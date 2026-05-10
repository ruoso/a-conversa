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

The development environment runs entirely locally via Docker Compose — a single command brings up the application, PostgreSQL, and a local OAuth provider. No external accounts or cloud setup required for development. See [docs/architecture.md — local development environment](docs/architecture.md#local-development-environment) for the intended shape.

The Compose file and code will land when implementation begins; this is currently a design-phase repo.

`pnpm install` enables a Husky pre-commit hook that runs `lint-staged` (ESLint `--fix` and Prettier `--write` against staged files) followed by an incremental whole-repo typecheck (`tsc -b`); a commit that fails lint or typecheck is rejected, and a commit cleaned up by the formatter lands with the cleaned content. The full development-workflow doc — including run commands, the smoke scripts, and the test layout — will land with `readme_dev_section`.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE) for details.

The AGPL was chosen because the project's intent is "if it succeeds, others can adopt the same format with the same tooling." The AGPL's network-use clause ensures that anyone hosting an a-conversa instance has to publish their modifications, keeping the format and its tooling co-evolving as open source.
