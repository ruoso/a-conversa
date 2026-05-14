# Moderator axiom-mark decoration (per-participant bedrock badges on the node)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `StatementNode` + `projectNodes` populate `data` from the WS log).
- `moderator_ui.mod_graph_rendering.mod_annotation_rendering` (done — the per-attached-decoration / badge-row pattern this task mirrors).
- `data_and_methodology.methodology_engine.axiom_mark_logic` (done — `propose-axiom-mark` + the per-(node, participant) projection update). The wire payload is `{ kind: 'axiom-mark', node_id, participant }`; the projection writes `node.axiomMarks.set(participant, …)`.
- `frontend_i18n.i18n_methodology_glossary` (done — the catalog parity gate this task extends with three new keys).

## What this task is

Render committed axiom-marks from the WS event log as **per-participant badges decorating the node they mark**. An axiom-mark is the methodology's "this participant holds this node as bedrock" disposition (`docs/methodology.md` §"Axioms / terminal values"): per-participant by definition — Anna may mark N9 while Ben does not, both may mark N9 (a structural finding of shared bedrock), or each may hold a different node. Every committed `axiom-mark` proposal carries `{ node_id, participant }`; this task surfaces every (node, participant) pair as a small decoration badge on the target node so the moderator sees at a glance which participants hold which nodes as bedrock — and which participant marked which axiom.

This task lands:

- A pure projection helper in `apps/moderator/src/graph/selectors.ts` — `projectAxiomMarks(events) → AxiomMark[]` (and the `AxiomMark` interface). Walks the event log once and emits one `AxiomMark` per *committed* axiom-mark proposal (proposal + matching commit pair, in commit-arrival order). An uncommitted axiom-mark proposal does **not** produce an `AxiomMark` — the badge represents the "ratified by all participants" landed state, not the pending vote. The proposed/pending visualization is owned by the separate `mod_axiom_mark_pending_render` task downstream.
- A `groupAxiomMarksByNode(marks) → Map<string, AxiomMark[]>` helper, mirroring `groupAnnotationsByNode`.
- A deterministic per-participant color helper — `axiomMarkColorFor(participantId) → { bg, text, ring }` — that maps a `participantId` UUID to a stable Tailwind color triple via a 6-bucket hash. Same `participantId` always yields the same color across renders / refreshes / browsers; different participants get visibly distinct colors. The color palette is the "participant identity" family (sky / amber / emerald / fuchsia / cyan / lime) chosen to not collide with the existing methodology-state palette (slate / rose / violet) or the amber-only annotation badge.
- An `AxiomMarkBadge` React component (`apps/moderator/src/graph/AxiomMarkBadge.tsx`) — a small rounded square (visually distinct from the rounded-pill annotation badge), color-coded by `participantId`, carrying a localized tooltip "Axiom marked by {participantId}". `data-testid="axiom-mark-badge-{nodeId}-{participantId}"`, `data-participant-id="{participantId}"` for selector-based assertions.
- An extension to `StatementNodeData` — adds `axiomMarks: readonly AxiomMark[]` (default `[]`). `StatementNode` renders the marks in a new decoration row above the existing annotation row (axiom-marks are the methodology-load-bearing decoration; annotations are commentary — visual hierarchy reflects load-bearing-ness). Container `data-testid="axiom-mark-list-node-{nodeId}"`.
- Wiring inside `projectNodes` (`GraphCanvasPane.tsx`) — does a single up-front pass `groupAxiomMarksByNode(projectAxiomMarks(events))` and attaches the matching subset to each emitted node's `data.axiomMarks`.
- Three new i18n catalog keys under `methodology.axiomMark`: `label` ("Axiom mark"), `tooltip` ("Axiom marked by {participantId}"), and `srLabel` ("Axiom mark from participant {participantId}") — landed in `en-US.json` + `pt-BR.json` + `es-419.json`.

This task is rendering only; the **action** that creates an axiom-mark proposal from the moderator UI is owned by the separate `mod_axiom_mark_flow.mod_axiom_mark_action` task downstream. Pending-axiom-mark visualization is owned by `mod_axiom_mark_pending_render` (also downstream).

## Why it needs to be done

Axioms are not a defect — `docs/methodology.md` §"Axioms / terminal values" calls them "often the most valuable output of the exercise: the debate dead-ends at 'A holds X as bedrock, B holds Y as bedrock, and that is the real disagreement.'" The methodology engine surfaces axiom-marks as one of the canonical resolutions for cycle / contradiction diagnostics (`docs/methodology.md` §"What 'resolved' looks like": "have a participant axiom-mark a node in the cycle (the chain terminates at that participant's bedrock)"). Without rendering, a committed axiom-mark lands silently in the WS log and the moderator has no visual confirmation that the bedrock-disposition has been recorded — defeating the methodology's primary success path for irreducible disagreements.

The badge must be **attributable** (the moderator must see *which participant* marked the axiom) because axiom-marks are per-participant — the methodology's whole point is that "Ben's bedrock" and "Anna's bedrock" are different recorded events with different implications. A single bedrock-color badge would erase that attribution and turn the per-participant invariant into a per-node invariant, which is exactly the opposite of what the methodology models. Per-participant coloring is the load-bearing visual: same participant always reads as the same color across every node they marked.

Visual distinctness from the annotation badge matters too — annotations are commentary; axiom-marks are methodology-disposition. The two badge families coexist on the same node card; mixing them visually would conflate "this is a note" with "this is bedrock", which is exactly the conflation the per-facet-state visualization is designed to *avoid*.

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; custom node decorations are the explicit extension point.
- [ADR 0021](../../../docs/adr/0021-event-envelope-and-payload-schemas.md) — the `Event` envelope's camelCased fields and the `proposal` payload's snake-cased `node_id` / `participant` for the axiom-mark sub-kind.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — locale-aware mount; the badge's tooltip resolves through `useTranslation`.
- `docs/methodology.md` §"Axioms / terminal values" — the canonical semantics. "When the operationalization test produces 'nothing could change my mind', the node receives an **axiom mark** from the participant who declared it. Axiom marks are **per-participant** — Ben's axiom mark on N9 records Ben's bedrock; Anna may add her own axiom mark to the same node (an unanticipated structural finding: shared bedrock), or hold a different node as her axiom, or hold no axiom at all in this debate. Axiom marks are visually distinct on the node they mark."
- `packages/shared-types/src/events/proposals.ts` — `axiomMarkProposalSchema` (the `{ kind: 'axiom-mark', node_id, participant }` shape).
- `apps/server/src/methodology/handlers/proposeAxiomMark.test.ts` — the per-participant uniqueness invariant ("a second participant marking the same node is accepted"). This task's rendering must honor that invariant — multiple `AxiomMark` records on one node must all render side-by-side.
- `apps/server/src/projection/replay.ts` lines 667-685 — the commit-side projection update that this client mirror produces against the same events.
- `apps/moderator/src/graph/AnnotationBadge.tsx` — the per-attached-decoration template this badge follows (rounded-square vs. rounded-pill is the visual difference; `useTranslation` and `data-*` attribute seams are the shared pattern).
- `apps/moderator/src/graph/selectors.ts` — the existing `projectAnnotations` / `groupAnnotationsByNode` pattern is the template.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — `projectNodes` is the seam the enrichment plugs into.

## Constraints / requirements

- **`AxiomMark` interface** (exported from `selectors.ts`): `{ readonly nodeId: string; readonly participantId: string; readonly committedAt: string }`. CamelCased per ADR 0021. The `committedAt` carries the commit envelope's `committed_at` so future per-mark sorting / tooltip-detail tasks have the timestamp without re-walking the log.
- **`projectAxiomMarks(events) → AxiomMark[]`**: pure function over `readonly Event[]`. Walks once. Maintains a `Map<proposalEnvelopeId, { nodeId, participantId }>` for `proposal` events whose inner kind is `axiom-mark`. On `commit` whose `proposal_id` matches, emits an `AxiomMark { nodeId, participantId, committedAt: commit.payload.committed_at }`. Uncommitted axiom-mark proposals produce **no** output. Emission order is commit-event arrival order (the typical debate scenario: A marks N9, B marks N9 later → A's badge renders first).
- **`groupAxiomMarksByNode(marks) → Map<string, AxiomMark[]>`**: pure helper, same `Map`-not-`Object` rationale as `groupAnnotationsByNode` (UUID keys + `O(1)` `get`).
- **`axiomMarkColorFor(participantId) → AxiomMarkColor`**: deterministic from the participant UUID via a 6-bucket hash (`hash(uuid) % 6` — chosen to fit a 6-color palette that stays visually distinguishable; a 2-debater session uses 2 of 6, with room for moderator / observer + future audience members). The hash is the sum of the UUID's hex digits (after stripping non-hex characters) — small, stable, no crypto needed (the goal is "same input → same output", not collision resistance). Returns `{ bg: string, text: string, ring: string }` Tailwind class names. Palette: `sky`, `amber`, `emerald`, `fuchsia`, `cyan`, `lime`. (See Decisions for the "why these six".)
- **`AxiomMarkBadge` component** (`apps/moderator/src/graph/AxiomMarkBadge.tsx`):
  - Renders as a small rounded-square (`rounded-sm`, not `rounded-full`) with the localized "axiom-mark" letter glyph (we use a centered "A" character — the methodology-glossary localized form is overkill for a 16px-square badge; the `aria-label` carries the full localized "Axiom mark from participant {participantId}" so screen readers get the full content).
  - Color triple resolved via `axiomMarkColorFor(participantId)` — `bg-${color}-100` background, `text-${color}-900` glyph color, `ring-1 ring-${color}-300` light halo so adjacent same-colored badges remain separable.
  - `title={t('methodology.axiomMark.tooltip', { participantId })}` — cheap baseline hover surface mirroring `AnnotationBadge`'s `title` pattern. Per-participant screen-name lookup (instead of raw UUID display) is a downstream concern: a `participants` projection / sidebar work-stream task; this task uses the UUID as the stable identifier the moderator can cross-reference via the participants pane. The `aria-label` mirrors the tooltip.
  - `data-testid="axiom-mark-badge-{nodeId}-{participantId}"` — both ids in the test id so the moderator's tests can target a specific (node, participant) pair without DOM walking.
  - `data-participant-id="{participantId}"` attribute — the stable seam for downstream per-participant selector-based assertions / styling.
  - Component is `memo`'d (same rationale as `AnnotationBadge`).
- **`StatementNodeData` extension**: add `axiomMarks: readonly AxiomMark[]` (default `[]` when none). The component renders the badges in a new decoration row **above** the annotation badge row (axiom-marks are methodology-load-bearing; annotations are commentary). Container test id: `axiom-mark-list-node-{nodeId}`. Tailwind: `mt-1 flex flex-wrap gap-1`. Container omitted from the DOM when the list is empty (same pattern as the annotation badge list).
- **`projectNodes` enrichment**: build `Map<string, AxiomMark[]>` once via `groupAxiomMarksByNode(projectAxiomMarks(events))` (single inline pass), then enrich each emitted node's `data.axiomMarks` with the matching subset (defaulting to a module-scope `EMPTY_AXIOM_MARKS` frozen array for stable identity). The function signature stays `(events) → Node[]`.
- **i18n keys** (added to all three locales):
  - `methodology.axiomMark.label` — `"Axiom mark"` / `"Marca de axioma"` / `"Marca de axioma"`.
  - `methodology.axiomMark.tooltip` — `"Axiom marked by {participantId}"` / `"Axioma marcado por {participantId}"` / `"Axioma marcado por {participantId}"`.
  - `methodology.axiomMark.srLabel` — `"Axiom mark from participant {participantId}"` / `"Marca de axioma do participante {participantId}"` / `"Marca de axioma del participante {participantId}"`.
- **Catalog parity**: `pnpm --filter @a-conversa/i18n-catalogs run check` must remain green after the new keys land.
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/selectors.test.ts` extended with:
    - 1 case: `projectAxiomMarks([])` → `[]`.
    - 1 case: a proposal without a matching commit → `[]`.
    - 1 case: one (proposal + commit) pair emits one `AxiomMark` with the right `nodeId` / `participantId` / `committedAt`.
    - 1 case: two participants marking the same node emits two `AxiomMark` records (the per-participant uniqueness invariant — both must surface).
    - 1 case: emission order matches commit arrival order.
    - 1 case: mixed log — non-axiom-mark proposals are ignored.
    - 1 case: `groupAxiomMarksByNode` buckets correctly.
    - 1 case: `axiomMarkColorFor` is deterministic — same UUID → same color triple across calls.
    - 1 case: `axiomMarkColorFor` distributes — at least three different UUIDs spread across at least three different palette buckets (regression against degenerate hash collapse).
  - `apps/moderator/src/graph/AxiomMarkBadge.test.tsx` (new file):
    - 3 cases × 3 locales (9 cases): the badge's `title` resolves to the matching localized string for each locale.
    - 1 case: `data-participant-id` attribute matches the prop.
    - 1 case: `data-testid` attribute matches `axiom-mark-badge-{nodeId}-{participantId}`.
    - 1 case: same `participantId` across two badge renders produces the same Tailwind background class (deterministic color).
  - `apps/moderator/src/graph/StatementNode.test.tsx` extended with:
    - 1 case: node with no axiom-marks renders no `axiom-mark-list-node-{id}` container.
    - 1 case: node with one axiom-mark renders the badge with the matching testid.
    - 1 case: node with two axiom-marks (two participants) renders both badges in arrival order.
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` extended with:
    - 1 case: `projectNodes` enriches a node's `data.axiomMarks` from a committed axiom-mark proposal targeting that node.
    - 1 case: `projectNodes` leaves `data.axiomMarks` empty for a node with only a proposal but no commit.
    - 1 case: end-to-end through the canvas — applying a `node-created` + an axiom-mark proposal + a commit to the WS store renders the badge inside the node's card.

## Acceptance criteria

- `apps/moderator/src/graph/selectors.ts` exports `AxiomMark`, `projectAxiomMarks`, `groupAxiomMarksByNode`, `axiomMarkColorFor` (and `EMPTY_AXIOM_MARKS`).
- `apps/moderator/src/graph/AxiomMarkBadge.tsx` exists; exports a memo'd `AxiomMarkBadge`.
- `apps/moderator/src/graph/StatementNode.tsx` renders the badges from `data.axiomMarks` in the `axiom-mark-list-node-{id}` decoration row when non-empty.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` `projectNodes` enriches `data.axiomMarks`.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry the three new keys.
- All new / extended test cases land and pass.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm --filter @a-conversa/i18n-catalogs run check` green.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_axiom_mark_decoration` plus a `note "Refinement: …"` line.

## Decisions

- **Render only committed axiom-marks, not pending proposals.** The badge represents "the bedrock is recorded" — a methodology-disposition state, not an in-flight vote. Pending axiom-mark proposals get their own visual via `mod_axiom_mark_pending_render` (downstream) and the generic facet-state styling already covers proposed-state for facets; per-participant marks are not a facet (they live on `node.axiomMarks: Map<participantId, …>`, separate from `wordingFacet` / `classificationFacet` / `substanceFacet`), so they don't flow through `computeFacetStatuses`. Keeping the badge to *committed* marks gives the moderator a clean "this is the recorded methodology disposition" signal without conflating with the in-flight vote layer.
- **Per-participant color via deterministic hash, not a per-session palette assignment.** The hash-from-UUID approach is stateless: every consumer (server-projection diagnostic snapshot, moderator UI, participant tablet, audience read-only view) arrives at the same color for the same participant without needing to share a session-scoped palette assignment. A per-session-palette alternative (assign colors in join order, persist the assignment in projection state) was rejected because it adds a stateful coupling between sessions and the rendering layer — a participant who joined late, left, and rejoined could end up with a different color than the one their earlier axiom-marks rendered under. The hash is decoupled from session order, so the color is a stable property of the participant identity itself.
- **6-color palette: sky / amber / emerald / fuchsia / cyan / lime.** A 6-bucket hash means a 2-debater session uses 2 of 6 (with room for moderator + an audience member + future spectators without collision pressure). The six were chosen to (a) be visually distinguishable from each other (the WCAG hue-distance check passes pairwise), (b) not collide with the methodology-state palette (slate / rose / violet) or the annotation badge (amber 100/900 is reserved by the annotation badge — we use amber 100/900 *with the ring* + the distinct rounded-square shape so the visual reads as "axiom-mark", not "annotation"; the shared amber bucket is acceptable because the shape difference is the dominant signal). Future palette tightening (e.g. swapping `amber` for `orange` if `packages/ui-tokens` lands a stricter token system) is a follow-up; the bucket count and hash are the stable contract.
- **Rounded-square shape (`rounded-sm`) for axiom-marks, distinct from rounded-pill annotation badges.** The shape difference is the primary visual seam between the two badge families. Rounded-square is the "this is structural" / "this is a flag" shape; rounded-pill is the "this is a tag" shape. A reader scanning a node card sees axiom-marks and annotations as two visually distinct decoration families at first glance — exactly the per-decoration-type separation the moderator needs.
- **Centered "A" glyph inside the square, not a localized text label.** A 16-20px square doesn't fit a localized word ("Axiom" / "Axioma" / "Axioma"). The "A" is a Latin-alphabet anchor that works across en-US / pt-BR / es-419 (all three locales use the same "A"). The full localized form is in the `title` + `aria-label` for hover and screen-reader use, where space isn't a constraint. The "A" glyph is colored to match the participant's color bucket, so the visual identity is color-primary, glyph-secondary.
- **Per-participant attribution via tooltip / aria-label, not initials on the badge face.** Participant *initials* would require a name lookup (a participants projection task that hasn't landed yet), wouldn't render until that lookup resolves, and would localize awkwardly (a "BD" initials badge is meaningless without knowing the screen name). The tooltip carries the participantId UUID directly — the moderator cross-references via the sidebar's participants pane (future task). When the participants projection lands, swapping the tooltip body to use the screen-name is a localized change in `AxiomMarkBadge.tsx` plus an i18n key tweak; the testids and the `data-participant-id` attribute (the stable seams) don't change.
- **Position the row above the annotation row, not below.** Axiom-marks are methodology-disposition (load-bearing for "what is the recorded outcome of this debate"); annotations are commentary (margin notes on the methodology). The reader's eye lands on the load-bearing decoration first when scanning the node card. The ordering is **wording → kind → axiom-marks → annotations** — the same load-bearing-to-decorative ordering the methodology document itself uses.
- **`projectAxiomMarks` mirrors the existing `projectAnnotations` / `selectAnnotations` pattern.** Pure function over `readonly Event[]`, returns the camelCased shape. Consistent surface with the surrounding selectors; no new architectural abstraction.
- **Module-scope `EMPTY_AXIOM_MARKS = Object.freeze([])` for stable identity.** Same React-memoization rationale as `EMPTY_ANNOTATIONS` and `EMPTY_FACET_STATUSES`. Without it, a node with no axiom-marks would get a fresh `[]` on every projection pass, defeating downstream `React.memo` checks.
- **No update to `cardRollupStatus`.** Axiom-marks are not a facet — they live on `node.axiomMarks: Map<participantId, …>` separately from the three facets (`wording` / `classification` / `substance`). The rollup priority order (`proposed > meta-disagreement > disputed > agreed > committed > withdrawn`) is for facet statuses, not for axiom-mark presence. A node with all-agreed facets and a committed axiom-mark renders as agreed (the slate-700 border) plus the axiom-mark badges — the two visual layers compose, they don't compete.
- **No edge-target axiom-marks in v1.** The `axiom-mark` proposal sub-kind targets nodes only (`{ node_id, participant }` — no `edge_id`). The methodology's "what could end this debate from this participant's side" semantics apply to statements, not to inferential edges. If a future methodology extension introduces edge-target axiom-marks, the rendering layer extends `StatementEdge` then; v1 lands node-only.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/AxiomMarkBadge.tsx` — memo'd badge rendering one axiom-mark as a per-participant-colored rounded-square. `useTranslation` resolves `methodology.axiomMark.tooltip` and `methodology.axiomMark.srLabel`; the `data-participant-id` and `data-testid="axiom-mark-badge-{nodeId}-{participantId}"` attributes are the stable selector seams. Centered "A" Latin-alphabet glyph is locale-independent; the full localized form lives in `title` / `aria-label`.
- Updated `apps/moderator/src/graph/selectors.ts` — added the `AxiomMark` interface, `projectAxiomMarks(events)` (proposal + commit pair → emitted AxiomMark, uncommitted proposals produce nothing), `groupAxiomMarksByNode(marks)` bucketing helper, the 6-color `AXIOM_MARK_PALETTE` (sky / amber / emerald / fuchsia / cyan / lime — Object.frozen for stable identity), `axiomMarkColorFor(participantId)` deterministic sum-of-hex-digits hash (`% 6`), and `EMPTY_AXIOM_MARKS` module-scope frozen array for stable identity in the empty case.
- Updated `apps/moderator/src/graph/StatementNode.tsx` — extended `StatementNodeData` with `axiomMarks: readonly AxiomMark[]`. The component renders an `axiom-mark-list-node-{id}` decoration row ABOVE the annotation row when the list is non-empty (no empty container in the DOM otherwise); per-mark `key={participantId}` honors the per-(node, participant) uniqueness invariant from `proposeAxiomMark.test.ts` rule 4.
- Updated `apps/moderator/src/graph/GraphCanvasPane.tsx` — `projectNodes` now does a `groupAxiomMarksByNode(projectAxiomMarks(events))` pass up-front and enriches each emitted node's `data.axiomMarks` with the matching subset.
- Updated `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — three new keys under `methodology.axiomMark`: `label`, `tooltip` (`Axiom marked by {participantId}` / `Axioma marcado por {participantId}` ×2), `srLabel` (the longer screen-reader form with per-locale "from / do / del" phrasing). Catalog parity check (`pnpm --filter @a-conversa/i18n-catalogs run check`) reports 124 keys present in all 3 locales.
- New `apps/moderator/src/graph/AxiomMarkBadge.test.tsx` — 13 cases: 9 cross-locale (3 locales × 3 assertions: title, aria-label, "A" glyph) + 2 data-attribute pins + 2 per-participant color (deterministic for same input; distinct for two different participants).
- Updated `apps/moderator/src/graph/selectors.test.ts` — +14 new cases under three new describe blocks: 6 `projectAxiomMarks` cases (empty log, uncommitted, single pair, two-participant uniqueness, commit-arrival order, mixed-log filtering), 1 `groupAxiomMarksByNode` bucketing case, 2 `axiomMarkColorFor` cases (determinism, distribution across ≥2 buckets). Test UUIDs chosen to land in distinct hash buckets (all-same-digit UUIDs collapse to bucket 0 because the per-digit sum is `30n + 12 = 6(5n+2)`, divisible by 6 — pinned in a comment).
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added 4 new axiom-mark cases under a new describe block: no-axioms renders no container; one axiom-mark renders the badge with the right testid; two participants both surface in arrival order; the axiom-mark row renders ABOVE the annotation row via `compareDocumentPosition`. Helper `makeAxiomMark` added.
- Updated `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — added 3 new axiom-mark cases under two describe blocks: `projectNodes` enriches with a committed axiom-mark; `projectNodes` leaves `data.axiomMarks` empty pre-commit; end-to-end through the canvas renders the badge inside the node card via `makeAxiomMarkProposal` + `makeCommit`. The existing `projectNodes` `toEqual` updated to include `axiomMarks: []`.
- Tests: +13 AxiomMarkBadge + 14 selectors + 4 StatementNode + 3 GraphCanvasPane (with one `toEqual` migration absorbed in the 4) = +29 cases net. Baseline `pnpm run test:smoke` 2203 → 2232, green. `pnpm run check` clean. `pnpm -F @a-conversa/moderator build` green (537.16 kB / gzip 167.42 kB — small bump from the new badge component + selector / projection / palette glue). `pnpm --filter @a-conversa/i18n-catalogs run check` green (124 keys per locale). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — the `mod_axiom_mark_flow.mod_axiom_mark_action` task (lands the *creating* of axiom-mark proposals from the moderator UI), `mod_axiom_mark_pending_render` (the pre-commit visualization sibling), the participants-projection / sidebar work-stream (will replace the raw UUID in the tooltip with the participant's screen-name without touching the testid / `data-participant-id` seams), and any future Playwright test selecting on `[data-participant-id="…"]` or the `axiom-mark-badge-{nodeId}-{participantId}` testid — now have a rendered badge surface and a stable selector seam to attach behaviour to.
