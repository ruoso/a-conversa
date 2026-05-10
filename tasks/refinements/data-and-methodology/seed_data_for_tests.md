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

- **Fixtures are committed to version control as JSON files** (R21). Plain text in git, easy to diff, deterministic. Each fixture is a sequence of event-log records plus the global graph entities they reference.
- **Fixtures live in `packages/test-fixtures/`** (R22). A separate workspace so both server tests and Playwright tests (which live in the frontend `apps/*` workspaces) can import the same data.
- **Fixture loader replays through the application's event-append code** (R23). Slower than direct INSERTs but ensures fixtures only contain valid events; saves a class of "fixture works in tests but not in real flow" bugs. Validates the same way production writes do.
- **The walkthrough fixture is canonical** — every other test that needs "a substantial debate" uses this one.

## Open questions

(none — all decided)

## Status

**Done as scaffold** — 2026-05-10.

The fixtures workspace is set up at
[`packages/test-fixtures/`](../../../packages/test-fixtures/) with a
`loadFixture(name, client)` / `listFixtures()` API
([`packages/test-fixtures/src/loader.ts`](../../../packages/test-fixtures/src/loader.ts))
and one bundled fixture: `empty` (a session with three participants
joined — alice as moderator, ben as debater-A, maria as debater-B —
plus the four corresponding event-log rows: `session-created` and three
`participant-joined`).

**Loader strategy** — truncate-then-insert. `loadFixture` issues a
single `TRUNCATE ... RESTART IDENTITY CASCADE` over `session_events,
session_annotations, session_edges, session_nodes, session_participants,
sessions, annotations, edges, nodes, users` and then INSERTs the
fixture's contents. Idempotent: safe to call repeatedly (each call
clears and reloads). The `pgmigrations` bookkeeping table is not
truncated, so migrations stay applied across loads.

**Deferred — R23 (replay through event-append code).** The settled
decision is that the loader should drive the same append API that
production writes use, so per-kind payload validation runs on fixtures
too. That code path does not exist yet — it lives in
`data_and_methodology.event_types.event_validation` and
`backend.api_skeleton`. Today the loader uses raw INSERTs against
`session_events`, with a `// TODO(R23):` comment at the call site
marking where the rewrite happens. When `event_validation` and the
backend skeleton land, this loader is rewritten to drive the real
append API.

**Deferred — the remaining fixtures.** The `walkthrough`, `mid-flow`,
`cycle`, `contradiction`, `multi-warrant`, and `cross-session`
fixtures all wait on the per-event-kind payload schemas owned by the
`data_and_methodology.event_types.*` tasks. Faithfully encoding the
canonical example walkthrough today would require inventing payload
shapes that the rest of the codebase will then need to retrofit; the
pragmatic choice is to defer those fixtures until the schemas settle.
The `empty` fixture is sufficient to bootstrap the workspace, the
loader API, and the verification harness.

**Verified end-to-end.** A throwaway script ran `make up` →
`make migrate` → `loadFixture('empty', client)` (twice, to confirm
idempotency) and asserted `count(*) FROM session_events WHERE
session_id = <fixture>` returns 4 and the participant join returns the
expected three (moderator/debater-A/debater-B → alice/ben/maria), then
`make down-v` cleaned up. No ADR.
