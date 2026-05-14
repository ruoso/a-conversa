Source: docs/security/m3-review/coverage.md G-017

# Pin the TOCTOU window on entity-inclusion source visibility

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.concurrency_safety.inclusion_source_toctou_pin`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend_hardening.concurrency_safety.concurrent_write_test_harness` (settled — provides `apps/server/src/test-support/concurrent-write-pool.ts`, the in-process harness with per-row FOR UPDATE semantics + an `INSERT INTO session_events` gate). The race this task pins lives between the source-side `canReference<Kind>` SELECT inside the include handler's transaction and a concurrent `UPDATE sessions SET privacy = ...` on the SOURCE session row; the harness's gate gives us the deterministic interleaving.

## What this task is

Decide what `POST /sessions/:id/include` should do when the source session's visibility flips concurrently with the inclusion's source-side reachability check, then pin the chosen behavior with a Vitest scenario driven through the concurrent-write harness. Closes G-017 in [docs/security/m3-review/coverage.md](../../../docs/security/m3-review/coverage.md).

## Why it needs to be done

The reference predicate `canReference<Kind>(client, entityId, callerUserId)` (`apps/server/src/sessions/references.ts`) runs INSIDE the include handler's `withTransaction` against the same client that has FOR UPDATE'd the **destination** session row (`apps/server/src/sessions/routes.ts`, lines ~2590–2667). The destination is serialised; the **source** session row referenced through `JOIN sessions ON sj.session_id = sessions.id` is NOT FOR UPDATE'd. A concurrent `PATCH /sessions/<source>/privacy` (a single non-transactional UPDATE in the production code — see `routes.ts` ~lines 1838–1940, where the handler deliberately skips FOR UPDATE because the UPDATE itself is atomic) can interleave between the reference predicate's SELECT and the inclusion's COMMIT. The handler will succeed even if the source flipped to private a microsecond after the SELECT returned, and the now-included entity will remain visible in the destination session forever.

The race window is narrow — both transactions are write-path, both run with PG's READ COMMITTED default, the privacy UPDATE is a single statement — but the window is genuinely non-zero. G-017 classifies it as Low severity.

The methodology decision in [`entity_inclusion_render_policy.md`](entity_inclusion_render_policy.md) (the sibling task closing G-015) frames inclusion as **"an explicit act of disclosure"**: once Alice includes a node from B into A, the node's content lives in A's event log and is rendered to A's audience. That framing materially shapes how we treat G-017's race: a milliseconds-wide window in which Alice's UI showed "you can include this" — and Alice clicked — is, semantically, the same act of disclosure regardless of which side of the privacy flip the SELECT landed on. Alice intended to include; the system disclosed. Tightening this race would require either (a) FOR-SHARE-locking the source row inside `canReference*` (extra contention with no methodology gain), or (b) adding a methodology rule that "inclusion at the moment of a privacy flip is forbidden" (not specified anywhere in [`docs/methodology.md`](../../../docs/methodology.md) or [`docs/architecture.md`](../../../docs/architecture.md)).

The right v1 outcome is to **document the race and pin the current behavior** so a future auditor sees the trade-off; a future task with a methodology mandate can tighten the rule by switching the assertion in one place.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-017 — source finding (Low; Confirmed).
- [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `POST /sessions/:id/include` (~lines 2489–2762) and `PATCH /sessions/:id/privacy` (~lines 1804–1941). The include handler runs in `withTransaction` with FOR UPDATE on the destination; the privacy handler runs a single non-transactional UPDATE on the (any) target row.
- [`apps/server/src/sessions/references.ts`](../../../apps/server/src/sessions/references.ts) — `canReferenceNode/Edge/Annotation`. The SQL is `SELECT 1 AS reachable FROM session_<kind>s sj JOIN sessions ON sj.session_id = sessions.id WHERE sj.<entity>_id = $1 AND <visibilityWhereFragment(2)> LIMIT 1`. Reads `sessions.privacy` and `sessions.host_user_id` and the `session_participants` EXISTS subquery.
- [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) — `visibilityWhereFragment`. Public OR host OR past-or-current participant. Note: "past-or-current participant" means a `session_participants` row exists regardless of `left_at`; removing Alice from a session does NOT revoke her visibility under v1 semantics.
- [`apps/server/src/test-support/concurrent-write-pool.ts`](../../../apps/server/src/test-support/concurrent-write-pool.ts) — the harness from `concurrent_write_test_harness`. Per-connection client isolation; per-row FOR UPDATE locking on sessions; one-shot `gateOnInsert(sessionId)` API.
- [`tasks/refinements/backend-hardening/entity_inclusion_render_policy.md`](entity_inclusion_render_policy.md) — the policy decision that "inclusion is an explicit act of disclosure," referenced in the rationale below.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — the test lands as a committed Vitest case (the harness backing is a pure-JS memory pool; ADR 0022's layer-mapping points at Vitest).

## Constraints / requirements

- **Option A — Accept the race; pin the v1 behavior.** No production-code change to the include handler or the reference predicates. The race is documented in this refinement; the test pins the current outcome so a future tightening surfaces as a one-line assertion flip rather than a silent semantic drift.
- **Two orderings exercised.** The test must drive BOTH interleavings deterministically (no `setTimeout`, no timing assumptions):
  1. **Alice's `canReferenceNode` SELECT runs BEFORE Bob's privacy UPDATE commits** → Alice's include succeeds with 200 even though Bob's flip commits an instant later. The race's "wide-open" outcome.
  2. **Bob's privacy UPDATE commits BEFORE Alice's `canReferenceNode` SELECT runs** → Alice's include surfaces 403 `entity-not-referenceable`. The race's "closed-shut" outcome.
- **No `setTimeout`, no timing assumptions.** Determinism via the harness's `gateOnInsert(destinationId)` + `untilWaitingForLock()` APIs. The first scenario gates Alice's `INSERT INTO session_events` (which fires AFTER `canReferenceNode` has run inside her transaction); the test fires Bob's privacy UPDATE while Alice is paused at the gate, then releases. The second scenario runs Bob's privacy UPDATE to completion BEFORE Alice's request is fired.
- **The pinned behavior is the production behavior.** No changes to `references.ts`, no changes to the include handler's source-side check. The test asserts what currently happens — not what an idealised version should happen.
- **The harness needs three new SQL recognisers**: `INSERT INTO session_<kind>s` (with composite-PK conflict semantics), `SELECT 1 AS reachable FROM session_<kind>s sj JOIN sessions ...` (the `canReference*` predicate), and `UPDATE sessions SET privacy = $1 ... RETURNING ...` (the privacy PATCH handler). Plus a non-FOR-UPDATE variant of the sessions row SELECT (the privacy PATCH's pre-check). Each is a one-line `if (text.includes(...))` block matching the same shape as the existing recognisers. The harness store gains `sessionNodes` / `sessionEdges` / `sessionAnnotations` arrays mirroring the existing memory-pool shim in `routes.test.ts`.
- **ADR 0022 — no throwaway probes.** Test is a committed Vitest case under `apps/server/src/test-support/inclusion-source-toctou.test.ts` (a new file; lives next to the existing `concurrent-writes.test.ts` scenarios).
- **Use `pnpm`.** All commands.

## Acceptance criteria

- A refinement document (this file) opening with `Source: docs/security/m3-review/coverage.md G-017`, naming Option A as the chosen path, and citing the `entity_inclusion_render_policy` precedent for the "inclusion is explicit disclosure" rationale.
- A scenario file `apps/server/src/test-support/inclusion-source-toctou.test.ts` covering the two orderings as separate `it(...)` blocks under a `describe('include + source-privacy-flip TOCTOU')` umbrella.
- The harness `apps/server/src/test-support/concurrent-write-pool.ts` extended with the new SQL recognisers (above) and store arrays; the existing self-test and the existing concurrent-write scenarios continue to pass unchanged.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new file; all pass.
- `complete 100` on the `.tji` task; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- Single commit using the template in the task brief.

## Decisions

- **Option A (accept + pin), not Option B (FOR SHARE the source row).** Rationale: (a) the methodology decision in `entity_inclusion_render_policy.md` already frames inclusion as "an explicit act of disclosure" — the act of clicking "include" is what discloses, not the bytes-on-the-wire of which side of the privacy flip the SELECT landed on; (b) the race window is genuinely narrow (single PG statement vs. single transaction commit; READ COMMITTED's SELECT reads the row's current committed value); (c) Option B adds contention against the privacy-flip path (every privacy PATCH would have to wait for any in-flight `canReference*` against the source to finish) for a Low-severity gap; (d) the test-pinned behavior makes a future tightening trivial — the assertion flips from "200" to "403" in one place if methodology grows a rule. The render-policy refinement's framing is the load-bearing piece; this task carries it across to G-017.
- **Test placement: Vitest, not Cucumber.** Per ADR 0007's layer-mapping the natural home is Cucumber, but pglite serialises every transaction internally (see the `concurrent_write_test_harness` decision); a pglite-backed test cannot interleave a source-row UPDATE and a destination-side transaction. The memory-pool harness gives us deterministic interleaving; the test lands as Vitest like the other harness scenarios.
- **Two pinned outcomes, not one.** The brief proposed "exercise both orderings; assert which outcome the system produces." Exercising only the wide-open ordering would leave the closed-shut outcome unverified; a future regression that broke `canReferenceNode` (e.g. cached the source row before re-reading it) would not be caught. Both orderings land as separate `it(...)` blocks under the same describe; together they pin the rule "the source-visibility check is committed-read at the moment the SELECT runs, no earlier, no later."
- **Gate placement: `INSERT INTO session_events` on the destination, not `SELECT ... FROM session_<kind>s`.** The harness already exposes `gateOnInsert(sessionId)`. Gating the `INSERT INTO session_events` (which fires AFTER `canReferenceNode` returned successfully) pauses Alice's transaction inside the still-open BEGIN — `canReferenceNode` has run, the destination FOR UPDATE is still held, the join-table INSERT has happened, but the COMMIT hasn't fired. Bob's `UPDATE sessions SET privacy = ...` on the source row runs against a different row, doesn't contend on Alice's lock, commits immediately. The test then releases the gate; Alice's include commits despite the source now being private. The choice keeps us inside the existing gate API instead of adding a new "gate on next SELECT against session_nodes" surface.
- **Bob is host of the SOURCE session B; Alice is not a participant of B.** Picking the cleanest realistic privacy-flip scenario: B is public, hosted by Bob. Alice — a stranger to B — can canReferenceNode(X) because B is public. Bob flips B to private. Alice's right to reference X depends on whether the predicate sees B as still-public. Other privacy-flip vectors (e.g. Alice being a past participant whose `session_participants` row is still in place) are NOT race-sensitive: the visibility predicate counts past-or-current participants regardless of `left_at`, so removing Alice does NOT revoke visibility (see `visibility.ts`'s "past-or-current participant" rule). The cleanest race is "Alice's access via 'public' is being revoked."
- **No new dependency.** The harness is plain TypeScript; the test is plain Vitest. The new SQL recognisers are one-line additions in the same pattern the harness already uses for the WS-handler scenarios.

## Open questions

- **Future "FOR SHARE source" tightening** — if the methodology decision is revisited (e.g. an "inclusion-at-flip-time is invalid" rule lands), Option B becomes the right answer. The test scenarios in this task make that future change a one-line assertion flip rather than a re-architecture. Out of scope for v1.
- **Other source-side mutators** — the v1 surface only exposes `PATCH /sessions/:id/privacy` as a way for the source session's visibility to change. If a future task adds DELETE-on-participants or hard-deletes the participant row (currently neither exists; `DELETE /sessions/:id/participants/:userId` is the soft-delete via `UPDATE ... SET left_at = NOW()`), the same TOCTOU class would surface and the test would need to grow a scenario. Tracked in this refinement's open questions but not in this task's scope.

## Status

**Done — 2026-05-11.**

Artifacts:
- `tasks/refinements/backend-hardening/inclusion_source_toctou_pin.md` (this file).
- `apps/server/src/test-support/concurrent-write-pool.ts` — extended with `sessionNodes` / `sessionEdges` / `sessionAnnotations` store arrays; new recognisers for the `canReference*` SELECT, the `INSERT INTO session_<kind>s ON CONFLICT DO NOTHING RETURNING` statement, the `UPDATE sessions SET privacy = $1 ... RETURNING` statement, and a non-FOR-UPDATE row-shape SELECT against `sessions`. All existing self-tests and scenarios continue to pass.
- `apps/server/src/test-support/inclusion-source-toctou.test.ts` — two scenarios under `describe('include + source-privacy-flip TOCTOU (G-017 pin)')`:
  1. `wide-open ordering — Alice's canReferenceNode runs before Bob's privacy UPDATE commits; include lands 200 even though source ends up private`.
  2. `closed-shut ordering — Bob's privacy UPDATE commits before Alice's canReferenceNode runs; include 403 entity-not-referenceable`.
- `tasks/25-backend-hardening.tji` — `complete 100` added under `inclusion_source_toctou_pin`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: +1 new file (2 `it(...)` blocks). `pnpm run check` and `pnpm run test:smoke` both pass.
