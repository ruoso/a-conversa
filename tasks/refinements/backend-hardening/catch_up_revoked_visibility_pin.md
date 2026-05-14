Source: docs/security/m3-review/coverage.md G-002

# Test: `catch-up` handler rejects after visibility revoke (race-safety pin for the gate-2 re-check)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.subscription_lifecycle.catch_up_revoked_visibility_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `backend_hardening.subscription_lifecycle.privacy_flip_subscription_prune` — settled (the active prune that scrubs the subscription registry when a session flips public→private; this task pins the **defensive** gate-2 re-check that catches the race window where a `catch-up` envelope arrives between the privacy UPDATE and the prune's per-connection eviction).
- `backend.websocket_protocol.ws_reconnection_handling` — settled (the catch-up handler with its three gates: rate-limit, subscribe-before-act, visibility re-check).
- `backend.cross_session_permissions.privacy_field_enforcement` — settled (`canSeeSession` predicate; the "once-a-participant" rule that admits former participants regardless of `left_at`).

## What this task is

A TEST-ONLY task. Pin (via committed tests) that the `catch-up` handler at
[`apps/server/src/ws/handlers/catch-up.ts:464`](../../../apps/server/src/ws/handlers/catch-up.ts)
runs `canSeeSession` for every `catch-up` envelope — independently of the
subscription registry's state at request time — and rejects with
`not-found` (existence-non-leak) when the user no longer satisfies the
visibility predicate. The handler ALREADY runs this gate; this task
converts the "obvious by inspection" claim into a regression test so a
future refactor that drops the re-check (e.g., "subscribe already gated
this; we don't need to re-check") is caught by CI.

Two scenarios cover the surface:

1. **Scenario A — race against the privacy-flip prune (G-002 main path).**
   A non-participant subscribes to a public session via the normal
   subscribe path. The session's privacy flips to `'private'` (mutated
   directly in the test pool — the predecessor task's prune is a separate
   surface and is exercised by its own tests in `routes.test.ts`). The
   client then sends a `catch-up` envelope BEFORE the prune would have
   evicted the registry entry — simulating the race the predecessor task
   names but cannot itself close (prune + handler re-check are
   complementary defenses). The handler's gate-2 `canSeeSession` fires,
   the request is rejected with `code: 'not-found'`, and the connection
   stays open.

2. **Scenario B — former participant on a private session is still
   admitted (pins the once-a-participant rule at the catch-up gate).**
   A user with `session_participants.left_at` set (they joined the
   session at some point in the past and have since left) sends a
   `catch-up` on a private session that they are NOT host of. Per the
   visibility rule documented in
   [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts)
   lines 12-19 ("a current OR past participant"), the user is still
   visible — the participant EXISTS clause does NOT filter `left_at`.
   The catch-up succeeds with a `caught-up` ack carrying
   `eventCount: 0` (the seeded session has no events past 0). This pins
   the methodology decision — "once you've seen a session you've seen
   it" — so a future regression that adds `AND sp.left_at IS NULL` to
   the visibility query (intuitively reasonable, but a security-model
   change that would break audience-replay for past participants) fails
   this test.

## Why it needs to be done

[`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md)
G-002 documents the surface:

> Catch-up replays history to a user whose session-visibility was
> revoked after subscribe.
> …
> The handler does re-check `canSeeSession` at line 213.
> …
> **Gap**: there is no test for a catch-up where the user was visible
> at subscribe but lost visibility between subscribe and catch-up
> (e.g., session privacy toggle, or, more importantly, the user being
> soft-deleted between subscribe and catch-up — see G-003). …
> **Adversarial scenario**: Reconnect-storm: user subscribed when
> public, server goes down briefly, host privatised during outage, user
> reconnects with `sinceSequence=0`, server delivers either a snapshot
> or every event the user was a stranger for.
> **Suggested test**: Vitest case in `catch-up.test.ts`: subscribe →
> flip privacy server-side → invoke catch-up → assert `not-found`. The
> handler's gate-2 visibility check at line 213 should fire; the
> assertion validates that.

The predecessor task
[`privacy_flip_subscription_prune`](privacy_flip_subscription_prune.md)
closes G-001 by actively pruning subscribers when a session flips to
private — eliminating the broadcast-fanout exposure (`event-applied`,
`diagnostic`, `proposal-status` no longer route to evicted strangers).
But the active prune does NOT cover the in-flight `catch-up` envelope:
a client whose `catch-up` is already on the wire when the UPDATE lands
could land its read BEFORE the prune's per-connection iteration reaches
it. The handler's gate-2 `canSeeSession` re-check is the structural
defense for that race window; this task pins the defense.

Two coverage gaps the test closes together:

- **Race path (Scenario A).** The active prune runs OUTSIDE the privacy-
  UPDATE transaction (per the predecessor's Decisions); a `catch-up`
  envelope that arrives between `COMMIT` of the privacy bit and the
  prune helper's per-connection visit is processed against a registry
  entry that still exists. Without gate-2's `canSeeSession`, the
  handler would read the full event log + project + serialize a
  snapshot for the now-private session and ship it to the stranger.
  The gate is in place; this test pins that it IS in place.

- **Once-a-participant invariant (Scenario B).** The visibility rule
  admits former participants by design. A test exercising the
  catch-up-from-former-participant path documents and pins the rule's
  edge — a regression that tightens the predicate to
  current-participants-only would break replay for legitimately
  past participants (the audience-of-record pattern) AND would be
  invisible to existing tests because no committed test exercises
  the `left_at IS NOT NULL` + private-session combination at the
  catch-up surface today.

ADR 0022 ("no throwaway verifications") is explicit: every empirical
verification of system behavior lands as a committed test. The
"obvious by inspection" defense of the gate doesn't survive a
refactor; the regression test does.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md)
  G-002 — source finding (High severity).
- [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts)
  lines 460-467 — gate-2 `canSeeSession` re-check. The
  `ApiError.notFound('session not found or not visible', …)` collapses
  "doesn't exist" and "exists but not visible" into one wire-shape per
  the existence-non-leak rule.
- [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts)
  lines 12-19 — the visibility rule. The participant EXISTS clause
  intentionally omits `left_at IS NULL` so former participants stay
  visible.
- [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts)
  — existing test scaffolding (`makeCatchUpPool`, `openWsClient`,
  `subscribeFrame`, `catchUpFrame`, `readUntilType`). The existing
  not-found-gate test at line 474 is the most relevant template: it
  uses `app.wsSubscriptions.subscribe(connectionId, …)` to forcibly
  install a registry entry (bypassing the subscribe handler's own
  visibility gate), then sends a `catch-up`, then asserts `not-found`.
  This task adapts the same template for the race + former-participant
  cases.
- [`tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md`](privacy_flip_subscription_prune.md)
  — predecessor refinement. Notes that the prune runs OUTSIDE the
  privacy-UPDATE transaction and per-connection iteration is sequential
  — the race window is real, not hypothetical.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every empirical verification lives as a committed test.

## Constraints / requirements

- **TEST-ONLY.** No edit to the catch-up handler (the gate at line 464
  is already correct). No edit to `canSeeSession`. No edit to the
  subscription registry. No edit to the dispatcher. This task pins
  existing behavior.
- **Use the existing test pool's mutation surface.** Scenario A mutates
  `store.sessions[…].privacy = 'private'` directly after the subscribe
  has succeeded. The test does NOT exercise the privacy-PATCH handler
  (the predecessor task already covers that surface). The point of
  Scenario A is to put the registry into the exact post-race state the
  prune helper could leave it in (subscription entry present, session
  no longer visible) and pin the catch-up handler's gate-2 rejection.
- **Scenario B requires extending the test mock with participation.**
  The current `makeCatchUpPool`'s visibility recogniser ignores
  `session_participants`; for Scenario B the mock must consult a new
  `participants` field on the store so the predicate admits former
  participants. The extension matches the production SQL — the EXISTS
  clause has no `left_at IS NULL` filter, so the mock returns
  `visible: 1` for any participant row regardless of `left_at`.
- **Reuse the not-found-gate template.** Scenario A subscribes via the
  normal `subscribeFrame` path (public session → subscribe-handler's
  `canSeeSession` admits, registry entry recorded with the userId
  binding the privacy_flip predecessor added); Scenario A then mutates
  `store.sessions[…].privacy` and sends the `catch-up`. Scenario B
  uses the same forcibly-subscribe trick as the existing line-474 test
  to install a registry entry without going through the subscribe
  handler (which would also run `canSeeSession`; the participant rule
  admits, but for Scenario B we want to keep the test focused on the
  catch-up surface, not the subscribe surface — and a separate
  subscribe-handler test exists for the participant case in
  `subscribe.test.ts`).
- **Connection stays open after the rejection (Scenario A).** A
  `not-found` is a per-frame logical error, NOT a malformed-envelope.
  The connection-level contract (`connection.test.ts`) is that the
  socket stays open across per-frame errors; this test asserts
  `ws.readyState === 1` after the `not-found` arrives.
- **Per ADR 0022**: every empirical claim about handler behavior is a
  committed test. No `node -e`, no ad-hoc probe.

## Acceptance criteria

- `apps/server/src/ws/handlers/catch-up.test.ts` contains two new
  `it('SECURITY (G-002): …')` cases inside the existing
  `describe('ws_reconnection_handling — handler integration', …)`
  block:
  1. **Scenario A** — non-participant subscribes to a public session,
     the session's privacy flips server-side, the client races a
     `catch-up`; the handler's gate-2 rejects with `code: 'not-found'`
     and the connection stays open.
  2. **Scenario B** — a former participant (with `left_at` set) on a
     private session sends a `catch-up`; the handler admits the
     request (`canSeeSession` returns true via the once-a-participant
     EXISTS clause), the catch-up returns a single `caught-up` ack
     with `eventCount: 0` (the fixture session has no events past 0).
- The `makeCatchUpPool` test fixture grows:
  - Two new fixture session ids: a public session NOT hosted by
    `FIXTURE_USER_ID` (Scenario A), and a private session NOT hosted by
    `FIXTURE_USER_ID` (Scenario B).
  - A `participants` field on the `Store` interface and the visibility
    recogniser consulting it (admits when a matching participant row
    exists, regardless of `left_at`).
- `pnpm exec vitest run apps/server/src/ws/handlers/catch-up.test.ts`
  — green.
- `pnpm run check` — clean.
- `pnpm run test:smoke` — green.
- Task-completion ritual per
  [`tasks/refinements/README.md`](../README.md): `complete 100` on the
  `.tji` task, `## Status` block appended to this refinement, single
  commit.

## Decisions

- **Two scenarios in one task.** G-002's gap statement names two
  separate but related paths — the race-against-the-prune (Scenario A,
  the headline) and the former-participant case (Scenario B,
  "and, more importantly, the user being … see G-003"). Bundling both
  into one task keeps the catch-up surface's coverage coherent: one
  describe block, two `it(…)` cases, one fixture extension. Splitting
  into two tasks would have duplicated the fixture extension.

- **Scenario A mutates the store directly; it does NOT call the
  privacy-PATCH handler.** The predecessor task's tests in
  `routes.test.ts` exercise the PATCH + prune path end-to-end. The
  goal of Scenario A is narrower: pin the **handler's own re-check**.
  Mutating the store directly cuts out the prune surface and the route
  surface, so the only thing under test is the catch-up handler's
  response to a registry entry whose visibility no longer holds. This
  is the exact race the prune leaves open by design (it runs
  per-connection, outside the UPDATE's transaction).

- **Scenario A uses the normal subscribe flow.** The test sends a real
  `subscribe` envelope before the privacy flip. This (a) puts the
  registry entry into the same shape the prune helper iterates over
  (userId binding included via the predecessor's
  `subscribe(connId, sessId, userId)` extension), and (b) pins that
  the gate-2 re-check is INDEPENDENT of how the registry entry got
  there. A future refactor that conflates "you subscribed therefore
  you can catch-up" would fail this test.

- **Scenario B uses the forcibly-subscribe shortcut.** The
  participant-on-a-private-session subscribe path is exercised by
  `subscribe.test.ts`; repeating it here would duplicate that
  coverage. The forcibly-subscribe shortcut (lines 485-488 of the
  existing not-found test) skips the subscribe handler entirely and
  installs the registry entry directly, so the test stays focused on
  the catch-up surface.

- **Mock extension: a `participants` field, not a separate map.**
  The existing `Store` shape is two arrays (`sessions`, `events`);
  adding a third array (`participants: ParticipantRow[]`) matches that
  shape and keeps the mock readable. The visibility recogniser does an
  Array.find — same big-O as the existing host-check — so the
  extension does not slow other tests measurably.

- **No `left_at` filter in the mock predicate.** The production SQL
  has no `left_at IS NULL` clause in the participant EXISTS subquery.
  The mock mirrors that intentionally — adding such a filter would
  cause Scenario B to fail with a false `not-found` and would mask the
  once-a-participant invariant the test is pinning.

- **Scenario B's session has zero events.** A `caught-up` ack with
  `eventCount: 0` and `throughSequence: 0` (because `MAX(sequence) =
  COALESCE(NULL, 0) = 0`) is sufficient evidence that gate-2 admitted
  the request — the handler reached the boundary read and the no-op-
  at-head branch. Adding events would be extra surface (replay-slice
  arithmetic) that the existing slice-replay test already covers.

- **Both scenarios assert `connection.readyState === 1` post-frame.**
  The `not-found` of Scenario A is a per-frame logical error;
  Scenario B's `caught-up` is a success ack. In both cases the socket
  stays open — pinned explicitly so a future regression that closes
  the connection on either path fails this test.

- **No Cucumber+pglite layer in this task.** The predecessor task's
  Decisions explicitly note that "any future Cucumber pass against the
  prune lifecycle covers all three" (privacy_flip / soft-delete /
  catch-up-revoked). This task stays at the Vitest unit layer for
  consistency with the rest of the `catch-up.test.ts` file (every
  case in the file is at the same layer; mixing layers would
  fragment the test surface).

- **No envelope-shape changes.** The gate-2 rejection reuses the
  existing `not-found` `ApiError.code` taxonomy — same wire shape
  as the existing not-found test at line 474. The test assertions are
  copy-shaped from that test to make the two pins visually parallel.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) — two new `it('SECURITY (G-002): …')` cases inside the existing `describe('ws_reconnection_handling — handler integration', …)` block:
  1. **Scenario A** — non-participant subscribes via the normal `subscribeFrame` path to `STRANGER_SUB_SESSION_ID` (public, hosted by `OTHER_HOST_ID`); the test mutates `store.sessions[…].privacy = 'private'` to simulate the race-window state the predecessor task's prune helper leaves open (registry entry persists, session no longer visible); the racing `catch-up` envelope is rejected with `code: 'not-found'` (existence-non-leak) and the connection stays open.
  2. **Scenario B** — `FIXTURE_USER_ID` is a former participant of `FORMER_PARTICIPANT_SESSION_ID` (private, hosted by `OTHER_HOST_ID`) with `left_at` set; the catch-up succeeds with a single `caught-up` ack carrying `eventCount: 0`, `throughSequence: 0`, `fromSnapshot: false`. Pins the once-a-participant rule documented in [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) lines 12-19.
- [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) (fixture extensions): added two new fixture session ids (`STRANGER_SUB_SESSION_ID`, `FORMER_PARTICIPANT_SESSION_ID`); added a `ParticipantRow` interface and a `participants` field on the `Store` shape; extended the `canSeeSession` recogniser in `makeCatchUpPool` to consult `store.participants` so the predicate admits any matching row regardless of `left_at` (mirroring the production SQL's no-`left_at`-filter rule).
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to the `catch_up_revoked_visibility_pin` task entry under `subscription_lifecycle`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (clean parse).
- No production-code change. The catch-up handler's gate-2 `canSeeSession` re-check at `apps/server/src/ws/handlers/catch-up.ts:464` was already in place; this task converts the "obvious by inspection" claim into a committed regression pin per ADR 0022.

Test count delta:
- `catch-up.test.ts`: 35 → 37 `it(…)` blocks (+2).
- Total: +2 new committed tests.

`pnpm run check` and `pnpm run test:smoke` both pass.

**Defense-in-depth split (load-bearing)**: G-002's race window is closed by TWO complementary surfaces — the active prune (predecessor task `privacy_flip_subscription_prune`, G-001) that walks the registry on every public→private flip, and the handler's own gate-2 `canSeeSession` re-check that catches in-flight envelopes the prune iteration hasn't reached yet. Scenario A exercises the gate-2 surface in isolation by mutating the store directly (bypassing the privacy-PATCH handler and its prune); the predecessor task's tests in `routes.test.ts` exercise the prune surface end-to-end. Scenario B pins the orthogonal once-a-participant invariant — a regression that tightens the visibility predicate to current-participants-only would break audience-replay for legitimately past participants and was previously uncovered at the catch-up surface.
