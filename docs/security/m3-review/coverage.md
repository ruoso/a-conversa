# Test-coverage gap audit (security-relevant)

## Methodology

I enumerated every HTTP route registered in `apps/server/src/**` (10 routes across `auth/routes.ts`, `sessions/routes.ts`, `routes/healthz.ts`) and every WS dispatcher handler (`subscribe`, `unsubscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`). For each, I walked the gate stack (auth → subscribe → visibility → role → engine) by reading the production source, then cross-referenced the matching `.test.ts` and `.feature` file plus the refinement under `tasks/refinements/backend/`. The report flags only adversarial scenarios that are NOT currently exercised; coverage that exists is documented inline so readers can verify the gap is real.

## Gaps

### G-001 [High] — Broadcast fan-out does NOT re-check session visibility, so a session that goes private retains stale subscribers receiving its event stream
**Surface**: `event-applied` broadcast (`apps/server/src/ws/broadcast/event-applied.ts:103`), `diagnostic` broadcast (`apps/server/src/ws/broadcast/diagnostic.ts:206`), `proposal-status` broadcast (`apps/server/src/ws/broadcast/proposal-status.ts:275`)
**Existing coverage**: Cross-session non-leak is tested in `tests/behavior/backend/ws-event-broadcast.feature` (Scenario "A client subscribed to session A does not receive broadcasts for session B") and `tests/behavior/backend/ws-diagnostic.feature`. Routes-level visibility tests live at `apps/server/src/sessions/routes.test.ts:1671, 1991, 2307` (404 on non-visible). The privacy-toggle endpoint at `apps/server/src/sessions/routes.ts:1767` has no subscription scrubbing and there is NO test covering the privacy-toggle-after-subscribe path.
**Gap**: When the host of a public session flips it to private via `PATCH /sessions/:id/privacy`, the WS subscription registry is NOT pruned. A non-participant who subscribed while the session was public continues to receive every subsequent `event-applied`, `diagnostic`, and `proposal-status` broadcast for that session — until they reconnect (when the next `subscribe` would fail visibility) or call `unsubscribe`. The three broadcast listeners only consult `connectionsForSession(sessionId)` and do not re-run `canSeeSession`.
**Adversarial scenario**: An attacker subscribes to a public debate, the host turns it private (intending to take it confidential), and the attacker continues to see every methodology event + diagnostic on that session. Particularly damaging because (a) the methodology engine emits potentially-sensitive propositional content in proposal payloads, and (b) the attacker never receives any signal that the session went private.
**Suggested test**: A Vitest case in `apps/server/src/sessions/routes.test.ts` (or a new `subscription-pruning.test.ts`) that: (1) opens a WS connection as non-participant, subscribes to a public session, (2) host PATCHes privacy to `private`, (3) appends an event via another path, (4) asserts the non-participant connection receives ZERO frames (or alternatively, a `unsubscribed` server-initiated push). Cucumber: `Scenario: a session flipped to private prunes subscribed strangers from the broadcast surface` in `session-privacy.feature`.
**Severity**: High

### G-002 [High] — Catch-up replays history to a user whose session-visibility was revoked after subscribe
**Surface**: WS `catch-up` handler (`apps/server/src/ws/handlers/catch-up.ts`)
**Existing coverage**: `apps/server/src/ws/handlers/catch-up.test.ts:442` covers `not-visible → not-found` for the initial gate. The handler does re-check `canSeeSession` at line 213.
**Gap**: G-001's stale-subscription issue compounds here: a user who subscribed to a public session that later went private CAN still see the catch-up because the visibility check passes at subscribe time but is NOT re-run when the user has been a former participant. However, more subtly — there is no test for a catch-up where the user was visible at subscribe but lost visibility between subscribe and catch-up (e.g., session privacy toggle, or, more importantly, the user being soft-deleted between subscribe and catch-up — see G-003).
**Adversarial scenario**: Reconnect-storm: user subscribed when public, server goes down briefly, host privatised during outage, user reconnects with `sinceSequence=0`, server delivers either a snapshot or every event the user was a stranger for. The handler's `canSeeSession` actually catches this on reconnect (the subscribe before catch-up will fail), BUT if the user re-subscribed in the same connection-lifetime window (without disconnecting), the registry never re-checked.
**Suggested test**: Vitest case in `catch-up.test.ts`: subscribe → flip privacy server-side → invoke catch-up → assert `not-found`. The handler's gate-2 visibility check at line 213 should fire; the assertion validates that.
**Severity**: High

### G-003 [High] — Long-lived WS connection survives soft-deletion of its authenticated user
**Surface**: WS connection (`apps/server/src/ws/connection.ts`), all 8 dispatcher handlers
**Existing coverage**: HTTP middleware soft-delete rejection is tested at `apps/server/src/auth/middleware.test.ts:260`. WS upgrade-time auth gate calls the same `authenticateRequest` helper.
**Gap**: The WS auth gate runs ONCE at upgrade; `connection.user` is captured for the connection's lifetime. There is NO post-auth refresh, NO per-message user-still-exists check, and NO test for the path "user soft-deleted via `users.deleted_at` while their WS connection is open." The dispatcher handlers all use `connection.user.id` for `actor` / `requester` on propose/vote/commit/meta-disagreement without re-validating the user row.
**Adversarial scenario**: Moderator deletes a malicious user via admin/DB op; the malicious user's still-open WS keeps proposing/voting until their 7-day JWT TTL expires. Audit-trail attribution: events keep being written with `actor = <deleted user id>`.
**Suggested test**: `apps/server/src/ws/auth.test.ts` — open WS, soft-delete the user row via the pool, send a `propose`. Today: succeeds. After fix: rejected with `auth-required` and connection closed.
**Severity**: High

### G-004 [High] — No coverage of concurrent commits / votes / inclusions on the same resource
**Surface**: `propose`, `vote`, `commit`, `mark-meta-disagreement` WS handlers; `POST /sessions/:id/end`, `POST /sessions/:id/participants`, `POST /sessions/:id/include`, `PATCH /sessions/:id/privacy` HTTP routes
**Existing coverage**: ADR 0020 documents the FOR UPDATE + MAX(sequence) primary serialisation. Tests verify the BEGIN/COMMIT trace (`apps/server/src/sessions/routes.test.ts:773-775`). Sequence-mismatch is tested for the single-client case (`propose.test.ts:530`).
**Gap**: No test fires two concurrent operations and asserts that exactly one wins. The FOR UPDATE + UNIQUE(session_id, sequence) safety net is unverified end-to-end. The same applies to:
 - Two clients picking the same screen name simultaneously (`POST /auth/screen-name`)
 - Two hosts ending the same session at the same instant
 - Two clients including the same entity into the same destination session (ON CONFLICT DO NOTHING path)
 - Two participants voting on the same proposal at the same time (engine's "no duplicate vote" rule)
**Adversarial scenario**: Two debaters race the moderator's commit with a withdraw vote; without the lock, both could land at sequence N+1, corrupting the event log. The DB-level UNIQUE constraint should catch this, but the resulting `internal-error` 500 is the only signal — there is no test pinning that surface.
**Suggested test**: Vitest case using `Promise.all([propose1, propose2])` against an in-memory pool that injects an artificial delay between MAX(sequence) and INSERT — assert exactly one succeeds and the other surfaces `sequence-mismatch` (preferred) or `internal-error` from the unique-constraint violation. Cucumber against pglite: `Scenario: concurrent ends — second host receives 409 session-already-ended` in `end-session.feature`.
**Severity**: High

### G-005 [High] — `POST /auth/logout` is a no-op against JWT revocation; no denylist test
**Surface**: `POST /auth/logout` (`apps/server/src/auth/routes.ts:809`)
**Existing coverage**: The session-token cucumber scenario "GET /auth/me without cookie is 401" implicitly covers cookie clearing.
**Gap**: The logout endpoint clears the browser cookie but the JWT remains structurally valid until its 7-day `exp`. There is NO test that the same JWT, replayed after logout (e.g., recovered from browser cache, server log, or proxy), is rejected. The `session-token.ts` module's docblock acknowledges deferring revocation; no audit test pins the trade-off (so a reviewer wouldn't realise this is an explicit accepted risk).
**Adversarial scenario**: Attacker exfiltrates the JWT via XSS one minute before user clicks logout. After logout, the attacker continues to authenticate against `/auth/me`, `/ws`, every protected endpoint for 7 days. The "logout" UX is a security illusion.
**Suggested test**: Vitest case in `apps/server/src/auth/routes.test.ts`: (1) issue token via callback, (2) POST `/auth/logout`, (3) replay the EXACT same cookie value against `/auth/me`. Today: returns 200. The test should EITHER assert 200 with a `// known limitation per ADR 0002` comment, OR (preferred) the implementation should add a denylist and the test verifies 401.
**Severity**: High (acknowledged limitation should be pinned by a test per ADR 0022)

### G-006 [Medium] — `catch-up` with adversarial `sinceSequence` values is partially covered
**Surface**: WS `catch-up` handler (`apps/server/src/ws/handlers/catch-up.ts`)
**Existing coverage**: `catch-up.test.ts:610` covers `sinceSequence > MAX(sequence)` (client-ahead). The Zod schema (`packages/shared-types/src/ws-envelope.ts:808`) enforces `z.number().int().nonnegative()`.
**Gap**: The Zod schema rejects negative / fractional / NaN / Infinity at parse time — but there is NO test that the envelope-parser correctly rejects those values at the wire boundary. The Zod regression would silently allow them past the gate. Specifically: `sinceSequence: -1`, `sinceSequence: 9999999999999`, `sinceSequence: 0.5`, `sinceSequence: "0"` (string).
**Adversarial scenario**: A regression in the shared-types schema (e.g., switching `nonnegative()` to `min(-1)`) would let a `sinceSequence: -1` request through; the SQL `WHERE sequence > $2 AND sequence <= $3` would still work (because Postgres bigint compares fine), but a `Number.parseInt(maxSeq) - sinceSequence = positive number larger than threshold` triggers the snapshot path, leaking the full projection of a session via what should be a tiny replay.
**Suggested test**: Add `catch-up.test.ts` cases for each of: negative, fractional, NaN string, Number.MAX_SAFE_INTEGER+1, JSON `null`. Assert each is rejected with a `malformed-envelope` error envelope at the connection layer.
**Severity**: Medium

### G-007 [Medium] — No test for proposer-id spoof on WS `propose` (other write handlers have one)
**Surface**: WS `propose` handler (`apps/server/src/ws/handlers/propose.ts`)
**Existing coverage**: The vote handler tests proposer-spoof at `vote.test.ts:728-736`. Commit at `commit.test.ts:937-962`. Meta-disagreement at `meta-disagreement.test.ts:975-985`. The propose handler does NOT have an equivalent test.
**Gap**: `propose.test.ts` has no test for "client sends extra `proposerId` field on payload; server uses `connection.user.id` regardless." The handler at `propose.ts:280` uses `actor: userId` from the connection — but this invariant is not pinned by a regression test specific to propose, whereas every other writer handler IS pinned.
**Adversarial scenario**: A future refactor moves `actor` derivation into a generic helper; a bug in that helper reads `payload.proposerId` instead of `connection.user.id`. Vote/commit/meta-disagreement tests catch it; propose drift slips through review.
**Suggested test**: Add a test "even when the client tries to spoof proposerId / actor / requester, the appended event's actor is the connection's authenticated user" mirroring `vote.test.ts:707-761`.
**Severity**: Medium

### G-008 [Medium] — Dispatcher behaviour for an S→C-only message type sent as C→S is not tested
**Surface**: WS dispatcher (`apps/server/src/ws/dispatcher.ts`)
**Existing coverage**: `dispatcher.test.ts:121` covers an unknown type (synthetic). No test sends a real S→C-only type (e.g., `subscribed`, `event-applied`, `error`, `proposal-status`, `diagnostic`, `caught-up`) AS a client.
**Gap**: The Zod envelope schema (`wsMessageTypes`) is a single closed list containing both C→S and S→C types; nothing in the schema prevents a client from sending `type: 'event-applied'`. The dispatcher rejects it with `unknown-message-type` (no handler registered), but this is implicit and not pinned.
**Adversarial scenario**: A future task registers a handler for an S→C type by mistake (e.g., when reusing a builder) — there's no test guarding "the server NEVER accepts an inbound frame typed as an ack/result/broadcast."
**Suggested test**: Vitest case "every S→C-only `wsMessageType` is rejected with `unknown-message-type` when sent C→S," parameterised over `['subscribed', 'unsubscribed', 'proposed', 'voted', 'committed', 'meta-disagreement-marked', 'snapshot-state', 'caught-up', 'event-applied', 'error', 'diagnostic', 'proposal-status', 'hello']`.
**Severity**: Medium

### G-009 [Medium] — Duplicate `id` envelope and forged `inResponseTo` on inbound frames are not exercised
**Surface**: WS dispatcher (`apps/server/src/ws/dispatcher.ts`), all handlers
**Existing coverage**: Envelope-level UUID validation is tested in `packages/shared-types/src/ws-envelope.test.ts:149` (non-UUID rejected). The server does NOT dedupe `id`s server-side.
**Gap**: There is no test asserting the server's behaviour when a client sends two `propose` envelopes with the same `id` field — does it process both? Does it correlate `inResponseTo` correctly when a client forges `inResponseTo: <random-uuid>` on a C→S frame? The dispatcher trusts the inbound `id`; an attacker could replay a `propose` envelope and the server would process it twice (different proposals at sequence N+1, N+2). The sequence allocator catches the actual race, but the `proposed` ack on the second copy returns `sequence-mismatch` — what should be a server-side dedupe is instead a methodology-engine reject.
**Adversarial scenario**: Replay attack against an idempotent-looking action: client sends `propose { id: X }`, network glitches, client retries with same `id`, attacker MITM injects a third copy. Without server-side dedupe by `(connectionId, envelope.id)`, the second-and-third arrive as fresh proposals.
**Suggested test**: `dispatcher.test.ts` case — same envelope sent twice in succession. Today's behaviour should be pinned (likely "both processed; second gets sequence-mismatch"); the test makes the behaviour explicit so any future refactor sees the contract.
**Severity**: Medium

### G-010 [Medium] — No test for pglite/pg `BIGINT MAX(sequence)` returning a string that's lexicographically > Number.MAX_SAFE_INTEGER
**Surface**: Every event-writing handler (`propose`, `vote`, `commit`, `mark-meta-disagreement`, all sessions/routes.ts append sites)
**Existing coverage**: The string-to-number coercion is in `propose.ts:232`, `vote.ts:184`, `commit.ts:188`, `meta-disagreement.ts`, plus 5 sites in `sessions/routes.ts`. The pg driver returns BIGINT as string by default; the code parses with `Number.parseInt`.
**Gap**: `Number.parseInt("9007199254740993", 10) === 9007199254740992` (silent precision loss). No test injects a `MAX(sequence)` near or past 2^53 and asserts the handler either (a) handles it correctly with bigint math, or (b) fails loudly with a typed error. The docblock acknowledges the ceiling without enforcing it.
**Adversarial scenario**: Very long-running session OR a deliberately-crafted poison row (DBA error) at sequence 2^53. Subsequent proposes silently land at the same JS-number sequence, breaking the read-side projection's invariant `sequence > prior.sequence`.
**Suggested test**: Vitest case where the in-memory store seeds the events table with a single row at sequence `Number.MAX_SAFE_INTEGER`, then send a `propose`. Assert either a typed `sequence-overflow` error envelope or correct handling.
**Severity**: Medium (documented limitation; an explicit test would convert it to a pinned behaviour)

### G-011 [Medium] — Pending-cookie verify path has no test for the `now`-injection bypass via clock skew
**Surface**: `POST /auth/screen-name` (`apps/server/src/auth/routes.ts:711`), `verifyPendingCookie` (`apps/server/src/auth/pending-cookie.ts`)
**Existing coverage**: `screen-name.test.ts:330` covers an expired cookie. `pending-cookie sign / verify` tests cover bad-secret, tampered payload, malformed, etc.
**Gap**: The pending-cookie's `expiresAt` is server-clock-checked, but the cookie ITSELF carries the `expiresAt` value in its signed payload. If `Date.now()` on the server jumps backward (NTP correction, container clock drift), an expired cookie becomes valid again. No test pins the "cookie that was valid at sign-time but the server's clock is now BEHIND its `expiresAt`" case as a deliberate accept/reject decision.
**Adversarial scenario**: Multi-region deployment where one node's clock is 20 minutes behind. Attacker steals a pending cookie that expired on the fast node; replays against the slow node; succeeds.
**Suggested test**: `pending-cookie.test.ts` — sign a cookie at t=0 with `expiresAt=t+600000`, verify at t=300000 with `now=() => t-100000` (clock went backward). Today: succeeds. Pin the behaviour explicitly.
**Severity**: Medium

### G-012 [Medium] — OIDC state replay coverage tests `take()` is one-shot, but no test for state-reuse across separate /auth/callback responses in the same session
**Surface**: `GET /auth/callback` (`apps/server/src/auth/routes.ts:573`)
**Existing coverage**: `routes.test.ts:267` covers "a replay against the same state after take() returns 400". `flow.test.ts:262` covers `take` is one-shot.
**Gap**: No test for the case where the client retains the `Location` URL from `/auth/login` (containing the original `state` value) and re-uses it via a *different* /auth/callback request (e.g., via a forged-state attack with a stolen state value via referer header). The current test only verifies that the same `state` cannot be `take()`ed twice in-process; what about a state that was leaked via browser history + replayed AFTER a fresh state was issued?
**Adversarial scenario**: Browser history attack — attacker reads the user's session-history (via XSS on a different site), finds the issuer redirect URL, replays the `state` against `/auth/callback` after the original state was already consumed. Should fail (it would — `flowState.take` returns undefined). But this scenario is the typical "state-fixation" attack class and would benefit from an explicit pinned test for the audit-trail reviewer.
**Suggested test**: `routes.test.ts` — issue state, call `/auth/callback` with it (consume), call `/auth/callback` AGAIN with the same state. Today's behaviour is correct (rejected), but the test gives the auditor a one-line proof.
**Severity**: Medium (defensive — current behaviour is correct, but the security pinning is implicit)

### G-013 [Medium] — `GET /sessions?offset=<huge>` is not tested for resource exhaustion / SQL behaviour
**Surface**: `GET /sessions` (`apps/server/src/sessions/routes.ts:1281`)
**Existing coverage**: `routes.test.ts:1497, 1513, 1529` cover bad UUID, limit>200, bad enum. `limit` is capped at 200 by the Zod schema (`sessions/routes.ts:802`); `offset` has only `minimum: 0` with no upper bound.
**Gap**: A request like `GET /sessions?offset=999999999999` is well-formed (Zod allows any nonnegative integer), Postgres handles a giant OFFSET correctly but burns disk/CPU to scan past it. No `?offset` upper-bound test.
**Adversarial scenario**: Authenticated denial-of-service: `GET /sessions?offset=1e18` repeated in parallel chews session_index scans on the server until the connection pool exhausts.
**Suggested test**: Either a Vitest assert "`?offset` is capped at 100000 (or similar)" alongside the existing limit-cap test, or pin the current behaviour ("`?offset=1e18` returns empty 200") for auditor visibility.
**Severity**: Medium

### G-014 [Medium] — Subscribing to a non-existent session id leaks "session not found" identically to "private session you can't see" — this is by design, but no test pins the no-leak property
**Surface**: WS `subscribe` handler (`apps/server/src/ws/handlers/subscribe.ts:93`)
**Existing coverage**: `subscribe.test.ts:295` tests a "non-visible session" emits `code: not-found`. The handler comment at line 95 documents the existence-non-leak rule.
**Gap**: There is no test asserting the wire response is BYTEWISE-IDENTICAL between "session doesn't exist" and "session exists but is private". The visibility predicate collapses them at the SQL layer, but a future refactor (e.g., adding a debug detail field) could leak the distinction. No test asserts the negative.
**Adversarial scenario**: Information leak — an attacker iterates UUIDs and learns which UUIDs match real private sessions vs. random UUIDs by timing or response shape.
**Suggested test**: `subscribe.test.ts` — two cases that should produce IDENTICAL envelopes (same `code`, same `message`, same shape; only `inResponseTo` differs because the request id differs). Diff the response payloads (after stripping `inResponseTo` and `id`) and assert equality.
**Severity**: Medium

### G-015 [Medium] — Catch-up snapshot path emits the full projection without re-checking visibility at projection-build time
**Surface**: WS `catch-up` handler snapshot branch (`apps/server/src/ws/handlers/catch-up.ts:262-294`)
**Existing coverage**: Initial gate-2 visibility check at line 213.
**Gap**: The handler runs `canSeeSession` once at line 213, then loads the FULL event log (line 271) and emits a `snapshot-state` payload containing every committed proposal, every node, every annotation. If the projection contains entities referenced from OTHER private sessions (via `entity-included`), the snapshot transitively exposes those entity contents to anyone who can see the destination session. The reference-permission predicate (`canReference*`) protects the CREATION of inclusions, but does NOT protect the rendering of already-included entities in a snapshot. There is no test for "an entity from a private origin session was included into a public session and a stranger snapshots the public session — what fields of the original entity are visible?"
**Adversarial scenario**: Host of public session A includes a node from their private session B (legal — host can reference). Public session A is widely subscribed. Strangers snapshot A and read the included node's `wording` / `axiomMarks` — fields that originated in private B.
**Suggested test**: `snapshot.test.ts` case: include an entity from a private origin into a public destination, snapshot from a stranger's perspective, assert which fields ARE visible (likely all — confirming current behaviour). This is more a documentation-test than a fix-test; the methodology may intend this transitivity. Either way, pin it.
**Severity**: Medium (depends on intended methodology — could be Informational if accepted)

### G-016 [Medium] — Diagnostic event for an unsubscribed session may still leak via the active-context window
**Surface**: `wsDiagnosticBroadcast.notifyForSession` (`apps/server/src/ws/broadcast/diagnostic.ts`)
**Existing coverage**: `tests/behavior/backend/ws-diagnostic.feature` covers cross-session non-leak.
**Gap**: The `notifyForSession` wrapper sets active context, calls `bus.notify`, and clears in `finally`. If `bus.notify` invokes handlers asynchronously (today it's sync per the doc, but a future refactor could change this), the context would be cleared before the listeners read it. No test pins the synchronous-dispatch contract. Additionally, the `diagnostic` broadcast inherits G-001's stale-subscription issue.
**Adversarial scenario**: A future refactor of `DiagnosticBus.notify` to async would silently break the session-attribution; broadcasts for session A could be tagged with session B's context.
**Suggested test**: Bus-level test that pins "notify is fully synchronous: when notifyForSession returns, every listener has finished and the context is cleared." Use a listener that awaits a microtask — the test should fail if the bus becomes async.
**Severity**: Medium

### G-017 [Low] — `POST /sessions/:id/include` does not verify that the SOURCE session's visibility is checked at INCLUSION-LANDING time inside the transaction
**Surface**: `POST /sessions/:id/include` (`apps/server/src/sessions/routes.ts:2452`)
**Existing coverage**: Source-side reference predicate `canReferenceNode/Edge/Annotation` runs inside the same transaction client (`routes.ts:2623`).
**Gap**: There IS a TOCTOU window if the source session's privacy is flipped between the user's UI rendering "you can include this" and the user clicking "include." The reference predicate at line 2623 reads through the same transaction as the destination FOR UPDATE — but the source session's row is NOT FOR UPDATE'd, so concurrent privacy flip on the source CAN race the inclusion. The handler will succeed even if the source was just flipped to private + user removed as participant.
**Adversarial scenario**: User Alice is participant of private session B. Alice prepares to include a node from B into public session A. Bob (host of B) removes Alice as participant AND flips B to private (multi-step UX) in a different request. Alice's include request races: it sees B-visible at line 2623's `canReferenceNode` SELECT and lands the inclusion. The inclusion is now PERMANENT in A even though Alice could not now re-discover this node.
**Suggested test**: Integration test that interleaves a participant-leave on source B with an include from B→A; assert which outcome we want (today: include succeeds; the "wanted" answer is a methodology decision).
**Severity**: Low (narrow race window; depends on UX intent)

### G-018 [Low] — Cucumber concurrent-pglite coverage is absent for the entire WS write surface
**Surface**: All WS write handlers exercised via Cucumber
**Existing coverage**: Cucumber backend features (`tests/behavior/backend/`) test each handler in isolation per ADR 0007.
**Gap**: No Cucumber Background that opens TWO authenticated clients and races them on the same session. The current `Promise.all`-style concurrency assertion lives nowhere.
**Adversarial scenario**: As G-004 — every concurrent-write security claim is uncovered by behaviour tests.
**Suggested test**: New `tests/behavior/backend/concurrent-writes.feature` with scenarios for (a) two propose at the same expectedSequence, (b) two commits of the same proposal, (c) two screen-name picks for the same user.
**Severity**: Low

### G-019 [Informational] — `/auth/me` does not return cache-control headers; a CDN could cache it across users
**Surface**: `GET /auth/me` (`apps/server/src/auth/routes.ts:857`)
**Existing coverage**: Cookie-validation path is tested.
**Gap**: No `Cache-Control: no-store` header is set on the response. A misconfigured CDN/proxy could cache one user's response and serve it to another. Today's deployment is same-origin without an intermediate CDN, so this is informational.
**Suggested test**: Vitest assertion: `expect(res.headers['cache-control']).toContain('no-store')`. If not present, either add it OR document the choice.
**Severity**: Informational

## Coverage notes

I walked:
- All 10 HTTP routes (`/`, `/healthz`, `/auth/login`, `/auth/callback`, `/auth/screen-name`, `/auth/logout`, `/auth/me`, `POST/GET /sessions`, `GET /sessions/:id`, `POST /sessions/:id/end`, `PATCH /sessions/:id/privacy`, `POST /sessions/:id/participants`, `DELETE /sessions/:id/participants/:userId`, `POST /sessions/:id/include`, `GET /ws`).
- All 8 WS handlers (`subscribe`, `unsubscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`).
- Both broadcast surfaces (`event-applied`, `diagnostic`, `proposal-status`).
- All `*.test.ts` files under `auth/`, `sessions/`, `ws/`, `ws/handlers/`, `ws/broadcast/`.
- All 34 cucumber `.feature` files under `tests/behavior/backend/`.
- Cross-referenced the refinement docs under `tasks/refinements/backend/` for stated invariants.

I deliberately deferred:
- Methodology-engine internal coverage (`apps/server/src/methodology/handlers/*.test.ts`) — out of scope for this audit; the engine is sandwiched between protocol-gated boundaries.
- Projection-cache invariants (`apps/server/src/projection/*.test.ts`) — not network-facing.
- The diagnostics module's own classification logic — covered by domain tests.
- HTTP-route schema-validation rejections — extensive coverage exists for each route's body/query schemas.

## Overall assessment

The protocol-layer gates (auth, subscribe-before-act, visibility, role) are individually well-tested for SYNCHRONOUS rejection paths — every handler has at least one "unauthorized → 401", "unsubscribed → forbidden", "non-visible → not-found", and (for moderator-gated handlers) "non-moderator → 403" case. The spoof-resistant identity binding (`actor` / `requester` from `connection.user`, never the payload) is pinned by tests on three of four write handlers (vote, commit, meta-disagreement). The OIDC handshake's state-replay protection and the JWT algorithm-confusion class are explicitly tested. **However**, the test surface is NOT adequate for a public-network deployment because of three classes of coverage gap: (1) the privacy/visibility model treats subscription state as immutable for the connection's lifetime — there is no test (and no implementation) for visibility revocation, so a stranger who subscribed to a public session retains every broadcast after the host privatises it (G-001, G-002, G-003); (2) the concurrent-write safety net is documented (ADR 0020) but no test exercises the actual race surface (G-004, G-018); (3) JWT revocation is a documented limitation but is not pinned by a test that the auditor can read to understand the trade-off (G-005). Before exposing the WS endpoint to the public network, at least G-001, G-003, and G-004 should grow tests AND, if tests reveal the implementation has bugs, fixes — the rest are defensive pinning and can land as a tightening pass.
