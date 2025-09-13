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

## Navigation (front)

Chaque module, section et page a son URL — react-router en `BrowserRouter`, le
fallback SPA étant déjà assuré par nginx en prod et par Vite en dev.

| URL | Page |
|---|---|
| `/dashboard/:slug` | Vue live d'une source |
| `/dora/:slug` | Métriques DORA d'une source |
| `/settings/general` | Réglages applicatifs |
| `/settings/sources` | Sources GitHub / GitLab |
| `/settings/environments/:slug` | Règles de classification (`?target=repository` pour l'onglet repos) |

`/`, `/dashboard`, `/dora` et `/settings/environments` redirigent vers la
première source ; `/settings` vers `/settings/general` ; tout le reste vers le
dashboard.

Le segment de source est le **slug** (`Source.slug`), forme URL-safe et unique
du nom : `SISMIC — Prod` donne `/dashboard/sismic-prod`. Deux sources de même
nom sont départagées par un suffixe (`prod`, `prod-2`). L'API, elle, continue
d'adresser les sources par `id` : le front résout slug → id depuis la liste
qu'il charge déjà pour le sélecteur, sans requête supplémentaire.

L'URL est la source de vérité du sélecteur : en changer garde la page courante
et ne remplace que le slug. Un slug inconnu — source supprimée ou renommée —
bascule sur la première source, ou sur l'état vide s'il n'en reste aucune.

> Le slug suit le nom : **renommer une source invalide ses anciens liens**. Le
> repli évite la page morte, mais le lien ne pointe plus sur la même source.

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

## Règles de classification

Une règle est une RegEx associée à une source. Deux axes indépendants :

- **`kind`** — `simple` extrait des attributs via les groupes nommés
  (`(?<app>…)` donne `app=…`) ; `meta` ne teste que l'appartenance et ajoute le
  **nom de la règle** comme méta-environnement. Une règle `meta` ignore
  totalement ses groupes nommés.
- **`target`** — `environment` s'applique aux noms d'environnements de
  déploiement, `repository` aux noms de repos.

Les règles `repository` existent parce qu'une pull request n'a pas
d'environnement : sans elles, `lead_time`, `coding_time`, `pickup_time` et
`review_time` retombent tous dans un seul bucket global. Classer le nom de repo
leur donne les mêmes dimensions que les métriques de déploiement.

`GET /api/sources/:id/env-rules?target=repository` liste une cible à la fois
(`environment` par défaut). Le patterns sont testés **non ancrés** — pensez à
`^` et `$` si vous voulez un match sur le nom entier.

## Filtres des métriques DORA

`GET /api/sources/:id/dora` répond un `DoraReport` : les résultats paginés, plus
les vocabulaires dont les contrôles de filtre ont besoin (`repos`,
`dimensions`) et la `period` effectivement appliquée.

| Paramètre | Effet |
|---|---|
| `from` / `to` | Période, dates ISO, bornes inclusives |
| `windowDays` | Fenêtre glissante en jours, se terminant à `to` |
| `repos` | **Scope la collecte** (répétable ou séparé par des virgules) |
| `dimension` | **Tranche les résultats**, paires `key:value` répétables |

`?from=2026-01-01&to=2026-01-31&repos=extranet-api&dimension=app:Extranet&dimension=type:Prod`

Deux natures distinctes de filtre :

- **`repos` agit avant les connecteurs.** Comme ils itèrent repo par repo, une
  liste plus courte veut dire *moins* d'appels API, pas plus.
- **`dimension` agit après le calcul.** Toutes les paires doivent correspondre.

Les vocabulaires sont calculés **avant** le tranchage — restreindre un filtre ne
vide jamais la liste dans laquelle on choisit, et `repos` reste toujours complet
même quand la sélection courante ne ramène rien.

### Période

Trois façons de demander une période, par précédence décroissante : un `from`
explicite, une fenêtre glissante `windowDays`, puis le réglage `doraWindowDays`.
Une date sans heure (`2026-01-31`) est prise en fin de journée UTC, et `to` omis
vaut maintenant. Sans paramètre on retrouve donc la fenêtre glissante des
réglages — ce que fait le snapshot planifié, qui reste volontairement non filtré
pour que l'historique et les sparklines restent cohérents.

`period.windowDays` renvoie la fenêtre effectivement appliquée, ou `null` quand
`from` était explicite. C'est ce qui permet à la page DORA d'afficher d'emblée
l'entrée correspondant au réglage courant, sans avoir à rejouer la logique de
repli côté front.

Sur la page DORA, l'entrée « Personnalisée » saisit les bornes dans une modale
et ne relance le calcul qu'à la validation : chaque requête DORA déclenche une
salve d'appels connecteurs, trop coûteuse pour être rejouée à chaque frappe dans
un champ date. Une borne laissée vide reste ouverte.

Le sélecteur de période — page DORA comme réglages — propose les mêmes valeurs
(`DORA_WINDOW_PRESETS` : 15 j, 1, 2, 3, 6 mois, 1 et 2 ans ; un mois compte 30
jours, une année 365). L'API, elle, accepte n'importe quelle valeur entre
`DORA_WINDOW_MIN` et `DORA_WINDOW_MAX` : une fenêtre hors presets déjà
enregistrée reste donc proposée dans la liste plutôt que réécrite en silence.

> Les attributs des règles `environment` et `repository` partagent le même
> espace de noms. Si `app` existe des deux côtés, les valeurs doivent être
> **identiques au caractère près** : `app=Extranet` côté environnements et
> `app=extranet` côté repos donneraient deux entrées distinctes, et filtrer sur
> l'une exclurait les métriques de l'autre.

### Rythme des requêtes (front)

Le dashboard et la page DORA lancent tous deux une requête coûteuse à chaque
état de leurs filtres. Deux garde-fous, mutualisés dans `front/src/hooks.ts` :

- **`useDebounced` (500 ms)** — cocher les dépôts un par un, ou enchaîner les
  pages, n'émet qu'une requête une fois la rafale terminée. C'est ce qui épargne
  le back : une requête annulée reste calculée côté serveur, NestJS ne
  s'interrompt pas parce que le client a raccroché.
- **`useCancellableLoad`** — chaque chargement annule celui qu'il remplace, et
  quitter la page annule aussi. Garantit que la vue affiche la réponse à sa
  dernière question, pas celle qui arrive en dernier.

Un abort n'est pas une erreur : `isAbort()` le distingue dans `api.ts` pour
qu'une annulation ne s'affiche jamais en bannière rouge, et le chargement
abandonné laisse le drapeau `loading` à celui qui l'a remplacé.

### Annulation côté back

Fermer la connexion ne suffit pas à arrêter Nest : sans rien faire, la collecte
irait au bout pour une réponse que personne ne lira. Les deux routes coûteuses
(`/dashboard/:id/live` et `/sources/:id/dora`) propagent donc l'abandon jusqu'aux
connecteurs.

`abortOnDisconnect(res)` (`common/request-abort.ts`) écoute le `close` de la
**réponse** — il signale soit la fin normale, soit une connexion coupée, et
`writableEnded` départage les deux. Le signal voyage ensuite dans
`ConnectorContext`, qui atteint déjà toutes les méthodes de `SourceConnector` :
aucune signature à changer.

Un connecteur l'honore de deux façons :

- **Au niveau HTTP**, quand le client le permet. Octokit accepte
  `request: { signal }` posé à la construction, ce qui couvre tous ses appels,
  `paginate()` compris. gitbeaker, lui, ne laisse pas passer : son helper
  reconstruit le signal depuis `queryTimeout` et pousse celui du caller dans la
  query string.
- **Entre deux repos**, via `ctx.signal?.throwIfAborted()` dans chaque boucle —
  et dans les boucles internes qui déclenchent un appel par PR/MR. C'est le
  garde-fou qui compte : le coût est le fan-out, pas un appel isolé. Il ne
  dépend d'aucune bibliothèque, et c'est donc lui qui couvre GitLab.

Deux conséquences à ne pas perdre de vue :

- Les `catch` best-effort des services (une permission manquante dégrade en
  métriques partielles) appellent `throwIfAborted(signal)` **avant** de dégrader.
  Une annulation n'a rien à dégrader : elle doit arrêter le travail, pas
  retourner une liste vide qui ressemblerait à « aucune donnée ».
- Une requête annulée répond **499** (`errors.aborted`), hors du bucket 5xx :
  le filtre ne la journalise pas comme une erreur serveur. La collecte planifiée
  n'a pas de signal — personne ne l'attend, rien ne l'annule.

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
