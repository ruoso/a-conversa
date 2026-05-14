# Moderator per-participant vote indicators on the graph (ambient, on the facet-pill row)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_vote_indicators_on_graph` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization` (done — landed `<FacetPill>` + the facet-pill row inside `<StatementNode>` + the `data-facet-pill`/`data-facet-name`/`data-facet-status` seam).
- `moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration` (done — landed `axiomMarkColorFor(participantId)` + the per-participant six-bucket palette).

## What this task is

Surface **who voted what on which facet** directly on the graph card, ambiently — without forcing the moderator to drill into the right sidebar. The facet-pill row added by `mod_per_facet_state_visualization` rendered the facet's overall status (`proposed` / `agreed` / `disputed` / `meta-disagreement` / `committed` / `withdrawn`); this task adds a row of small dots beside each pill, one dot per participant who voted on the facet's pending proposal, color-keyed so the moderator can read at a glance "Alice agreed, Bob disputed, Carol withdrew."

This task lands:

- A new `projectVotesByFacet(events)` helper in `apps/moderator/src/graph/selectors.ts` that returns a `Map<string, Map<FacetName, Vote[]>>` keyed by node id then by facet name. Each `Vote` is `{ participantId, choice }` where `choice` is `'agree' | 'dispute' | 'withdraw'`. The projection walks the same event log the existing selectors walk (proposal → vote pairs), filters to facet-targeting proposal sub-kinds (`classify-node`, `set-node-substance`, `edit-wording`, `amend-node`), and for each `vote` event records the participant's latest vote on the proposal's target facet. Only the latest pending proposal per (node, facet) is surfaced — a committed-then-superseded proposal's votes are not re-surfaced; the methodology projection on the server already pins this and the client mirrors it.
- A new `<VoteIndicator>` component in `apps/moderator/src/graph/VoteIndicator.tsx` — small dot, outer ring color-keyed to the participant via `axiomMarkColorFor(participantId)`, inner fill color-keyed to the vote choice (green = agree, rose = dispute, slate-gray = withdraw). Carries the `data-vote-indicator` sentinel + `data-participant-id` + `data-choice` attributes for the stable seam. Localized `aria-label` via `useTranslation` (`methodology.voteIndicator.label`).
- A new vote-indicator row rendered INSIDE each facet pill (between the localized facet-name label and the pill's trailing edge). The row renders only when the facet has at least one vote — otherwise the pill renders unchanged (the existing per-status border / opacity is preserved).
- New i18n keys `methodology.voteIndicator.label` / `.choice.agree` / `.choice.dispute` / `.choice.withdraw` in all three v1 catalogs (en-US / pt-BR / es-419). The `voteChoice` namespace already has `agree`/`dispute`/`withdraw` from the i18n glossary task; the `voteIndicator.label` is a new aria-label-friendly phrasing.
- Tests covering: no votes (no row rendered); agree-only single vote; mixed votes (one agree + one dispute); withdrawn vote rendered with the gray choice color; per-participant outer-ring color stable across two facets when the same participant votes on both.

**This task is additive**: the existing facet-pill border / ring / opacity stay; the vote-indicator row sits inside the pill content area to the right of the facet-name label.

## Why it needs to be done

The whole-card frame and the facet-pill row already tell the moderator "this card has a disputed substance facet" — but the methodology has more than three or four participants in many sessions, and the moderator needs to see *who* is on which side without context-switching to the right sidebar's per-proposal detail. The ambient-indicator pattern (same vocabulary as the axiom-mark badge row: per-participant color, deterministic from UUID, stable across surfaces) is the established design language for "surface per-participant disposition on the canvas." This task is the third instance of that pattern (after `mod_axiom_mark_decoration` and the per-participant render in `mod_per_facet_state_visualization`'s seam-attribute design).

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; in-card decoration rows are the extension point.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the aria-label localization.
- `docs/methodology.md` § "Facets" + "Votes / Withdrawal" — the three vote arms (`agree`, `dispute`, `withdraw`) and their semantics.
- `packages/shared-types/src/events.ts` — `votePayloadSchema` shape: `{ proposal_id, participant, vote: 'agree' | 'dispute' | 'withdraw', voted_at }`.
- `apps/moderator/src/graph/selectors.ts` — `axiomMarkColorFor(participantId)` + the `AXIOM_MARK_PALETTE`; the established per-participant deterministic color seam this task reuses.
- `apps/moderator/src/graph/FacetPill.tsx` — the pill component this task adds a child row to.
- `apps/moderator/src/graph/facetStatus.ts` — `FacetName` (`'wording' | 'classification' | 'substance'`) and the `targetOf` logic that maps a proposal's payload to (entityKind, entityId, facet). The new projection in this task uses the same mapping.

## Constraints / requirements

- **`projectVotesByFacet(events)`** in `apps/moderator/src/graph/selectors.ts`:
  - Returns `Map<string, Map<FacetName, Vote[]>>` — keyed by node id, then by facet name.
  - Walks `events` once: tracks proposal-id → (nodeId, facet) for each facet-targeting proposal sub-kind (`classify-node` → `classification`; `set-node-substance` → `substance`; `edit-wording` / `amend-node` → `wording`). The four facet-targeting sub-kinds match `targetOf` in `facetStatus.ts`, scoped to node targets only (edge `set-edge-substance` is out of scope — edges don't render the facet-pill row).
  - For each `vote` event referencing a known facet-targeting proposal, records the participant's latest vote (last-write-wins per `(proposal, participant)`).
  - A `commit` or `meta-disagreement-marked` event referencing a tracked proposal stops further votes from being surfaced (the proposal is closed). Per-proposal votes that landed BEFORE commit ARE surfaced (the participant's recorded agreement on a committed proposal is still meaningful for "who agreed").
  - Skips proposals targeting an entity that isn't a node (edge proposals contribute nothing here).
  - Each `Vote` record: `{ participantId: string; choice: 'agree' | 'dispute' | 'withdraw' }`. Insertion order: arrival order of the participant's first non-overwritten vote (so the row reads left-to-right in the order participants first weighed in on this facet).
- **`<VoteIndicator>` component** (`apps/moderator/src/graph/VoteIndicator.tsx`):
  - Memoized React component taking `{ participantId: string; choice: 'agree' | 'dispute' | 'withdraw' }`.
  - Renders a `<span>` with:
    - `data-vote-indicator` sentinel (empty value).
    - `data-participant-id="<uuid>"` — the deterministic per-participant seam.
    - `data-choice="<agree|dispute|withdraw>"` — the per-choice seam.
    - Localized `aria-label` resolved via `t('methodology.voteIndicator.label', { participantId, choice: t(\`methodology.voteIndicator.choice.\${choice}\`) })`.
    - `title` attribute carrying the same localized string (hover affordance).
    - `role="img"` for SR/A11y.
  - Visual: a small inline-block `h-2 w-2 rounded-full` dot.
    - **Outer ring** (1px) uses the participant's `axiomMarkColorFor(participantId).ring` Tailwind class — deterministic from the UUID.
    - **Inner fill** is choice-keyed:
      - `agree` → `bg-emerald-500`
      - `dispute` → `bg-rose-500`
      - `withdraw` → `bg-slate-400` (grayed out — the methodology semantics: the agreement was retracted, the dot stays as a record but reads as faded).
  - The component avoids importing anything from React's runtime beyond `memo` + `useTranslation` so it renders cleanly under `@testing-library/react`.
- **Facet-pill integration**: extend `<FacetPill>` to accept an optional `votes: readonly Vote[]` prop (default `[]`). When non-empty, render a `<span>` row of `<VoteIndicator>` children to the right of the localized facet-name label. The row container carries `data-vote-indicator-row` for downstream Playwright selection. Per-pill rendering branches (`PILL_STATUS_CLASSNAME`) are unchanged.
- **`<StatementNode>` integration**: thread `votes` through. `StatementNodeData` gets a new optional `votesByFacet: Readonly<Partial<Record<FacetName, readonly Vote[]>>>` field (defaults to `{}` in `projectNodes` when the projection yields nothing for the node). The `FACET_RENDER_ORDER` iteration reads `votesByFacet[facet] ?? []` and passes it to the matching pill.
- **`projectNodes` enrichment** in `GraphCanvasPane.tsx`: call `projectVotesByFacet(events)` alongside the existing axiom-mark / facet-status projections; bucket the result onto each node via `votesByFacetIndex.get(nodeId) ?? EMPTY_VOTES_BY_FACET`.
- **i18n catalog keys**: add to all three v1 catalogs (en-US / pt-BR / es-419):
  - `methodology.voteIndicator.label` — ICU template with `{participantId}` + `{choice}` substitutions. en-US: `"Participant {participantId} voted {choice}"`; pt-BR: `"Participante {participantId} votou {choice}"`; es-419: `"Participante {participantId} votó {choice}"`.
  - `methodology.voteIndicator.choice.agree` — the verb form for inline ICU substitution. en-US: `"agree"`; pt-BR: `"concordou"`; es-419: `"concordó"`. (Distinct from the existing `methodology.voteChoice.agree` "Agree" noun/title-case — the indicator label is a sentence fragment.)
  - `methodology.voteIndicator.choice.dispute` — en-US: `"dispute"`; pt-BR: `"contestou"`; es-419: `"impugnó"`.
  - `methodology.voteIndicator.choice.withdraw` — en-US: `"withdraw"`; pt-BR: `"retirou"`; es-419: `"retiró"`.
- **No change to the existing facet-pill border / ring / opacity rules or the whole-card frame**. The vote-indicator row is purely additive.
- **Tests** (committed, per ADR 0022):
  - Extend `apps/moderator/src/graph/selectors.test.ts` with a `projectVotesByFacet` describe block: empty event log; single vote (one node, one facet, one participant, one agree); same-participant repeated vote (latest wins); two participants on the same facet (both surface, ordered by first vote arrival); votes across two facets on the same node (both buckets present); votes on a non-existent proposal (silently dropped); vote on an edge proposal (silently dropped — edges aren't in the index).
  - New `apps/moderator/src/graph/VoteIndicator.test.tsx`: seam-attribute stamping (3 cases × 3 choices); per-choice fill class (3 cases — `bg-emerald-500` / `bg-rose-500` / `bg-slate-400`); per-participant outer-ring class (2 cases — different participants get different ring classes, deterministic); localized aria-label (1 sample per locale × 3 locales).
  - Extend `apps/moderator/src/graph/FacetPill.test.tsx` with a vote-indicator describe block: pill without votes does NOT render the row; pill with one vote renders one indicator; pill with mixed votes (agree + dispute + withdraw) renders three indicators with distinct `data-choice` values; the per-pill border / status classes are unchanged when votes are present.
  - Extend `apps/moderator/src/graph/StatementNode.test.tsx` with a `mod_vote_indicators_on_graph` describe block: empty `votesByFacet` renders no vote-indicator rows; a single agree vote on the wording facet renders one indicator inside the wording pill; mixed votes across two facets render two separate rows (one per pill); a withdrawn vote renders with `data-choice="withdraw"` and the gray choice color.
  - Extend `packages/i18n-catalogs/src/methodology.test.ts` to extend `METHODOLOGY_VALUES` with the new `voteIndicator` keys so the round-trip test covers them automatically.

## Acceptance criteria

- `apps/moderator/src/graph/selectors.ts` exports `projectVotesByFacet(events): Map<string, Map<FacetName, Vote[]>>` and a `Vote` type `{ participantId: string; choice: 'agree' | 'dispute' | 'withdraw' }`.
- `apps/moderator/src/graph/VoteIndicator.tsx` exists, exports a memoized `<VoteIndicator>` component with the per-choice fill + per-participant outer-ring classes.
- `apps/moderator/src/graph/FacetPill.tsx` accepts an optional `votes` prop and renders the indicator row inside the pill.
- `apps/moderator/src/graph/StatementNode.tsx` reads `votesByFacet` off `data` and threads the per-facet vote list to each pill.
- `apps/moderator/src/graph/GraphCanvasPane.tsx`'s `projectNodes` calls `projectVotesByFacet(events)` and attaches the per-node bucket.
- Three i18n catalogs carry the new `methodology.voteIndicator.*` entries.
- `packages/i18n-catalogs/src/methodology.test.ts`'s `METHODOLOGY_VALUES` is extended with the new keys.
- `apps/moderator/src/graph/selectors.test.ts` extended with the `projectVotesByFacet` describe block.
- New `apps/moderator/src/graph/VoteIndicator.test.tsx`.
- `apps/moderator/src/graph/FacetPill.test.tsx` extended with the vote-indicator block.
- `apps/moderator/src/graph/StatementNode.test.tsx` extended with the new describe block.
- `pnpm run check` clean (no new errors beyond the pre-existing baseline).
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_vote_indicators_on_graph` plus a `note "Refinement: …"` line.

## Decisions

- **Indicator placement: INSIDE the facet pill, right of the label.** The pill is already the per-facet record; putting the vote dots inside the same chip keeps the per-facet locality. Putting them in a separate row would either duplicate the facet-name label or untether the dots from the facet they reference. Right of the label means the dots appear after the moderator's eye has read which facet they're looking at.
- **Per-participant outer ring + per-choice inner fill.** The outer ring uses `axiomMarkColorFor(participantId).ring` — the same six-bucket palette already pinned by `mod_axiom_mark_decoration`. The inner fill is choice-keyed (emerald = agree, rose = dispute, slate = withdraw). Two readings: scan the dots' fills to see the agreement pattern; look at a specific dot's ring to identify which participant. This dual encoding is the design language already established for per-participant decoration on the canvas.
- **Withdrawn votes render with a gray fill, not as removed dots.** A `withdraw` is methodologically meaningful: the participant agreed, then retracted. The record shouldn't vanish — the moderator needs to see that the agreement was withdrawn (and from whom). Gray + the `data-choice="withdraw"` seam preserves that signal. The pill's overall status (`disputed` / `withdrawn`) is the orthogonal signal at the facet level.
- **Latest vote per participant per proposal wins.** The server-side methodology engine enforces a single vote per (proposal, participant) at write time (per `apps/server/src/methodology/handlers/vote.ts` rule 4); this client projection mirrors that with last-write-wins on the proposal-id + participant key. Switching arms (e.g. agree→dispute, dispute→agree) is legal per the same handler; the indicator surfaces the participant's current arm only.
- **Edge votes are out of scope.** Edges render the facet-pill row for substance only (per `mod_per_facet_state_visualization`), and the participant-vote indicator on edge facets is an ambient indicator on edges — a separate task. This task scopes to node facets. The `projectVotesByFacet` projection bucket is keyed by node id only.
- **No re-derivation of `axiomMarkColorFor` name.** The function name says "axiom mark" but the per-participant deterministic color is the seam; renaming to `participantColorFor` is a separate refactor task that touches every callsite. For now the import name stays and the JSDoc on this task's component notes the seam reuse.
- **i18n keys: `methodology.voteIndicator.label` + `methodology.voteIndicator.choice.<arm>`.** Mirrors the existing `methodology.voteChoice.<arm>` pattern but in a sentence-fragment form suitable for ICU substitution into the aria-label template. The two namespaces coexist: `voteChoice` is the noun/title-case label ("Agree" / "Dispute" / "Withdraw"); `voteIndicator.choice` is the verb-form fragment ("agree" / "concordou" / "concordó").
- **No styling change to the pill's border / ring / opacity.** The vote-indicator row is content-area additive. A future task can revisit pill width if the indicator row crowds the facet-name label; today the small dot footprint (`h-2 w-2` + `gap-0.5`) is well within the pill's `px-1.5` padding.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/VoteIndicator.tsx` — memoized React component rendering a single per-participant vote dot. Takes `{ participantId, choice }`. Stamps `data-vote-indicator` + `data-participant-id` + `data-choice` for the stable test seam. Outer ring (1px) uses `axiomMarkColorFor(participantId).ring` (the per-participant deterministic palette from `mod_axiom_mark_decoration`); inner fill is choice-keyed: `bg-emerald-500` (agree), `bg-rose-500` (dispute), `bg-slate-400` (withdraw). Localized `aria-label` + `title` via `methodology.voteIndicator.label` ICU template + `methodology.voteIndicatorChoice.<arm>` verb-form substitution.
- Extended `apps/moderator/src/graph/selectors.ts` — added the `Vote` type (`{ participantId, choice }`), the `EMPTY_VOTES_BY_FACET` / `EMPTY_VOTES` shared empty references, and `projectVotesByFacet(events)` returning `Map<string, Map<FacetName, Vote[]>>`. Walks proposals + votes in a single pass; latest vote per `(proposal, participant)` wins; insertion order preserves each participant's FIRST vote arrival so dot positions don't jump on an agree↔dispute switch. Filters to the four node-facet-targeting proposal sub-kinds (`classify-node`, `set-node-substance`, `edit-wording`, `amend-node`); edge-substance and structural sub-kinds contribute nothing.
- Updated `apps/moderator/src/graph/FacetPill.tsx` — added optional `votes` prop. When non-empty, the pill renders a `<span data-vote-indicator-row>` row to the right of the localized facet-name label containing one `<VoteIndicator>` per vote. Per-status border / ring / opacity classes are unchanged.
- Updated `apps/moderator/src/graph/StatementNode.tsx` — added `votesByFacet: Readonly<Partial<Record<FacetName, readonly Vote[]>>>` to `StatementNodeData`. The pill iterator reads `votesByFacet[facet] ?? EMPTY_VOTES` and passes it to each pill.
- Updated `apps/moderator/src/graph/GraphCanvasPane.tsx` — `projectNodes` now calls `projectVotesByFacet(events)` alongside the existing axiom-mark / facet-status / annotation projections and attaches the per-node bucket via `Object.fromEntries(perNodeVotes)` to the node's `data.votesByFacet`.
- New i18n catalog entries in all three v1 catalogs (en-US: "Participant {participantId} voted {choice}" + agree/dispute/withdraw; pt-BR: "Participante {participantId} votou {choice}" + concordou/contestou/retirou; es-419: "Participante {participantId} votó {choice}" + concordó/impugnó/retiró). Used the flat shape `methodology.voteIndicator.label` + `methodology.voteIndicatorChoice.<arm>` so the round-trip test in `packages/i18n-catalogs/src/methodology.test.ts` picks them up via `METHODOLOGY_VALUES` extension. Catalog parity green (131 keys across all three).
- New `apps/moderator/src/graph/VoteIndicator.test.tsx` — 15 cases: seam-attribute stamping (3); per-choice fill class (3); per-participant outer-ring class deterministic + distinct-buckets (2); base structural classes (2); cross-locale aria-label resolution (5).
- Extended `apps/moderator/src/graph/FacetPill.test.tsx` — added a vote-indicator describe block with 4 cases (empty votes → no row; one vote → one indicator; mixed agree/dispute/withdraw → three indicators with distinct seams; pill border / ring classes unchanged with votes present). Total file went from 20 to 24 cases.
- Extended `apps/moderator/src/graph/StatementNode.test.tsx` — added a `mod_vote_indicators_on_graph` describe block with 5 cases (empty `votesByFacet` → no rows; one wording vote → one indicator inside wording pill; two-facet votes → one indicator per pill; mixed agree+dispute → two distinct-choice indicators on the same pill; withdrawn vote → gray `bg-slate-400` fill + `data-choice="withdraw"`). Total file: 70 cases (was 65).
- Extended `apps/moderator/src/graph/selectors.test.ts` — added a `projectVotesByFacet` describe block with 9 cases (empty log; single agree; latest-wins on repeat; first-vote arrival-order preserved across two participants + arm switch; two facets on one node; two distinct nodes; unknown proposal silently dropped; edge proposal silently dropped; withdraw arm recorded). Total file: 45 cases (was 36).
- Updated `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — the projectNodes baseline assertion now includes `votesByFacet: {}` in the expected `data` shape (one test, two `toEqual` assertions).
- Updated `tasks/30-moderator-ui.tji` — added `complete 100` and `note "Refinement: …"` to the `mod_vote_indicators_on_graph` task block.
- `pnpm run check` — green.
- `pnpm run test:smoke` — 2259 passed (was 2178 + 8 unrelated server failures still failing; pre-existing dist/index.html missing issue from the predecessor task, not introduced here). The moderator-side test count delta: +30 cases (15 VoteIndicator + 9 selectors + 5 StatementNode + 4 FacetPill — the i18n round-trip caught the new keys for +9 / 3 locales × 3 keys, taking methodology.test from 100 to 109).
- `pnpm -F @a-conversa/moderator build` — green, 540.67 kB / gzip 168.27 kB (small bump from the new VoteIndicator component + selector helpers).
- `pnpm --filter @a-conversa/i18n-catalogs run check` — parity green, 131 keys across all three locales.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` — silent.

Downstream consumers — `mod_vote_indicators_in_sidebar` (the next dependent task in `30-moderator-ui.tji` line 235) and any future Playwright test selecting on `[data-vote-indicator][data-participant-id="<uuid>"][data-choice="<arm>"]` — now have the per-participant vote-by-facet projection and the indicator component as a reusable seam. The same `axiomMarkColorFor` per-participant deterministic palette is shared between the axiom-mark badges (rounded-square, A glyph) and the vote-indicator dots (small circle, choice-fill) so the same participant reads visually consistent across both decoration families on the canvas.
