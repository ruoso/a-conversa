# `reference_permission_check` — can caller C reference entity E into a new session?

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.cross_session_permissions.reference_permission_check`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.cross_session_permissions.privacy_field_enforcement` — settled ([`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts)). Exports `visibilityWhereFragment(userIdParamIndex)` and `canSeeSession(...)` plus the `VisibilityExecutor` structural type. This task reuses the fragment verbatim — it is the gate on the origin-session side.
- `data_and_methodology.schema.session_nodes_join_table` — settled ([0007_session_nodes.sql](../../../apps/server/migrations/0007_session_nodes.sql)).
- `data_and_methodology.schema.session_edges_join_table` — settled ([0008_session_edges.sql](../../../apps/server/migrations/0008_session_edges.sql)).
- `data_and_methodology.schema.session_annotations_join_table` — settled ([0009_session_annotations.sql](../../../apps/server/migrations/0009_session_annotations.sql)).

## What this task is

Second sibling under `backend.cross_session_permissions`. Implements the read-side predicate "can caller C reference entity E (a node, edge, or annotation) into ANY session right now?" — i.e. "is entity E *publicly reachable* from C's perspective?". The predicate decomposes into three per-kind variants — `canReferenceNode`, `canReferenceEdge`, `canReferenceAnnotation` — exported from a new module `apps/server/src/sessions/references.ts`.

The rule (lifted from [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions)):

- An entity is referenceable from session B by caller C iff:
  - The entity exists.
  - The entity has at least one row in its respective `session_<kind>s` join table (it was included in some "origin" session).
  - At least ONE of those origin sessions is visible to C per the visibility rule (`canSeeSession`-equivalent on the origin row).

The "any visible origin" semantics matter because globally-stored entities can live in multiple sessions: if entity E is in session A (private, invisible to C) AND session A' (public), then C is allowed to reference E — they could trivially reach it via A'. Locking C out because the FIRST session they happen to query is private would be a false negative.

This task lands the predicate ONLY. The HTTP surface that consumes it — `POST /sessions/:id/include` — is the next sibling task `entity_inclusion_endpoint`. The boundary is intentional: this predicate answers "is the entity reachable to C at all?"; the endpoint additionally checks "is C a participant in session B (the write-target)?" before allowing the inclusion to land.

The artifact shape:

- `apps/server/src/sessions/references.ts` — NEW. Exports `canReferenceNode(executor, nodeId, userId)`, `canReferenceEdge(executor, edgeId, userId)`, `canReferenceAnnotation(executor, annotationId, userId)`. Each issues one parameterized SELECT against the appropriate join table, ANDed with the shared visibility fragment.
- `apps/server/src/sessions/references.test.ts` — NEW. Vitest unit cases pinning the per-kind semantics + the any-visible-origin rule + the unknown-id collapse.
- `tests/behavior/backend/reference-permission.feature` + `tests/behavior/steps/backend-reference-permission.steps.ts` — NEW. Cucumber+pglite scenarios pinning the rule against the migrated schema.

## Why it needs to be done

Two downstream consumers depend on this:

- **`backend.cross_session_permissions.entity_inclusion_endpoint`** — the immediate next sibling. The endpoint accepts `POST /sessions/:id/include` with a body containing `{ entityKind, entityId }` and must answer: "may C, currently in session B, pull entity E into B?" The first half of that question is what THIS task answers. The endpoint composes this predicate with the participant-of-B check.
- **Future WS-include message** — when the WebSocket protocol exposes "include this existing entity into the live session" as a message (planned, not yet refined), it routes through the same predicate.

Why "any visible origin" and not "the originally-creating origin": the data layer doesn't model "the original origin" specially. A node is inserted into `nodes` once; its inclusion in any session creates a `session_nodes` row, and there's no flag distinguishing "first" from "subsequent" inclusion. The architecture's framing matches this: an entity's referenceability follows from the *current* topology of where it lives, not from a historical "first inclusion" notion. A node first introduced in a private session and later included in a public one IS reachable from C via the public session, regardless of which inclusion came first.

The motivation is also defense-in-depth: this is a privacy boundary as load-bearing as the session-visibility predicate. Two consumers (the endpoint + the future WS message) inlining the rule independently is the configuration that produces a "we forgot to update one of them" privacy bug when the rule evolves. One module + a feature-file pinning the semantics is the right shape — same argument as for `visibility.ts`.

## Inputs / context

From [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions):

> Sessions are public by default; the host may mark a session private. Reference rules follow:
>
> - Public session — any authenticated user can reference the session's nodes and edges in a new session.
> - Private session — only participants of the original session (or the host) can reference its nodes and edges.

From [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) — the `visibilityWhereFragment(userIdParamIndex)` export. The fragment is a parenthesized `(privacy = 'public' OR host_user_id = $N OR EXISTS (...session_participants...sp.session_id = sessions.id AND sp.user_id = $N))` expression with TWO textual references to the same `$N` slot. It correlates against the unaliased `sessions` table name. THIS task joins `session_<kind>s sj` to `sessions` and reuses the fragment unchanged — the correlation `sp.session_id = sessions.id` continues to work because the join still produces `sessions.id` as the visible-from-here name.

From the three join tables ([0007](../../../apps/server/migrations/0007_session_nodes.sql) / [0008](../../../apps/server/migrations/0008_session_edges.sql) / [0009](../../../apps/server/migrations/0009_session_annotations.sql)) — each is a pure (session_id, entity_id) M-N table with a composite PK plus a single-column reverse index on the entity-id side (e.g. `session_nodes_node_id_idx`). The reverse index is the hot path for THIS predicate: "in which sessions does this node appear?" The migration's R9 decision explicitly names cross-session permission checks as the index's reason for existing.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure-logic (the per-kind predicates against a memory executor); Cucumber+pglite covers the rule against the migrated schema.

## Constraints / requirements

- **Module location**: `apps/server/src/sessions/references.ts`. Sits next to `visibility.ts` — both are session-subsystem access policies. The reference rule is the "next layer up" of the visibility rule; co-locating the two helpers keeps the imports obvious (`references.ts` imports `visibilityWhereFragment` from its sibling).

- **Per-kind predicates (chosen over a single polymorphic `canReference(executor, kind, id, userId)`)**:

  ```ts
  export function canReferenceNode(
    executor: VisibilityExecutor, nodeId: string, userId: string,
  ): Promise<boolean>;

  export function canReferenceEdge(
    executor: VisibilityExecutor, edgeId: string, userId: string,
  ): Promise<boolean>;

  export function canReferenceAnnotation(
    executor: VisibilityExecutor, annotationId: string, userId: string,
  ): Promise<boolean>;
  ```

  Three small symmetric functions. The polymorphic alternative was considered (one function with a `kind: 'node' | 'edge' | 'annotation'` arg that picks the join table and id column at runtime) — rejected because:
  1. The per-kind variants are each one line of SQL each (the join-table and column names are the only differences) — there's almost no duplication to factor out.
  2. The per-kind type signature is more honest at each callsite: `canReferenceNode(executor, nodeId, userId)` documents which kind of id is expected; the polymorphic form would shift that type-safety burden to the caller (or to a sum-type arg) for no readability gain.
  3. The endpoint that will consume this is structured around per-kind branches anyway (the `entityKind` of the request dispatches to a per-kind handler block); aligning the API with that branching keeps the calling code straight-line.

- **SQL shape** (per-kind, all three follow the same template):

  ```sql
  SELECT 1
    FROM session_<kind>s sj
    JOIN sessions ON sj.session_id = sessions.id
   WHERE sj.<entity>_id = $1
     AND <visibilityWhereFragment(2)>
   LIMIT 1
  ```

  One round-trip per predicate call. The `LIMIT 1` short-circuits — Postgres stops after the first matching origin session, so the cost is bounded even for an entity that lives in many sessions. The reverse-index on `sj.<entity>_id` (added in each join-table migration per R9) makes the row scan cheap.

  The join to `sessions` is necessary because the visibility fragment references `sessions.privacy`, `sessions.host_user_id`, and (via the EXISTS subquery) `sessions.id`. The fragment is hard-coded to the unaliased `sessions` name — which is fine because we use `JOIN sessions ON ...` (not `JOIN sessions s ON ...`); the fragment's `sessions.id` resolves correctly.

- **Reuse `visibilityWhereFragment` from `visibility.ts`** — do not re-implement. The two predicates are intentionally entangled: reference is "visibility of the origin session, taken over all origins." A future edit to the visibility rule (e.g. a fourth branch for moderator-delegation) must propagate to both predicates automatically. Inlining the fragment text would defeat this.

- **`VisibilityExecutor` reused** — the structural type from `visibility.ts` matches `DbPool` and `pg.PoolClient`; same shape works here.

- **Parameterized SQL only**. Two parameters: `$1` for the entity id, `$2` for the caller's user id. The visibility fragment is the literal output of `visibilityWhereFragment(2)`.

- **Unknown entity id → false**. The predicate does NOT distinguish "entity doesn't exist" from "entity exists but isn't in any visible session." Both cases produce zero rows; the predicate returns false. Same existence-non-leak property as `canSeeSession`.

- **Entity-not-in-any-session → false**. An entity row that exists in `nodes` / `edges` / `annotations` but has no row in the corresponding `session_<kind>s` table is unreachable — by construction. This case shouldn't happen in production (entities are always inserted into a join table during the creation event) but the predicate handles it correctly via the join: no `session_<kind>s` row → no rows produced → false.

- **No RLS**. Application-layer enforcement per the project's ADR set.

- **Boundary with `entity_inclusion_endpoint`**: THIS predicate answers "is E reachable to C at all?" The endpoint additionally checks "is C a participant of session B (the write target)?". The participant-of-B check is NOT part of THIS predicate — that's a write-authority concern about the destination, not a reachability concern about the source. Keeping the two questions separate lets the predicate be reused by future WS messages that have a different write-side authority shape.

- **Test layers per ADR 0022**:
  - **Vitest** — new cases in `apps/server/src/sessions/references.test.ts`:
    - Node from a public session → true for any user.
    - Node from a private session → true for host of that session.
    - Node from a private session → true for current participant.
    - Node from a private session → false for stranger.
    - Node in TWO sessions (one private-invisible + one public) → true (any-visible-origin rule).
    - Edge — public-origin true; private-origin stranger false; private-origin host true (parallel cases).
    - Annotation — public-origin true; private-origin stranger false; private-origin host true (parallel cases).
    - Unknown id (each kind) → false.
    - Each predicate issues one parameterized SELECT against the executor.
  - **Cucumber+pglite** — new scenarios in `tests/behavior/backend/reference-permission.feature`:
    - Public-origin node → referenceable by any authenticated user.
    - Private-origin node → referenceable by host; NOT by a stranger.
    - Multi-origin node (in both a private-invisible and a public session) → referenceable by a stranger via the public origin.
    - Private-origin edge → not referenceable by a stranger (sanity-check sibling).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total upward (target +N — see Status when landed).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 4 scenarios.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- No regression in `visibility.ts`'s 12 cases or in any other existing suite.

## Decisions

- **Per-kind predicates, three functions (chosen over a single polymorphic predicate).** Rationale in Constraints. The two alternatives surveyed:
  - **Three per-kind functions** (chosen) — `canReferenceNode`, `canReferenceEdge`, `canReferenceAnnotation`. Each is ~6 lines; type signatures are honest about which id is expected; aligns with the per-kind dispatch the endpoint will use.
  - **One polymorphic `canReference(executor, kind, id, userId)`** (rejected) — would build the SQL by switching on `kind` at runtime, sacrificing per-kind type-safety for ~10 lines of saved code. The duplication isn't large enough to justify the loss of clarity.

- **Reuse `visibilityWhereFragment` (chosen over inlining the visibility SQL or re-implementing).** Two alternatives surveyed:
  - **Reuse the fragment** (chosen) — `references.ts` imports `visibilityWhereFragment` from `visibility.ts`. The visibility rule has one source of truth; reference is "the visibility rule applied to origin sessions." Any future rule change propagates automatically.
  - **Inline the visibility SQL** (rejected) — would duplicate the OR-expression; any future edit to the visibility rule that misses this site is exactly the "we forgot to update one of them" privacy bug the previous task exists to prevent.

- **Any-visible-origin semantics (chosen over first-origin-only or visible-to-creator-only).** Three alternatives surveyed:
  - **Any visible origin** (chosen) — if the entity lives in at least one session the caller can see, it's referenceable. Matches the architecture's framing: globally-stored entities are reachable through any of their session-anchors. The `LIMIT 1` makes this cheap.
  - **First (oldest) origin only** (rejected) — would require schema-level "this is the first inclusion" marker (there isn't one) AND would produce surprising false negatives where the entity is publicly reachable via a later inclusion but the predicate refuses because the original creation was private. The data layer doesn't model "first" specially; the rule shouldn't either.
  - **Creator-anchored** (rejected) — would gate on whether the caller can see the creator's session(s), which conflates entity authorship with entity reachability. Authorship isn't a privacy boundary in the architecture's framing; reachability is. The current design rightly keeps them separate.

- **Boundary: this predicate handles ONLY the source-side reachability check.** The destination-side participant-of-B check is the endpoint's responsibility. Two alternatives surveyed:
  - **Predicate handles source-side only** (chosen) — `canReference<Kind>(executor, entityId, userId)` answers "can C reach entity E at all?" The endpoint composes this with "is C a participant in session B?" The split keeps the predicate reusable by future consumers (WS message handlers) whose destination-side authority check may differ.
  - **Predicate handles both** (rejected) — would require a `sessionB` arg; would couple the predicate to a write-target shape the WS handler may not have (the WS handler operates against the current connection's subscribed session, not against a path-param session). Keeping the predicate destination-agnostic preserves its reusability.

- **Unknown entity id → false; entity-not-in-any-session → false (chosen, mirrors `canSeeSession`).** Same existence-non-leak property as the visibility predicate. Callers that need the distinction (none today) own the separate SELECT and own the leak.

- **`LIMIT 1` on the SELECT (chosen).** The predicate is a yes/no boolean; the first matching row is sufficient. Without `LIMIT 1`, an entity referenced in 100 sessions would compute visibility for all 100 even though one match settles the question. The reverse-index on `sj.<entity>_id` keeps the unbounded-scan worst case bounded too, but `LIMIT 1` is the explicit short-circuit.

- **No `users.deleted_at` re-check (inherited).** Same reasoning as `visibility.ts`: the auth middleware filters soft-deleted users at cookie-verification, so a soft-deleted caller never reaches this predicate in production. Documented by reference; not re-implemented.

## Open questions

- **Should `canReference<Kind>` accept a transaction client by default?** Today both the pool and a transaction client satisfy `VisibilityExecutor`; the endpoint will likely call this OUTSIDE its transaction (the reference check is a precondition, not a mutating step). Revisit if a future caller needs it inside a tx.

- **Should there also be a "reachable origin sessions" accessor for diagnostics / debugging?** A function that returns the list of origin session ids visible to the caller (rather than the boolean) could be useful for the endpoint to surface "you can reference E because it's also in session X" in a future error/info message. Deferred — the boolean is enough for v1; if the inclusion endpoint surfaces useful messages later it can issue its own SELECT.

- **Should annotation-target visibility cascade?** Today an annotation's referenceability depends solely on the annotation's own join-table rows, not on whether the caller can see the annotated node/edge. An entity-level cascade ("you can reference annotation A only if you can also reference its target") is plausible but not specified by the architecture; deferred unless/until the architecture grows that rule.

## Status

**Done** — 2026-05-10. Landed as:

- New module: [`apps/server/src/sessions/references.ts`](../../../apps/server/src/sessions/references.ts) — exports three per-kind predicates: `canReferenceNode(executor, nodeId, userId)`, `canReferenceEdge(executor, edgeId, userId)`, `canReferenceAnnotation(executor, annotationId, userId)`. Each issues one parameterized `SELECT 1 ... FROM session_<kind>s sj JOIN sessions ON sj.session_id = sessions.id WHERE sj.<entity>_id = $1 AND <visibilityWhereFragment(2)> LIMIT 1`. The visibility fragment is reused verbatim from `visibility.ts` — no inlined OR-expression duplication; the `VisibilityExecutor` structural type is also reused. JSDoc captures the any-visible-origin rule, the boundary with `entity_inclusion_endpoint`, and the no-target-cascade note for annotations.
- Vitest unit tests: [`apps/server/src/sessions/references.test.ts`](../../../apps/server/src/sessions/references.test.ts) — 21 cases (8 node + 6 edge + 6 annotation + 1 shared single-round-trip). Each kind pins the public-origin / private-origin-host / private-origin-stranger / multi-origin-any-visible / unknown-id semantics; the node group additionally pins the entity-without-any-join-row collapse to false and the exact SELECT shape (substrings for `FROM session_nodes sj`, `JOIN sessions ON sj.session_id = sessions.id`, `LIMIT 1`, `privacy = 'public'`, `host_user_id = $2`, `session_participants`).
- Cucumber+pglite scenarios: [`tests/behavior/backend/reference-permission.feature`](../../../tests/behavior/backend/reference-permission.feature) — 6 scenarios (public-origin-node-by-stranger, private-origin-node-by-host, private-origin-node-by-stranger, multi-origin-node-by-stranger-via-public, private-origin-edge-by-stranger, public-origin-annotation-by-stranger) with step defs at [`tests/behavior/steps/backend-reference-permission.steps.ts`](../../../tests/behavior/steps/backend-reference-permission.steps.ts). Step phrases use "for reference tests" / "fresh node/edge/annotation" suffixes so they don't collide with existing sibling Givens.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 822 → 843 (+21); Cucumber 165 → 171 (+6).
- **Boundary confirmed**: this module owns ONLY the source-side reachability check. The participant-of-destination-session check is the next sibling's (`entity_inclusion_endpoint`) responsibility.
