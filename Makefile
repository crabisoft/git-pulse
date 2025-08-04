# Everyday tasks. Run `make` (or `make help`) to list the commands.
.DEFAULT_GOAL := help
COMPOSE := sh .docker/compose.sh

.PHONY: help install build typecheck \
        dev dev-down logs restart ps \
        prod prod-down \
        migrate deploy studio db-reset psql sh-back \
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

# ─── Docker: development (watch / HMR) ───────────────────────────────
dev: ## Start the dev stack (db + redis + back watch + front HMR)
	npm run docker:dev

dev-down: ## Stop the dev stack
	npm run docker:dev:down

logs: ## Follow the dev stack logs
	npm run docker:logs

restart: dev-down dev ## Restart the dev stack

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

deploy: ## Apply pending migrations
	npm run db:deploy

studio: ## Open Prisma Studio (data browser)
	npm run db:studio

db-reset: ## Reset the dev database (DESTRUCTIVE, asks for confirmation)
	cd back && npx prisma migrate reset

psql: ## psql console on the dev database (running container)
	$(COMPOSE) dev exec db psql -U dashboard dashboard

sh-back: ## Open a shell in the back container (dev)
	$(COMPOSE) dev exec back sh

# ─── Cleanup ─────────────────────────────────────────────────────────
clean: ## Remove build artifacts (dist)
	rm -rf back/dist front/dist packages/shared/dist

clean-all: clean ## Also remove node_modules
	rm -rf node_modules back/node_modules front/node_modules packages/shared/node_modules
