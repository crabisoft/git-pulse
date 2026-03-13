# Everyday tasks. Run `make` (or `make help`) to list the commands.
.DEFAULT_GOAL := help
COMPOSE := sh .docker/compose.sh
# Stack the container targets act on. Override with `mode=prod`.
mode ?= dev

.PHONY: help install build typecheck test \
        dev dev-down logs restart restart-back ps \
        prod prod-down \
        migrate deploy studio db-reset psql sh-back set-password \
        demo demo-clear \
        clean clean-all

help: ## Show this help
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ─── Project ─────────────────────────────────────────────────────────
install: ## Install dependencies (npm)
	npm install

build: ## Full build (shared → back → front)
	npm run build

typecheck: ## Type-check the whole monorepo
	npm run typecheck

test: ## Run the unit tests (pure engines: classification, DORA, tickets)
	npm test

# ─── Docker: development (watch / HMR) ───────────────────────────────
dev: ## Start the dev stack (db + redis + back watch + front HMR)
	npm run docker:dev

dev-down: ## Stop the dev stack
	npm run docker:dev:down

logs: ## Follow the dev stack logs
	npm run docker:logs

restart: dev-down dev ## Restart the dev stack

restart-back: ## Restart only the back container (dev)
	$(COMPOSE) dev restart back

ps: ## Show container status
	$(COMPOSE) dev ps

# ─── Docker: production (build + nginx) ──────────────────────────────
prod: ## Build and start the prod stack
	npm run docker:prod

prod-down: ## Stop the prod stack
	npm run docker:prod:down

# ─── Database ────────────────────────────────────────────────────────
migrate: ## Create a migration  (usage: make migrate name=add_table)
	@test -n "$(name)" || { echo "Usage: make migrate name=<description>"; exit 1; }
	npm run db:migrate -- --name $(name)

# Through the container, unlike the targets below: DATABASE_URL is built by
# docker-compose for the back service and exists nowhere else, so the host has
# none unless somebody wrote a root .env by hand (see .env.example). The dev
# container applies pending migrations at boot anyway — `make restart-back`
# does this and reloads the API with it.
deploy: ## Apply pending migrations (in the running back container)
	$(COMPOSE) $(mode) exec back npm run prisma:deploy -w @repo/back

studio: ## Open Prisma Studio (data browser)
	npm run db:studio

db-reset: ## Reset the dev database (DESTRUCTIVE, asks for confirmation)
	cd back && npx prisma migrate reset

psql: ## psql console on the dev database (running container)
	$(COMPOSE) dev exec db psql -U dashboard dashboard

sh-back: ## Open a shell in the back container (dev)
	$(COMPOSE) dev exec back sh

# ─── Accounts ────────────────────────────────────────────────────────
# Recovery only: the UI handles accounts. Use it when no admin can sign in —
# an unknown address is created as one. The password goes through the shell,
# so it lands in its history: change it again from the UI afterwards.
set-password: ## Reset a password, or recreate an admin (usage: make set-password email=… password=… [mode=prod])
	@test -n "$(email)" -a -n "$(password)" \
		|| { echo "Usage: make set-password email=<email> password=<password>"; exit 1; }
	$(COMPOSE) $(mode) exec back node back/dist/scripts/set-password.js "$(email)" "$(password)"

# ─── Demo ────────────────────────────────────────────────────────────
# A fictional organization, written straight into the store. Nothing is
# collected and no credential is involved — see docs/technical/demo.md.
demo: ## Fill the install with demo data (usage: make demo [email=… password=…] [mode=prod])
	$(COMPOSE) $(mode) exec back node back/dist/scripts/seed-demo.js "$(email)" "$(password)"

demo-clear: ## Remove the demo source and its rules
	$(COMPOSE) $(mode) exec back node back/dist/scripts/seed-demo.js --clear

# ─── Cleanup ─────────────────────────────────────────────────────────
clean: ## Remove build artifacts (dist)
	rm -rf back/dist front/dist packages/shared/dist

clean-all: clean ## Also remove node_modules
	rm -rf node_modules back/node_modules front/node_modules packages/shared/node_modules
