# @a-conversa/test-fixtures

Versioned JSON event-log fixtures for tests, plus a
`loadFixture(name, db, options)` helper that resets the relevant
tables and replays a fixture into a clean database through the
production event-append helper.

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
import { appendSessionEvent } from '@a-conversa/server/events/append';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await loadFixture('empty', client, {
  appendEvent: (c, event) => appendSessionEvent(c, event).then(() => undefined),
});
await client.end();
```

`loadFixture(name, client, options)` is **idempotent**: it truncates
the tables the fixture touches (in foreign-key dependency order),
inserts the users / session / participants rows, then for each event
in the fixture runs `validateEvent` and replays through the caller-
injected `appendEvent` helper. Production callers wire it to
`appendSessionEvent` so the fixture and the production write path
share one SQL surface. Safe to call repeatedly.

`listFixtures()` returns the names of all bundled fixtures.

## Why callback injection

`@a-conversa/test-fixtures` is a leaf workspace package whose only dep
is `@a-conversa/shared-types`. Importing `appendSessionEvent`
directly would invert the apps → packages layering and drag the
server's runtime transitive deps into a test-support package. The
callback keeps the loader agnostic; callers wire the concrete helper
(the same pattern this file already uses for the DB client).

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
