# Git Dashboard — GitHub / GitLab

Dashboard **self-hosted** de monitoring GitHub et GitLab : vue live PR/MR &
pipelines, avec un socle prêt pour l'historisation DORA (Phase 2), la
génération de release notes assistée par IA (Phase 3) et les métriques
étendues (Phase 4).

> Spécification complète : voir le document de cadrage partagé à l'équipe.

## Commandes courantes

Un `Makefile` regroupe les tâches du quotidien — tapez `make` (sans argument)
pour la liste complète auto-documentée :

| Commande | Effet |
|---|---|
| `make dev` | Stack de dev (db + redis + API watch + Vite HMR) |
| `make logs` | Suivre les logs |
| `make migrate name=x` | Créer une migration |
| `make deploy` | Appliquer les migrations en attente |
| `make prod` | Stack de prod (build + nginx) |
| `make build` | Build complet du monorepo |
| `make clean` | Nettoyer les artefacts de build |

Les cibles délèguent aux scripts npm et au wrapper Docker décrits ci-dessous.

## Stack

| Couche | Techno |
|--------|--------|
| Frontend | React + TypeScript (Vite) |
| Backend | NestJS (TypeScript) |
| Base de données | PostgreSQL (Prisma) |
| Jobs / cache | Redis (BullMQ — Phase 2) |
| Sources | Octokit (GitHub) · @gitbeaker (GitLab) |

Monorepo **npm workspaces** : `back`, `front`, `packages/shared`.

## Architecture (Phase 1)

- **`SourceConnector`** — interface commune ; implémentations `GitHubConnector`
  et `GitLabConnector` normalisent PR/MR, pipelines, déploiements. URLs de base
  paramétrables (GitLab self-hosted / GitHub Enterprise).
- **`CryptoModule`** — secrets (tokens, clés) chiffrés au repos en AES-256-GCM.
  Master key générée au premier démarrage dans un fichier `0600`, ou fournie
  via `MASTER_KEY` (base64) pour Kubernetes / secret manager.
- **`SourcesModule`** — CRUD des sources + test de connexion.
- **`DashboardModule`** — agrégation live par source.

## Pagination des routes de liste

Toute route qui retourne une liste accepte `?limit=&offset=` et répond
`{ items, page: { total, limit, offset, hasMore } }`. Omettre `limit` applique
la taille de page configurée — réglage `pageSize` de la section Paramètres, à
`PAGE_LIMIT_DEFAULT` (10) sur une nouvelle installation. `limit` reste plafonné
à `PAGE_LIMIT_MAX` (200) ; au-delà la requête est rejetée en 400.

`GET /api/dashboard/:sourceId/live` agrège trois listes et expose donc une
fenêtre par liste — `prsLimit`/`prsOffset`, `pipelinesLimit`/`pipelinesOffset`,
`environmentsLimit`/`environmentsOffset` — plus un filtre `repos` (répétable ou
séparé par des virgules) appliqué en amont : les compteurs de `summary` portent
sur l'ensemble filtré, jamais sur la seule fenêtre retournée.

## Démarrage — Docker (recommandé)

Toute la configuration Docker vit dans `.docker/` :

```
.docker/
  docker-compose.yml       # base : db + redis
  docker-compose.dev.yml   # override DEV : watch / HMR, code monté en volume
  docker-compose.prod.yml  # override PROD : images buildées + nginx
  Dockerfile.back · Dockerfile.front · nginx.conf
  .env                     # défauts versionnés (aucun secret réel)
  .env.local               # vos surcharges locales (git-ignoré)
  .env.local.example       # modèle à copier
  compose.sh               # wrapper : mode + chaînage .env/.env.local
```

**Mode dev (recommandé au quotidien)** — rechargement à chaud : `nest start
--watch` côté API, serveur Vite (HMR) côté front. Le code source est monté en
volume, aucune reconstruction d'image à chaque modification.

```bash
npm run docker:dev         # db + redis + API (watch) + front (Vite/HMR)
# Front : http://localhost:5173   ·   API : http://localhost:3001/api
npm run docker:logs        # logs suivis
npm run docker:dev:down    # arrêt
```

> Premier lancement : les conteneurs dev exécutent `npm install` dans un volume
> `node_modules` dédié (binaires Alpine) — comptez une minute la première fois,
> instantané ensuite.

**Mode prod (validation d'un build)** — API compilée + front statique servi par nginx.

```bash
npm run docker:prod        # build les images + démarre
# Web : http://localhost:8080   ·   API : http://localhost:3001/api
npm run docker:prod:down   # arrêt
```

**Personnaliser l'environnement** — ne modifiez pas `.docker/.env` (versionné) :
copiez le modèle et surchargez seulement ce qui vous concerne.

```bash
cp .docker/.env.local.example .docker/.env.local
# éditez .docker/.env.local — ex. WEB_PORT=9090, API_PORT=3100
npm run docker:up
```

`.env.local` écrase `.env` au lancement (le wrapper `compose.sh` chaîne les
deux `--env-file`). Variables disponibles : ports hôte, identifiants Postgres,
`WEB_ORIGIN`, `VITE_API_URL`, images…

> ⚠️ **Master key** : persistée dans le volume `master-key`. Sa perte rend tous
> les secrets stockés irrécupérables — sauvegardez-la séparément.

## Démarrage — local (dev)

Prérequis : Node 20+, un PostgreSQL et un Redis accessibles (voir `.env`).

```bash
npm install
npm run build:shared
npm run db:deploy                        # applique les migrations
npm run dev:back                         # http://localhost:3001
npm run dev:front                        # http://localhost:5173
```

## Configurer une source

1. Onglet **Sources** → *Ajouter une source*.
2. Plateforme, URL de base (ex. `https://gitlab.example.com`), organisation/groupe,
   méthode d'auth et secret (token). Le secret est chiffré immédiatement.
3. **Tester** la connexion, puis basculer sur l'onglet **Dashboard**.

## Migrations de base de données

Le schéma est géré par des **migrations versionnées** (Prisma), commitées dans
`back/prisma/migrations/` et embarquées dans l'image de prod.

**Appliquer les migrations** — automatique au démarrage des conteneurs :
`prisma migrate deploy` s'exécute avant l'API, en **dev** comme en **prod**
(non-interactif, idempotent). En local sans Docker : `npm run db:deploy`.

**Créer une migration** — après avoir modifié `back/prisma/schema.prisma` :

```bash
# base de dev accessible sur localhost:5432 (npm run docker:dev en cours)
npm run db:migrate -- --name ajout_table_x
# → génère back/prisma/migrations/<horodatage>_ajout_table_x/  → à commiter
```

> `db:migrate` (= `prisma migrate dev`) crée le fichier SQL, l'applique à la
> base de dev et régénère le client. En équipe, les fichiers de migration sont
> la source de vérité : commitez-les.

Autres commandes : `npm run db:deploy` (appliquer), `npm run db:studio`
(explorateur de données Prisma).

## Roadmap

- **Phase 1 ✅** Socle, connecteurs, chiffrement, dashboard live.
- **Phase 2** Historisation + DORA (4 métriques + décomposition lead time),
  moteur RegEx d'environnements (méta-env, priorité + cumul), jobs BullMQ.
- **Phase 3** Release notes tag→tag + reformulation IA (`LLMProvider`
  multi-fournisseurs), publication de Release.
- **Phase 4** Métriques review/CI/débit, alertes/seuils.
