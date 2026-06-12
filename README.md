# a-conversa

A debate platform that helps people debate by classifying every statement and only proceeding when the participants agree on the classification. Designed as the format for a YouTube show, with the goal of slowing debate down so clarity can build.

## Status

**Live in production at [www.a-conversa.org](https://www.a-conversa.org); milestones M0–M9 complete.** The full MVP — data model + methodology engine, backend, the Moderator / Participant / Audience surfaces, end-to-end debate, replay, landing page — shipped through M8, and M9 (Deployment ready, 2026-06-12) put it in production: Railway-hosted (app + [Dex](https://dexidp.io/) OIDC broker + Postgres, [ADR 0031](docs/adr/0031-production-hosting-railway-paas.md) / [ADR 0048](docs/adr/0048-production-oauth-dex-identity-broker.md)), tag-gated deploys ([ADR 0034](docs/adr/0034-releases-calendar-versioning-tag-deploy.md)), drilled runbooks under [docs/runbooks/](docs/runbooks/). All gating work for M10 (first show recorded) is done; the milestone closes when the show itself is recorded. The orchestrator that drives WBS work is described in [orchestrator/README.md](orchestrator/README.md); `make unblocked` is the canonical "what's ready to pick up." If you're new to the project, start with [DESIGN.md](DESIGN.md) and follow the document index from there. Architectural decisions live in [docs/adr/](docs/adr/).

## What is a-conversa?

A debate has two debaters defending different positions, one moderator organizing the discourse, and an audience watching. Each statement made during the debate is captured by the moderator and classified — what kind of statement is it (`fact` / `predictive` / `value` / `normative` / `definitional`)? How does it relate to other statements (`supports` / `rebuts` / `qualifies` / `bridges-from` / `bridges-to` / `defines` / `contradicts`)? All participants — both debaters and the moderator — must agree on every change before it lands.

The hypothesis is that most disagreements are either (a) people contradicting themselves without realizing it, or (b) people talking past each other because they treat the same statement as different *kinds* of thing. The platform aims to surface both patterns and to find the *actual* disagreement — often a shared axiom with different downstream weighting, or a category mismatch the participants didn't notice.

For a worked example of the format in action, see [docs/example-walkthrough.md](docs/example-walkthrough.md): a simulated debate on "Should zoos exist?" exercising the methodology end-to-end.

## Documents

- [DESIGN.md](DESIGN.md) — vision, format, high-level overview, document index.
- [docs/data-model.md](docs/data-model.md) — graph entities (nodes, edges, annotations), facets (`wording` / `classification` / `substance` for nodes; `shape` / `substance` for edges), per-participant agreement tracking, structural diagnostics, the change-history event log, event types.
- [docs/methodology.md](docs/methodology.md) — debate procedure, agreement rule, the commit step, diagnostic tests, decomposition, interpretive splits, meta-moves, axioms, meta-disagreement fallback.
- [docs/architecture.md](docs/architecture.md) — engineering shape: event-sourced state model, sessions and the global graph (nodes/edges M-N to sessions), server-authoritative real-time over WebSockets, frontend surfaces, identity (federated OAuth, screen names only), deployment, replay, test mode, local development environment.
- [docs/moderator-ui.md](docs/moderator-ui.md) — moderator surface flows: capture, decompose, run diagnostic test, capture defeater, axiom-mark, meta-move, snapshot. Visual state representation. Keyboard shortcuts.
- [docs/participant-ui.md](docs/participant-ui.md) — debater tablet flows: per-facet voting (the central design), withdrawal, axiom-mark proposal, view of structural diagnostics and change history.
- [docs/example-walkthrough.md](docs/example-walkthrough.md) — simulated debate exercising the design.
- [docs/adr/](docs/adr/) — Architecture Decision Records. Each ADR captures one architectural choice (status, context, decision, consequences); see [docs/adr/README.md](docs/adr/README.md) for the convention.
- [docs/runbooks/](docs/runbooks/) — production operations: [admin.md](docs/runbooks/admin.md) is the entry point (orientation, task index, troubleshooting playbook); release, rollback, post-deploy smoke, secret rotation, and backup restore each have their own. The production topology record is [infra/railway/README.md](infra/railway/README.md).
- [docs/obs-setup.md](docs/obs-setup.md) — OBS Browser-source setup for show producers broadcasting the audience surface.
- [orchestrator/README.md](orchestrator/README.md) — the orchestrator that drives the WBS forward, using `make unblocked` as its sole window into "what's ready to pick up."

## Localization

UI localized in **English (US)**, **Brazilian Portuguese**, and **Latin American Spanish** (`en-US`, `pt-BR`, `es-419`) via `react-i18next` per [ADR 0024](docs/adr/0024-frontend-i18n-react-i18next-with-icu.md); the data model stays English-coded so events and replay are durable across translation updates. Participant-supplied content (statement wordings) is not translated.

## Local development

Development is workspace-based (pnpm workspaces under [apps/](apps/) and [packages/](packages/)). A three-service Docker Compose stack (`app + postgres + authelia` — Authelia is the dev-only mock OIDC issuer; production uses Dex per [ADR 0048](docs/adr/0048-production-oauth-dex-identity-broker.md)) is brought up by `make up`; see [docs/dev-environment.md](docs/dev-environment.md) for the full walkthrough.

### Prerequisites

- Node 20+ (host last verified on 20.19.2).
- pnpm 9.x — the version is pinned in [`package.json`](package.json) `packageManager`; enable via `corepack enable` and Corepack will enforce the pinned version on every `pnpm` invocation.
- Docker + Docker Compose v2 — required for `make up` and the Playwright e2e suite.

### First-run setup

`pnpm install` (or `make install`) installs every workspace and registers the Husky pre-commit hook.

### What works today

- `make check` — runs the full static-analysis bundle (lint + format:check + typecheck × 3). Same target the pre-commit hook and CI invoke; run it before pushing.
- `make unblocked` — lists, per milestone, the leaf tasks currently READY to pick up. Pass `MILESTONE=<id>` to scope to one milestone (e.g. `make unblocked MILESTONE=m_moderator_mvp`). Resolves the WBS dep graph via `tj3`; see [`scripts/unblocked.ts`](scripts/unblocked.ts).
- Tests: `pnpm run test:smoke` (Vitest), `pnpm run test:behavior:smoke` (Cucumber), `pnpm run test:e2e:smoke` (Playwright). `make test` runs all three.
- Lint / format / typecheck: `pnpm run lint`, `pnpm run format`, `pnpm run typecheck`.
- Stack-validation smokes: `pnpm run smoke:{node,react,reactflow,cytoscape,tailwind}`.
- `make up` brings up Postgres + Authelia + the app container (auto-creating `.env` from `.env.example` if absent), waits for healthy, and prints the URL banner. The app listens on `:3000` and `/healthz` flips to 200 once startup migrations finish. `make up-prod-mode` is the same boot without the dev override (used by CI). `make down` / `make down-v` tear the stack down (the latter also drops named volumes).
- `make seed` — seeds the dev database with an example session (`FIXTURE=<name>` selects one); see [`dev_env.seed_data_script`](tasks/refinements/foundation/seed_data_script.md).

### End-to-end tests

Playwright specs live in [`tests/e2e/`](tests/e2e/) and run against the **single-origin** Fastify server — the same process serves the SPA bundles alongside the JSON / WebSocket API (see [`apps/server/src/routes/static-frontends.ts`](apps/server/src/routes/static-frontends.ts) and the [serve_static_frontends refinement](tasks/refinements/backend/serve_static_frontends.md)). No separate Vite preview; tests load each surface through the same URL a real browser would. Per [ADR 0026](docs/adr/0026-micro-frontend-root-app.md) the surface URLs use a micro-frontend layout — `/` (root landing + auth chrome), `/m/*` (moderator), `/p/*` (participant), `/a/*` (audience).

Per-locale Chromium projects in [`playwright.config.ts`](playwright.config.ts) pre-seed the `aconversa_locale` cookie (see [`packages/i18n-catalogs/src/negotiation.ts`](packages/i18n-catalogs/src/negotiation.ts)) for each supported locale (`en-US`, `pt-BR`, `es-419`). A spec under `chromium-pt-BR` therefore boots the SPA with the pt-BR catalog already resolved — exactly the path a returning Brazilian moderator would take.

Two run modes:

- `make test:e2e` — run against an already-running compose stack. Fastest iteration: `make up` once, then `make test:e2e` repeatedly. The default base URL is `http://localhost:3000`; override with `PLAYWRIGHT_BASE_URL` for a remote staging host.
- `make test:e2e:compose` — bring up the full compose stack, wait for `/healthz`, run the suite, tear down with `down -v`. Slower (compose build + health poll) but the realistic path; the teardown runs whether the suite passes or fails.

CI runs the compose-driven path on every PR via the `e2e-playwright` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). On failure the job uploads `playwright-report/` and `test-results/` (traces / videos / screenshots) as workflow artifacts.

Browser binaries are installed CI-job-locally via `pnpm exec playwright install chromium --with-deps`; the runtime Docker image never bakes Chromium.

### Pre-commit hook

`lint-staged` runs ESLint `--fix` and Prettier `--write` against staged files, then `pnpm run lint` (full repo) and the three `tsc -b` invocations (`typecheck`, `typecheck:tools`, `typecheck:tests`). When `.tji`/`.tjp` files are staged the hook also runs `tj3 --silent project.tjp` and rejects the commit on any Warning or Error line — keeping the WBS warning-free. A failed hook rejects the commit; formatter cleanups are committed as-is. Bypass with `git commit --no-verify` only when justified.

See the [Makefile](Makefile) for the full target list. The deeper local-dev walkthrough (workspace layout, env vars, compose services, troubleshooting) is in [docs/dev-environment.md](docs/dev-environment.md).

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE) for details.

The AGPL was chosen because the project's intent is "if it succeeds, others can adopt the same format with the same tooling." The AGPL's network-use clause ensures that anyone hosting an a-conversa instance has to publish their modifications, keeping the format and its tooling co-evolving as open source.
