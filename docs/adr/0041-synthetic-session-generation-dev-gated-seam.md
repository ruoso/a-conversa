# 0041 — Synthetic-session generation is a non-production-gated backend seam

## Status

Accepted

## Context

Test mode (`/t`, ADR 0026) is the operator-side design-iteration and debugging
surface: one authenticated person scrubs a recorded session without three live
participants. `test_mode_load_session` (Done 2026-06-05) gave it the ability to
load and display a session's persisted event log by id, and the downstream
timeline scrubber will drive a projected state off that loaded log. But to
*iterate on design* the operator needs sessions to look at — and the only way to
produce a non-trivial session today is the live three-participant flow
(moderator + debater-A + debater-B driving the real gesture endpoints in
sequence). That is exactly the friction test mode exists to remove.

The repo already has two seams that touch synthetic data, and neither fits a
runtime operator-triggered generator:

- **`packages/test-fixtures/` `loadFixture(name, client, { appendEvent })`**
  (`src/loader.ts:124`) is **destructive** — it issues
  `TRUNCATE TABLE ... CASCADE RESTART IDENTITY` across every core table before
  replaying a fixture's events with fixed ids. It is a test-harness primitive
  (used by Vitest + Cucumber against a fresh pglite handle) and must never run
  against a shared backend: it would wipe the database. Its fixtures also carry
  fixed ids, so a second load would collide.
- **The public write path** (`POST /api/sessions` + the per-gesture
  proposal/vote/commit endpoints) enforces **participant-role authorization** —
  a single operator cannot POST a proposal *as debater-A* and a counter *as
  debater-B*. Driving the public endpoints to fabricate a multi-party debate is
  blocked by the very authorization that makes the live flow correct.

So generating a synthetic session inherently means **bypassing participant
authorization** to fabricate events attributed to fabricated actors. That is
safe and useful in dev/staging (design iteration, demos, scrubber fodder) and
unacceptable in production (data pollution, fabricated-actor attribution).

The server registers most routes unconditionally in `createServer()`
(`apps/server/src/server.ts`), already keys CORS and other behavior off
`NODE_ENV` (`server.ts:320`), and already depends on `@a-conversa/test-fixtures`
as a **devDependency** (`apps/server/package.json`).

## Decision

Synthetic-session generation is a **dedicated backend seam that is only
registered when `NODE_ENV !== 'production'`**.

1. **A test-mode plugin** (`apps/server/src/test-mode/`) registers its routes in
   `createServer()` **behind a `NODE_ENV !== 'production'` guard**. In
   production the routes are never mounted; requests 404 like any unknown path.
2. **Generation is non-destructive and re-runnable.** Each call allocates a
   **fresh session id and fresh entity ids** and appends a validated event log
   into that new session via the production write path (`validateEvent` +
   `appendSessionEvent`, inside one `withTransaction`). It never truncates, and
   repeated calls never collide. The generated session is **owned by the calling
   operator** (`host_user_id = authUser.id`) so it is visible to them through
   the existing `canSeeSession` gate and loadable via `GET /sessions/:id/events`.
3. **Synthetic participants are stable, clearly-marked users** inserted with
   `INSERT ... ON CONFLICT DO NOTHING` (e.g. `oauth_subject` prefixed
   `synthetic:`), so the operator is the moderator and the synthetic debaters
   are reused across generations without bloating the user table.
4. **Scenarios are server-side builders** — pure functions
   `(sessionId, hostUserId, ids) -> Event[]` registered under string keys. The
   set of available scenarios is exposed via a read endpoint so the operator UI
   is data-driven and cannot offer a scenario the server cannot build.
5. **The seam is authenticated.** Even gated to non-production it requires a
   valid operator session; it is not an open back door.

## Consequences

- Test mode gains a self-service generator: pick a scenario → mint a fresh,
  fully-persisted session → land on the existing `/sessions/:id` load route (and
  later the scrubber) — no live participants, no role choreography.
- The generated sessions are **real persisted sessions** flowing through the same
  read path as live ones, so everything downstream (load readout, scrubber,
  inspectors, export) consumes one data source. No second in-memory code path.
- The authorization bypass is **contained to non-production** by route
  registration, the simplest enforcement the server already uses for CORS; it is
  testable (a unit test asserts the guard skips registration when
  `NODE_ENV === 'production'`).
- `loadFixture`'s destructive truncate stays a test-only primitive — it is *not*
  reused at runtime. Reusing the rich `walkthrough` fixture at runtime would
  require a non-destructive, typed id-re-keyer; that is deferred to a follow-up
  scenario-library task rather than forcing the destructive loader online.
- Whether the `/t` surface is exposed in production at all is an orthogonal
  deployment question; this ADR makes the *generator* safe regardless of where
  the surface mounts.

## References

- ADR 0026 (micro-frontend root app — the `/t` mount), ADR 0021 (event
  envelope), ADR 0020 (sequence allocation / `node-pg-migrate`), ADR 0022 (no
  throwaway verifications).
- Refinement: `tasks/refinements/replay_test/test_mode_synthetic_session.md`.
- Predecessor: `tasks/refinements/replay_test/test_mode_load_session.md`.
