# `privacy_field_enforcement` — formalize the public-by-default + host-marks-private rule

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.cross_session_permissions.privacy_field_enforcement`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.session_management` — settled. All five callers of the visibility predicate already exist as inlined SQL fragments inside `apps/server/src/sessions/routes.ts`. This task de-duplicates them.
- `data_and_methodology.schema.sessions_table` — settled ([0002_sessions.sql](../../../apps/server/migrations/0002_sessions.sql)) — the `privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private'))` column.
- `data_and_methodology.schema.session_participants_table` — settled ([0003_session_participants.sql](../../../apps/server/migrations/0003_session_participants.sql)) — the visibility-gate join target.

## What this task is

First sibling under `backend.cross_session_permissions`. Lifts the inlined "public OR host OR participant" visibility predicate out of the five session-management endpoints (`GET /sessions`, `GET /sessions/:id`, `POST /sessions/:id/end`, `PATCH /sessions/:id/privacy`, `POST /sessions/:id/participants`, `DELETE /sessions/:id/participants/:userId`) into a single shared module — `apps/server/src/sessions/visibility.ts` — that exports BOTH the SQL fragment (so callers that need to compose additional filters can keep parameterized SQL as one composite SELECT) AND a higher-level `canSeeSession(...)` boolean predicate (so callers that need a yes/no answer before doing their own row-fetch don't have to redeclare the SELECT shape).

The behavior of the existing endpoints does not change — the refactor is a behavior-preserving de-duplication. The TEST surface gains a feature file that pins the rule's semantics independently of the endpoints that consume it, so a future endpoint that accidentally bypasses the helper (and reimplements the rule wrongly) shows up as a feature-file failure even before its own per-endpoint suite runs.

The artifact shape:

- `apps/server/src/sessions/visibility.ts` — NEW. Exports `visibilityWhereFragment(userIdParamIndex)`, `canSeeSession(executor, sessionId, userId)`, and a `VisibilityExecutor` structural type that matches both `DbPool` and `pg.PoolClient`.
- `apps/server/src/sessions/routes.ts` — refactored. Each of the six call sites (1 list, 1 get, 1 end, 1 privacy-toggle, 2 participant endpoints) replaces its inlined WHERE fragment with a call to `visibilityWhereFragment(...)`. No other behavior changes.
- `apps/server/src/sessions/visibility.test.ts` — NEW. Vitest unit cases for the fragment shape and the predicate semantics.
- `tests/behavior/backend/session-visibility.feature` + `tests/behavior/steps/backend-session-visibility.steps.ts` — NEW. Cucumber+pglite scenarios pinning the rule against the migrated schema.

## Why it needs to be done

Three downstream consumers depend on this:

- **`backend.cross_session_permissions.reference_permission_check`** — the next sibling. The reference-permission check is "can session B reference session A's entities?", which decomposes into "is session A visible to the writer?" (this module's rule) PLUS "is the writer inside session B?" (a different predicate). Extracting the visibility predicate now means the reference-permission task can simply call `canSeeSession(..., sessionA, writerUserId)` rather than re-deriving the rule a seventh time.

- **`backend.audience_broadcast.audience_page_auth`** — the audience page mirrors session privacy (public sessions → public viewer URL; private sessions → auth required). The audience-page handler needs the same "can this caller see this session?" predicate before serving the page; today it would have to re-derive the rule. After this task it imports `canSeeSession` and is one line.

- **Future participant-list / event-stream endpoints** — `GET /sessions/:id/participants` (not yet refined), `GET /sessions/:id/events` (likewise), and the WebSocket subscribe-to-session handler will all need the same gate. Centralizing it now means they don't drift.

The motivation is also a defense in depth concern: the visibility rule is the platform's privacy boundary. Five inlined copies of a load-bearing predicate is exactly the configuration that produces a "we forgot to update one of them" privacy bug when the rule evolves (e.g. when a future moderator-delegation feature adds a fourth visibility branch). One source of truth + a feature-file that pins the rule's semantics is the right shape.

## Inputs / context

From [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions):

> Sessions are public by default; the host may mark a session private. Reference rules follow:
>
> - Public session — any authenticated user can reference the session's nodes and edges in a new session.
> - Private session — only participants of the original session (or the host) can reference its nodes and edges.

Reading a session's metadata is strictly weaker than referencing it; the same rule applies (this is the unifying observation already documented in the list-endpoint refinement). This task elevates the rule from "inlined SQL in five handlers" to "named function imported by all consumers."

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — the six existing call sites of the inlined WHERE fragment:

1. `GET /sessions` (visibility-gated list).
2. `GET /sessions/:id` (single-session fetch).
3. `POST /sessions/:id/end` (visibility-gated SELECT FOR UPDATE).
4. `PATCH /sessions/:id/privacy` (visibility-gated SELECT).
5. `POST /sessions/:id/participants` (visibility-gated SELECT FOR UPDATE).
6. `DELETE /sessions/:id/participants/:userId` (visibility-gated SELECT FOR UPDATE).

From [`apps/server/migrations/0002_sessions.sql`](../../../apps/server/migrations/0002_sessions.sql) — `privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private'))`. The default is set at the column level; the CHECK enforces the enum at the DB. The application layer never has to fill `'public'` in explicitly when the host omits the privacy field.

From [`apps/server/migrations/0003_session_participants.sql`](../../../apps/server/migrations/0003_session_participants.sql) — `(session_id, user_id, role, joined_at, left_at)`. The visibility rule reads `(session_id, user_id)` and ignores `left_at` — historical (left) rows count, by the architecture's "once you've seen a session you've seen it" framing.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers pure-logic (the fragment builder; the predicate against a memory executor); Cucumber+pglite covers the rule against the migrated schema.

## Constraints / requirements

- **Module location**: `apps/server/src/sessions/visibility.ts`. Sits next to `routes.ts` because the rule is conceptually a session-management concern, not a generic-auth concern (the auth middleware owns identity; visibility is the session subsystem's own access rule).

- **Exported API surface**:

  ```ts
  export interface VisibilityExecutor {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }>;
  }

  export function visibilityWhereFragment(userIdParamIndex: number): string;
  export function canSeeSession(
    executor: VisibilityExecutor,
    sessionId: string,
    userId: string,
  ): Promise<boolean>;
  export type { DbPool };
  ```

  Two exports, one rule. `visibilityWhereFragment` is for callers composing larger SELECTs (the list endpoint composes filters on top; the per-id endpoints AND `id = $1`); `canSeeSession` is for callers that need a yes/no boolean without writing their own SELECT (anticipated consumers: `reference_permission_check`, the audience-page handler, the WS-subscribe handler). Both produce the same predicate; both reference `$N` for the `userId` slot.

- **Fragment semantics**: the function returns a parenthesized OR expression with TWO textual references to the same `$N` placeholder (host-match AND EXISTS-participant-user-id). Callers bind ONE param value at that slot; the SQL reads it twice. The `sessions` alias is hard-coded inside the EXISTS subquery (`sp.session_id = sessions.id`); callers must use the unaliased table name (every current callsite does).

- **`canSeeSession` semantics**: runs `SELECT 1 AS visible FROM sessions WHERE id = $1 AND <fragment with $2> LIMIT 1`. Returns true iff at least one row matches. Does NOT distinguish "session doesn't exist" from "session exists but caller can't see it" — both return false. The existence-non-leak rule (see [`get_session_endpoint.md`](./get_session_endpoint.md)'s 404-not-403 decision) is exactly the property this collapse preserves.

- **Soft-deleted users**: the visibility predicate does NOT re-check `users.deleted_at IS NULL`. The auth middleware filters soft-deleted rows at cookie-verification (`apps/server/src/auth/middleware.ts`'s `SELECT id, screen_name FROM users WHERE id = $1 AND deleted_at IS NULL`), so a soft-deleted user never has a valid session cookie and never reaches a handler. If the caller's id is passed directly (test bypass), the predicate still answers truthfully from `sessions` + `session_participants`; soft-delete is a USER concern, not a SESSIONS concern. Documented in the module's JSDoc.

- **Parameterized SQL only**. The fragment is a literal string template (no interpolation of user data); the param slot is the caller's choice but it's still positional. `canSeeSession` issues a parameterized SELECT. No SQL string concat anywhere.

- **No RLS**. The rule is enforced at the application layer per the project's ADR set; no Postgres RLS policy.

- **Refactor is behavior-preserving**. The existing six call sites continue to issue the same SQL (modulo whitespace) and produce the same results for the same inputs. All 810 existing Vitest cases + 159 existing Cucumber scenarios must continue to pass without modification.

- **Test layers per ADR 0022**:
  - **Vitest** — 12 new cases in `apps/server/src/sessions/visibility.test.ts`:
    - 4 fragment shape cases (`$1` at both slots; `$2` at both slots; rejects zero/negative; rejects non-integer).
    - 8 predicate cases (public → true non-participant; private → false stranger; private → true host; private → true active participant; private → true historical participant; private → false participant-in-different-session; unknown id → false; single-round-trip contract).
  - **Cucumber+pglite** — 6 new scenarios in `tests/behavior/backend/session-visibility.feature`:
    - Public session → visible to anyone.
    - Private session → visible to host.
    - Private session → visible to active participant.
    - Private session → visible to historical (left) participant.
    - Private session → NOT visible to stranger.
    - Unknown session id → not visible to anyone.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total from 810 to 822 (+12).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 6 scenarios (159 → 165).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- No regression in the existing endpoint suites — the six refactored call sites still pass their existing per-endpoint tests unchanged.

## Decisions

- **Module location: `apps/server/src/sessions/visibility.ts` (chosen over `apps/server/src/auth/visibility.ts` or `packages/shared-types/`).** Three alternatives surveyed:
  - **`apps/server/src/sessions/visibility.ts`** (chosen). The rule is session-management's own access policy — "can this caller see this session row?" — not a generic auth concern. Sitting next to `routes.ts` keeps the imports local and obvious; the call sites are all in the sibling file. Future cross-session-reference and audience-page consumers reach into this directory deliberately to import it, which is the right discoverability shape (cross-session-reference IS a sessions concern; the audience page mirrors session privacy).
  - **`apps/server/src/auth/visibility.ts`** (rejected). The auth subsystem owns "who is the caller?" — identity verification, cookie minting, the OAuth dance. Visibility is a downstream consumer of identity, not a peer of it. Putting it under `auth/` would conflate "who are you?" with "what may you see?", which the project's other surfaces (e.g. the error envelope's `auth-required` vs. `not-found` distinction) already keep separate.
  - **`packages/shared-types/src/visibility.ts`** (rejected). The rule's SQL fragment is server-only — there's no client-side equivalent (the client doesn't issue SQL; it asks the server). Putting it in a shared package would either re-export from the server (pointless layer) or pollute the shared types with server-only artifacts. The TypeScript types involved (`VisibilityExecutor`, `DbPool` re-export) are already server-local.

- **Two exports (`visibilityWhereFragment` + `canSeeSession`), not one (chosen over fragment-only OR predicate-only).** Three alternatives surveyed:
  - **Both fragment + predicate** (chosen). The fragment is for callers composing larger SELECTs (the list endpoint AND-composes status / host / participant / privacy / topic filters on top; the per-id endpoints AND `id = $1`). The predicate is for callers that need a yes/no answer before doing their own row-fetch (none today, but `reference_permission_check`, the audience-page handler, and the WS-subscribe handler are imminent). Exporting both keeps each callsite's code at its natural minimum — composition callers don't pay for an extra round-trip, predicate callers don't write boilerplate SELECT shape.
  - **Fragment only** (rejected). Forces every "is this visible?" caller to write `SELECT 1 FROM sessions WHERE id = $1 AND <fragment> LIMIT 1` by hand. Three lines saved per caller is small in isolation but adds up across three anticipated consumers, and each handwritten copy is a place a future SELECT-shape evolution could drift.
  - **Predicate only** (rejected). Forces the list endpoint to issue TWO queries (the predicate + the page query), or to abandon the helper for its own visibility-gate (which is exactly the inlining this task removes). Composition callers genuinely need the fragment, not the predicate.

- **Fragment carries the slot index as an arg (chosen over hard-coded `$1`).** Two alternatives surveyed:
  - **`visibilityWhereFragment(userIdParamIndex)`** (chosen). The list endpoint composes the gate with no preceding params (caller-id at `$1`); the per-id endpoints reserve `$1` for the session id (caller-id at `$2`). Hard-coding the slot would force the caller to either re-number their own params after the fragment OR write a parameter-renumbering pass. Passing the index is one extra arg per callsite and trivially documents what the fragment expects.
  - **Hard-coded `$1`** (rejected). Forces the per-id endpoints to either reorder their params (id second, caller-id first — surprising) or post-process the fragment string to bump `$1` to `$2` (string surgery on SQL; brittle and error-prone). The slot-index arg is the cleaner expression.

- **`sessions` table alias hard-coded inside the EXISTS subquery.** Two alternatives surveyed:
  - **Hard-coded `sessions.id`** (chosen). All current callsites use the unaliased table name (`FROM sessions WHERE id = $1`); the EXISTS subquery's `sp.session_id = sessions.id` correlates against that name. A future callsite that needed to alias the table (e.g. self-join) is hypothetical; until it materializes, the hard-coded name is the simplest contract.
  - **Take the alias as a second arg (`visibilityWhereFragment(idx, tableAlias)`)** (rejected for v1). Adds API surface for a use case nobody has. Reconsider if/when a callsite needs a different alias.

- **`canSeeSession` does NOT distinguish "doesn't exist" from "not visible".** Two alternatives surveyed:
  - **Single boolean return** (chosen). The existence-non-leak rule (see [`get_session_endpoint.md`](./get_session_endpoint.md)) says these two cases MUST be indistinguishable from outside. The predicate's API mirrors that — a caller that wants to leak the distinction has to write a separate query themselves and own the leak; the helper makes the safe path the default path.
  - **Three-valued return (`'visible' | 'invisible' | 'not-found'`)** (rejected). Same information density as the 404-not-403 leak; the helper would be useful only to a hypothetical caller that wants to distinguish — and that caller is the exact privacy bug the 404-not-403 decision exists to prevent. Refusing to return the distinction at the API layer makes the bug harder to commit.

- **Soft-deleted users are out of scope for this module.** Two alternatives surveyed:
  - **Trust the auth middleware** (chosen). The middleware already filters `deleted_at IS NOT NULL` rows at the cookie-verification step; a soft-deleted user can never authenticate, so the visibility predicate never sees a soft-deleted caller in production. Re-checking inside the predicate would be defense-in-depth at the cost of an additional JOIN on every visibility check — a real performance hit for a property already guaranteed upstream.
  - **Re-check `users.deleted_at IS NULL` inside the fragment** (rejected). Adds a JOIN to every visibility check; the auth middleware already enforces this property; the redundancy buys a defense against a "middleware bypass" attack that has no plausible attack path at v1 (the middleware is the only way to get an authenticated session). Re-evaluate if a future bypass surface emerges.

- **Scope: this task ONLY handles "can this user see this session?"** The sibling `reference_permission_check` handles "can session B reference session A's entities?" — a different question (writing entity-included events; the writer must be inside session B AND session A must pass the visibility gate for the writer). Keeping the read-side rule isolated means the reference-check can import THIS module as one of its preconditions without inheriting unrelated machinery.

## Open questions

- **Should a future `users.deleted_at` defense-in-depth pass land here?** Open; depends on whether a "middleware bypass" attack path emerges. Until then, the auth layer is the canonical filter and we don't pay the JOIN cost on every visibility check.

- **Should `canSeeSession` accept a transaction client by default and treat the pool-based call as a special case?** Today both work (the `VisibilityExecutor` interface unifies them). If most callers turn out to need the predicate inside a transaction (the FOR-UPDATE callers in `routes.ts` don't use the helper; they use the fragment), we may revisit the type. Deferred until the reference-permission task uses it in anger.

- **Should the EXISTS subquery be a LATERAL join for plan-stability?** Empirically `EXISTS` produces the same plan as `LATERAL` on small participants tables in pg14+; deferred until a query-plan investigation surfaces a performance gap.

## Status

**Done** — 2026-05-11. Landed as:

- New module: [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) — exports `visibilityWhereFragment(userIdParamIndex: number): string`, `canSeeSession(executor, sessionId, userId): Promise<boolean>`, and the `VisibilityExecutor` structural type. JSDoc captures the rule, the soft-deleted-user reasoning, the existence-non-leak collapse, and a worked example for each export.
- Refactored: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — six call sites (list, get, end, privacy-toggle, participant-assign, participant-remove) now use `visibilityWhereFragment(...)` in place of inlined SQL. No behavior change; the textual SQL still includes `privacy = 'public'`, `host_user_id = $N`, `session_participants`, and `sp.session_id = sessions.id AND sp.user_id = $N` substrings so the existing in-memory test shims continue to recognise the queries.
- Vitest unit tests: [`apps/server/src/sessions/visibility.test.ts`](../../../apps/server/src/sessions/visibility.test.ts) — 12 cases (4 fragment-shape + 8 predicate-semantics).
- Cucumber+pglite scenarios: [`tests/behavior/backend/session-visibility.feature`](../../../tests/behavior/backend/session-visibility.feature) — 6 scenarios (public, host, active participant, historical participant, stranger, unknown id) with step defs at [`tests/behavior/steps/backend-session-visibility.steps.ts`](../../../tests/behavior/steps/backend-session-visibility.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 810 → 822 (+12); Cucumber 159 → 165 (+6).
