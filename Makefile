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

.PHONY: help install check test test\:e2e test\:e2e\:compose up up-app up-prod-mode up-backing dev dev-app _bring-up migrate down down-v logs ps seed unblocked clean

help:
	@echo "a-conversa — make targets"
	@echo "  make install        pnpm install across all workspaces"
	@echo "  make check          run the full static-analysis bundle (lint + format:check + typecheck x3)"
	@echo "                      — same target invoked by the pre-commit hook and by CI"
	@echo "  make test           run smoke tests (vitest, cucumber, playwright)"
	@echo "  make test:e2e       run the Playwright e2e suite against an already-running server (assumes 'make up')"
	@echo "  make test:e2e:compose  drop volumes, bring up compose (dev mode), run e2e, tear down"
	@echo "  make up             bring up the whole dev stack with the dev compose override"
	@echo "                      (NODE_ENV=development; .env.example placeholders accepted)"
	@echo "  make up-prod-mode   like 'make up' but WITHOUT the dev override — boot gates match CI/production"
	@echo "                      (used by .github/workflows/ci.yml's e2e-playwright job)"
	@echo "  make up-app         alias for 'make up' (back-compat; the old up/up-app split is gone)"
	@echo "  make up-backing     bring up ONLY the backing services (postgres + authelia) — no app container"
	@echo "  make dev-app        build, then run the app on the HOST against the backing services"
	@echo "                      (assumes 'make up-backing'; rewrites in-compose hostnames to host ports)"
	@echo "  make dev            watch-mode host loop: backing services + backend on :3000 (tsx watch)"
	@echo "                      + root Vite dev server on :5174 with HMR. Loads every surface (and"
	@echo "                      graph-view/shell) from SOURCE, so editing any of them hot-reloads live."
	@echo "  make migrate        apply pending DB migrations against the running postgres (forward-only; ADR 0020)"
	@echo "                      — usually unnecessary now that 'make up' applies migrations on app startup"
	@echo "  make down           stop the dev stack (volumes preserved)"
	@echo "  make down-v         stop the dev stack and drop named volumes"
	@echo "  make logs           tail logs from the dev stack"
	@echo "  make ps             show dev-stack service status"
	@echo "  make seed           seed the dev database (stub — see foundation.dev_env.seed_data_script)"
	@echo "  make unblocked      list, per milestone, the leaf tasks that are currently unblocked"
	@echo "                      (uses tj3 to resolve the WBS dep graph; see scripts/unblocked.ts)"
	@echo "                      pass MILESTONE=<id> to scope to one milestone"
	@echo "  make clean          remove build artifacts and caches"

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
#
# A leading `down-v` guarantees the stack starts from a clean slate —
# the per-CI-run users/postgres state the Playwright suite assumes
# would otherwise be polluted by any prior `make up` left behind.
# Uses `up` (the dev override) because the Playwright suite drives
# browser flows against the dev compose; the prod-mode boot gates
# (strict secrets, CORS lockdown) are exercised by CI's dedicated
# `e2e-playwright` job, not by this local convenience target.
test\:e2e\:compose:
	@$(MAKE) down-v
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

# `make up` (ergonomic local dev) and `make up-prod-mode` (CI / realistic
# local e2e) share their boot body via the private `_bring-up` target;
# they differ only in which compose files get composed in. The dev
# override (`compose.dev.yaml`) flips `NODE_ENV=development` so the
# production-mode boot gates relax to dev defaults — see the header
# comment in `compose.dev.yaml` for the audit list.
COMPOSE_FILES_DEV  := -f compose.yaml -f compose.dev.yaml
COMPOSE_FILES_PROD := -f compose.yaml

up: COMPOSE_FILES := $(COMPOSE_FILES_DEV)
up: _bring-up

# Prod-mode boot. Used by `.github/workflows/ci.yml`'s `e2e-playwright`
# job so CI exercises the same boot gates production runs. Local devs
# can also reach for this when they want to reproduce a CI failure.
up-prod-mode: COMPOSE_FILES := $(COMPOSE_FILES_PROD)
up-prod-mode: _bring-up

# --- Host-app dev loop -------------------------------------------------
#
# `make up` runs everything (postgres + authelia + app) inside Compose,
# rebuilding the app image on every change — fine for a smoke check, slow
# for an edit/run loop. The pair below splits that: bring up only the
# backing services in Compose, then run the app process on the HOST
# against them (`pnpm` start, no image rebuild). `make dev` chains both.
#
# Two hostnames that resolve INSIDE the Compose network have to be
# remapped for a host-side process:
#   - DATABASE_URL's `@postgres:` host → `@localhost:` (postgres
#     publishes 5432 on the host; same rewrite `make migrate` uses).
#   - NODE_EXTRA_CA_CERTS → the on-disk cert path so Node trusts
#     Authelia's self-signed dev cert during OIDC discovery (the
#     compose `app` service mounts the same file at a container path).
# OIDC_ISSUER_URL is left as `authelia.aconversa.local` — OIDC discovery
# is lazy (first login, not boot), so the app starts fine without it
# resolving; browser login still needs the /etc/hosts alias the `up`
# banner documents.
#
# Runs with NODE_ENV=development so the production boot gates relax
# against `.env.example` placeholders — the same posture `compose.dev.yaml`
# gives the in-Compose app.

# Backing services only — postgres + authelia, no app container.
# `--wait` blocks until both report healthy (their compose healthchecks).
up-backing:
	@if [ ! -f .env ]; then \
		echo "[ensuring .env from .env.example]"; \
		cp .env.example .env; \
	fi
	@docker compose $(COMPOSE_FILES_DEV) up -d --wait postgres authelia
	@echo ""
	@echo "Backing services ready (app NOT started — run 'make dev-app'):"
	@echo "  postgres   localhost:5432"
	@echo "  authelia   https://authelia.aconversa.local:9091"

# Run the app on the host against the backing services. Builds first
# because the Fastify server fail-fasts at boot without the frontend
# `dist/` bundles (apps/root, apps/moderator, the surfaces). Runs in the
# foreground; Ctrl-C stops the app but leaves the backing services up
# (`make down` / `make down-v` to stop those). See the block comment
# above for the env rewrites.
dev-app:
	@if [ ! -f .env ]; then \
		echo "[dev-app] .env missing — run 'make up-backing' first to seed it from .env.example"; \
		exit 1; \
	fi
	@pnpm run build
	@echo "[dev-app] starting app on http://localhost:3000 (Ctrl-C to stop; backing services stay up)"
	@set -a; . ./.env; set +a; \
		DATABASE_URL=$$(echo "$$DATABASE_URL" | sed 's|@postgres:|@localhost:|') \
		NODE_ENV=development \
		NODE_EXTRA_CA_CERTS="$$(pwd)/infra/authelia/tls/cert.pem" \
		pnpm --filter @a-conversa/server start

# Watch-mode host dev loop (Vite HMR + backend watch).
#
# Backing services in Compose, then TWO host processes:
#   - backend on :3000 under `tsx watch` (restarts on server-src edits),
#     with the same host env rewrites `dev-app` uses.
#   - the root Vite dev server on :5174 with HMR, proxying /api, /ws, and
#     /_surfaces to the backend (see apps/root/vite.config.ts).
# Open the app at http://localhost:5174.
#
# Full-tree HMR: the root dev server's `serve` config aliases every surface
# (moderator, participant, audience, test-mode) AND the shared UI packages
# (graph-view, shell, i18n-catalogs) to their TypeScript SOURCE, so editing
# any of them hot-reloads live — no rebuild, no per-surface dev server.
# `SurfaceHost` switches to the source loader via the VITE_SURFACE_SOURCE
# flag the `serve` config sets. This is a dev-only divergence from ADR
# 0026's runtime-bundle loading; the real manifest + built-bundle path is
# exercised by `make up` / `make dev-app`.
#
# A one-time `pnpm run build` runs first: the backend's static-frontends
# plugin fail-fasts at boot unless every frontend `dist/` exists, and the
# shared workspace packages must be built for the backend + the initial
# resolve to succeed.
#
# Login note: APP_BASE_URL stays http://localhost:3000, so the OIDC
# callback lands on :3000 (the registered redirect URI) — the session
# cookie is set for `localhost` (port-agnostic) so it's still sent back
# to :5174. Browser login also needs the /etc/hosts alias the `up`
# banner documents.
#
# The trap tears down BOTH host processes on Ctrl-C; the backing services
# stay up (`make down` / `make down-v` to stop those).
dev: up-backing
	@if [ ! -f .env ]; then \
		echo "[dev] .env missing — 'make up-backing' should have seeded it from .env.example"; \
		exit 1; \
	fi
	@pnpm run build
	@echo "[dev] backend :3000 (tsx watch) + root Vite :5174 (HMR, surfaces from source). Open http://localhost:5174 — Ctrl-C stops both."
	@set -a; . ./.env; set +a; \
		export DATABASE_URL=$$(echo "$$DATABASE_URL" | sed 's|@postgres:|@localhost:|'); \
		export NODE_ENV=development; \
		export NODE_EXTRA_CA_CERTS="$$(pwd)/infra/authelia/tls/cert.pem"; \
		pnpm --filter @a-conversa/server exec tsx watch src/index.ts & BACK=$$!; \
		pnpm --filter @a-conversa/root dev & FRONT=$$!; \
		trap 'kill $$BACK $$FRONT 2>/dev/null' INT TERM EXIT; \
		wait

# Alias for `make up`. Kept so existing muscle memory / docs that
# reference `make up-app` still work; the split it used to enforce
# (backing services first, then the app) is no longer needed now
# that the app applies migrations on startup and the healthcheck
# (targeting /healthz) flips to healthy.
up-app: up

# Shared body for `up` and `up-prod-mode`. The COMPOSE_FILES variable
# is set per-target above (target-specific variable, Make's standard
# pattern for parameterising a shared recipe).
#
# The trailing `/etc/hosts` notice is non-blocking. The OIDC redirect
# target is `https://authelia.aconversa.local:9091` (`.env.example`'s
# `OIDC_ISSUER_URL`); the compose network already aliases that name to
# the `authelia` service (see `compose.yaml`'s `networks` block), so
# backend-to-Authelia traffic resolves inside the stack without help.
# Browser-side redirects from the host need the same name to resolve to
# 127.0.0.1, which the compose port-forward then routes to Authelia.
# Without the /etc/hosts entry, backend-only flows (`/healthz`, the
# Vitest + Cucumber smoke suites, the Playwright suite when it can use
# pre-seeded cookies) work fine; browser-driven OIDC login does not.
_bring-up:
	@if [ ! -f .env ]; then \
		echo "[ensuring .env from .env.example]"; \
		cp .env.example .env; \
	fi
	@docker compose $(COMPOSE_FILES) up -d --build postgres authelia app
	@echo "[waiting up to ~60s for services to report healthy]"
	@sleep 30
	@docker compose $(COMPOSE_FILES) ps
	@echo ""
	@echo "Dev stack ready:"
	@echo "  postgres   localhost:5432"
	@echo "  authelia   https://authelia.aconversa.local:9091   (host-side; see /etc/hosts notice below)"
	@echo "  app        http://localhost:3000                    (curl /healthz returns 200; / returns {\"status\":\"ok\"})"
	@if ! grep -qE '^[[:space:]]*[^#[:space:]]+[[:space:]]+([^#]*[[:space:]])?authelia\.aconversa\.local([[:space:]#]|$$)' /etc/hosts 2>/dev/null; then \
		echo ""; \
		echo "[notice] authelia.aconversa.local is not registered in /etc/hosts — browser-driven"; \
		echo "[notice] OIDC redirects (the SSO login flow) will fail to resolve from your host."; \
		echo "[notice] Backend-only flows (/healthz, vitest + cucumber smoke, pre-seeded e2e) work without this."; \
		echo "[notice]"; \
		echo "[notice] One-time fix (sudo required, adds one line):"; \
		echo "[notice]   echo '127.0.0.1  authelia.aconversa.local' | sudo tee -a /etc/hosts"; \
		echo "[notice]"; \
		echo "[notice] See docs/dev-environment.md > 'Host resolution for Authelia' for context."; \
	fi

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

# List currently-unblocked leaf tasks, grouped by milestone. Uses tj3
# (TaskJuggler) to resolve the WBS dep graph — see the header comment in
# `scripts/unblocked.ts` for the approach.
# Pass MILESTONE=<id> to scope to a single milestone (bare id or
# `milestones.<id>` both accepted), e.g. `make unblocked MILESTONE=m_backend_review`.
unblocked:
	@pnpm run unblocked $(MILESTONE)

clean:
	@rm -rf node_modules apps/*/node_modules packages/*/node_modules
	@rm -rf dist build coverage playwright-report test-results
