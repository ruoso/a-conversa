# Chromatic axiom-mark badge row in the participant entity detail panel

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_entity_detail_panel_chromatic_axiom_mark_badge`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_entity_detail_panel` (settled — commit `728f8d1`, 2026-05-17. Shipped the read-only right-sidebar `<EntityDetailPanel>` at [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1). Section 4 — the axiom-mark attribution row — landed as a **textual comma-separated screen-name list** ("alice, ben") under the bucketed `nodeAxiomMarkIndex: ReadonlyMap<string, readonly AxiomMark[]>` reader at [`EntityDetailPanel.tsx:517-547`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L517). The textual surface was deliberately the v0 polish-deferred choice — per that refinement's Decision §6 ("Sub-decision: the per-participant axiom-mark attribution row uses textual comma-separated screen names … NOT the moderator's per-participant chromatic badge … the textual surface is sub-day work; the chromatic surface would consume a meaningful chunk of the 1d budget"). The same Status block registered THIS leaf in the orchestrator's debt registry as the discharge path: "moderator-style per-participant chromatic badge replacing the v0 comma-separated screen-name list, ~0.5d."
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_facet_pill` (settled — commit landed 2026-05-17 immediately after `part_entity_detail_panel`. Lifted `<FacetPill>` + `PILL_*_CLASSNAME` + `<VoteIndicator>` + `axiomMarkColorFor` + `AXIOM_MARK_PALETTE` + `AxiomMarkColor` + `Vote` + `EMPTY_VOTES` from the moderator workspace into `@a-conversa/shell` at [`packages/shell/src/facet-pill/`](../../../packages/shell/src/facet-pill/index.ts#L1) and **closed the participant → moderator workspace edge** the predecessor leaf had opened. The participant workspace no longer depends on `@a-conversa/moderator`; `axiomMarkColorFor` + `AxiomMarkColor` are reachable directly from `@a-conversa/shell`. This is load-bearing for THIS leaf: the chromatic palette + the deterministic per-participant hash are already shell-exported, so the badge surface can lift the same color vocabulary without reopening the freshly-paid debt — see Decision §1).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_axiom_mark_decoration` (settled — established the per-participant axiom-mark projection `projectAxiomMarks` + `groupAxiomMarksByNode` + `AxiomMark` at [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts#L1). That refinement's Decision §1 split the surfaces deliberately: boolean `isAxiom` overlay at the at-a-glance card layer; per-participant chromatic identity in the React-driven detail panel. The participant's `axiomMarks.ts:28-37` block-comment makes the policy explicit: "the per-participant chromatic identity is owned by the future `part_entity_detail_panel` React surface, which can import the moderator's `AxiomMarkBadge` directly when it lands. Leaving the palette out keeps the participant workspace's surface area minimal and the per-participant attribution work concentrated in one place." THIS leaf is that promised concentration point — but rather than importing the moderator's badge (the predecessor's deferred-state language), it composes the shell-exported `axiomMarkColorFor` into a participant-local badge per Decision §1.b).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_session_join.part_lobby_view` + `participant_ui.part_graph_view.part_entity_detail_panel`'s `participantRoster.ts` (settled — established the `Map<userId, screenName>` resolver at [`apps/participant/src/detail/participantRoster.ts`](../../../apps/participant/src/detail/participantRoster.ts#L1) the badge's per-participant tooltip + sr-label consume verbatim).

## What this task is

Swap the participant detail panel's **textual comma-separated screen-name list** for the axiom-mark attribution row (Section 4 of the panel) for a **moderator-style per-participant chromatic badge row** that uses the shell-exported `axiomMarkColorFor` palette to render one colored "A" badge per participant whose axiom-mark touches the selected node. The badges sit in a horizontal flex row; each badge's `title` + `aria-label` carry the participant's resolved screen name; the per-participant deterministic color hash is the same one the moderator's canvas-side `<AxiomMarkBadge>` already paints — so a debater glancing at the same participant's mark across multiple nodes sees the same color, and a moderator and a debater looking at the same session see consistent per-participant identity across surfaces.

Before this leaf: the panel renders Section 4 as
```jsx
<section data-testid="participant-detail-panel-axiom-marks">
  <h3>Bedrock for</h3>
  <p data-testid="participant-detail-panel-axiom-mark-attribution">alice, ben</p>
</section>
```
([`apps/participant/src/detail/EntityDetailPanel.tsx:534-546`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L534)).

After this leaf: the panel renders Section 4 as a flex row of chromatic badges, one per unique participant attribution:
```jsx
<section data-testid="participant-detail-panel-axiom-marks">
  <h3>Bedrock for</h3>
  <div
    data-testid="participant-detail-panel-axiom-mark-attribution"
    className="flex flex-wrap items-center gap-1"
  >
    <span
      data-testid={`participant-detail-panel-axiom-mark-badge-${participantId}`}
      data-participant-id={participantId}
      title="alice"
      aria-label={t('participant.detailPanel.axiomMarkBadge.srLabel', { screenName: 'alice' })}
      role="img"
      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm ${color.bg} ${color.text} ring-1 ${color.ring} text-[11px] font-semibold leading-none`}
    >
      A
    </span>
    {/* ...one badge per de-duplicated participantId... */}
  </div>
</section>
```

The container test-id (`participant-detail-panel-axiom-mark-attribution`) is preserved verbatim — it shifts from a `<p>` element carrying the joined names to a `<div>` container carrying the per-badge children. This deliberate seam-stability means the predecessor's component-level Vitest case `(g)` ([`EntityDetailPanel.test.tsx:415-442`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L415)) — which asserts `attribution.textContent === 'alice, ben'` — must be revised in this leaf (the container's textContent now resolves to `'AA'`, one glyph per badge), but the test-id targeting itself stays valid for future readers + future Playwright assertions.

Concretely the deliverable is:

- A new `apps/participant/src/detail/AxiomMarkBadge.tsx` — small React component receiving `{ participantId, screenName }` and rendering a chromatic span using `axiomMarkColorFor(participantId)` from `@a-conversa/shell`. The component is **a participant-local re-port** of the moderator's [`apps/moderator/src/graph/AxiomMarkBadge.tsx:38-79`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx#L38) — same DOM shape (rounded-square, centered "A", chromatic class triple), but the prop signature takes a resolved `screenName: string` instead of relying on a future moderator-side participants projection (the participant has the roster locally — Decision §1.b). Mem-wrapped with `memo` per the moderator precedent.
- A modified `apps/participant/src/detail/EntityDetailPanel.tsx` — the `AxiomMarkAttributionSection` function ([lines 517-547](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L517)) rewrites the body of the section: same dedup-by-`participantId` walk as today, but instead of pushing names into a `string[]` and joining them, push `{ participantId, screenName }` records into a `BadgeAttribution[]` and render one `<AxiomMarkBadge>` per record. The function signature widens by nothing (it already takes `marks: readonly AxiomMark[]` + `roster: ReadonlyMap<string, string>`).
- A modified `apps/participant/src/detail/EntityDetailPanel.test.tsx` — Vitest case `(g)` ([lines 415-442](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L415)) is revised to assert (i) one badge per de-duplicated `participantId` carrying the right `data-participant-id` + the right `data-testid="participant-detail-panel-axiom-mark-badge-<id>"` + the chromatic class triple from `axiomMarkColorFor(participantId)` + the `title` containing the screen name, and (ii) the badge for the **same `participantId`** carries the **same chromatic classes across two different nodes / re-renders** — pinning the determinism contract that the per-participant identity is the same color everywhere. Case `(g-bis)` ([lines 444-451](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L444)) stays unchanged — the omission of the entire section when the bucket is empty still holds.
- A new `apps/participant/src/detail/AxiomMarkBadge.test.tsx` — Vitest cases (~5) for the badge primitive in isolation: (a) renders a span with `data-participant-id={participantId}` + `data-testid="participant-detail-panel-axiom-mark-badge-<id>"`; (b) applies the chromatic class triple matching `axiomMarkColorFor(participantId)` for several different ids (covering at least two distinct palette buckets to pin the hash-determinism contract); (c) the `title` attribute is the passed `screenName`; (d) the `aria-label` resolves through `t('participant.detailPanel.axiomMarkBadge.srLabel', { screenName })`; (e) renders the centered "A" glyph as text content.
- A modified `apps/participant/src/detail/index.ts` — barrel re-exports `AxiomMarkBadge` for completeness (matches the existing per-helper re-export discipline at [`apps/participant/src/detail/index.ts:1`](../../../apps/participant/src/detail/index.ts#L1)).
- Two new i18n key clusters in [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json): `participant.detailPanel.axiomMarkBadge.tooltip` (e.g. ICU `{screenName}` — used in `title` for hover; intentionally just the screen name today, no preamble, mirroring the canvas-dot tooltips' minimal style) and `participant.detailPanel.axiomMarkBadge.srLabel` (e.g. "Bedrock by {screenName}" — used in `aria-label` for screen readers). 2 keys × 3 locales = 6 new entries. The moderator's own `methodology.axiomMark.tooltip` / `srLabel` keys are NOT reused (Decision §2) — those still substitute `{participantId}` (the moderator doesn't yet have the participants projection); the participant-side keys substitute `{screenName}` because the participant DOES.
- A modified `tests/e2e/participant-graph-render.spec.ts` block 10 ([line 2553](../../../tests/e2e/participant-graph-render.spec.ts#L2553) — `henry + grace`, block-4 role-swap) — extend the existing seed pattern with a third seeded event pair: an `axiom-mark` proposal targeting `NODE_A` (from grace's `GRACE_USER_ID` as the actor — so the badge's per-participant color matches `axiomMarkColorFor(GRACE_USER_ID)`) plus the matching `commit` envelope so the axiom-mark actually lands in the projection. The assertions extend to: (i) before the tap, the Section 4 testid is absent (no node selected); (ii) after the tap on `NODE_A`, the Section 4 testid is present AND the container has at least one `[data-testid^="participant-detail-panel-axiom-mark-badge-"]` child; (iii) the child's `data-participant-id` matches `GRACE_USER_ID`; (iv) the child's `title` contains "grace" (per the roster resolve from the seeded `participant-joined` event). The block-10 inheritance is consistent with the per-block panel-targeting pattern already established (block 10 is the panel-rendering block).

### Scope bounded by 0.5d budget

Per the orchestrator brief: 0.5d is a polish leaf. Scope cut-offs explicitly registered as Decisions, NOT silently dropped:

- **In scope (ships in this leaf)**: participant-local `<AxiomMarkBadge>` (Decision §1.b); panel-section rewrite swapping the `<p>` for the badge row; 6 new i18n entries; Vitest revisions + new badge tests; one extended Playwright block-10 assertion pair.
- **Out of scope (deferred to dedicated leaves)**:
  - **Lifting `<AxiomMarkBadge>` into `@a-conversa/shell`** — the deferred-until-third-caller policy [`extract_facet_pill`](../shell-package/extract_facet_pill.md) just discharged for `<FacetPill>` applies here too. The moderator is the first caller (its own canvas-side `apps/moderator/src/graph/AxiomMarkBadge.tsx` and `StatementNode.tsx`); the participant becomes the second caller (this leaf); the audience surface (`audience.aud_graph_rendering.*` once it lands) is the prospective third caller — at that point a sibling `shell_package.extract_axiom_mark_badge` leaf lifts the badge into shell with the same mechanical move `extract_facet_pill` carried out. Named-future-task: `shell_package.extract_axiom_mark_badge` (~0.5d, gated on the audience surface adding the third call site; closer registers in WBS).
  - **Per-vote / per-annotation chromatic identity surfaces** — only the axiom-mark attribution row swaps in this leaf. The annotation list (Section 5 of the panel) still surfaces author screen names as plain text; the other-voters table (Section 8) still surfaces voter screen names as plain text. The chromatic palette is methodology-load-bearing for axiom-marks (per `mod_axiom_mark_decoration` Decision §1 — same color across surfaces / nodes for the same participant); it is NOT methodology-load-bearing for annotation authorship or vote casting (those surfaces show identity but the cross-node consistency property doesn't carry the same weight). If a future leaf wants per-participant chromatic identity on the other rows, a separate refinement scopes it; this leaf does NOT preempt.
  - **Animation / transition on chromatic-vs-textual transition** — pure DOM swap; the badges appear as the panel mounts. No fade-in / no morph from text.
  - **Per-badge hover popover** — `title` (native browser tooltip) + `aria-label` are sufficient for the v0 surface; a richer per-badge popover (e.g. "alice marked this as bedrock at 2026-05-15 14:30") is a future polish leaf if real usage shows the tooltip insufficient. Decision §3.

## Why it needs to be done

The methodology layer treats axiom-marks as **per-participant bedrock dispositions** (`docs/methodology.md` §"Axioms / terminal values") — a node may carry multiple marks from different participants, each separately load-bearing for the agreement loop. The moderator surface ([`apps/moderator/src/graph/AxiomMarkBadge.tsx`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx#L1)) renders that per-participant identity chromatically: one colored badge per participant, the color deterministically hashed from the participant UUID so the same participant's mark appears in the same color across every node they've marked, across every render, and (the cross-surface property) across every surface that paints axiom-marks. The same-color-everywhere property is what the methodology surface uses to support claims like "alice has marked four nodes as bedrock — see the four sky-blue badges across the graph"; without it, a debater scanning the canvas (or the panel) cannot trace per-participant disposition patterns without manually matching screen names row-by-row.

The participant's v0 textual list ("Bedrock for: alice, ben") satisfies the **identity-knowable** part of the requirement — the debater knows WHO marked the node — but loses the **cross-node visual coherence** the moderator's surface gives. A debater who sees alice's name in the panel for one node and ben's name for another node can derive "two different participants marked these two nodes", but cannot recognize "the participant who marked NODE_A is the SAME participant who marked NODE_X" without re-checking the name. The chromatic badge restores that property: across two different selections in the panel, alice's badge stays sky-blue, ben's stays amber, and the debater's pattern-recognition kicks in.

Architecturally the deferred-state language from the predecessor refinement plus the `axiomMarks.ts` block-comment plus the methodology doc all point at the same future surface: a chromatic per-participant badge in the React-driven detail panel. `extract_facet_pill` paid down the cross-workspace dep that would have made the original "import the moderator's `<AxiomMarkBadge>` directly" path awkward; now `axiomMarkColorFor` is shell-exported and a participant-local re-port costs ~30 lines. The deferral was always sized for this leaf; the budget is here; the dependency surface is clean.

Downstream concretely:

- **`audience.aud_graph_rendering.*`** (future) inherits the same per-participant chromatic vocabulary. The audience surface's per-entity rendering (if it gets a detail-panel equivalent) reads `axiomMarkColorFor` from shell too. At that point the third caller materializes and `shell_package.extract_axiom_mark_badge` lifts the participant + moderator implementations into one shell-exported component.
- **`part_axiom_mark_from_tablet.*`** (future leaf, currently in the WBS only as named placeholders) attaches an "axiom-mark this node" action to the panel's identity header. The chromatic badge row from THIS leaf is the natural visual confirmation surface — when the future leaf lets the debater axiom-mark a node, the new badge appears in the panel's row using the same `axiomMarkColorFor(currentParticipantId)` color.

## Inputs / context

### ADRs

- [ADR 0003 — Frontend framework: React](../../../docs/adr/0003-frontend-framework-react.md) — `<AxiomMarkBadge>` is a memo'd React component, same pattern as every other participant + moderator UI primitive.
- [ADR 0005 — Styling: Tailwind](../../../docs/adr/0005-styling-tailwind-css.md) — the badge's color is a Tailwind class triple from the shell-exported `AxiomMarkColor` palette (`bg-sky-500`, `text-white`, `ring-sky-200`, etc.). The Tailwind v4 source autodiscovery picked up by `extract_facet_pill` already covers `packages/shell/src/facet-pill/participant-color.ts`; the new participant-side badge component lives in `apps/participant/src/` which is the app's own Tailwind source root.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behaviour pinned by a committed Vitest case + extended Playwright assertion. Failing-first verification per the predecessor leaves' pattern; see Acceptance criteria.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — 2 new participant-only i18n keys × 3 locales = 6 entries; `useTranslation()` is the resolution seam.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the participant workspace owns its rendered surface; no shell-extraction in this leaf (Decision §1; deferred-until-third-caller policy applies).
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — axiom-marks are entity-layer (per-node disposition, not per-facet). The badge sits in the panel's Section 4 (axiom-mark attribution), strictly separate from Section 3 (per-facet pill row).

No new ADR needed. The architectural seams (React framework, Tailwind palette, shell-package shape, shell-vs-app extraction policy) are all settled; this leaf applies them.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](part_entity_detail_panel.md) — **the source of this leaf's deferral.** Decision §6 settled the v0 textual surface vs the future chromatic surface split: "the chromatic badge is the eventual surface; for v0 the textual surface satisfies the methodology requirement … The future polish leaf can swap the textual surface for the chromatic badge without re-shaping the data flow." That data-flow guarantee holds in this leaf: the `marks: readonly AxiomMark[]` prop signature on `<AxiomMarkAttributionSection>` is unchanged; only the render body swaps.
- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md) — established the per-participant axiom-mark projection + the deliberate "boolean overlay at canvas; per-participant chromatic identity in the panel" surface split (Decision §1). The `axiomMarks.ts:28-37` block-comment cites THIS leaf as the discharge: "the per-participant chromatic identity is owned by the future `part_entity_detail_panel` React surface … the moderator's `AxiomMarkBadge` directly when it lands."
- [`tasks/refinements/shell-package/extract_facet_pill.md`](../shell-package/extract_facet_pill.md) — **the precedent for the chromatic palette's home.** Lifted `axiomMarkColorFor` + `AXIOM_MARK_PALETTE` + `AxiomMarkColor` from the moderator into `@a-conversa/shell` (Decision §3 of that leaf), exactly so that any future per-participant chromatic surface can compose the palette without crossing workspace boundaries. THIS leaf consumes that extraction.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](../moderator-ui/mod_axiom_mark_decoration.md) — established `<AxiomMarkBadge>` on the moderator (canvas-side per-node row). Its Decision on the deterministic hash-based color (preferred over per-session assignment so the color is stable across sessions / re-renders / surfaces) carries over verbatim — the participant-side badge uses the same `axiomMarkColorFor` function and gets the same property for free.

### Live code the leaf plugs into

- [`apps/participant/src/detail/EntityDetailPanel.tsx:517-547`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L517) — the `AxiomMarkAttributionSection` function. Body rewrite per Decision §1.b. The prop signature is unchanged. The dedup-by-participantId walk (lines 527-533) is unchanged — it just feeds a `BadgeAttribution[]` instead of a `string[]`.
- [`apps/participant/src/detail/EntityDetailPanel.test.tsx:414-451`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L414) — the existing two cases. Case `(g)` is revised; case `(g-bis)` is unchanged. The renderPanel + `useSelectionStore` + seeded events fixture pattern is reused verbatim.
- [`apps/moderator/src/graph/AxiomMarkBadge.tsx:38-79`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx#L38) — the moderator's badge primitive. Read-only reference; **NOT imported** from the participant per Decision §1.b. The participant-local re-port follows the same DOM shape verbatim: same `inline-flex h-5 w-5 items-center justify-center rounded-sm` baseline, same `text-[11px] font-semibold leading-none` typography, same chromatic `${color.bg} ${color.text} ring-1 ${color.ring}` triple, same centered "A" glyph, same `role="img"`. The only divergence is the prop shape: the moderator takes `{ mark: AxiomMark }` and reads `participantId` from the mark; the participant-local re-port takes `{ participantId, screenName }` so the per-badge tooltip resolves through the locally-available roster (the moderator can't, today — the moderator's tooltip carries the raw UUID per [`AxiomMarkBadge.tsx:33-36`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx#L33) block-comment).
- [`packages/shell/src/facet-pill/participant-color.ts:30-105`](../../../packages/shell/src/facet-pill/participant-color.ts#L30) — `AxiomMarkColor` interface + `axiomMarkColorFor(participantId): AxiomMarkColor` function. Both re-exported via [`packages/shell/src/index.ts:84-94`](../../../packages/shell/src/index.ts#L84) at the names `axiomMarkColorFor` + `AxiomMarkColor`. The participant-local badge imports both as `import { axiomMarkColorFor, type AxiomMarkColor } from '@a-conversa/shell';`.
- [`apps/participant/src/detail/participantRoster.ts`](../../../apps/participant/src/detail/participantRoster.ts#L1) — `participantRosterFrom` + `screenNameFor` + `EMPTY_PARTICIPANT_ROSTER`. The panel already calls `screenNameFor(props.roster, mark.participantId)` at line 532; this leaf widens the use: each badge gets the resolved screen name passed as a prop.
- [`apps/participant/src/graph/axiomMarks.ts:54-58`](../../../apps/participant/src/graph/axiomMarks.ts#L54) — the `AxiomMark` projection interface (`{ nodeId, participantId, committedAt }`). The badge reads `participantId` only; `nodeId` and `committedAt` are consumed elsewhere in the panel.
- [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the catalog files. Adds the two new `participant.detailPanel.axiomMarkBadge.*` keys.
- [`tests/e2e/participant-graph-render.spec.ts:2553-2899`](../../../tests/e2e/participant-graph-render.spec.ts#L2553) — block 10 (henry + grace). The seed body is extended with an `axiom-mark` proposal + commit pair; the assertions block is extended with the per-badge testid + `data-participant-id` + `title` assertions.

### What the surface MUST NOT do

- **No re-introduction of the participant → moderator workspace dependency.** `extract_facet_pill` just closed it. The chromatic palette is reachable via `@a-conversa/shell` directly; no cross-app import is needed.
- **No mutation of `AxiomMark` or `participantRoster.ts` shapes.** Both are consumed read-only.
- **No new `peerDependencies` on `packages/shell/`.** This leaf doesn't touch the shell — it consumes existing exports.
- **No widening of `apps/participant/src/graph/axiomMarks.ts`.** The badge doesn't need anything beyond `participantId`; the projection's three-field shape stays.
- **No animation on the badge appear/disappear cycle.** Pure DOM render; CSS transitions are a future polish leaf if real usage shows the abrupt swap unpleasant.
- **No write paths.** The badge is read-only — `aria-label` is informational, `title` is informational, no `onClick` or `onContextMenu` on the badge or its container.
- **No change to the moderator-side `<AxiomMarkBadge>`.** Decision §1.b reimplements participant-local. The moderator's canvas-side badge stays as-is; its eventual lift into shell (alongside the participant re-port) is the named-future-task `shell_package.extract_axiom_mark_badge` once the audience surface lands.
- **No widening of the section testid coverage beyond the per-badge testid family.** The existing `data-testid="participant-detail-panel-axiom-marks"` (section) and `data-testid="participant-detail-panel-axiom-mark-attribution"` (container) testids are preserved verbatim — they keep their position in the test-id graph; only the container's element type + children change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/detail/AxiomMarkBadge.tsx` — NEW. The participant-local badge. Component shape:
  ```typescript
  export interface AxiomMarkBadgeProps {
    readonly participantId: string;
    readonly screenName: string;
  }
  export const AxiomMarkBadge: React.MemoExoticComponent<(props: AxiomMarkBadgeProps) => ReactElement>;
  ```
  Reads `axiomMarkColorFor(participantId)` from `@a-conversa/shell`; resolves `t('participant.detailPanel.axiomMarkBadge.srLabel', { screenName })` for the `aria-label`; sets `title={screenName}` directly (the tooltip key resolves through `t('participant.detailPanel.axiomMarkBadge.tooltip', { screenName })` when ICU substitution is needed, but the v0 form is just `{screenName}` so the raw screen name suffices — Decision §3 / §4). Stamps `data-testid={`participant-detail-panel-axiom-mark-badge-${participantId}`}` + `data-participant-id={participantId}` + `role="img"` + the chromatic class triple. Renders the centered "A" glyph as its only child text.
- `apps/participant/src/detail/AxiomMarkBadge.test.tsx` — NEW. ~5 Vitest cases per the deliverable sketch.
- `apps/participant/src/detail/EntityDetailPanel.tsx` — modified. Body of `AxiomMarkAttributionSection` (lines 521-547) rewritten per the deliverable sketch + Decision §1.b. The dedup-by-participantId walk (lines 527-533) becomes a walk over `BadgeAttribution[]`:
  ```typescript
  type BadgeAttribution = { participantId: string; screenName: string };
  const seen = new Set<string>();
  const attributions: BadgeAttribution[] = [];
  for (const mark of props.marks) {
    if (seen.has(mark.participantId)) continue;
    seen.add(mark.participantId);
    attributions.push({
      participantId: mark.participantId,
      screenName: screenNameFor(props.roster, mark.participantId),
    });
  }
  ```
  The render body swaps the `<p>...{names.join(', ')}</p>` for the flex `<div>` of `<AxiomMarkBadge>` children. The section's outer `<h3>` heading + the section-omission branch (line 522 `if (props.marks.length === 0) return null;`) are unchanged.
- `apps/participant/src/detail/EntityDetailPanel.test.tsx` — modified. Case `(g)` rewritten:
  - Assert the container `participant-detail-panel-axiom-mark-attribution` has at least 2 children matching `[data-testid^="participant-detail-panel-axiom-mark-badge-"]`.
  - Assert one child has `data-participant-id={ALICE_ID}` AND its `title === 'alice'` AND its className contains `axiomMarkColorFor(ALICE_ID).bg`.
  - Assert one child has `data-participant-id={BEN_ID}` AND its `title === 'ben'` AND its className contains `axiomMarkColorFor(BEN_ID).bg`.
  - Add a (g.2) supplementary case: rendering the panel with two different node selections (NODE_A and NODE_X) that both carry an `AxiomMark` for `ALICE_ID` produces the **same** chromatic class on each — pinning the cross-node determinism contract.
  - Case `(g-bis)` is unchanged (the empty-bucket section-omission).
- `apps/participant/src/detail/index.ts` — modified. Add `export { AxiomMarkBadge, type AxiomMarkBadgeProps } from './AxiomMarkBadge';` alongside the existing re-exports.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Add `participant.detailPanel.axiomMarkBadge.tooltip` (e.g. `"{screenName}"`) + `.srLabel` (e.g. `"Bedrock by {screenName}"`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same two keys, Portuguese values (e.g. tooltip `"{screenName}"`, srLabel `"Pedra fundamental de {screenName}"`).
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same two keys, Spanish values (e.g. tooltip `"{screenName}"`, srLabel `"Fundamento de {screenName}"`).
- `packages/i18n-catalogs/src/catalogs.test.ts` — modified ONLY IF the cross-locale parity test asserts a key inventory directly. The two new keys land symmetrically in all 3 locales; usually no test-logic change.
- `tests/e2e/participant-graph-render.spec.ts` — modified. Block 10 ([line 2553](../../../tests/e2e/participant-graph-render.spec.ts#L2553)) extended per the deliverable sketch: seed an `axiom-mark` proposal targeting `NODE_A_ID` from `GRACE_USER_ID` plus the matching `commit` envelope; assert the per-badge testid + `data-participant-id` + `title` matchers after the tap on `NODE_A`. The block's role-swap-pair (henry + grace), the `freshContext` discipline, and the per-block-isolated session id all stay verbatim.

### Files this task does NOT touch

- `apps/moderator/src/graph/AxiomMarkBadge.tsx` — unchanged. Moderator-side surface stays; lift-to-shell is deferred to `shell_package.extract_axiom_mark_badge`.
- `apps/participant/src/graph/axiomMarks.ts` — unchanged. The projection shape (`AxiomMark`) carries everything the badge needs (`participantId`).
- `apps/participant/src/detail/participantRoster.ts`, `lookupEntity.ts`, `ParticipantVoteButtons.tsx` — unchanged.
- `apps/participant/src/graph/GraphView.tsx`, `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The detail panel's data flow is preserved.
- `packages/shell/` — unchanged. `axiomMarkColorFor` + `AxiomMarkColor` are already exported.
- `apps/audience/`, `apps/server/`, `apps/root/` — unchanged.
- `docs/adr/` — no new ADR.
- `.tji` files — `complete 100` on `part_entity_detail_panel_chromatic_axiom_mark_badge` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script the CI already runs — no throwaway probes.

- `apps/participant/src/detail/AxiomMarkBadge.tsx` exists, exports `AxiomMarkBadge` + `AxiomMarkBadgeProps` per the prop signature; renders a span with the chromatic class triple from `axiomMarkColorFor(participantId)`, the `title` containing the passed `screenName`, the `aria-label` resolving through `participant.detailPanel.axiomMarkBadge.srLabel`, and the centered "A" glyph.
- `apps/participant/src/detail/AxiomMarkBadge.test.tsx` exists, with ~5 Vitest cases pinning (a) testid + data-participant-id, (b) chromatic class triple matching `axiomMarkColorFor` for ≥2 distinct ids covering ≥2 palette buckets, (c) title=screenName, (d) aria-label resolves through i18n, (e) "A" glyph rendered.
- `apps/participant/src/detail/EntityDetailPanel.tsx` `AxiomMarkAttributionSection` renders a flex row of `<AxiomMarkBadge>` children instead of a joined-name `<p>`. The container testid + the section testid are preserved.
- `apps/participant/src/detail/EntityDetailPanel.test.tsx` case `(g)` is rewritten per the sketch; supplementary case `(g.2)` pins the cross-render color-determinism contract; case `(g-bis)` is unchanged.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry the two new `participant.detailPanel.axiomMarkBadge.{tooltip,srLabel}` keys symmetrically across all 3 locales; the existing `packages/i18n-catalogs/src/catalogs.test.ts` cross-locale parity test stays green.
- `tests/e2e/participant-graph-render.spec.ts` block 10 (henry + grace, [line 2553](../../../tests/e2e/participant-graph-render.spec.ts#L2553)) is extended per the deliverable sketch: axiom-mark proposal + commit seed events, per-badge testid + data-participant-id + title assertions after the tap on `NODE_A`.
- **Failing-first verification per ADR 0022**: short-circuiting `<AxiomMarkBadge>` to render an unclassed `<span>{participantId}</span>` (no chromatic classes, no testid prefix, no glyph) flips at least 4 of the 5 badge-component Vitest cases red AND the rewritten Vitest case `(g)` + supplementary `(g.2)` red AND the new Playwright per-badge `data-participant-id` + chromatic-class assertions red. Document the verification in the Status block.
- `pnpm run check` clean (lint + format + typecheck + tools + tests across all workspaces).
- `pnpm run test:smoke` green; Vitest count rises by the new cases (~5 badge component + ~1 supplementary EntityDetailPanel case = +6; case `(g)` is rewritten, not added — net Vitest delta +6).
- `pnpm -F @a-conversa/participant build` succeeds. Bundle grows by ~30 lines of badge component source (negligible).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended block 10 and it passes; chromium-participant-skeleton wall-clock grows by <1s for the added axiom-mark seed pair + assertions.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_entity_detail_panel_chromatic_axiom_mark_badge` in the same commit (the Closer's ritual). The `part_graph_view` parent grouping closes if and only if `part_entity_detail_panel_per_facet_other_voter_breakdown` is also `complete 100` at the same time (the two sibling polish leaves were registered together by `part_entity_detail_panel`'s Status block); the Closer reads the WBS state at commit time.
- Named-future-task **`shell_package.extract_axiom_mark_badge`** (~0.5d, gated on the audience surface's `aud_graph_rendering.*` third-call materialization) registered in the orchestrator's debt registry per the closer's ritual — covers lifting both the moderator's canvas-side `<AxiomMarkBadge>` AND this leaf's participant-local `<AxiomMarkBadge>` into `@a-conversa/shell` with a single mechanical move (the `extract_facet_pill` pattern).

## Decisions

### §1 — Participant-local `<AxiomMarkBadge>` re-port; do NOT lift to shell in this leaf; do NOT reopen the cross-workspace edge

The chromatic badge component could live in three places. Settled against the deferred-until-third-caller policy `extract_facet_pill` just discharged.

- **(a) Lift `<AxiomMarkBadge>` into `@a-conversa/shell` now (alongside the already-extracted `axiomMarkColorFor`).** Rejected for this leaf. The deferred-until-third-caller policy applies: the moderator is the first caller (its canvas-side `<AxiomMarkBadge>` + `<StatementNode>` row); the participant would be the second caller (this leaf); the audience surface is the prospective third caller. Extracting at two callers risks ossifying the wrong shape (the participant's prop signature includes `screenName: string` because the participant has the roster locally; the moderator's doesn't because the moderator doesn't yet have a participants projection — see Decision §2). Letting the participant ship its own re-port and waiting for the audience's third call to do the extraction means the shell-side API is shaped from three diverged-but-now-converged usage patterns. Same posture `extract_facet_pill` adopted with the dependency surface its trigger had to clear; same posture the participant `axiomMarks.ts:28-37` block-comment encoded ("two callers is YAGNI; lift when the audience surface materializes as the third caller").
- **(b) Reimplement participant-local `<AxiomMarkBadge>` in `apps/participant/src/detail/`.** **Chosen.** ~30 lines of component source (the moderator's primitive is 80 lines but ~50 of those are block-comment + i18n key resolution; the actual JSX is ~20 lines). The participant-local re-port consumes `axiomMarkColorFor` from `@a-conversa/shell` (the shell already exports it; the extraction trigger has fired for the palette but not yet for the badge component) — so the color vocabulary is shared, and the determinism contract (same participantId → same color across surfaces) holds without any cross-app coupling. The 30-line duplication cost is genuinely small and aligns with the existing per-app re-port pattern (the participant already maintains a re-port of `projectAxiomMarks` at `apps/participant/src/graph/axiomMarks.ts` for the same reason).
- **(c) Re-introduce the participant → moderator workspace edge to import the moderator's badge.** Rejected. `extract_facet_pill` JUST closed this debt; reopening it for a polish leaf is a regression of architectural posture. The participant's workspace dep graph stays clean (only `@a-conversa/shell` + `@a-conversa/shared-types` + `@a-conversa/i18n-catalogs`).

Decision §1: ship (b). Participant-local `<AxiomMarkBadge>` at `apps/participant/src/detail/AxiomMarkBadge.tsx`. When the audience surface materializes as the third caller, the named-future-task `shell_package.extract_axiom_mark_badge` lifts both the moderator's primitive AND the participant's primitive into shell with one atomic-commit move (the `extract_facet_pill` template).

### §2 — Participant-specific i18n keys (`participant.detailPanel.axiomMarkBadge.{tooltip,srLabel}`) substitute `screenName`; reuse of the moderator's `methodology.axiomMark.{tooltip,srLabel}` rejected

The moderator's `<AxiomMarkBadge>` substitutes `{participantId}` (the raw UUID) into its tooltip + sr-label per [`AxiomMarkBadge.tsx:54-58`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx#L54). The block-comment at lines 33-36 explains: "today the tooltip / `aria-label` carries the raw participant UUID. When the participants projection lands, the tooltip body swaps to the participant's screen-name." The participant has the participants projection (`participantRoster.ts`); the moderator does NOT (today). Two options:

- **(a) Reuse the moderator's `methodology.axiomMark.{tooltip,srLabel}` keys but pass `screenName` into the `{participantId}` slot.** Rejected. Semantically wrong: the key name names the slot as `participantId`; passing a screen name into it works mechanically (ICU substitution doesn't care) but is confusing for any future reader (a contributor reading the i18n catalog sees `{participantId}` and assumes a UUID will land there). The key inventory grows opaque.
- **(b) Add new participant-specific keys under `participant.detailPanel.axiomMarkBadge.*` that substitute `{screenName}` directly.** **Chosen.** Two new keys × 3 locales = 6 entries. Clear naming, no semantic drift. The moderator's keys stay unchanged (when the moderator gets the participants projection in the future, its `methodology.axiomMark.{tooltip,srLabel}` keys can be revised to `{screenName}` then — but that's a separate concern, not this leaf's scope).

Decision §2: ship (b). The catalog test will assert key presence in all 3 locales.

A sub-decision on the tooltip's content shape: the v0 tooltip is just `{screenName}` (literally the participant's screen name, no preamble like "Bedrock by"). The reason: the section's heading already says "Bedrock for" (the existing `participant.detailPanel.sectionTitle.axiomMarks` key), so the hover tooltip on each badge just needs to disambiguate "which participant is this color?". A longer "Bedrock by alice" tooltip is redundant with the heading + the sr-label. The sr-label uses the longer form because screen-reader users may navigate badge-by-badge without re-reading the heading — `aria-label="Bedrock by alice"` reads cleanly on its own.

### §3 — Native `title` + `aria-label` are the v0 disclosure surface; no per-badge popover

The moderator's canvas-side badge uses the same `title` + `aria-label` pattern. Three options:

- **(a) Native `title` (browser-rendered tooltip) + `aria-label` for screen readers.** **Chosen.** Zero-runtime-cost; works in every browser; consistent with the moderator's primitive; sufficient for the v0 surface ("who is this color?" answered in 2 seconds of hover).
- **(b) Custom popover (e.g. Radix or HeadlessUI) with richer body (screen name + committedAt + node count).** Rejected for v0. The methodology surface doesn't require a richer disclosure today; the future per-node-history surface (whenever it lands) is the natural home for a richer hover layer.
- **(c) Click-to-expand inline detail row.** Rejected. The badge row is dense (one badge per attribution); a click-to-expand affordance fights the "scan the row to read attribution" gesture the v0 design optimizes for.

Decision §3: ship (a). If real usage shows the native tooltip insufficient (e.g. accessibility audit flags the `title` attribute's screen-reader inconsistency), a future polish leaf can swap to a Radix tooltip or similar without re-shaping the per-badge data flow.

### §4 — Container test-id stays `participant-detail-panel-axiom-mark-attribution`; per-badge test-ids follow the canvas-side `axiom-mark-badge-${nodeId}-${participantId}` precedent, simplified to `participant-detail-panel-axiom-mark-badge-${participantId}`

The participant panel always shows one badge per dedup-by-participant entry, never multiple badges for the same participant within one section render (the dedup walk discards the redundant marks). So the test-id can drop the `nodeId` qualifier the moderator's canvas-side badge carries (the moderator surface renders the same participant's badge once per node they marked — the `nodeId` qualifier is load-bearing to disambiguate; the participant panel renders the same participant's badge once per section render).

- **(a) `participant-detail-panel-axiom-mark-badge-${participantId}`.** **Chosen.** Per-participant uniqueness within the section is guaranteed by the dedup walk; the test-id stays simple and selector-friendly.
- **(b) `participant-detail-panel-axiom-mark-badge-${nodeId}-${participantId}` (mirror the moderator's canvas-side test-id).** Rejected. The panel renders ONE entity at a time (the selected node); the `nodeId` qualifier is constant within the rendered section. Adding it bloats the test-id without disambiguation.
- **(c) Plain `data-participant-id` attribute on the badge with no test-id prefix.** Rejected. Test-ids are the established selector seam (every other panel testid follows the `participant-detail-panel-*` prefix); dropping the test-id family for this one component breaks the panel's selector consistency.

Decision §4: ship (a). The container test-id (`participant-detail-panel-axiom-mark-attribution`) carries the dedup-by-participant invariant; the per-badge test-id carries the participant identity.

### §5 — Container `<div>` replaces the `<p>`; container test-id is preserved despite the element type change

The v0 textual surface renders Section 4's container as `<p data-testid="participant-detail-panel-axiom-mark-attribution">alice, ben</p>`. Two options for the new container:

- **(a) Replace the `<p>` with a `<div>` carrying the same test-id.** **Chosen.** A `<p>` element semantically holds prose text (flow content); replacing its inner content with chromatic spans (a list of badges) is a structural mismatch — `<div>` with a flex layout is the right semantic container. The test-id stays so existing selectors (and any future Playwright assertion targeting the container) continue to resolve.
- **(b) Replace with a `<ul>` of `<li>` wrappers around each badge.** Rejected for v0. The badges are visual primitives, not a discrete enumerable list (no per-row affordance, no per-row navigation gesture); a flex `<div>` is structurally simpler. If a future polish leaf adds per-badge navigation (e.g. tab focus order), promoting to `<ul role="list">` is a one-line edit.
- **(c) Rename the container test-id (e.g. `participant-detail-panel-axiom-mark-row`).** Rejected. The existing test-id is consumed by the predecessor's Vitest case `(g)` — preserving it means the per-case retarget is a single assertion-body edit instead of a test-id-change-everywhere refactor. The future Playwright block 10 extension can target the same test-id without divergence from the Vitest cases.

Decision §5: ship (a). The existing testid graph stays intact; only the inner element shape + content change.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- New `apps/participant/src/detail/AxiomMarkBadge.tsx`: participant-local chromatic badge component consuming `axiomMarkColorFor` from `@a-conversa/shell`; renders centered "A" glyph with `data-testid`, `data-participant-id`, `title`, `aria-label`, and `role="img"`.
- New `apps/participant/src/detail/AxiomMarkBadge.test.tsx`: 5 Vitest cases covering (a) testid + data-participant-id, (b) chromatic class triple for ≥2 palette buckets, (c) title=screenName, (d) aria-label resolves via i18n srLabel key, (e) "A" glyph rendered.
- Modified `apps/participant/src/detail/EntityDetailPanel.tsx`: `AxiomMarkAttributionSection` body rewired — dedup walk now builds `BadgeAttribution[]` fed to a flex `<div>` of `<AxiomMarkBadge>` children; `<p>` containing comma-separated names removed; container testid preserved.
- Modified `apps/participant/src/detail/EntityDetailPanel.test.tsx`: case (g) rewritten to assert per-badge testid family + `data-participant-id` + chromatic class per participant; new supplementary case (g.2) pins cross-node color-determinism contract.
- Modified `apps/participant/src/detail/index.ts`: barrel re-exports `AxiomMarkBadge` + `AxiomMarkBadgeProps`.
- Modified `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`: 2 new keys × 3 locales — `participant.detailPanel.axiomMarkBadge.tooltip` (`{screenName}`) and `.srLabel` ("Bedrock by {screenName}" / "Pedra fundamental de {screenName}" / "Fundamento de {screenName}").
- Modified `tests/e2e/participant-graph-render.spec.ts`: block 10 (henry + grace) extended with axiom-mark proposal + commit seed events from `GRACE_USER_ID` → `NODE_A`; per-badge testid + `data-participant-id` + `title` assertions after tap on `NODE_A`.
- Tech-debt deferred: `shell_package.extract_axiom_mark_badge` (~0.5d) — lift both the moderator's and participant's `<AxiomMarkBadge>` into `@a-conversa/shell` once the audience surface adds the third call site; registered in WBS by the Closer.
