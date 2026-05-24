# Moderator node card: classification affordance

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_node_card_classification_affordance`
**Effort estimate**: 1.5d
**Inherited dependencies**: `pf_mod_capture_pane_wording_only` (the palette becomes available for remount here), `pf_projection_facet_status_refactor` (moderator-side `facetStatus.ts` mirror provides the `awaiting-proposal` / `agreed` reads that gate this affordance).

## What this task is

Mount the classification palette inline on the moderator's per-node card (`StatementNode` or whatever the per-node component is called in the current codebase). The palette appears for nodes whose `wording` facet is `agreed` or `committed` — i.e. the wording has been settled, and the classification facet is ready to receive a candidate. Picking a kind fires a `classify-node` propose envelope keyed to the node id.

The affordance is gated by the wording-facet derived status:

- `wording === 'awaiting-proposal'` — never reachable (wording is inline on `node-created`, so it always has a candidate).
- `wording === 'proposed' | 'disputed' | 'meta-disagreement' | 'withdrawn'` — palette is hidden; the classification facet isn't ready yet.
- `wording === 'agreed' | 'committed'` — palette is visible.

After a `classify-node` proposal lands and the classification facet is itself `agreed` / `committed`, the palette flips to display the agreed-upon kind (read-only); a re-propose affordance (revealed via a small "change" button) lets the moderator propose a new candidate, which clears prior votes per the projection's reset rule.

## Why it needs to be done

Per [ADR 0030 §1 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "classification proposals … each have their own affordance on the moderator's node card." Without this affordance, there is no surface from which to issue the `classify-node` proposal — the gesture would have nowhere to live after `pf_mod_capture_pane_wording_only` removes it from the capture pane.

## Inputs / context

- [ADR 0030 §1 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/moderator/src/graph/`](../../../apps/moderator/src/graph/) — the directory housing the moderator's per-node React components. Identify the `StatementNode` (or equivalent) — exact filename to confirm at implementation time.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) — the moderator-side mirror; reads the wording facet's derived status.
- [`apps/moderator/src/layout/ClassificationPalette.tsx`](../../../apps/moderator/src/layout/ClassificationPalette.tsx) — the existing palette component, repurposed here.
- The WS client surface (`useWsClient`) + the propose-send path; this task adds a `useProposeClassifyNode` hook that mirrors the existing `useProposeAction` shape but targets the classify-node sub-kind directly with the node id (no co-bundled events).
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest cases + a Playwright e2e block (joined to the methodology-full-flow spec — see `pf_e2e_methodology_full_flow_update`).
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — new catalog keys for the per-node-card chrome + locales (PENDING drafts as per the prior moderator-UI tasks).

## Constraints / requirements

- The palette mounts on each node card; visibility is gated by the wording facet's derived status (`agreed` / `committed` shows the affordance; otherwise hidden).
- Picking a kind fires a `propose` envelope with `proposal: { kind: 'classify-node', node_id, classification }`. The propose-action skeleton from `pf_mod_capture_pane_wording_only` (or a new shared `useProposeFacet` hook) is the wire-write path.
- After the classification facet is `agreed` / `committed`, the palette displays the value read-only. A "Change" affordance allows re-proposing (mints a new `classify-node` proposal; the projection clears prior votes per `pf_projection_facet_status_refactor`).
- The new affordance does NOT bypass the server's sequence gate (`pf_sequence_gate_server_enforced`) — the UI hides the affordance when the wording facet isn't settled, but the server is the integrity boundary.
- New Vitest cases at the appropriate test file in `apps/moderator/src/graph/`.
- e2e coverage rolls into `pf_e2e_methodology_full_flow_update` (the methodology-full-flow Playwright spec).

## Acceptance criteria

- The classification palette is mounted on the node card; visibility is gated by the wording-facet derived status.
- Picking a kind sends a `classify-node` propose envelope.
- The post-agreement display shows the committed value with a "Change" affordance.
- Vitest covers the visibility gate + the send-on-pick path.
- The e2e coverage lives in `pf_e2e_methodology_full_flow_update`.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Affordance lives on the node card, not on a per-node detail panel.** Per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "the classification proposal and the substance proposal each have their own affordance on the moderator's node card."
- **Re-propose mints a new proposal** (does not edit the existing one). The projection's vote-reset-on-new-candidate handles the semantics.
- **i18n keys land flagged PENDING** for pt-BR / es-419 drafts, per the catalog workflow precedent (`tasks/refinements/frontend-i18n/i18n_catalog_workflow.md`).

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

- New `apps/moderator/src/graph/NodeCardClassificationPalette.tsx` mounts inline on the moderator's per-node card; visibility is gated on `wording === 'agreed' | 'committed'` AND `classification === 'awaiting-proposal'`, per ADR 0030 §1.
- New `apps/moderator/src/layout/useProposeClassifyNodeAction.ts` hook fires a `classify-node` propose envelope keyed to the node id (mirrors the existing per-node propose-hook shape).
- Capture-node proposal mapped to the wording facet across server + client read surfaces (vote/commit/markMetaDisagreement handlers, primitives, replay walker, broadcast proposal-status, moderator + participant facet-status + proposal-facets + pending-proposals selectors, participant vote buttons). This is the missing bridge between the capture-node gesture and the wording-facet agreement flow — needed so the pending row clears on wording commit.
- i18n catalog keys added under `moderator.classifyNodeAction.*` in en-US (canonical) with PENDING entries flagged in pt-BR + es-419 review.json per the existing i18n review workflow (no new WBS leaf needed).
- 7 Playwright tests un-fixme'd (4 methodology-full-flow Phase 3.1 / 3.2 / 4.1 / 5.3 + 3 moderator-capture.spec.ts tests); 4 new methodology-full-flow phases added (2.2 wording vote / 2.3 wording commit / 2.4 alice classify / 5.2 N2 wording vote+commit). Vitest 4349 → 4371 (+22). Cucumber 262 / 1803 unchanged.
- All `TODO(pf_mod_node_card_classification_affordance)` markers cleared.
- Gates: `pnpm run check` green, `pnpm run test:smoke` 4371 passing, `pnpm run test:behavior:smoke` 262 / 1803, `pnpm run test:e2e:smoke` 111 passed + 0 fixme.
