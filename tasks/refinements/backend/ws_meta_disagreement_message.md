# Mark-meta-disagreement message: client → server (moderator-only)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_meta_disagreement_message`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.websocket_protocol.ws_commit_message` (settled — the gate-stack + dispatcher seam + closed-union extension convention + moderator-only authority pattern this task mirrors), `backend.websocket_protocol.ws_propose_message` (settled — first sibling that established the layout convention), `backend.websocket_protocol.ws_vote_message` (settled — second sibling that established the connection-derived-actor convention), `backend.websocket_protocol.ws_message_envelope`, `backend.websocket_protocol.ws_auth_on_connect`, `backend.websocket_protocol.ws_subscribe_to_session`, `backend.websocket_protocol.ws_event_broadcast`, `backend.websocket_protocol.ws_error_message`, `data_and_methodology.methodology_engine.meta_disagreement_logic` (settled — `markMetaDisagreementHandler` enforces four rule groups: moderator gate, proposal exists, proposal is pending, methodology-exhaustion (≥1 recorded dispute on the affected facet) for the four facet-targeting sub-kinds; structural sub-kinds defer with `illegal-state-transition`).

## What this task is

Land the **fourth of five** client→server methodology-action WS handlers. The mark-meta-disagreement handler is the structural sibling of the commit handler from [`ws_commit_message`](./ws_commit_message.md) — same gate stack, same moderator-only authority pattern, same dual-signal contract, same dispatcher-seam error path, same union-extension convention — only the engine call (`mark-meta-disagreement` instead of `commit`), the constructed action variant (`MethodologyAction.markMetaDisagreement`), and the ack envelope type (`meta-disagreement-marked` instead of `committed`) differ.

Concretely, the meta-disagreement handler:

1. **Subscribe-before-act gate** — same `ApiError.forbidden('not subscribed ...')` as propose / vote / commit.
2. **Visibility re-check** — `canSeeSession(pool, sessionId, userId)` → `ApiError.notFound(...)` if the session became invisible between subscribe and mark.
3. **Transactional sequence allocation + projection load + engine validation + INSERT** — FOR UPDATE on `sessions`, MAX(sequence)+1, `projectFromLog`, build `MarkMetaDisagreementAction`, call `validateAction`, `validateEvent`, `appendSessionEvent`. Identical to commit's transactional block.
4. **Post-commit broadcast + `meta-disagreement-marked` ack** — `broadcast.emit({ event })` after COMMIT, then send `meta-disagreement-marked` ack frame directly on the originating socket. The moderator receives BOTH frames (ack + broadcast); non-moderator subscribed clients receive only the broadcast.

Scope is **mark-meta-disagreement only** — the engine's `markMetaDisagreementHandler` enforces moderator-only authority, proposal-state transitions, the methodology-exhaustion gate, and the structural-sub-kind boundary. Snapshot is the remaining separate downstream task.

## Why it needs to be done

The moderator console's "mark meta-disagreement" escape valve routes through this handler. Semantically (per `docs/methodology.md` lines 203–212), marking a proposal as meta-disagreement is the moderator's last-resort declaration that the diagnostic tests and decomposition attempts have failed to resolve a dispute about wording or classification — the affected facet's status transitions to `meta-disagreement` and the proposal moves from `pendingProposals` to `unresolvedMetaDisagreements`, terminating the proposal's life cycle with a typed not-decided outcome and allowing the debate to continue past the irresolvable point.

Without this handler, the only path to write a `meta-disagreement-marked` event would be a (not-yet-existing) HTTP route, which would force the moderator UI to maintain a dual transport surface and lose the request-response correlation `inResponseTo` provides over the duplex pipe — exactly the same motivation as propose / vote / commit.

Downstream consumers:

- `moderator_ui` — the moderator's "mark meta-disagreement" button routes through this handler.
- `participant_ui` and `audience_broadcast` — the `event-applied` broadcast carrying the `meta-disagreement-marked` event drives every subscriber's local `handleMetaDisagreementMarked` projection step (in `apps/server/src/projection/replay.ts`), which transitions the affected facet to status `meta-disagreement` and moves the proposal from `pendingProposals` to `unresolvedMetaDisagreements`.
- `ws_reconnection_handling` — replays missed `meta-disagreement-marked` events through the same `event-applied` broadcast.

## Inputs / context

From [`apps/server/src/methodology/handlers/markMetaDisagreement.ts`](../../../apps/server/src/methodology/handlers/markMetaDisagreement.ts):

- `markMetaDisagreementHandler: Validator<MarkMetaDisagreementAction>` runs four rule groups: moderator gate (rule 1, `'not-a-moderator'`), proposal exists (rule 2, `'proposal-not-found'`), proposal-state (rule 3, `'proposal-already-committed'` / `'proposal-already-meta-disagreement'`), methodology-exhaustion (rule 4, `'methodology-not-exhausted'` for facet-targeting sub-kinds with no recorded dispute). Structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) fall through with `'illegal-state-transition'` and a sub-kind-naming `detail`.

From [`apps/server/src/methodology/types.ts`](../../../apps/server/src/methodology/types.ts):

- `MarkMetaDisagreementAction extends ActionEnvelopeBase` with `kind: 'mark-meta-disagreement'`, `proposalEventId: string`, `markedAt: string` (ISO-8601). The envelope's `requester`, `sessionId`, `eventId`, `sequence`, `actor`, `createdAt` are populated by the handler before the engine call.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- `metaDisagreementMarkedPayloadSchema` requires `proposal_id: uuid`, `moderator: uuid`, `marked_at: ISO-8601`. The engine emits this exact shape.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts) — `rejectedToApiError` mapping for mark-specific reasons:

- `'not-a-moderator'` → 403 (headline authority gate for this task)
- `'proposal-not-found'` → 404
- `'proposal-already-committed'` → 422
- `'proposal-already-meta-disagreement'` → 422
- `'methodology-not-exhausted'` → 422
- `'illegal-state-transition'` → 422 (structural sub-kind fallthrough)

From [`ws_commit_message.md`](./ws_commit_message.md) and [`ws_propose_message.md`](./ws_propose_message.md) — the commit / propose / vote refinements' Decisions sections are canonical for the gate stack, the union-layout convention, the post-commit-emit invariant, the dual-signal contract, the projection-load strategy, and the connection-derived-actor security invariant. Every decision there applies verbatim to this handler; only the deltas below are mark-meta-disagreement-specific.

## Constraints / requirements

- **Mirror commit tightly.** Same `withTransaction` shape, same FOR UPDATE, same MAX(sequence)+1, same projection-load-per-request, same `validateEvent` + `appendSessionEvent`, same post-commit `broadcast.emit` + `meta-disagreement-marked` ack ordering. The five sibling handlers (propose, vote, commit, meta-disagreement, snapshot) live side-by-side; structural drift would degrade reviewability.
- **Single source of truth: the methodology engine.** No parallel mark-meta-disagreement validation logic.
- **Moderator identity from the connection.** `action.requester = action.actor = connection.user.id`. The client's request payload does NOT carry `moderatorId`. A client cannot mark on behalf of someone else. See refinement Decisions.
- **Closed-union extension** — `'mark-meta-disagreement'` to group B tail, `'meta-disagreement-marked'` to group C tail of [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts), per the union-layout convention `ws_propose_message` documented.
- **Moderator's dual signal** — both `meta-disagreement-marked` ack (`inResponseTo` correlated) and `event-applied` broadcast arrive at the moderator; non-moderator subscribed clients receive only the broadcast.
- **Schema-on-write** — `validateEvent` runs on the constructed event envelope before `appendSessionEvent`, mirroring commit / vote / propose.
- **Headline gate pinned**: a non-moderator subscribed participant attempting a mark receives a wire `error` envelope with `code: 'not-a-moderator'` (the engine's rule-1 rejection mapped through `rejectedToApiError`).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` green; baseline 960 Vitest tests still pass plus the new mark-meta-disagreement handler tests + the vocabulary pin update.
- `pnpm run test:behavior:smoke` green; baseline 203 Cucumber scenarios still pass plus the new mark-meta-disagreement feature.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/handlers/meta-disagreement.ts` can see the structural mirror to `commit.ts` (and through it to `propose.ts` / `vote.ts`) at a glance.
- A reader of `packages/shared-types/src/ws-envelope.ts` sees `'mark-meta-disagreement'` and `'meta-disagreement-marked'` at the tails of groups B and C respectively, consistent with the union-layout convention.

## Decisions

The propose refinement's Decisions section ([`ws_propose_message.md`](./ws_propose_message.md)) applies verbatim, the vote refinement's ([`ws_vote_message.md`](./ws_vote_message.md)) connection-derived-actor decision applies verbatim, and the commit refinement's ([`ws_commit_message.md`](./ws_commit_message.md)) moderator-authority decision applies verbatim. Only the meta-disagreement-specific deltas are documented here.

- **Wire-type naming: kebab-case `'mark-meta-disagreement'` (C→S request) + `'meta-disagreement-marked'` (S→C ack).** The methodology engine uses `markMetaDisagreement` camelCase internally (`MethodologyAction.markMetaDisagreement`, `markMetaDisagreementHandler`); the wire vocabulary is kebab-case throughout (`'subscribe'`, `'propose'`, `'vote'`, `'commit'`, `'event-applied'`, etc. — convention established by `ws_message_envelope`). Two wire entries follow:
  - **`'mark-meta-disagreement'` (Group B tail)** is the imperative client-→-server request — naming mirrors the methodology vocabulary's verb form (the action kind in `MethodologyAction` is itself `'mark-meta-disagreement'`).
  - **`'meta-disagreement-marked'` (Group C tail)** is the past-participle ack on the moderator's socket, matching the `event.kind` of the emitted event (`metaDisagreementMarkedPayloadSchema` in `events.ts`). This reuses the same lexeme that already lives in the event vocabulary, so wire-trace readers see the request and ack named consistently with the event.
  - Both forms stay close to the v1 convention `proposed` / `voted` / `committed` follow (server-emitted ack = past participle of the request verb), and the noun-phrase form on the ack lets the wire trace read "I asked to mark; the server tells me it has been marked."

- **Moderator-only authority gate lives in the engine, surfaced on the wire as `not-a-moderator` — same path as commit.** The methodology engine's `markMetaDisagreementHandler` rule 1 (`requireModerator(projection, action.requester)`) is the single source of truth for "who may mark meta-disagreement." A non-moderator subscribed participant who sends a `mark-meta-disagreement` envelope passes the WS handler's gates 1 (subscribe) and 2 (visibility), then hits the engine's `not-a-moderator` rejection. `rejectedToApiError` maps it to a 403 with `code: 'not-a-moderator'`; the dispatcher's `onHandlerError` seam echoes the wire `error` envelope. **Pinned in a unit test** (`HEADLINE: rejects a non-moderator subscribed participant attempting mark with 'not-a-moderator'`) so this authority gate is regression-protected. Same rationale-cluster as commit's headline gate — the engine owns role-gating semantics; the WS handler is the protocol-layer gate.

- **Moderator identity comes from the authenticated connection, not the request payload.** The `mark-meta-disagreement` request payload carries `{ sessionId, expectedSequence, proposalId }` — there is NO `moderatorId` field. The handler reads `connection.user.id` and uses it for BOTH `action.requester` (the methodology gate the engine checks against `requireModerator`) AND `action.actor` (the event's actor column + the payload's `moderator` field). Symmetric with `propose` (no `proposerId`), `vote` (no `voterId`), and `commit` (no `moderatorId`). The convention is "the request payload describes the *what*; the connection supplies the *who*." Pinned in a unit test (`SECURITY: ignores any client-supplied moderatorId field`) — the wire schema is a closed `z.object` that strips unknown fields, and even if it didn't the handler ignores them.

- **What "marking as meta-disagreement" means in methodology terms.** Per `docs/methodology.md` lines 203–212: when the diagnostic tests have failed to resolve a facet-level dispute about wording / classification / substance, and decomposition has also failed, the moderator declares the disagreement irreducible — the affected facet's status transitions to `meta-disagreement` (carrying both proposed values side by side), the proposal moves from `pendingProposals` to `unresolvedMetaDisagreements`, and the debate proceeds past the irresolvable point. It is a typed not-decided terminal state for a proposal — semantically the moderator's escape valve when the methodology has been exhausted but consensus cannot be reached.

- **`inapplicable-to-facet` is not a current rejection reason for this handler; `illegal-state-transition` covers the structural-sub-kind boundary.** The engine's `markMetaDisagreementHandler` returns `'illegal-state-transition'` (not `'inapplicable-to-facet'`) for the seven structural sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) because they don't have per-participant vote state on the projection; the per-sub-kind sibling tasks may tighten this later. `'inapplicable-to-facet'` is reserved in the `RejectionReason` union for future handlers (e.g. a sub-kind-targeted axiom-mark mark) — not used here today. `'methodology-not-exhausted'` is the heart of the rule-4 gate: a facet-targeting proposal with no recorded dispute is by definition not stuck, and meta-disagreement is the methodology's last resort. All three (`illegal-state-transition`, `methodology-not-exhausted`, `proposal-already-committed`) map to 422 via `rejectedToApiError`.

- **One meta-disagreement-marked event per mark action.** The engine's `markMetaDisagreementHandler` emits exactly one `meta-disagreement-marked` event for a successful mark (per `methodology/handlers/markMetaDisagreement.ts` — `return { ok: true, events: [event] }`). The read-side projection's `handleMetaDisagreementMarked` (in `apps/server/src/projection/replay.ts`) does the facet-status transition + proposal-bucket move, but that runs on every subscriber's local incremental `applyEvent` call against the broadcast `event-applied` frame — no additional wire frames are required. The WS handler's defensive assertion (`if (result.events.length !== 1) throw`) pins this contract; if a future engine arm widens the emitted-events count the handler surfaces the drift loudly.

- **`markedAt` mirrors `createdAt` (single clock source).** The handler sets `action.markedAt = action.createdAt` (the ISO timestamp from the injected clock). The engine forwards it into `payload.marked_at`. Same rationale as commit's `committedAt = createdAt` and vote's `votedAt = createdAt` — keeping the two timestamps identical at the handler level prevents drift; if a future requirement separates "mark intent time" from "server-applied time" the handler is the single place that branches.

- **Wire vocabulary extension is two entries: `'mark-meta-disagreement'` (Group B) + `'meta-disagreement-marked'` (Group C).** Per the union-layout convention `ws_propose_message` documented. The vocabulary pin in `ws-envelope.test.ts` is updated to include both at the matching tails.

- **Tests layered per ADR 0022.** Pure-logic handler behaviour (gate stack, engine-rejection echoing including the headline `not-a-moderator` case, success path including the `meta-disagreement-marked` ack + bus emit, security invariant) → Vitest at `apps/server/src/ws/handlers/meta-disagreement.test.ts`. Wire-path against pglite → Cucumber at `tests/behavior/backend/ws-meta-disagreement.feature` with steps at `tests/behavior/steps/backend-ws-meta-disagreement.steps.ts`. The Cucumber scenarios reuse the existing world/carrier pattern (auth-gated app + cookie + WS client lifecycle) from `backend-ws-auth.steps.ts` / `backend-ws-connection.steps.ts` / `backend-ws-subscribe.steps.ts` and add the mark-specific verbs.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `'mark-meta-disagreement'` added to Group B / `'meta-disagreement-marked'` added to Group C per the documented union-layout convention; `wsMarkMetaDisagreementPayloadSchema` (prefixed `Ws` to mirror the `wsCommitPayloadSchema` / `wsVotePayloadSchema` convention) + `metaDisagreementMarkedAckPayloadSchema` (suffix `AckPayloadSchema` to disambiguate from the event-side `metaDisagreementMarkedPayloadSchema` exported from `events.ts`) + matching `WsMessagePayloadMap` entries.
- Server (handler): [`apps/server/src/ws/handlers/meta-disagreement.ts`](../../../apps/server/src/ws/handlers/meta-disagreement.ts) — `buildMarkMetaDisagreementHandler` + `registerMarkMetaDisagreementHandlers`. Structurally mirrors `commit.ts` (subscribe-gate → visibility-check → FOR-UPDATE → MAX(sequence)+1 → projection-load → `validateAction` → `validateEvent` → `appendSessionEvent` → post-commit `event-applied` broadcast + `meta-disagreement-marked` ack). Moderator identity sourced exclusively from `connection.user.id` (`action.requester` AND `action.actor`); the wire payload has no `moderatorId` field. Engine's `not-a-moderator` rejection mapped to wire 403 `error` envelope via `rejectedToApiError`.
- Server (registration): [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) — `wsHandlersPlugin` extended to register `buildMarkMetaDisagreementHandler` alongside subscribe + propose + vote + commit.
- Tests (Vitest): [`apps/server/src/ws/handlers/meta-disagreement.test.ts`](../../../apps/server/src/ws/handlers/meta-disagreement.test.ts) — 8 cases (forbidden, not-found, sequence-mismatch, HEADLINE `not-a-moderator` non-moderator gate, `proposal-already-committed` on a committed-proposal mark, `proposal-already-meta-disagreement` on a duplicate mark, successful mark with dual signal, and the security invariant pinning that a client-spoofed `moderatorId` does NOT alter the engine's authority decision) + a one-line vocabulary-pin update in [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts).
- Tests (Cucumber): [`tests/behavior/backend/ws-meta-disagreement.feature`](../../backend/ws-meta-disagreement.feature) (3 scenarios — moderator marks pending proposal → `meta-disagreement-marked` + broadcast, non-moderator → `not-a-moderator`, mark on committed proposal → `proposal-already-committed`) + [`tests/behavior/steps/backend-ws-meta-disagreement.steps.ts`](../../backend/steps/backend-ws-meta-disagreement.steps.ts).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- Final pre-commit run: 968 Vitest tests pass (960 baseline + 8 new); 206 Cucumber scenarios pass (203 baseline + 3 new).
