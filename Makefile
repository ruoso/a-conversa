# a-conversa — top-level task runner.
#
# Thin wrappers around pnpm and docker compose. The compose targets
# below were originally added by foundation.dev_env.compose_file and
# wrapped with friendlier UX (env-file auto-create, health-wait, URL
# banner) by foundation.dev_env.one_command_script.
#
# `make up` brings up postgres, authelia, AND app. The historical
# split between `up` (backing services only) and `up-app` (app on
# top) existed while the runtime entry point was an ADR-0015 stub
# and again while `/healthz` was unimplemented; both gaps are now
# closed (`backend.api_skeleton.http_server` shipped the real
# Fastify entry, `backend.api_skeleton.health_endpoint` shipped the
# liveness probe + startup migration gate). `make up-app` remains as
# a thin alias for back-compat with existing dev-loop muscle memory.
# See ADR 0018 / ADR 0023 / ADR 0020 (Amendments) for context.

.PHONY: help install check test test\:e2e test\:e2e\:compose up up-app migrate down down-v logs ps seed clean

help:
	@echo "a-conversa — make targets"
	@echo "  make install   pnpm install across all workspaces"
	@echo "  make check     run the full static-analysis bundle (lint + format:check + typecheck x3)"
	@echo "                 — same target invoked by the pre-commit hook and by CI"
	@echo "  make test      run smoke tests (vitest, cucumber, playwright)"
	@echo "  make test:e2e  run the Playwright e2e suite against an already-running server (assumes 'make up')"
	@echo "  make test:e2e:compose  bring up compose, run e2e, tear down (slow but realistic)"
	@echo "  make up        bring up the whole dev stack (postgres + authelia + app), wait for healthy, print URLs"
	@echo "  make up-app    alias for 'make up' (back-compat; the old up/up-app split is gone)"
	@echo "  make migrate   apply pending DB migrations against the running postgres (forward-only; ADR 0020)"
	@echo "                 — usually unnecessary now that 'make up' applies migrations on app startup"
	@echo "  make down      stop the dev stack (volumes preserved)"
	@echo "  make down-v    stop the dev stack and drop named volumes"
	@echo "  make logs      tail logs from the dev stack"
	@echo "  make ps        show dev-stack service status"
	@echo "  make seed      seed the dev database (stub — see foundation.dev_env.seed_data_script)"
	@echo "  make clean     remove build artifacts and caches"

install:
	@pnpm install -r

# Single entry point for the static-analysis bundle. Used by:
#   - the Husky pre-commit hook (`.husky/pre-commit`)
#   - the GH Actions CI workflow (`.github/workflows/ci.yml`)
# so dev + CI share one contract. See ADR 0014 (Amendment 2026-05-11).
check:
	@pnpm run check

test:
	@pnpm run test:smoke
	@pnpm run test:behavior:smoke
	@pnpm run test:e2e:smoke

# Run the Playwright e2e suite against an already-running server. The
# default baseURL is `http://localhost:3000` — set PLAYWRIGHT_BASE_URL
# to override (e.g., pointing at a remote staging host). The compose
# stack (`make up`) MUST be running, otherwise every spec times out
# against a connection-refused error. See README "End-to-end tests"
# for the full local-dev story.
test\:e2e:
	@pnpm run test:e2e

# Bring up the compose stack, wait for `/healthz` to flip to 200, run
# the e2e suite, then tear the stack down (with -v so the named
# volumes are dropped — leaves the dev env clean for the next run).
# The teardown runs whether the suite passes or fails so a Playwright
# crash never leaks compose state.
test\:e2e\:compose:
	@$(MAKE) up
	@echo "[waiting for /healthz to flip to 200]"
	@for i in $$(seq 1 60); do \
		if curl --fail --silent http://localhost:3000/healthz > /dev/null 2>&1; then \
			echo "[/healthz OK after $${i}s]"; \
			break; \
		fi; \
		sleep 1; \
	done
	@status=0; \
		$(MAKE) test:e2e || status=$$?; \
		$(MAKE) down-v; \
		exit $$status

up:
	@if [ ! -f .env ]; then \
		echo "[ensuring .env from .env.example]"; \
		cp .env.example .env; \
	fi
	@docker compose up -d --build postgres authelia app
	@echo "[waiting up to ~60s for services to report healthy]"
	@sleep 30
	@docker compose ps
	@echo ""
	@echo "Dev stack ready:"
	@echo "  postgres   localhost:5432"
	@echo "  authelia   http://localhost:9091"
	@echo "  app        http://localhost:3000   (curl /healthz returns 200; / returns {\"status\":\"ok\"})"

# Alias for `make up`. Kept so existing muscle memory / docs that
# reference `make up-app` still work; the split it used to enforce
# (backing services first, then the app) is no longer needed now
# that the app applies migrations on startup and the healthcheck
# (targeting /healthz) flips to healthy.
up-app: up

# Apply pending DB migrations (forward-only; see ADR 0020).
# Connects to the running postgres via DATABASE_URL from .env. The
# `make up` postgres maps host port 5432, but DATABASE_URL in
# .env.example points at the in-Compose hostname `postgres` — running
# from the host shell needs a localhost-flavoured URL. The override
# below swaps `@postgres:` for `@localhost:` so `make migrate` works
# off the .env without further editing. Inside the eventual app
# container (post-backend.api_skeleton) the unmodified URL is correct.
migrate:
	@if [ ! -f .env ]; then \
		echo "[migrate] .env missing — run 'make up' first to seed it from .env.example"; \
		exit 1; \
	fi
	@set -a; . ./.env; set +a; \
		DATABASE_URL=$$(echo "$$DATABASE_URL" | sed 's|@postgres:|@localhost:|') \
		pnpm run migrate

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
