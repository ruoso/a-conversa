# Seed-data fixtures for tests

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.seed_data_for_tests`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.schema.session_events_table` (settled)

## What this task is

Build a seed-data harness — fixture data that can be loaded into a clean database to give tests a known starting state. Used by behavior tests, integration tests, and Playwright E2E suites that need a populated session to drive their scenarios.

## Why it needs to be done

Tests that run against a live application need realistic data. Hand-crafting test setup in every spec is slow and brittle; seed fixtures give a shared, versioned starting point. Particularly important for replay / test-mode tests (`test_mode_load_session`, `replay_*`) which need a saved session to load.

## Inputs / context

The example walkthrough ([docs/example-walkthrough.md](../../../docs/example-walkthrough.md)) is the canonical "interesting debate" — a complete simulated session ending at the located crux N19 with a segment snapshot. It should be one of the seeded fixtures because it exercises every methodology mechanic.

Other useful fixtures:

- **Empty session** — one with just the moderator and two debaters joined; no events beyond `session-created` and `participant-joined`.
- **Mid-flow session** — partial state, useful for "the moderator just disconnected; new client connecting catches up" tests.
- **Cycle session** — events that produce a `supports` cycle, used to test cycle-detection diagnostics.
- **Contradiction session** — events that produce a contradicts edge, used to test contradiction diagnostics and bedrock-axiom resolution.
- **Multi-warrant session** — events that produce the multi-warrant pattern, used to test that diagnostic.
- **Cross-session reference fixture** — two sessions where session B references nodes from session A, used to test cross-session permissions.

The dev environment also seeds data when `make up` is run (via `foundation.dev_env.seed_data_script`); this task and that one share fixture content.

## Constraints / requirements

- Fixtures are deterministic (UUIDs are stable; timestamps are predictable).
- Fixtures load fast (a Playwright test setup shouldn't take seconds).
- Fixtures live in version control (not generated dynamically) so test failures are reproducible.
- A single fixture-loading helper is exposed to test code; tests don't write their own SQL.
- Fixtures express the example-walkthrough scenario faithfully — `data_methodology_tests.dm_e2e_tests.walkthrough_replay_e2e` uses this.

## Acceptance criteria

- A fixtures directory (e.g., `apps/server/test/fixtures/`) holding the canonical fixtures listed above.
- Each fixture is a sequence of event-log records (JSON files) plus the global graph entities they reference.
- A `loadFixture(name, db)` helper that resets the test DB and applies the fixture.
- The walkthrough fixture, when loaded and projected, produces a final visible-graph state matching the example walkthrough.
- Fixtures are usable from Cucumber.js scenarios (per `test_behavior_framework_decision`) and from Playwright tests (per `playwright_decision`).

## Decisions

- **Fixtures are committed to version control** as JSON files (event payloads + global entity rows). Plain text in git, easy to diff, deterministic.
- **The walkthrough fixture is canonical** — every other test that needs "a substantial debate" uses this one.

## Open questions

- **Fixture format.**
  - **(a) JSON files mirroring the schema** — straightforward; map cleanly to insert statements.
  - **(b) A small DSL** for expressing event sequences (more readable but invents new syntax).
  - **(c) TypeScript modules** that build fixtures programmatically (typed, but harder to diff).
  - **My instinct: (a) JSON files** — most direct, easy to inspect. **Awaiting input.**
- **Where do fixtures live?**
  - **`apps/server/test/fixtures/`** — co-located with the server (which is what loads them).
  - **`packages/test-fixtures/`** — separate workspace shared between server tests and Playwright tests.
  - **My instinct: `packages/test-fixtures/`** — Playwright tests live in the frontend workspaces and need access too. **Awaiting input.**
- **Fixture loader implementation.**
  - **Direct INSERTs** to the test DB (skipping event-log validation) — fastest, but skips the validation pipeline.
  - **Replay through the application's event-append code** — slower, but exercises the same validation that production writes go through.
  - **My instinct: replay through event-append.** It's slower but it ensures fixtures only contain valid events; saves a class of "fixture works in tests but not in real flow" bugs. **Awaiting input.**
