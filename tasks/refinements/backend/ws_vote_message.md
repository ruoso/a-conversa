# Vote message: client → server

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_vote_message`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.websocket_protocol.ws_propose_message` (settled — the gate-stack + dispatcher seam + closed-union extension convention this task mirrors), `backend.websocket_protocol.ws_message_envelope`, `backend.websocket_protocol.ws_auth_on_connect`, `backend.websocket_protocol.ws_subscribe_to_session`, `backend.websocket_protocol.ws_event_broadcast`, `backend.websocket_protocol.ws_error_message`, `data_and_methodology.event_types.vote_events` (settled — `VotePayload` schema + `votePayloadSchema`), `data_and_methodology.methodology_engine.withdrawal_logic` (settled — `voteHandler` with the three-arm matrix: `'agree'` / `'dispute'` / `'withdraw'`).

## What this task is

Land the **second of five** client→server methodology-action WS handlers. The vote handler is the structural sibling of the propose handler from [`ws_propose_message`](./ws_propose_message.md). Same gate stack, same dual-signal contract, same dispatcher-seam error path, same union-extension convention — only the engine call (`vote` instead of `propose`), the constructed action variant (`MethodologyAction.vote`), and the ack envelope type (`voted` instead of `proposed`) differ.

Concretely, the vote handler:

1. **Subscribe-before-act gate** — same `ApiError.forbidden('not subscribed ...')` as propose.
2. **Visibility re-check** — `canSeeSession(pool, sessionId, userId)` → `ApiError.notFound(...)` if the session became invisible between subscribe and vote.
3. **Transactional sequence allocation + projection load + engine validation + INSERT** — FOR UPDATE on `sessions`, MAX(sequence)+1, `projectFromLog`, build `MethodologyAction.vote`, call `validateAction`, `validateEvent`, `appendSessionEvent`. Identical to propose's transactional block.
4. **Post-commit broadcast + `voted` ack** — `broadcast.emit({ event })` after COMMIT, then send `voted` ack frame directly on the originating socket. The voter receives BOTH frames (ack + broadcast); non-voter subscribed clients receive only the broadcast.

Scope is **vote only** — `agree`, `dispute`, `withdraw` are vote *variants* on the same handler (the engine's `voteHandler` switches on `action.vote`). Withdraw is NOT a separate message type; the wire vocabulary stays at one `vote` request type / one `voted` ack type.

## Why it needs to be done

The participant tablet and moderator console mint vote actions over the WebSocket in response to participants' tap-to-agree / dispute / withdraw interactions. Without this handler, the only path to write a `vote` event is the (not-yet-existing) HTTP route, which would force the live UIs to maintain a dual transport surface and lose the request-response correlation `inResponseTo` provides over the duplex pipe — exactly the same motivation as propose.

Downstream consumers:

- `participant_ui` and `moderator_ui` — every facet-level disposition (`agree` button, `dispute` button, `withdraw` after commit) routes through this handler.
- `ws_commit_message` (next in the wave) — the commit gate enforces unanimous-agree; the votes it reads were written by this handler.
- `ws_reconnection_handling` — replays missed vote events through the same `event-applied` broadcast.

## Inputs / context

From [`apps/server/src/methodology/handlers/vote.ts`](../../../apps/server/src/methodology/handlers/vote.ts):

- `voteHandler: Validator<VoteAction>` runs four rule groups: participant gate (universal), proposal existence, proposal-state-vs-vote-arm matrix, per-participant prior-vote check. Rejection reasons surfaced via the engine: `'proposal-not-found'`, `'proposal-already-meta-disagreement'`, `'proposal-already-committed'`, `'no-prior-agree'`, `'already-voted'`, plus universal `'not-a-participant'` / `'sequence-mismatch'` / `'session-mismatch'`. (`'self-vote-not-allowed'` is in the union but not used by the current vote handler — see refinement Decisions.)

From [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts):

- `VoteAction extends ActionEnvelopeBase` with `kind: 'vote'`, `proposalEventId: string`, `vote: PerParticipantVote` (`'agree' | 'dispute' | 'withdraw'`), `votedAt: string` (ISO-8601). The envelope's `requester`, `sessionId`, `eventId`, `sequence`, `actor`, `createdAt` are populated by the handler before the engine call.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- `votePayloadSchema` requires `proposal_id: uuid`, `participant: uuid`, `vote: 'agree'|'dispute'|'withdraw'`, `voted_at: ISO-8601`. The engine emits this exact shape.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `rejectedToApiError` mapping for vote-specific reasons:

- `'no-prior-agree'` → 409
- `'already-voted'` → 409
- `'self-vote-not-allowed'` → 403
- `'proposal-not-found'` → 404
- `'proposal-already-committed'` → 422
- `'proposal-already-meta-disagreement'` → 422

From [`ws_propose_message.md`](./ws_propose_message.md) — the propose refinement's Decisions section is canonical for the gate stack, the union-layout convention, the post-commit-emit invariant, the dual-signal contract, and the projection-load strategy. Every decision there applies verbatim to this handler; only the deltas below are vote-specific.

## Constraints / requirements

- **Mirror propose tightly.** Same `withTransaction` shape, same FOR UPDATE, same MAX(sequence)+1, same projection-load-per-request, same `validateEvent` + `appendSessionEvent`, same post-commit `broadcast.emit` + `voted` ack ordering. Future sibling handlers (commit / meta / snapshot) read these two side-by-side; structural drift would degrade reviewability.
- **Single source of truth: the methodology engine.** No parallel vote validation logic.
- **Voter identity from the connection.** `action.requester = connection.user.id`. The client's request payload does NOT carry `voterId` (the schema does not include one; cf. propose's request payload which does not carry `proposerId`). A client cannot vote on behalf of someone else. See refinement Decisions.
- **Withdraw is a vote variant.** No separate `'withdraw'` message type; the wire vocabulary extension is two entries (`'vote'` + `'voted'`), not four. See refinement Decisions.
- **Closed-union extension** — `'vote'` to group B tail, `'voted'` to group C tail of [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts), per the union-layout convention `ws_propose_message` documented.
- **Voter's dual signal** — both `voted` ack (`inResponseTo` correlated) and `event-applied` broadcast arrive at the voter; non-voter subscribed clients receive only the broadcast.
- **Schema-on-write** — `validateEvent` runs on the constructed event envelope before `appendSessionEvent`, mirroring the propose handler.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` green; baseline ~945 Vitest tests still pass plus the new vote handler tests + the vocabulary pin update.
- `pnpm run test:behavior:smoke` green; baseline 195 Cucumber scenarios still pass plus the new vote feature.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/handlers/vote.ts` can see the structural mirror to `propose.ts` at a glance.
- A reader of `packages/shared-types/src/ws-envelope.ts` sees `'vote'` and `'voted'` at the tails of groups B and C respectively, consistent with the union-layout convention.

## Decisions

The propose refinement's Decisions section ([`ws_propose_message.md`](./ws_propose_message.md)) applies verbatim. Only the vote-specific deltas are documented here.

- **Voter identity comes from the authenticated connection, not the request payload.** The `vote` request payload carries `{ sessionId, expectedSequence, proposalId, choice }` — there is NO `voterId` field. The handler reads `connection.user.id` (populated by `ws_auth_on_connect`) and uses it for BOTH `action.requester` (the methodology gate) AND `action.actor` (the event's actor column). Rationale:
  - **Security invariant.** Letting the client name the voter on the wire would let a malicious client impersonate any other participant. The engine's `not-a-participant` gate would catch a vote for a non-participant, but it wouldn't catch a moderator voting "as" another debater. The connection's authenticated user is the only trustworthy source.
  - **No payload-level voterId at all.** Symmetric with `propose` (no `proposerId` field) — the convention is "the request payload describes the *what*; the connection supplies the *who*."
  - **Pinned in a test.** The Vitest unit test sends a payload that *does* include an unauthorised `voterId` field (which `parseWsEnvelope` would silently strip per `proposePayloadSchema`'s strict-object behaviour — `votePayloadSchema` is also a closed `z.object`, so unknown fields are dropped on parse); the handler still constructs the action with `connection.user.id`, and the resulting event's `actor` and `payload.participant` are the connection's user. This pins the invariant against future drift.

- **Withdraw is a vote variant (`choice: 'withdraw'`), not a separate message type.** The wire vocabulary extension is exactly two entries (`'vote'` + `'voted'`). Rationale:
  - The engine's `voteHandler` already switches on `action.vote` for the three-arm matrix; minting a separate `withdraw` action kind would force the engine to grow a parallel dispatch arm for what is structurally a vote against a committed proposal. The methodology design (per [withdrawal_logic refinement](../data-and-methodology/withdrawal_logic.md)) is "withdraw is a vote with arm `'withdraw'`."
  - The wire shape stays minimal — one request type, one ack type, one wire-error code path. Future client-side UIs can map their three buttons (agree / dispute / withdraw) onto a single message type with three `choice` values.
  - The engine's per-arm rejections (`no-prior-agree` for an illegal withdraw, `already-voted` for a duplicate agree/dispute, `proposal-already-committed` for an agree/dispute on a committed proposal) all flow through `rejectedToApiError` → wire `error` envelope; the client distinguishes via `error.payload.code`.

- **Engine owns per-facet voting + per-facet status; the handler does not re-implement.** The four facet-targeting proposal sub-kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`) carry per-facet `perParticipant` records (see `findParticipantVoteOnProposal` in `methodology/primitives.ts`); the seven structural sub-kinds short-circuit prior-vote lookup as `null`. All of this lives inside `voteHandler`. The WS handler's only job is to construct the `VoteAction` and call `validateAction`.

- **No `'self-vote-not-allowed'` from the vote handler today.** The current `voteHandler` (per `docs/methodology.md` line 9 — "all participants must agree on every change") explicitly does NOT reject self-votes; the proposer's agree is required for the unanimous-commit gate. The `'self-vote-not-allowed'` RejectionReason is reserved in the union for future handlers (e.g. axiom-mark) that have opposite semantics. The vote-test surface still covers `self-vote-not-allowed` as a wire-mapping case via a constructed engine rejection — but in the integration test we exercise the more common rejection paths (`already-voted`, `no-prior-agree`).

- **`choice` is the request-payload field name for the vote arm.** The action type calls it `vote` (`VoteAction.vote: PerParticipantVote`); the event payload calls it `vote` (`VotePayload.vote`); but the request payload uses `choice` to avoid a confusingly-self-referential `{ type: 'vote', payload: { vote: ... } }` shape. The handler maps `payload.choice` → `action.vote`. The mapping is a one-line translation, isolated to the handler builder. (Alternative considered: name the request payload field `vote` too; rejected on readability grounds — the doubled `vote.vote` form would be visually noisy in wire logs and test scaffolds.)

- **Vote-action `votedAt` mirrors `createdAt`.** The handler sets `action.votedAt = action.createdAt` (the same ISO timestamp from the injected clock). The engine forwards it into `payload.voted_at`. Rationale: keeping the two timestamps identical at the handler level prevents drift; if a future requirement separates "vote intent time" from "server-applied time" the handler is the single place that branches.

- **Tests layered per ADR 0022.** Pure-logic handler behaviour (gate stack, engine-rejection echoing, success path, security invariant) → Vitest at `apps/server/src/ws/handlers/vote.test.ts`. Wire-path against pglite → Cucumber at `tests/behavior/backend/ws-vote.feature` with steps at `tests/behavior/steps/backend-ws-vote.steps.ts`. The Cucumber scenarios reuse the existing world/carrier pattern (auth-gated app + cookie + WS client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts` and add the vote-specific verbs.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `'vote'` added to Group B / `'voted'` added to Group C per the documented union-layout convention; `wsVotePayloadSchema` (prefixed `Ws` to avoid colliding with the event-side `votePayloadSchema` exported from `events.ts`) + `votedPayloadSchema` + matching `WsMessagePayloadMap` entries.
- Server (handler): [`apps/server/src/ws/handlers/vote.ts`](../../../apps/server/src/ws/handlers/vote.ts) — `buildVoteHandler` + `registerVoteHandlers`. Structurally mirrors `propose.ts` (subscribe-gate → visibility-check → FOR-UPDATE → MAX(sequence)+1 → projection-load → `validateAction` → `validateEvent` → `appendSessionEvent` → post-commit `event-applied` broadcast + `voted` ack). Voter identity sourced exclusively from `connection.user.id` (`action.requester` AND `action.actor`); the wire payload has no `voterId` field.
- Server (registration): [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) — `wsHandlersPlugin` extended to register `buildVoteHandler` alongside subscribe + propose.
- Tests (Vitest): [`apps/server/src/ws/handlers/vote.test.ts`](../../../apps/server/src/ws/handlers/vote.test.ts) — 7 cases (forbidden, not-found, sequence-mismatch, already-voted, no-prior-agree on pending-withdraw, successful agree with dual signal, and the security invariant pinning that a client-spoofed `voterId` is ignored) + one-line vocabulary-pin update in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts).
- Tests (Cucumber): [`tests/behavior/backend/ws-vote.feature`](../../backend/ws-vote.feature) (4 scenarios — agree-dual-signal, duplicate-agree → `already-voted`, withdraw-of-pending → `no-prior-agree`, unsubscribed → `forbidden`) + [`tests/behavior/steps/backend-ws-vote.steps.ts`](../../backend/steps/backend-ws-vote.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- Final pre-commit run: 952 Vitest tests pass (945 baseline + 7 new); 199 Cucumber scenarios pass (195 baseline + 4 new).
