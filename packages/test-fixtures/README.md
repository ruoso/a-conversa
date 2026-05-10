# @a-conversa/test-fixtures

Versioned JSON event-log fixtures for tests, plus a `loadFixture(name, db)`
helper that resets the relevant tables and replays a fixture into a clean
database.

## Why this workspace exists

Tests across the platform — Vitest unit/integration tests, Cucumber.js
behavior scenarios, and Playwright end-to-end suites — all need a
deterministic, populated session to drive their scenarios. Hand-crafting
test setup in every spec is slow and brittle; shared, versioned fixtures
give a known starting state.

The fixtures live in this dedicated workspace (decided in R22 of the
`seed_data_for_tests` refinement) so server tests in `apps/server/` and
Playwright tests under the frontend `apps/*` workspaces can both import
the same data. Fixtures are committed as JSON (R21), readable and
diff-friendly in git.

## Layout

```
src/
  index.ts             public API: loadFixture, listFixtures
  loader.ts            Postgres truncate-then-insert implementation
  fixtures/
    empty/             "empty session" fixture (3 participants joined,
                       no proposals or commits)
      meta.json
      users.json
      session.json
      participants.json
      events.json
```

## Public API

```ts
import { loadFixture, listFixtures } from '@a-conversa/test-fixtures';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await loadFixture('empty', client);
await client.end();
```

`loadFixture(name, client)` is **idempotent**: it truncates the tables
the fixture touches (in foreign-key dependency order) and then inserts
the fixture's contents. Safe to call repeatedly.

`listFixtures()` returns the names of all bundled fixtures.

## Deferred work (R23)

The settled R23 decision is that the loader should **replay through the
application's event-append code path**, so fixtures only contain valid
events and the same validation runs in tests as in production.

That code path does not exist yet — it lives in
`data_and_methodology.event_types.event_validation` and
`backend.api_skeleton`. Until both land, this loader uses **raw INSERTs**
against `session_events`, bypassing per-kind payload validation. The
loader carries a `// TODO(R23):` comment at the relevant call site, and
this README is the second place to find that note.

When `event_validation` and `backend.api_skeleton` land, the loader is
rewritten to drive the real append API and this section is updated.

## Fixture status

Today the workspace ships **one** fixture: `empty`. The remaining
fixtures planned by the refinement
(`tasks/refinements/data-and-methodology/seed_data_for_tests.md`) —

- `walkthrough` — canonical fixture that encodes the entire
  `docs/example-walkthrough.md` debate.
- `mid-flow`, `cycle`, `contradiction`, `multi-warrant`,
  `cross-session` — diagnostic / scenario fixtures.

— all wait on the per-event-kind payload schemas owned by the
`data_and_methodology.event_types.*` tasks. Faithfully encoding the
walkthrough today would mean inventing payload shapes that the rest of
the codebase will then need to retrofit; the pragmatic choice is to
defer those fixtures until the schemas are settled.

## Tables touched by `loadFixture`

In dependency order (children first when truncating, parents first when
inserting):

```
session_events
session_annotations, session_edges, session_nodes, session_participants
sessions
annotations, edges, nodes
users
```

Truncate uses `TRUNCATE ... RESTART IDENTITY CASCADE` in a single
statement to avoid ordering bugs. The `pgmigrations` bookkeeping table
is **not** touched — migrations stay applied across loads.
