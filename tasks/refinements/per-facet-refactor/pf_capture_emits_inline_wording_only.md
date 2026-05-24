# Capture emits inline wording only

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.server_handlers.pf_capture_emits_inline_wording_only`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_projection_facet_status_refactor`, `pf_projection_replay_updates`.

## What this task is

Strip the bundled "capture + classify" gesture out of the propose handler. Capturing a node emits `node-created` carrying the inline wording on the payload; it does NOT emit a co-bundled `classify-node` proposal. The classification facet of the new node is `awaiting-proposal` until a later, separate `classify-node` proposal is made (handled by the moderator UI's per-node-card classification affordance — `pf_mod_node_card_classification_affordance`).

For the connecting case (capture-with-edge), `edge-created` carries the shape (role + endpoints) inline; the new edge's `substance` facet is `awaiting-proposal` until a later `set-edge-substance` proposal lands.

## Why it needs to be done

Per [ADR 0030 §1, §4, §5](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "Capture is sequential and per-facet. … The bundled 'capture + classify' gesture is removed." The bundled gesture is what produces the voteless-wording-facet bug; removing it is the runtime expression of the sequential-capture methodology.

## Inputs / context

- [ADR 0030 §1, §4, §5](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) — current propose handler. Today, capturing a node mints a `classify-node` proposal as part of the bundle; that path is removed.
- [`tasks/refinements/moderator-ui/mod_propose_action.md`](../moderator-ui/mod_propose_action.md) — historical record of the prior moderator-side bundle. Do not edit; this task's moderator-side companion is `pf_mod_capture_pane_wording_only`.
- [ADR 0027 — entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the principle this task lands on the wire: structural facts (the node exists, the wording was captured) go on the entity-creation event; agreement state lives on the facet layer separately.

## Constraints / requirements

- Propose handler's "capture-a-node" path emits exactly one event on success: `node-created` with `wording` on the payload. No co-bundled `classify-node`. The `classify-node` path becomes a separate later gesture from the moderator UI.
- Propose handler's "capture-with-edge" path emits exactly two events on success: `node-created` (with inline wording) and `edge-created` (with inline role + endpoints). No co-bundled `classify-node` or `set-edge-substance`.
- `entity-included` events for the new node / edge fire as today (their semantics are unchanged).
- All existing handler tests (`apps/server/src/ws/handlers/propose.test.ts` and any Cucumber scenarios on capture) are updated against the new event count; the prior assertions on the bundled `classify-node` are removed (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), in-place revision rather than new throwaway).
- The wire-shape contract for `node-created` already carries `wording` per the data model; this task does not change the schema, only the handler that emits it.

## Acceptance criteria

- The propose handler's capture path emits `node-created` (and optionally `edge-created`) only; no `classify-node` / `set-edge-substance` bundle.
- Existing handler tests are updated; the no-bundle event count is asserted.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Bundle is removed, not split server-side.** The server simply stops emitting the second proposal; the gesture moves to the moderator UI's per-node-card classification affordance, which fires its own later `classify-node` propose envelope.
- **`entity-included` events are unchanged.** They are entity-layer carriages, not facet-layer, and the inclusion gesture (the entity exists in this session) is unrelated to the facet-keying refactor.
- **Capture-with-edge keeps the two-event emission** (node-created + edge-created) on a single propose envelope. The propose handler still accepts the capture envelope as a single submission; only the bundled `classify-node` / `set-edge-substance` proposals go away.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

- New propose sub-kind `capture-node` lands per ADR 0030 §1, §4, §5: wording-only entity-layer emission with optional inline edge shape for the connecting-capture case.
- Schema in `packages/shared-types/src/events/proposals.ts` (`captureNodeProposalSchema` + nested `captureNodeEdgeShapeSchema`), wired into `proposalPayloadSchema` union and re-exported from `events.ts`.
- Propose handler (`apps/server/src/methodology/handlers/propose.ts`) grows a `validateCaptureNodeProposal` + `capture-node` arm in the dispatch and in `buildStructuralEventsForPropose`.
- Withdraw handler (`apps/server/src/ws/handlers/withdraw.ts`) grows a `capture-node` retraction arm.
- The legacy `classify-node`-with-wording bundle stays alive with a `TODO(pf_mod_capture_pane_wording_only)` marker so the existing moderator UI continues to compile until that downstream task migrates the capture pane to the new sub-kind.
- Vitest 4314 → 4319 (+5 cases — wording-only emit count, capture-with-edge emit count, rule-1 uniqueness, rule-3 missing target, rule-3 self-reference accept). Cucumber 257 → 259 scenarios (+2). Playwright 107 → 107 (unchanged, green).
- New artifacts: `apps/server/src/methodology/handlers/proposeCaptureNode.test.ts`, `tests/behavior/methodology/propose-capture-node.feature`, `tests/behavior/steps/methodology-propose-capture-node.steps.ts`.
