# Moderator capture pane: wording only

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_capture_pane_wording_only`
**Effort estimate**: 1d
**Inherited dependencies**: `pf_capture_emits_inline_wording_only` (server-side bundle removal; client follows).

## What this task is

Strip the classification palette out of the moderator's bottom-strip capture pane. The pane keeps:

- The wording textarea.
- The target chip + edge-role selector (still relevant for the capture-with-edge case — `edge-created` carries the role inline; the role is captured at capture-time per [ADR 0030 §5](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)).
- The propose button.

The propose button enables on wording alone (plus the role-with-target coupled-clear contract from the prior capture flow). The bundled `classify-node` proposal that the old propose action emitted is gone; the client sends `propose` envelopes whose proposal payload only carries `node-created` (and optionally `edge-created`) — wait, that's wrong; let me re-state: the propose handler treats the capture envelope as the "create the entity" gesture, emitting `node-created` (and optionally `edge-created`) on the server side per `pf_capture_emits_inline_wording_only`. The moderator client constructs a `propose` envelope whose payload is just the wording (+ optional role + target). No client-side `classify-node` is constructed.

This task removes the classification slot from the layout component and updates the `useProposeAction` hook to drop the classification + classify-bundle paths.

## Why it needs to be done

The bundled gesture is what produces the voteless-wording-facet bug per [ADR 0030 Context](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). Removing the classification palette from the capture pane is the visible expression of that change on the moderator surface. The classification gesture moves to the per-node card (handled by `pf_mod_node_card_classification_affordance`).

## Inputs / context

- [ADR 0030 §1 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/moderator/src/layout/BottomStripCapture.tsx`](../../../apps/moderator/src/layout/BottomStripCapture.tsx) — the layout component that mounts the classification palette today.
- [`apps/moderator/src/layout/ClassificationPalette.tsx`](../../../apps/moderator/src/layout/ClassificationPalette.tsx) — the palette component that gets removed from the capture pane (it may stay as a reusable component, mounted on the node card instead — handled by `pf_mod_node_card_classification_affordance`).
- [`apps/moderator/src/layout/useProposeAction.ts`](../../../apps/moderator/src/layout/useProposeAction.ts) — the propose hook; the bundled-classify path is removed.
- [`apps/moderator/src/stores/captureStore.ts`](../../../apps/moderator/src/stores/captureStore.ts) — the `classification` slice on the capture store is no longer read by the capture pane; the slice itself can be removed (or repurposed if helpful — judgment at implementation time).
- [`tasks/refinements/moderator-ui/mod_propose_action.md`](../moderator-ui/mod_propose_action.md), [`mod_classification_palette.md`](../moderator-ui/mod_classification_palette.md) — historical records of the prior bundle. Do not edit.

## Constraints / requirements

- Capture pane no longer shows the classification palette; the palette component itself may stay in the codebase for reuse on the node card.
- The propose action's validation gate no longer requires a classification pick. The remaining gate rules: text non-empty, target+role coupled (clear → both, set → both), session loaded, WS connected.
- `useCaptureStore.classification` is no longer read by the propose hook; the slice may be removed if its only readers were the propose path and the palette inside the capture pane (judgment call).
- The validation-reason enum on `useProposeAction` drops the `'classification-missing'` reason.
- The i18n catalog entries for the classification-missing reason can stay (other consumers may exist) or be retired; judgment at implementation time.
- Vitest cases at `apps/moderator/src/layout/useProposeAction.test.tsx` are revised; the prior assertions on the bundled-classify path are removed per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md). New cases assert that wording-only submission produces a single `propose` envelope (no second classify-envelope).

## Acceptance criteria

- Classification palette is not mounted in the capture pane.
- Propose action validates without classification.
- Propose action emits one envelope (the node-create) in the free-floating case; two (node-create + edge-create) in the connecting case.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Classification palette component is preserved**, just unmounted from the capture pane. The same component remounts on the node card in `pf_mod_node_card_classification_affordance`. Code reuse + design parity.
- **Edge role stays on the capture pane.** Per [ADR 0030 §5](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) edge shape (role + endpoints) lives inline on `edge-created`; capturing the role at capture-time matches the inline-on-creation contract.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

- Moderator capture pane no longer mounts the classification palette; the bottom-strip textarea + (optional) edge-target + Propose button mints a single `capture-node` envelope per ADR 0030 §1 (free-floating or with inline `edge` block).
- `useProposeAction` retires the classification-required validation gate and the `'classification-missing'` reason; remaining gate rules (text non-empty, target+role coupled, session loaded, WS connected) unchanged.
- Server-side legacy `classify-node`-with-wording bundle retired end-to-end: `wording` field dropped from `classifyNodeProposalSchema`, `buildStructuralEventsForPropose` legacy branch removed, propose sequence-gate legacy-bundle exemption removed, withdraw retraction arm for the legacy bundle is now a no-op.
- Vitest 4350 → 4349 (−1 retired classification-missing assertion). Cucumber 262 / 1803 unchanged. Playwright 107 → 100 passed + 7 `test.fixme` — inherited debt closed by downstream `pf_mod_node_card_classification_affordance` (methodology-full-flow Phase 3.1 / 3.2 / 4.1 / 5.3 + 3 moderator-capture.spec.ts tests).
- All 3 `TODO(pf_mod_capture_pane_wording_only)` markers paid down (sequence-gate exemption, `buildStructuralEventsForPropose` legacy branch, test seams); zero new TODOs introduced.
- Files: moderator UI (`useProposeAction.{ts,test.tsx}`, `ProposeAction.{tsx,test.tsx}`, `BottomStripCapture.{tsx,test.tsx}`, `PendingProposalsPane.tsx`, `routes/Operate.tsx`); server (`methodology/handlers/propose.ts`, `proposeSequenceGate.test.ts`, `engine.test.ts`, `ws/handlers/withdraw.{ts,test.ts}`); shared schema (`packages/shared-types/src/events/proposals.ts`); behavior step (`tests/behavior/steps/backend-ws-withdraw.steps.ts`); e2e specs (`methodology-full-flow.spec.ts`, `moderator-capture.spec.ts`, `moderator-proposed-entity-canvas-visibility.spec.ts`, `moderator-real-capture-flow.spec.ts`, `moderator-warrant-elicitation-mode.spec.ts`).
