# Moderator node card: substance affordance

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_node_card_substance_affordance`
**Effort estimate**: 1.5d
**Inherited dependencies**: `pf_mod_node_card_classification_affordance` (mirrors the affordance shape + reuses the gate-by-predecessor pattern), `pf_projection_facet_status_refactor`.

## What this task is

Mount the substance-proposal affordance inline on the moderator's per-node card. Visibility is gated by the classification facet's derived status:

- `classification === 'agreed' | 'committed'` — affordance visible.
- Other statuses — affordance hidden.

Picking a substance value (`agreed` / `disputed`) fires a `set-node-substance` propose envelope. After the substance facet itself is `agreed` / `committed`, the affordance shows the value read-only with a "Change" re-propose affordance.

## Why it needs to be done

Per [ADR 0030 §1 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "the classification proposal and the substance proposal each have their own affordance on the moderator's node card." Substance is the third facet in the per-node sequence (wording → classification → substance) and its gesture lives here.

## Inputs / context

- [ADR 0030 §1, §8 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- `pf_mod_node_card_classification_affordance` (sibling) — the shape this affordance mirrors. The two affordances likely share a helper hook / component pattern; the implementation can DRY where it makes sense.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) — reads the classification facet's derived status.
- The WS propose-send path (per `pf_mod_capture_pane_wording_only`).
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — new catalog keys for the substance affordance.

## Constraints / requirements

- Affordance visibility gated by classification-facet status.
- Picking a value fires a `set-node-substance` propose envelope.
- Post-agreement display shows the committed value + "Change" affordance.
- New Vitest cases.
- e2e coverage rolls into `pf_e2e_methodology_full_flow_update`.

## Acceptance criteria

- The substance affordance is mounted on the node card with the correct gate.
- Picking a value sends a `set-node-substance` propose envelope.
- The post-agreement display + "Change" path works.
- Vitest covers the gate + the send path.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Same shape as classification affordance**, per [ADR 0030 §1](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)'s consistent "per-facet affordance on the node card" framing.
- **No symmetric edge-substance affordance lives here** — edges are not nodes; the edge-substance gesture lands separately. (This refinement is scoped to nodes; if the edge surface needs a parallel affordance for `set-edge-substance`, it lives on the edge card / hover surface — out of scope here. The methodology-full-flow e2e exercises the edge path via the participant detail panel + the moderator's edge-card affordances, which exist today.)

## Open questions

(none — all decided per ADR 0030)
