# a-conversa — top-level task runner.
#
# Thin wrappers around pnpm and docker compose. The compose targets
# below were originally added by foundation.dev_env.compose_file and
# wrapped with friendlier UX (env-file auto-create, health-wait, URL
# banner) by foundation.dev_env.one_command_script.
#
# The split between `up` (postgres + authelia) and `up-app` (app on
# top) is honest about today's reality: the application image's
# runtime entry point is still the stub from ADR 0015 — it exits 0
# immediately, and `restart: unless-stopped` then re-launches it in a
# tight loop. Bringing the backing services up alone gives a quiet,
# usable dev stack today; `up-app` (and eventually full-stack `up`)
# becomes non-noisy once `backend.api_skeleton` lands. See ADR 0018
# (Amendments) for the rationale.

.PHONY: help install test up up-app down down-v logs ps seed clean

help:
	@echo "a-conversa — make targets"
	@echo "  make install   pnpm install across all workspaces"
	@echo "  make test      run smoke tests (vitest, cucumber, playwright)"
	@echo "  make up        bring up postgres + authelia, wait for healthy, print URLs"
	@echo "  make up-app    bring up the app service too (loops on stub entry point until backend.api_skeleton)"
	@echo "  make down      stop the dev stack (volumes preserved)"
	@echo "  make down-v    stop the dev stack and drop named volumes"
	@echo "  make logs      tail logs from the dev stack"
	@echo "  make ps        show dev-stack service status"
	@echo "  make seed      seed the dev database (stub — see foundation.dev_env.seed_data_script)"
	@echo "  make clean     remove build artifacts and caches"

install:
	@pnpm install -r

test:
	@pnpm run test:smoke
	@pnpm run test:behavior:smoke
	@pnpm run test:e2e:smoke

up:
	@if [ ! -f .env ]; then \
		echo "[ensuring .env from .env.example]"; \
		cp .env.example .env; \
	fi
	@docker compose up -d --build postgres authelia
	@echo "[waiting ~15s for postgres + authelia to report healthy]"
	@sleep 15
	@docker compose ps
	@echo ""
	@echo "Dev stack ready:"
	@echo "  postgres   localhost:5432"
	@echo "  authelia   http://localhost:9091"
	@echo "  app        http://localhost:3000   (waits on backend.api_skeleton; bring up with 'make up-app')"

up-app:
	@docker compose up -d --build app
	@echo ""
	@echo "app service started. Note: until backend.api_skeleton lands, the entry point exits 0"
	@echo "and the container restarts in a loop. See ADR 0018 (Amendments) for context."

down:
	@docker compose down

down-v:
	@docker compose down -v

logs:
	@docker compose logs -f

ps:
	@docker compose ps

seed:
	@pnpm run seed -- $(if $(FIXTURE),--fixture $(FIXTURE))

clean:
	@rm -rf node_modules apps/*/node_modules packages/*/node_modules
	@rm -rf dist build coverage playwright-report test-results
