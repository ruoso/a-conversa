# Document the WebSocket message protocol

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_protocol_documentation`
**Effort estimate**: 1d
**Inherited dependencies**: every other `backend.websocket_protocol` task. The doc is the synthesis pass after the fourteen functional WS tasks (`ws_connection_handling`, `ws_auth_on_connect`, `ws_subscribe_to_session`, `ws_message_envelope`, `ws_propose_message`, `ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`, `ws_event_broadcast`, `ws_proposal_status_broadcast`, `ws_diagnostic_broadcast`, `ws_error_message`, `ws_reconnection_handling`) have shipped.

## What this task is

Produce the canonical, end-user-readable WebSocket protocol reference: a single document a developer (server, four frontend surfaces, future contributors) can read end-to-end in 10–15 minutes to understand every wire envelope, every handler's contract, the gate stacks, the error vocabulary, the ordering invariants, and the reconnection / catch-up flow.

The deliverable is **`docs/ws-protocol.md`**. It is a **reference, not a tutorial**: examples stay short; rationale links out to the owning refinements under `tasks/refinements/backend/ws_*.md`. The doc covers (in order):

1. Overview — endpoint, auth, connection lifecycle.
2. Envelope shape — universal `{ type, id, inResponseTo?, payload }`.
3. Message-type catalog — one sub-section per entry in `WsMessageType`, grouped C→S / S→C-ack / S→C-unsolicited.
4. Handler gate stack — connection authenticated → subscribed → visible → engine.
5. Error envelope reference — unified `code` vocabulary (HTTP `ApiError` codes + WS-specific codes + methodology `RejectionReason`).
6. Broadcasts + ordering invariants — post-commit-emit; synchronous-bus event-applied-before-derived; per-instance fan-out; per-connection error isolation.
7. Reconnection / catch-up — slice replay vs. `snapshot-state` fallback; client dedup.
8. Future / out-of-scope — labeled-checkpoint snapshots, multi-instance fan-out, client retry/backoff.

This task also ships a documentation-coverage test (`apps/server/src/ws/protocol-docs.test.ts`) that pins the audit invariant: every literal in the runtime `wsMessagePayloadSchemas` registry MUST appear in the catalog as a heading or code-fenced literal, and every error `code` the doc lists MUST be either an HTTP `ApiError` factory code, a methodology `RejectionReason`, or one of the two WS-specific extensions (`unknown-message-type`, `malformed-envelope`). Doc-vs-code drift breaks CI.

## Why it needs to be done

Four downstream frontend surfaces (`participant_ui`, `moderator_ui`, `audience_ui`, plus future contributors implementing reconnection in client code) need a single authoritative protocol reference. Today the protocol's truth is distributed across:

- The closed `WsMessageType` enum in `packages/shared-types/src/ws-envelope.ts` (with extensive docblocks).
- Fourteen refinement documents under `tasks/refinements/backend/ws_*.md`.
- The server-side dispatcher / handler / broadcast modules under `apps/server/src/ws/`.

A frontend developer mapping the participant tablet's send-loop has to read the envelope module's docblock, the propose refinement, the vote refinement, the commit refinement, the error refinement, the reconnection refinement, and the dispatcher to understand "what wire envelope do I send, and what comes back?" The synthesis is currently O(N) sources for any frontend task; this doc reduces it to O(1).

The WBS task is the last functional `websocket_protocol` task. Per the WBS-completion ritual, `complete 100` marks the task done; per ADR 0022, the doc ships with a committed test that catches drift.

## Inputs / context

From `packages/shared-types/src/ws-envelope.ts` (the source of truth for the wire format):

- `wsMessageTypes` — closed `as const` tuple. Today 21 entries spread across three groups (server-unsolicited, client-request, server-ack/result).
- `wsMessagePayloadSchemas` — exhaustive `Record<WsMessageType, z.ZodTypeAny>`. The catalog must cover every key.
- `parseWsEnvelope` / `parseWsEnvelopeJson` / `serializeWsEnvelope` — two-stage parse + schema-on-write serialize.
- `WsEnvelope<T>` — generic envelope type narrowing `payload` via `WsPayloadFor<T>`.

From `apps/server/src/ws/`:

- `connection.ts` — the `GET /ws` route, `preValidation` auth gate, `connectionId` mint, hello frame, message-receive loop, close-with-1001/1011 contract.
- `dispatcher.ts` — `WsDispatcher` with `register(type, handler)` / `dispatch(envelope, ctx)`, `onUnknownType` + `onHandlerError` seams.
- `subscriptions.ts` — `WsSubscriptionRegistry` bidirectional bookkeeping (`bySession`, `byConnection`).
- `error-envelope.ts` — `buildWsErrorEnvelope` + `sendWsError` + the four exported `code` constants (`WS_INTERNAL_ERROR_CODE`, `WS_MALFORMED_ENVELOPE_CODE`, `WS_UNKNOWN_MESSAGE_TYPE_CODE`, `WS_INTERNAL_ERROR_MESSAGE`).
- `broadcast/bus.ts` — `WsBroadcastBus` synchronous in-process pub/sub.
- `broadcast/event-applied.ts` — fan-out per session, per-connection try/catch isolation.
- `broadcast/proposal-status.ts` — derived broadcast, async tail after `event-applied`.
- `broadcast/diagnostic.ts` — `WsDiagnosticBroadcast` wrapper with active-context.
- `handlers/{subscribe,propose,vote,commit,meta-disagreement,snapshot,catch-up}.ts` — the gate stack + ack/broadcast shape.

From `apps/server/src/errors.ts`:

- HTTP `ApiError` kebab-case `code` taxonomy (`bad-request`, `unauthorized`, `forbidden`, `not-found`, `conflict`, `unprocessable-entity`, `internal-error`).
- `rejectedToApiError(rejection)` maps every methodology `RejectionReason` to the same kebab-case `code` verbatim.

From `apps/server/src/methodology/types.ts`:

- `RejectionReason` union — 22 entries across universal / role-gated / proposal-reference / entity-reference / vote-specific / propose-axiom-mark / methodology-flow / participant-assignment / entity-inclusion groups.

From `docs/architecture.md`:

- "Clients (moderator, debaters, audience) connect over **WebSockets**." The protocol doc inherits that vocabulary; it does not re-derive the architecture.

From `docs/methodology.md`:

- The per-facet status vocabulary (`proposed` / `agreed` / `disputed` / `committed` / `withdrawn` / `meta-disagreement`) that the `proposal-status` broadcast surfaces.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- The doc ships with a committed coverage test that pins the audit invariant. No ad-hoc one-shot scripts to check coverage; the test IS the verification.

## Constraints / requirements

- **Doc location**: `docs/ws-protocol.md` (alongside `architecture.md`, `data-model.md`, `methodology.md`).
- **Audience**: server developers + the four frontend workstreams (`participant_ui`, `moderator_ui`, `audience_ui`, plus future client SDKs) + future contributors.
- **Reference, not tutorial**: each section ≤ what a developer needs to recognise the surface and find the deeper rationale. Examples ≤ 8 lines of JSON each. Every section hyperlinks to the owning refinement + relevant source file.
- **Full catalog**: every literal in `wsMessageTypes` appears as a heading or code-fenced literal in the message-type catalog. Pinned by the coverage test.
- **Unified error vocabulary**: every code the doc claims as part of the surface must be reachable from one of three sets — HTTP `ApiError` factory codes, methodology `RejectionReason`, or the WS-specific `{ unknown-message-type, malformed-envelope }`. Pinned by the coverage test.
- **Reference owning code**: each catalog entry names the handler / broadcast / file path that owns the type (e.g. `apps/server/src/ws/handlers/propose.ts`).
- **Pin doc invariants in a test** (per ADR 0022): `apps/server/src/ws/protocol-docs.test.ts` reads `docs/ws-protocol.md` and asserts the two audit invariants above. Runs in the same Vitest suite as the rest of the WS tests.
- **No new wire shape**: this is a documentation task. Source-of-truth schemas live in `packages/shared-types`; the doc summarises what they say, not what we wish they said. If a drift between doc and code surfaces during writing, fix the doc (the code is committed + tested).
- **Stay aligned with `docs/architecture.md`'s vocabulary**: same WS terminology, same lifecycle words. No re-naming.

## Acceptance criteria

- `docs/ws-protocol.md` exists, ≤ 15 minutes read end-to-end, with the eight sections above.
- Every entry in `wsMessageTypes` appears in the catalog (pinned by the coverage test).
- Every claimed error `code` is in HTTP `ApiError` factory codes ∪ `RejectionReason` ∪ `{ unknown-message-type, malformed-envelope }` (pinned by the coverage test).
- `apps/server/src/ws/protocol-docs.test.ts` exists and passes.
- `pnpm exec vitest run apps/server/src/ws` green, net delta = +1 test file (+the count of cases inside it).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Cross-references: every catalog entry hyperlinks back to its owning refinement under `tasks/refinements/backend/ws_*.md`; every gate / broadcast / error invariant hyperlinks back to its refinement.

## Decisions

- **Doc location: `docs/ws-protocol.md`.** Co-located with the other long-form architectural docs (`architecture.md`, `data-model.md`, `methodology.md`). The `docs/adr/` directory is reserved for decision records; `tasks/refinements/` is task-shaping; the protocol reference is none of those — it's an enduring user-facing surface that ships alongside the running system.
- **Reference, not tutorial.** A tutorial would walk a reader through a full participant-tablet session in narrative form. That tutorial belongs in the future participant-UI / moderator-UI / audience-UI workspace READMEs as they land. The reference is the catalog + the invariants — short examples, links to source for rationale. Splitting the two prevents the doc from sprawling and going stale.
- **Discriminated-union audit method.** The single hardest doc-drift failure mode is "someone adds a new `WsMessageType` literal and forgets to update the doc." The runtime registry (`wsMessagePayloadSchemas`) is exhaustive over the closed union (TypeScript enforces the `Record<WsMessageType, …>` keys). The coverage test imports the registry's `Object.keys(...)` at runtime, reads the markdown text, and asserts every key is mentioned as a heading or fenced literal. **The first run of the coverage test IS the audit** (per ADR 0022 — no separate one-shot script).
- **Error-code audit method.** The unified vocabulary spans three sources: HTTP `ApiError` factory codes (a fixed set of seven kebab strings), methodology `RejectionReason` (the closed union), and two WS-specific codes (`unknown-message-type`, `malformed-envelope`). The test extracts every code the doc names (via a fenced-literal scan) and asserts each is in the union of those three sets. Future widening (a new `RejectionReason` lands; a new WS-specific code is added) requires updating the test's allowed set in lockstep.
- **Group catalog by direction.** Three subsections in the catalog — C→S requests, S→C acks/results, S→C unsolicited (hello, broadcasts, errors). Matches the union-extension layout convention already documented in `wsMessageTypes`'s docblock — readers fluent in the codebase find the doc structure familiar.
- **Per-entry shape: direction / schema link / when-it-fires / correlation / example / owner.** The minimum a developer wiring a client needs. Adding a "failure modes" sub-bullet per entry would duplicate the error vocabulary section; the link from each entry to its owning refinement carries that detail.
- **The gate stack as a single H2.** Repeating "subscribe-before-act → visibility → engine" on every catalog entry would bloat the doc. One H2 documents the stack; each catalog entry links to it.
- **The reconnection flow as a single H2.** The catch-up envelope is one entry in the catalog; the broader flow ("client opens → auth → subscribe → catch-up → live deltas") is the integration story that's worth its own section. The H2 references the catch-up entry; the entry references the H2.
- **Future / out-of-scope section is explicit.** Three deferred surfaces (labeled-checkpoint snapshots Interpretation B; multi-instance fan-out; client-side retry/backoff orchestration) are named with their reasons, so a frontend developer wiring reconnection doesn't reach for a server primitive that doesn't exist.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Shipped:

- `docs/ws-protocol.md` — the canonical WS reference (8 sections, ≤ 15-minute read).
- `apps/server/src/ws/protocol-docs.test.ts` — the coverage test pinning both audit invariants (every `wsMessagePayloadSchemas` key appears as a doc heading or fenced literal; every claimed error code is in the union of HTTP `ApiError` codes ∪ `RejectionReason` ∪ `{ unknown-message-type, malformed-envelope }`).
- `tasks/20-backend.tji` — `complete 100` on `ws_protocol_documentation`; `tj3 project.tjp` silent.
