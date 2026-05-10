# Document the local-dev workflow

**TaskJuggler entry**: `foundation.dev_env.dev_env_docs` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort**: 0.5d
**Inherited dependencies**: `foundation.dev_env.one_command_script` (settled)

## What and why

The README's [Local development section](../../../README.md#local-development) is intentionally short — it is the front door, not the manual. Once `compose_file`, `one_command_script`, and `seed_data_script` had landed (round 5), there was enough mechanism in the dev environment that a contributor cloning the repo for the first time benefited from a deeper walkthrough than the README's ~30-line section can carry. This task delivers that walkthrough.

Originally the task's title named `CONTRIBUTING.md` as the candidate destination. Per the [`readme_dev_section` Status](readme_dev_section.md), CONTRIBUTING.md as a separate document was punted to a future task (R25). The decision to defer CONTRIBUTING.md stands; this task instead writes the deeper how-to as a doc under `docs/`, matching the existing pattern for design and architecture docs.

## Decisions

- **Destination**: [`docs/dev-environment.md`](../../../docs/dev-environment.md). Sits next to `docs/architecture.md`, `docs/data-model.md`, etc. CONTRIBUTING.md is **not** created by this task.
- **README posture**: the existing Local development section stays as the front-door pointer. One new line is added at the bottom: `For the deeper local-dev walkthrough see [docs/dev-environment.md](docs/dev-environment.md).` The section is otherwise unchanged.
- **Scope**: prerequisites; first-run setup; the compose stack; Make targets; environment variables; Authelia dev login; tests; lint/format/typecheck; workspace layout; what's not yet runnable end-to-end; troubleshooting; pointers to deeper material (ADR index, WBS, design docs).
- **Out of scope**: production deployment ([`deployment.deployment_docs`](../../30-deployment.tji)); per-test database isolation ([`foundation.test_infra.test_db_provisioning`](test_db_provisioning.md)); CONTRIBUTING.md (deferred to R25).
- **Style**: terse, direct, honest about what works today vs. what's planned. Every Make target / ADR / file path mentioned is linked. Does not duplicate `infra/postgres/README.md` or `infra/authelia/README.md` — links to them.
- **No new ADR.** This task is documentation; no architectural decision is captured.

## Acceptance criteria

- `docs/dev-environment.md` exists and covers the scope above.
- `README.md` Local development section gains exactly one new line pointing at the new doc.
- The new doc cross-references the relevant ADRs (0001, 0010, 0011-0018), Make targets, and infra READMEs rather than duplicating their content.
- Stays in the ~120-200 line range — deep enough to be useful, short enough to read.

## Status

**Done** — 2026-05-10.

- [`docs/dev-environment.md`](../../../docs/dev-environment.md) added (154 lines). Section list (H2 headings):
  - Prerequisites
  - First-run setup
  - The compose stack
  - Make targets
  - Environment variables
  - Authelia dev login
  - Tests
  - Lint, format, typecheck
  - Workspace layout
  - What's not yet runnable end-to-end
  - Troubleshooting
  - Where to learn more
- [`README.md`](../../../README.md)'s Local development section gained one new line at the bottom: `For the deeper local-dev walkthrough see [docs/dev-environment.md](docs/dev-environment.md).` No other changes to that section.
- The doc cross-links every Make target, ADR (0001, 0006-0008, 0010-0018), and infra README it mentions. It explicitly notes that the `app` container's stub entry point makes `make up-app` informational today and that `make seed` is a stub until the fixture loader and the event-append API both land.
- **CONTRIBUTING.md remains deferred to R25.** The decision recorded in [`readme_dev_section`](readme_dev_section.md) is unchanged.
- `tj3 project.tjp` parses cleanly with `complete 100` set on this task and the `note "Refinement: tasks/refinements/foundation/dev_env_docs.md"` line added for consistency with the other foundation tasks.
