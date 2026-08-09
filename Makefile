# Everyday tasks. Run `make` (or `make help`) to list the commands.
.DEFAULT_GOAL := help
COMPOSE := sh .docker/compose.sh
# Stack the container targets act on. Override with `mode=prod`.
mode ?= dev
# Where `make backup` writes. Override with `out=/somewhere/else`.
out ?= backup
# Where `make restore` reads. Defaults to what the backup wrote, so a pair run
# with the same `out=` needs it stated once.
in ?= $(out)
# Which suite `make screenshots` runs. The guide's by default;
# `suite=screenshots` regenerates the README's five instead.
suite ?= screenshots:docs
# Set to anything to rebuild the screenshots container before running it. Empty
# means the existing image is reused — see the target for why that is the
# default, and when this is the answer.
rebuild ?=
# Database `make smoke` creates and drops. Its default matches the value the
# checks service builds its DATABASE_URL from in .docker/docker-compose.dev.yml.
SMOKE_DB ?= smoke

.PHONY: help install prepare build typecheck test catalogue images smoke \
        check ci storybook docs screenshots \
        dev dev-down stop start logs restart restart-back ps \
        prod prod-down \
        migrate deploy studio db-reset psql sh-back set-password \
        backup restore \
        demo demo-clear \
        clean clean-all

help: ## Show this help
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ─── Project ─────────────────────────────────────────────────────────
# Every check runs in the dev image through the `checks` service, and the CI
# runs these very targets — so what breaks there breaks here, on the same Node
# and the same dependencies, with no version of anything restated in a workflow
# file. `run` builds the image when it is missing and reuses it after: the first
# check on a fresh clone costs an image build and an install, and the
# dependencies then live in volumes of their own and survive.
#
# As the calling user, so what lands in the working tree — dist, the catalogue,
# the guide — belongs to whoever asked for it.
#
# The exception is a shell already inside a container with the project's Node,
# which says so with DEVCONTAINER=true — the devcontainer sets it, and so does
# the dev image. There the commands run as they are, on what `make install`
# put in place, since a container has no Docker to start another one with.
ifeq ($(DEVCONTAINER),true)
CHECKS := sh -c
else
CHECKS := HOST_UID=$$(id -u) HOST_GID=$$(id -g) \
	$(COMPOSE) dev --profile checks run --rm -T checks sh -c
endif

install: ## Install on the host, for editors and language servers only
	npm install

# What every check reads before it can say anything true: both sides typecheck
# against @repo/shared's dist and the generated Prisma client, and a clone that
# skips this reports errors that are not in the code.
#
# The install is skipped while the installed tree is newer than the lockfile —
# npm writes node_modules/.package-lock.json on every install, and the CI starts
# from empty volumes, so it installs once there and never again in the same run.
prepare: ## Install and generate what the checks read
	$(CHECKS) "[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci; \
		npm run build:shared && npm run prisma:generate -w @repo/back"

build: prepare ## Full build (shared → back → front)
	$(CHECKS) "npm run build"

typecheck: prepare ## Type-check the whole monorepo
	$(CHECKS) "npm run typecheck"

test: prepare ## Run the unit tests (pure engines: classification, DORA, tickets)
	$(CHECKS) "npm test"

# A story that no longer compiles is a catalogue entry nobody would notice was
# gone — nothing renders it until somebody opens it.
catalogue: prepare ## Build the component catalogue
	$(CHECKS) "npm run build-storybook -w @repo/front"

# The images are how the project is meant to be deployed, so a broken Dockerfile
# is a broken release. Tagged `local` rather than `ci`: the same build, run from
# either side.
images: ## Build the production images
	docker build -f .docker/Dockerfile.back -t git-pulse-back:local .
	docker build -f .docker/Dockerfile.front -t git-pulse-front:local .

# The one check that opens a database connection — see scripts/smoke.sh for what
# that buys. On a database of its own, so a check never migrates and never
# resets the data being worked on; the second one is the shadow the migration
# diff needs. Both are dropped and recreated here rather than cleaned up after:
# the run starts from a known empty state whatever the last one did, and a
# failed run leaves its database standing to be looked at. The owner comes from
# the db container's own environment rather than from a second copy of it here.
smoke: prepare ## Boot the API against a real database
	$(COMPOSE) dev up -d --wait db redis
	@$(COMPOSE) dev exec -T db sh -c 'psql -U "$$POSTGRES_USER" -d postgres -q \
		-c "DROP DATABASE IF EXISTS $(SMOKE_DB)" -c "CREATE DATABASE $(SMOKE_DB)" \
		-c "DROP DATABASE IF EXISTS $(SMOKE_DB)_shadow" -c "CREATE DATABASE $(SMOKE_DB)_shadow"'
	$(CHECKS) "sh scripts/smoke.sh"

check: typecheck test catalogue smoke ## Every check the CI runs, except the images
	@echo "All checks passed."

ci: check images ## Everything the CI runs

# In the running front container, like every other target that needs the
# dependencies installed: the host has no node_modules of its own for this, and
# the ones the dev stack installs belong to root. Needs `make dev` first.
storybook: ## Component catalogue on http://localhost:6006 (needs the dev stack up)
	$(COMPOSE) dev exec front npm run storybook -w @repo/front -- --host 0.0.0.0 --no-open

# In the checks container, which is where Sphinx is: the dev image carries it in
# a virtualenv, so nothing has to be installed on the host to build the guide,
# and the CI builds it the same way rather than with a Python of its own.
# Warnings are fatal here exactly as they are on Read the Docs — see
# docs/technical/user-guide.md.
#
# No stack needed, unlike before: the guide is text, it reads nothing from the
# database. As the calling user, so the HTML in the working tree is openable in
# a browser on the host without sudo.
docs: ## Build the user guide (HTML in docs/user/build/html)
	$(CHECKS) 'make -C docs/user html SPHINXBUILD=$$DOCS_VENV/bin/sphinx-build'
	@echo "Open docs/user/build/html/index.html"

# The one target with a container of its own, and the one that needs no stack
# running: the suite stubs every API call and starts a Vite of its own, so this
# works on a machine where `make dev` was never typed.
#
# No `--build`. `run` builds a service whose image is missing and reuses it
# otherwise, which is the behaviour wanted here: the image appears the first
# time somebody asks for the images — the service sits behind a compose profile
# precisely so that nothing else ever brings it into existence — and every run
# after that is a container start. Expect a few minutes on that first one: a
# browser and its libraries are being downloaded.
#
# What that costs is an image that no longer tracks its Dockerfile, so a change
# to it, or to PLAYWRIGHT_IMAGE, is picked up with `make screenshots rebuild=1`.
#
# As the caller, like `docs` above and for the same reason: the PNGs land in the
# working tree, and a root-owned PNG needs sudo to regenerate.
screenshots: ## Regenerate the user guide's images (its container is built on first use)
	HOST_UID=$$(id -u) HOST_GID=$$(id -g) SCREENSHOT_SUITE=$(suite) \
		$(COMPOSE) dev --profile screenshots run --rm $(if $(rebuild),--build) screenshots
	@echo "Written to docs/user/source/images — review them before committing."

# ─── Docker: development (watch / HMR) ───────────────────────────────
dev: ## Start the dev stack (db + redis + back watch + front HMR)
	npm run docker:dev

# Takes the containers away with it — the named volumes survive, so the
# database and the installed dependencies do. `stop` below is the other half of
# the distinction, and the one wanted most of the time.
dev-down: ## Stop the dev stack and remove its containers
	npm run docker:dev:down

# The pair `down`/`up` does not have: the containers stay, with their state and
# their filesystem, and `start` puts them back exactly as they were. Nothing is
# recreated and nothing is rebuilt, so this is also what to reach for when a
# rebuild is precisely what you do not want.
#
# Mode-aware like the database targets: `make stop mode=prod`.
stop: ## Stop the containers without removing them
	$(COMPOSE) $(mode) stop

start: ## Start the containers stopped by `make stop`
	$(COMPOSE) $(mode) start

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

prod-down: ## Stop the prod stack and remove its containers
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

# ─── Backup ──────────────────────────────────────────────────────────
# The two halves, in one pass, with the stack running: a dump restored without
# its key gives back credentials nobody can decrypt. `pg_dump` snapshots a live
# database, so nothing has to be stopped. Adjust the user and database name
# below if POSTGRES_USER or POSTGRES_DB were changed in .docker/.env.local.
# Keep the key somewhere other than the dump — see
# docs/runbooks/backup-and-restore.md, which also covers the restore.
backup: ## Back up the database and the master key (usage: make backup [out=backup] [mode=prod])
	@mkdir -p "$(out)"
	$(COMPOSE) $(mode) exec -T db pg_dump -U dashboard --format=custom dashboard > "$(out)/dashboard.dump"
	$(COMPOSE) $(mode) exec -T back cat /data/master.key > "$(out)/master.key"
	@chmod 600 "$(out)/master.key"
	@echo "Wrote $(out)/dashboard.dump and $(out)/master.key — store the key apart from the dump."

# The inverse, in the one order that works: the database first, then the key
# **before the API starts**, since it is read once on boot.
#
# Destructive where the backup was not. `--clean --if-exists` drops what the
# dump replaces, so this overwrites the install it is pointed at rather than
# merging into it — hence the confirmation, which `yes=1` skips for a script.
# The database is started on its own and waited on: `pg_restore` against a
# container that is up but not yet accepting connections fails halfway.
#
# A missing key is a case rather than a failure: the dump restores, every
# encrypted column stays unreadable, and each secret is re-entered by hand. That
# is a documented way out of a lost key, so it is reported and not refused.
restore: ## Restore the database and the master key (usage: make restore [in=backup] [mode=prod] [yes=1])
	@test -f "$(in)/dashboard.dump" \
		|| { echo "No dump at $(in)/dashboard.dump — point at one with in=<directory>."; exit 1; }
	@test -n "$(yes)" || { \
		printf 'Replace the %s database with %s? Type yes to continue: ' "$(mode)" "$(in)/dashboard.dump"; \
		read -r reply; test "$$reply" = yes; \
	} || { echo "Aborted."; exit 1; }
	$(COMPOSE) $(mode) up -d db
	@echo "Waiting for the database to accept connections…"
	@i=0; until $(COMPOSE) $(mode) exec -T db pg_isready -U dashboard >/dev/null 2>&1; do \
		i=$$((i + 1)); \
		test $$i -lt 60 || { echo "The database is still not ready after 60s."; exit 1; }; \
		sleep 1; \
	done
	$(COMPOSE) $(mode) exec -T db pg_restore -U dashboard -d dashboard --clean --if-exists < "$(in)/dashboard.dump"
	@if [ -f "$(in)/master.key" ]; then \
		$(COMPOSE) $(mode) run --rm -T back \
			sh -c 'cat > /data/master.key && chmod 600 /data/master.key' < "$(in)/master.key"; \
	else \
		echo "No $(in)/master.key: the stored credentials stay unreadable and each secret has to be"; \
		echo "re-entered from Settings — see docs/runbooks/backup-and-restore.md."; \
	fi
	$(COMPOSE) $(mode) up -d
	@echo "Restored. Open Settings › Sources and press Test on a source: that call decrypts a token,"
	@echo "which is what proves the key matches the data."

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
