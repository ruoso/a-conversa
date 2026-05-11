# Commit message: client → server (moderator-only)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_commit_message`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.websocket_protocol.ws_propose_message` (settled — the gate-stack + dispatcher seam + closed-union extension convention this task mirrors), `backend.websocket_protocol.ws_vote_message` (settled — the second sibling that established the connection-derived-actor convention for write handlers), `backend.websocket_protocol.ws_message_envelope`, `backend.websocket_protocol.ws_auth_on_connect`, `backend.websocket_protocol.ws_subscribe_to_session`, `backend.websocket_protocol.ws_event_broadcast`, `backend.websocket_protocol.ws_error_message`, `data_and_methodology.methodology_engine.commit_logic` (settled — `commitHandler` enforces four rules: moderator gate, proposal exists, proposal is pending, unanimous-agree across current participants).

## What this task is

Land the **third of five** client→server methodology-action WS handlers. The commit handler is the structural sibling of the propose handler from [`ws_propose_message`](./ws_propose_message.md) and the vote handler from [`ws_vote_message`](./ws_vote_message.md). Same gate stack, same dual-signal contract, same dispatcher-seam error path, same union-extension convention — only the engine call (`commit` instead of `propose` / `vote`), the constructed action variant (`MethodologyAction.commit`), and the ack envelope type (`committed` instead of `proposed` / `voted`) differ.

Concretely, the commit handler:

1. **Subscribe-before-act gate** — same `ApiError.forbidden('not subscribed ...')` as propose / vote.
2. **Visibility re-check** — `canSeeSession(pool, sessionId, userId)` → `ApiError.notFound(...)` if the session became invisible between subscribe and commit.
3. **Transactional sequence allocation + projection load + engine validation + INSERT** — FOR UPDATE on `sessions`, MAX(sequence)+1, `projectFromLog`, build `MethodologyAction.commit`, call `validateAction`, `validateEvent`, `appendSessionEvent`. Identical to propose / vote's transactional block.
4. **Post-commit broadcast + `committed` ack** — `broadcast.emit({ event })` after COMMIT, then send `committed` ack frame directly on the originating socket. The moderator receives BOTH frames (ack + broadcast); non-moderator subscribed clients receive only the broadcast.

Scope is **commit only** — the engine's `commitHandler` enforces moderator-only authority, proposal-state transitions, and the unanimous-agree predicate. Meta-disagreement and snapshot are separate downstream tasks.

## Why it needs to be done

The moderator console mints commit actions over the WebSocket once a proposal reaches unanimous-agree across all current participants. Without this handler, the only path to write a `commit` event is the (not-yet-existing) HTTP route, which would force the moderator UI to maintain a dual transport surface and lose the request-response correlation `inResponseTo` provides over the duplex pipe — exactly the same motivation as propose / vote.

Downstream consumers:

- `moderator_ui` — the moderator's "commit" button routes through this handler.
- `participant_ui` and `audience_broadcast` — the `event-applied` broadcast carrying the `commit` event drives every subscriber's local `handleCommit` projection step, which marks the affected facet `agreed` and moves the proposal from `pendingProposals` to `committedProposals`.
- `ws_reconnection_handling` — replays missed commit events through the same `event-applied` broadcast.

## Inputs / context

From [`apps/server/src/methodology/handlers/commit.ts`](../../../apps/server/src/methodology/handlers/commit.ts):

- `commitHandler: Validator<CommitAction>` runs four rule groups: moderator gate (rule 1, surfaced as `'not-a-moderator'`), proposal exists (rule 2, `'proposal-not-found'`), proposal-state (rule 3, `'proposal-already-committed'` / `'proposal-already-meta-disagreement'`), unanimous-agree across current participants (rule 4, `'unanimous-agree-required'`). Structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) fall through to `'illegal-state-transition'` until their sibling tasks land.

From [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts):

- `CommitAction extends ActionEnvelopeBase` with `kind: 'commit'`, `proposalEventId: string`, `committedAt: string` (ISO-8601). The envelope's `requester`, `sessionId`, `eventId`, `sequence`, `actor`, `createdAt` are populated by the handler before the engine call.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- `commitPayloadSchema` requires `proposal_id: uuid`, `moderator: uuid`, `committed_at: ISO-8601`. The engine emits this exact shape.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `rejectedToApiError` mapping for commit-specific reasons:

- `'not-a-moderator'` → 403 (headline authority gate for this task)
- `'proposal-not-found'` → 404
- `'proposal-already-committed'` → 422
- `'proposal-already-meta-disagreement'` → 422
- `'unanimous-agree-required'` → 422
- `'methodology-not-exhausted'` → 422
- `'illegal-state-transition'` → 422 (structural sub-kind fallthrough)

From [`ws_propose_message.md`](./ws_propose_message.md) and [`ws_vote_message.md`](./ws_vote_message.md) — the propose / vote refinements' Decisions sections are canonical for the gate stack, the union-layout convention, the post-commit-emit invariant, the dual-signal contract, the projection-load strategy, and the connection-derived-actor security invariant. Every decision there applies verbatim to this handler; only the deltas below are commit-specific.

## Constraints / requirements

- **Mirror propose / vote tightly.** Same `withTransaction` shape, same FOR UPDATE, same MAX(sequence)+1, same projection-load-per-request, same `validateEvent` + `appendSessionEvent`, same post-commit `broadcast.emit` + `committed` ack ordering. Future sibling handlers (meta / snapshot) read these three side-by-side; structural drift would degrade reviewability.
- **Single source of truth: the methodology engine.** No parallel commit validation logic.
- **Moderator identity from the connection.** `action.requester = action.actor = connection.user.id`. The client's request payload does NOT carry `moderatorId`. A client cannot commit on behalf of someone else. See refinement Decisions.
- **Closed-union extension** — `'commit'` to group B tail, `'committed'` to group C tail of [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts), per the union-layout convention `ws_propose_message` documented.
- **Moderator's dual signal** — both `committed` ack (`inResponseTo` correlated) and `event-applied` broadcast arrive at the moderator; non-moderator subscribed clients receive only the broadcast.
- **Schema-on-write** — `validateEvent` runs on the constructed event envelope before `appendSessionEvent`, mirroring propose / vote.
- **Headline gate pinned**: a non-moderator subscribed participant attempting commit receives a wire `error` envelope with `code: 'not-a-moderator'` (the engine's rule-1 rejection mapped through `rejectedToApiError`).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` green; baseline 952 Vitest tests still pass plus the new commit handler tests + the vocabulary pin update.
- `pnpm run test:behavior:smoke` green; baseline 199 Cucumber scenarios still pass plus the new commit feature.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/handlers/commit.ts` can see the structural mirror to `propose.ts` and `vote.ts` at a glance.
- A reader of `packages/shared-types/src/ws-envelope.ts` sees `'commit'` and `'committed'` at the tails of groups B and C respectively, consistent with the union-layout convention.

## Decisions

The propose refinement's Decisions section ([`ws_propose_message.md`](./ws_propose_message.md)) applies verbatim, and the vote refinement's ([`ws_vote_message.md`](./ws_vote_message.md)) connection-derived-actor decision applies verbatim. Only the commit-specific deltas are documented here.

- **Moderator-only authority gate lives in the engine, surfaced on the wire as `not-a-moderator`.** The methodology engine's `commitHandler` rule 1 (`requireModerator(projection, action.requester)`) is the single source of truth for "who may commit." A non-moderator subscribed participant who sends a `commit` envelope passes the WS handler's gates 1 (subscribe) and 2 (visibility), then hits the engine's `not-a-moderator` rejection. `rejectedToApiError` maps it to a 403 with `code: 'not-a-moderator'`; the dispatcher's `onHandlerError` seam echoes the wire `error` envelope. **Pinned in a unit test** (`HEADLINE: rejects a non-moderator subscribed participant attempting commit with 'not-a-moderator'`) so this authority gate is regression-protected. Rationale for not duplicating the check in the WS handler:
  - The engine already owns role-gating semantics; duplicating the check in the WS handler would mean two places to fix when `requireModerator`'s definition evolves (e.g. the multi-moderator extension contemplated for v2).
  - The engine's check sees the full projection — including the participant-left case for a former moderator — which the WS handler would otherwise have to load and inspect separately. Routing through `validateAction` keeps the inspection in one place.
  - The same pattern propose / vote established (the WS handler is the protocol-layer gate; the engine is the methodology-layer gate) stays consistent across all five sibling handlers.

- **Moderator identity comes from the authenticated connection, not the request payload.** The `commit` request payload carries `{ sessionId, expectedSequence, proposalId }` — there is NO `moderatorId` field. The handler reads `connection.user.id` and uses it for BOTH `action.requester` (the methodology gate the engine checks against `requireModerator`) AND `action.actor` (the event's actor column + the payload's `moderator` field). Rationale (same as the vote handler's `voterId` security invariant; propagated here verbatim):
  - **Security invariant.** Letting the client name the moderator on the wire would let a non-moderator participant claim moderator authority by spoofing the field. The engine's `not-a-moderator` gate would still catch the spoof (the engine checks the *projection's* moderator role, not the payload-supplied id), but the asymmetry between "what the wire claims" and "what the engine enforces" would create a confusing on-wire diagnostic for a malicious or buggy client. Reading the actor from the authenticated connection makes the two sources identical by construction.
  - **No payload-level moderatorId at all.** Symmetric with `propose` (no `proposerId`) and `vote` (no `voterId`). The convention is "the request payload describes the *what*; the connection supplies the *who*."
  - **Pinned in a test.** The Vitest unit test `SECURITY: ignores any client-supplied moderatorId field` sends a payload that includes a spoofed `moderatorId` naming the real moderator (`OTHER_HOST_ID`) while the connection is authenticated as a debater (`FIXTURE_USER_ID`). The wire schema (`wsCommitPayloadSchema`) is a closed `z.object` that strips unknown fields on parse; even if it didn't, the handler ignores them. The engine sees `requester = FIXTURE_USER_ID` (the debater) and rejects with `not-a-moderator`. The spoof has zero effect.

- **One commit event per commit action.** The engine's `commitHandler` emits exactly one `commit` event for a successful commit action (per `methodology/handlers/commit.ts` line 257 — `return { ok: true, events: [event] }`). The read-side projection's `handleCommit` (in `apps/server/src/projection/replay.ts`) does the facet-marking + proposal-state transition (facet → `agreed`, proposal moves from `pendingProposals` to `committedProposals`); but that runs on every subscriber's local incremental `applyEvent` call against the broadcast `event-applied` frame — no additional wire frames are required. The WS handler's defensive assertion (`if (result.events.length !== 1) throw`) pins this contract; if a future engine arm widens the emitted-events count (e.g. structural fan-out for an axiom-mark commit), the handler surfaces the drift loudly.

- **`committedAt` mirrors `createdAt` (single clock source).** The handler sets `action.committedAt = action.createdAt` (the ISO timestamp from the injected clock). The engine forwards it into `payload.committed_at`. Rationale: same as the vote handler's `votedAt = createdAt` decision — keeping the two timestamps identical at the handler level prevents drift; if a future requirement separates "commit intent time" from "server-applied time" the handler is the single place that branches.

- **Wire vocabulary extension is two entries: `commit` (Group B) + `committed` (Group C).** Per the union-layout convention `ws_propose_message` documented. The vocabulary pin in `ws-envelope.test.ts` is updated to include both at the matching tails.

- **Tests layered per ADR 0022.** Pure-logic handler behaviour (gate stack, engine-rejection echoing including the headline `not-a-moderator` case, success path including the `committed` ack + bus emit, security invariant) → Vitest at `apps/server/src/ws/handlers/commit.test.ts`. Wire-path against pglite → Cucumber at `tests/behavior/backend/ws-commit.feature` with steps at `tests/behavior/steps/backend-ws-commit.steps.ts`. The Cucumber scenarios reuse the existing world/carrier pattern (auth-gated app + cookie + WS client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts` and add the commit-specific verbs.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `'commit'` added to Group B / `'committed'` added to Group C per the documented union-layout convention; `wsCommitPayloadSchema` (prefixed `Ws` to mirror the `wsVotePayloadSchema` convention) + `committedPayloadSchema` + matching `WsMessagePayloadMap` entries.
- Server (handler): [`apps/server/src/ws/handlers/commit.ts`](../../../apps/server/src/ws/handlers/commit.ts) — `buildCommitHandler` + `registerCommitHandlers`. Structurally mirrors `propose.ts` and `vote.ts` (subscribe-gate → visibility-check → FOR-UPDATE → MAX(sequence)+1 → projection-load → `validateAction` → `validateEvent` → `appendSessionEvent` → post-commit `event-applied` broadcast + `committed` ack). Moderator identity sourced exclusively from `connection.user.id` (`action.requester` AND `action.actor`); the wire payload has no `moderatorId` field. Engine's `not-a-moderator` rejection mapped to wire 403 `error` envelope via `rejectedToApiError`.
- Server (registration): [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) — `wsHandlersPlugin` extended to register `buildCommitHandler` alongside subscribe + propose + vote.
- Tests (Vitest): [`apps/server/src/ws/handlers/commit.test.ts`](../../../apps/server/src/ws/handlers/commit.test.ts) — 8 cases (forbidden, not-found, sequence-mismatch, HEADLINE `not-a-moderator` non-moderator gate, `unanimous-agree-required`, duplicate commit → `proposal-already-committed`, successful commit with dual signal, and the security invariant pinning that a client-spoofed `moderatorId` does NOT alter the engine's authority decision) + one-line vocabulary-pin update in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts).
- Tests (Cucumber): [`tests/behavior/backend/ws-commit.feature`](../../backend/ws-commit.feature) (4 scenarios — moderator commits unanimous-agree → `committed` + broadcast, non-moderator participant → `not-a-moderator`, commit before unanimous-agree → `unanimous-agree-required`, unsubscribed → `forbidden`) + [`tests/behavior/steps/backend-ws-commit.steps.ts`](../../backend/steps/backend-ws-commit.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- Final pre-commit run: 960 Vitest tests pass (952 baseline + 8 new); 203 Cucumber scenarios pass (199 baseline + 4 new).
