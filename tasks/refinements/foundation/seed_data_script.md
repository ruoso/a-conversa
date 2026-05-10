# Seed-data script

**TaskJuggler entry**: `foundation.dev_env.seed_data_script` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort**: 1d

## What and why

A script (`make seed`) that loads the example walkthrough fixture from `packages/test-fixtures/` into the running dev database. Lets developers spin up an interesting state immediately to explore the app without running a debate manually.

## Decisions

- Wraps the `loadFixture` helper from `packages/test-fixtures/` (per `seed_data_for_tests.md`).
- Replays through the application's event-append API, exercising the same validation production uses.
- Idempotent: `make seed` can run multiple times safely (drops/recreates the test session each time).
- Default fixture: the example walkthrough.
- Optional flag: `make seed FIXTURE=<name>` for other fixtures.

## Acceptance criteria

- `make seed` populates the dev DB with the walkthrough scenario.
- Reload the dev app: the walkthrough's session is visible and projects to the expected state.
- Subsequent `make seed` runs reset cleanly.
