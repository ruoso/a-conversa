# a-conversa — top-level task runner.
#
# Thin wrappers around pnpm and docker compose. The compose targets
# below were originally added by foundation.dev_env.compose_file and
# wrapped with friendlier UX (env-file auto-create, health-wait, URL
# banner) by foundation.dev_env.one_command_script.
#
# The split between `up` (postgres + authelia) and `up-app` (app on
# top) was introduced when the app image's runtime entry point was
# still the stub from ADR 0015 (exit 0 + restart loop). The real
# Fastify entry point has now landed (ADR 0023 /
# `backend.api_skeleton.http_server`), so the app container runs the
# server — but the compose healthcheck still targets `/healthz`, which
# is owned by `backend.api_skeleton.health_endpoint` and not yet
# implemented; the container is "running but unhealthy" until that
# sibling lands. We therefore keep the `up` / `up-app` split for one
# more task cycle so the default `make up` stays quiet; once
# `health_endpoint` (with migrations-on-startup) ships, `up` absorbs
# `up-app` and the split goes away. See ADR 0018 (Amendments) for
# context.

.PHONY: help install test up up-app migrate down down-v logs ps seed clean

help:
	@echo "a-conversa — make targets"
	@echo "  make install   pnpm install across all workspaces"
	@echo "  make test      run smoke tests (vitest, cucumber, playwright)"
	@echo "  make up        bring up postgres + authelia, wait for healthy, print URLs"
	@echo "  make up-app    bring up the app service too (runs the real Fastify server; /healthz still pending)"
	@echo "  make migrate   apply pending DB migrations against the running postgres (forward-only; ADR 0020)"
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
	@echo "  app        http://localhost:3000   (bring up with 'make up-app'; /healthz pending)"

up-app:
	@docker compose up -d --build app
	@echo ""
	@echo "app service started. The Fastify server is listening on :3000; 'curl http://localhost:3000/'"
	@echo "returns {\"status\":\"ok\"}. The compose healthcheck targets /healthz (still pending —"
	@echo "owned by backend.api_skeleton.health_endpoint), so 'docker compose ps' shows the service"
	@echo "as unhealthy until that sibling lands. See ADR 0023 + ADR 0015 (Amendments) for context."

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
