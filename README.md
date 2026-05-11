# a-conversa

A debate platform that helps people debate by classifying every statement and only proceeding when the participants agree on the classification. Designed as the format for a YouTube show, with the goal of slowing debate down so clarity can build.

## Status

**Foundation build in progress.** The design captured under `docs/` is settled enough to start building; tech-stack picks and repo bootstrapping are landing under [milestone M0](tasks/99-milestones.tji). If you're new to the project, start with [DESIGN.md](DESIGN.md) and follow the document index from there. Architectural decisions taken so far live in [docs/adr/](docs/adr/).

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

## Local development

Development is workspace-based (pnpm workspaces under [apps/](apps/) and [packages/](packages/)). Eventually a Docker Compose stack will boot the full app, PostgreSQL, and a local OAuth provider; that stack lands with `foundation.dev_env`.

### Prerequisites

- Node 20+ (host is on 20.19.2).
- pnpm 9.x — the version is pinned in [`package.json`](package.json) `packageManager`; enable via `corepack enable && corepack prepare pnpm@9.15.4 --activate`.
- Docker — only needed once `dev_env` lands; not required today.

### First-run setup

`pnpm install` (or `make install`) installs every workspace and registers the Husky pre-commit hook.

### What works today

- Tests: `pnpm run test:smoke` (Vitest), `pnpm run test:behavior:smoke` (Cucumber), `pnpm run test:e2e:smoke` (Playwright). `make test` runs all three.
- Lint / format / typecheck: `pnpm run lint`, `pnpm run format`, `pnpm run typecheck`.
- Stack-validation smokes: `pnpm run smoke:{node,react,reactflow,cytoscape,tailwind}`.
- `make up` brings up Postgres + Authelia (auto-creating `.env` from `.env.example` if absent) and prints the URL banner. `make down` / `make down-v` tear the stack down (the latter also drops named volumes).

### What's planned

- `make up-app` brings the app container up too — the Fastify server (per [ADR 0023](docs/adr/0023-web-framework-fastify.md)) listens on `:3000` and `curl http://localhost:3000/` returns `{"status":"ok"}`. The compose healthcheck still targets `/healthz` (owned by `backend.api_skeleton.health_endpoint`, pending), so `docker compose ps` shows the service as unhealthy until that sibling lands. Once `health_endpoint` (with migrations-on-startup) ships, full-stack `make up` will absorb `up-app`.
- Seeded fixture for manual exploration via [`dev_env.seed_data_script`](tasks/refinements/foundation/seed_data_script.md). `make seed` is a stub that errors clearly until that task lands.
- Surfaces served on localhost: moderator at `/moderator`, participant at `/participant`, audience at `/audience` (`/replay` later). See [docs/architecture.md — local development environment](docs/architecture.md#local-development-environment).

### Pre-commit hook

`lint-staged` runs ESLint `--fix` and Prettier `--write` against staged files, followed by `tsc -b`. A commit that fails lint or typecheck is rejected; formatter cleanups are committed as-is. Bypass with `git commit --no-verify` when needed.

See the [Makefile](Makefile) for the full target list and [pnpm-workspace.yaml](pnpm-workspace.yaml) for the workspace layout.

For the deeper local-dev walkthrough see [docs/dev-environment.md](docs/dev-environment.md).

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE) for details.

The AGPL was chosen because the project's intent is "if it succeeds, others can adopt the same format with the same tooling." The AGPL's network-use clause ensures that anyone hosting an a-conversa instance has to publish their modifications, keeping the format and its tooling co-evolving as open source.
