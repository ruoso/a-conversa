# Audience DOM-overlay scaffolding extraction (a behavior-preserving refactor that lifts the duplicated rAF-batched commit + Cytoscape-event subscription set + seen-Set lazy-init pattern out of the four `apps/audience/src/graph/*Overlay.tsx` siblings into a pair of audience-local hooks — `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` — that the existing overlays consume; the four overlays' rendered DOM, prop shapes, test selectors, and observable behavior remain identical)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_dom_overlay_extraction` (lines 357-362).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_animations.aud_node_appear_animation` (settled — [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md)). The direct `.tji` predecessor. Decision §2 of that refinement (verbatim copy of the predecessor's overlay shape, with the rule-of-three-or-four extraction deferred) named THIS task as the registered-future destination and is the source-of-debt for the refactor; the `.tji` `note` line at [`tasks/50-audience-and-broadcast.tji:361`](../../50-audience-and-broadcast.tji#L361) reproduces the same pointer. With the fourth duplicate of the overlay scaffolding having landed, the rule-of-three (or rather, rule-of-four) extraction trigger is now genuinely live.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). The predecessor that introduced the second instance of the seen-Set lazy-init-on-non-empty-placements pattern; Decision §4 there established the lazy-init gate that this extraction lifts verbatim into `useSeenKeysGate`.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_per_facet_visualization` (settled — [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md)). The first DOM-overlay sibling and the origin of the rAF-batched commit + three-event subscription pattern that this extraction lifts. Its Decisions §1, §4, §5 documented the original scaffolding the four current overlays each duplicate.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_axiom_mark_decoration` (settled — [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](aud_axiom_mark_decoration.md)). Second instance of the scaffolding; established that "two overlays share the same `Core` instance and each owns its own listeners" (Decision §5) — a property the extraction preserves (the hooks are per-overlay-instance, each registers its own listener set).
- Prose-only context (NOT a `.tji` edge): `audience.aud_annotation_rendering` and `audience.aud_annotation_rendering_edges` (settled — [`tasks/refinements/audience/aud_annotation_rendering.md`](aud_annotation_rendering.md), [`tasks/refinements/audience/aud_annotation_rendering_edges.md`](aud_annotation_rendering_edges.md)). Third instance of the scaffolding, and the one divergence point that shapes Decision §3 below: the annotation overlay iterates BOTH `cy.nodes()` and `cy.edges()` inside its `commit`, while the other three iterate `cy.nodes()` only. The extraction parameterizes "what to iterate" via the caller-supplied `commit` callback rather than baking a `nodes-only` iteration into the primitive (and the original "KeyedCytoscapeNodeOverlay" name from the `.tji` note is renamed to `useCytoscapeOverlayPlacements` to reflect this — Decision §3).
- Prose-only context (NOT a `.tji` edge): `aud_animations.aud_animation_pacing` and the remaining `aud_animations.*` siblings (`aud_proposed_to_agreed_animation`, `aud_decomposition_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`). These will likely add more DOM-overlay siblings consuming the scaffolding once they land — the extracted hooks are the surface they consume from day one, paying down the duplication for all future siblings at once. The `aud_animation_pacing` task's `.tji` `depends` list is unaffected by this leaf (it depends on the animation siblings whose constants it tunes, not on the structural refactor).
- Prose-only context (NOT a `.tji` edge): predecessor in-repo extractions established the codebase's extraction conventions and test discipline ([`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md), [`tasks/refinements/audience/aud_stylesheet_state_color_extraction.md`](aud_stylesheet_state_color_extraction.md), [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](../shell-package/shell_axiom_marks_extraction.md), [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md)). The cumulative posture: existing-callers' tests pass unchanged post-rewire; small dedicated test of the extracted seam pins the consolidation property; no new ADR for intra-package refactors.

## What this task is

The 1d **behavior-preserving refactor** that pays down the duplication accumulated across the four `apps/audience/src/graph/*Overlay.tsx` siblings — `<AudiencePerFacetPillOverlay>`, `<AudienceAxiomMarkOverlay>`, `<AudienceAnnotationOverlay>`, `<AudienceNodeAppearOverlay>` — into a pair of audience-local hooks under `apps/audience/src/graph/`. After this leaf the four overlay components keep their per-surface render shapes, public prop interfaces, test selectors, header comment blocks, and observable behavior; what they LOSE is the duplicated rAF-batched commit machinery, the duplicated `cy.on('render pan zoom resize') + cy.on('position', 'node') + cy.on('add remove data')` listener set, the duplicated cleanup branch, and (for the two animation siblings) the duplicated seen-Set lazy-init-on-non-empty-placements gate.

The extraction lands two hooks in a new module `apps/audience/src/graph/cytoscapeOverlayHooks.ts`:

- **`useCytoscapeOverlayPlacements<P>(cy, commit)`** — owns the rAF-batched commit + subscription lifecycle. Takes the Cytoscape `Core` handle (nullable, matching the four overlays' `cy: Core | null` prop) and a caller-supplied `commit: (cy: Core) => readonly P[]` callback that snapshots whatever the overlay cares about (node-and-edge data reads, vertical-offset computation, empty-row filtering). Returns the current `readonly P[]` placements snapshot. Internally: `useState<readonly P[]>([])` + `useRef<number | null>` rAF handle + `useEffect([cy])` registering and tearing down the three subscriptions. The returned array reference is updated only when the rAF-batched commit fires; React's normal state-change discipline drives the re-render.
- **`useSeenKeysGate<K>(currentKeys)`** — owns the lazy-init-on-non-empty `useRef<Set<K> | null>` seen-Set gate. Takes a `readonly K[]` of "the keys present in the current placement snapshot" derived by the caller (the AxiomMark overlay flattens `placements.flatMap(p => p.marks.map(m => `${p.id}:${m.participantId}`))`; the NodeAppear overlay just uses `placements.map(p => p.id)`). Returns an `isNew: (key: K) => boolean` predicate that **also has the side effect of adding the key to the seen-Set on a `true` return**, matching the existing per-element idiom (`if (isNew) seenNodeIds.add(p.id)`). Lazy-init fires when `seenRef.current === null && currentKeys.length > 0`, preserving the Decision §4 contract from the predecessor refinements (initially-present items do NOT animate; only post-mount arrivals do).

The two animation overlays (`AxiomMarkOverlay`, `NodeAppearOverlay`) consume both hooks; the two non-animation overlays (`PerFacetPillOverlay`, `AnnotationOverlay`) consume only `useCytoscapeOverlayPlacements`. Each overlay's render path remains its own (root `<div>` with its specific `data-testid` and `aria-hidden` posture; per-element wrapper with its specific `data-*-row` / `data-*-anim` attribute, its specific `transform: translate(...)` string, its specific child content — `<FacetPill>` map / `<AxiomMarkBadge>` wrap / `<AudienceAnnotationBadge>` map / empty halo `<span>`). The extraction lifts ONLY the scaffolding, not the per-surface render geometry. The four overlay files become substantially smaller (the duplicated effect body + commit closure + cleanup is ~40 lines each; after extraction each overlay drops to ~50–80 LOC of render-and-data-extraction code).

After this leaf:

- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` — **NEW**. Houses `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>`. Header comment-block cites this refinement, the four caller files, ADRs 0004 / 0022 / 0026, and the rule-of-four extraction trigger from `aud_node_appear_animation` Decision §2.
- `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — **NEW**. Vitest cases that pin the **consolidation properties** the hooks add — rAF batching (multiple events within a frame produce one commit), subscription cleanup on `cy` change / unmount, lazy-init-on-non-empty-placements gate timing, `isNew` side-effect idempotency on repeat-call. These tests are NEW because the consolidation behavior is what the extraction adds; per the precedent established by `shell_substrate_extraction.md`'s "one-fetch-per-provider" pin, the consolidation property gets its own test even though existing overlay tests already exercise the surface.
- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — MODIFIED. Drops the local `frameRef`, `commit`, `scheduleUpdate`, the `useEffect([cy])` body, and the cleanup branch; replaces with one `const placements = useCytoscapeOverlayPlacements<PillRowPlacement>(cy, commit)` call where `commit` is a pure function `(cy: Core): readonly PillRowPlacement[]` containing the existing iteration + offset + facet-empty-check. Render path unchanged; outer `<div data-testid="audience-per-facet-pill-overlay">` unchanged; per-pill row wrapper unchanged. Header comment-block extends with a Decision §1-§6 trail entry citing this refinement.
- `apps/audience/src/graph/AxiomMarkOverlay.tsx` — MODIFIED. Same scaffolding swap as PerFacetPill, plus the seen-Set call: `const seenMarkKeys = placements.flatMap((p) => p.marks.map((m) => `${p.id}:${m.participantId}`)); const isNew = useSeenKeysGate(seenMarkKeys);` and then `isNew(`${p.id}:${mark.participantId}`)` at the per-badge site, replacing the inline `seenMarkKeys !== null && !seenMarkKeys.has(markKey); if (isNew) seenMarkKeys.add(markKey)` pair. The `<span data-axiom-mark-anim>` wrapper + the conditional `aud-axiom-mark-land` class survive unchanged. Header comment-block extends.
- `apps/audience/src/graph/AnnotationOverlay.tsx` — MODIFIED. Same scaffolding swap as PerFacetPill; the unique node-AND-edge iteration stays inside the caller-supplied `commit` callback (the hook does not bake in `cy.nodes()`-only behavior). Header comment-block extends.
- `apps/audience/src/graph/NodeAppearOverlay.tsx` — MODIFIED. Same scaffolding swap as AxiomMark (both hooks). The `placements.map(p => p.id)` derived-keys array is the simplest seen-Set input (no per-element nested mark loop). Header comment-block extends.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx`, `apps/audience/src/graph/AxiomMarkOverlay.test.tsx`, `apps/audience/src/graph/AnnotationOverlay.test.tsx`, `apps/audience/src/graph/NodeAppearOverlay.test.tsx` — **UNCHANGED** (the refactor is behavior-preserving; if any of these need to change to pass, the extraction has accidentally altered observable behavior and must be revised — Decision §5).

Out of scope (deferred or non-tasks):

- **Shell-package home for the extracted hooks.** Rejected this round (Decision §2): the four callers all live under `apps/audience/src/graph/`; no moderator/participant graph today consumes the rAF-batched-Cytoscape-overlay pattern. The right home today is `apps/audience/src/graph/`. If a third surface (moderator's ReactFlow does not — different graph lib; participant's Cytoscape COULD if a future participant-side overlay lands) ever needs the same scaffolding, the third-caller trigger fires a shell lift then — same pattern as how `<AxiomMarkBadge>` flowed from three workspaces into `@a-conversa/shell`. **NOT pre-registered** today; speculative.
- **A `<KeyedCytoscapeOverlay>` component primitive instead of two hooks.** Rejected (Decision §1): the four overlays' render shapes diverge enough (different root `data-testid`, different per-element wrapper attribute / transform / children-type) that a single component primitive would either require many configuration props (defeating the purpose of extraction) or use a render-prop / children-as-function callback (a pattern the codebase has zero precedent for — per the Explore survey of prior extractions). Hooks compose cleanly with the existing component-per-overlay layout and match the codebase's "extract the seam, not the shape" posture.
- **Renaming the primitive to `KeyedCytoscapeNodeOverlay`** as the `.tji` `note` line literally says. Adjusted (Decision §3): the `Node` part of the name is incorrect (AnnotationOverlay iterates edges too) and `Overlay` suggests a component (Decision §1 rejected the component shape). The chosen names are `useCytoscapeOverlayPlacements` + `useSeenKeysGate`. The `.tji` `note` line is preserved as the source-of-debt pointer; the refinement explains the rename.
- **Behavior change in any of the four overlays.** Out of scope by definition (this is a refactor); see Acceptance criteria for the byte-and-behavior-preservation pins.
- **New animation behavior or new overlay site.** The four current overlay siblings are the four callers; this leaf does NOT add a fifth site and does NOT add a new keyframe / animation class. The remaining `aud_animations.*` siblings (`aud_proposed_to_agreed_animation`, `aud_decomposition_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`) MAY add new overlays consuming these hooks; that is their work, not this leaf's.
- **A Playwright spec.** Refactor is behavior-preserving; the existing `aud_session_url`-deferred chain already covers the live behavior of the four overlays (see `aud_axiom_mark_animation.md` Decision §6 and `aud_node_appear_animation.md` Decision §6). This leaf adds NO new Playwright-debt entry — it neither adds new user-visible behavior nor changes any of the per-overlay scenarios already on the chain.
- **A motion-framework dependency.** Same rejection posture the predecessor animation siblings established (`aud_axiom_mark_animation.md` Decision §1, §2; `aud_node_appear_animation.md` Decision §1). The hooks are framework-free.
- **A new ADR.** Per the survey of prior extractions (`aud_stylesheet_module_extraction.md`, `aud_stylesheet_state_color_extraction.md`, `shell_axiom_marks_extraction.md`, `shell_substrate_extraction.md`), intra-app extractions of duplicated React scaffolding do not require an ADR. The architectural seams (per-package home, no motion framework, CSS-first animations, Vitest pin discipline) are all already settled by ADRs 0004 / 0005 / 0022 / 0026.

## Why it needs to be done

The four DOM-overlay siblings currently encode the same scaffolding four times. The shape is intricate enough — singleton rAF handle, three distinct subscription strings, cleanup branch that cancels the pending frame AND deregisters the three subscriptions, seen-Set lazy-init that subtly gates on `placements.length > 0` rather than the literal first render — that the predecessor refinements have each had to re-derive the same Decision-§4 mistake-avoidance ("seeding on the literal first render leaves the set empty and the FIRST non-empty commit animates everything"). The fourth instance landing in `aud_node_appear_animation` makes the duplication concrete: changing the subscription set, the rAF batching policy, or the seen-Set timing now requires touching four files in lockstep, and a future fifth animation sibling would compound the cost.

The extraction pays the duplication down at the moment it becomes most expensive — before the remaining four `aud_animations.*` siblings (`aud_proposed_to_agreed_animation`, `aud_decomposition_animation`, `aud_withdrawal_animation`, `aud_diagnostic_fire_animation`) land. Each of those refinements will likely need its own overlay (some node-level, some possibly edge-level for diagnostics) and would otherwise each duplicate the scaffolding a fifth, sixth, seventh, and eighth time. Doing the extraction now means each of those subsequent leaves becomes a thin overlay that calls `useCytoscapeOverlayPlacements` + (optionally) `useSeenKeysGate`, plus its own keyframe + render shape.

The methodology surface unaffected: the broadcast viewer sees the same animations, same pixel rest states, same arrival timing. The refactor's gain is internal — it lowers the cost of future animation siblings, reduces the maintenance surface when (not if) a Cytoscape upgrade changes the event vocabulary or a React upgrade changes the rAF-state-update pattern, and gives the audience-graph layer a single place to evolve overlay machinery.

Downstream concretely:

- **`aud_proposed_to_agreed_animation`**, **`aud_decomposition_animation`**, **`aud_withdrawal_animation`**, **`aud_diagnostic_fire_animation`** ([`tasks/50-audience-and-broadcast.tji:331-346`](../../50-audience-and-broadcast.tji#L331)) inherit the extracted hooks; their refinements will scope thin overlay components rather than re-deriving the scaffolding. Each gets to focus on its keyframe geometry and its data-attribute conventions rather than the rAF-batching boilerplate.
- **`aud_animation_pacing`** ([`tasks/50-audience-and-broadcast.tji:352-355`](../../50-audience-and-broadcast.tji#L352)) is unaffected (this refactor does not touch animation durations or curves).
- **`aud_session_url`** ([`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md), pending) — unaffected. The deferred-e2e chain for the audience surface is structurally unchanged; this leaf adds no new scenarios to it.
- **`aud_visual_regression`** — unaffected. The post-animation steady state is identical.

Architecturally, the extraction codifies the "extract the seam, not the shape" pattern as the cumulative posture for audience-graph layer refactors: lifecycle and data-flow code becomes a hook, render geometry stays in the component. This is the right grain for the audience-overlay surface specifically because the per-overlay divergence is all about render geometry (offsets, transforms, child-element types), while the convergence is all about the Cytoscape-side dance (subscribe → rAF → snapshot → cleanup).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the four overlays each subscribe to Cytoscape's event API; the extraction preserves the exact event vocabulary (`render pan zoom resize` + `position node` + `add remove data`) verbatim, unchanged. No new graph-library dependency, no policy shift on how React+Cytoscape overlap.
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — no styling change. The animation CSS lives at `apps/audience/src/index.css` (unchanged); the hooks emit only JS-side state (no className strings, no inline style).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — pins the discipline: the new hook test is a permanent regression pin on the consolidation properties (rAF batching, cleanup, lazy-init timing, `isNew` side-effect idempotency); the four overlay tests stay unchanged because their behavior is unchanged. No throwaway smoke scripts.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the hooks ship inside the audience artifact bundle, not in any shell package. Decision §2 explains why this is correct.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — unaffected. The hooks are mechanical scaffolding; the per-layer separation lives in the caller's data-extraction logic (each overlay still reads its own `node.data(...)` slot — facetStatuses / axiomMarks / annotations / no-data for node-appear).

No new ADR. Per the survey of prior extractions, intra-app React-scaffolding consolidations do not need an ADR. The architectural seams are already settled.

### Sibling refinements

- [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) — the direct predecessor; Decision §2 there is the source-of-debt for this leaf. The "verbatim copy, defer the extraction" posture chosen there required this follow-up to exist.
- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — second predecessor; its Decision §4 lazy-init-on-non-empty-placements logic is what `useSeenKeysGate` lifts.
- [`tasks/refinements/audience/aud_per_facet_visualization.md`](aud_per_facet_visualization.md) — first introduction of the rAF-batched commit + three-event subscription pattern; the canonical reference shape.
- [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](aud_axiom_mark_decoration.md) — second instance; established "each overlay owns its own listener set even when sharing the same `Core`" — a property the extraction preserves (per-instance hook call → per-instance listener set).
- [`tasks/refinements/audience/aud_annotation_rendering.md`](aud_annotation_rendering.md) and [`tasks/refinements/audience/aud_annotation_rendering_edges.md`](aud_annotation_rendering_edges.md) — third overlay (and the one with node-AND-edge iteration, the divergence point that shapes Decision §3).
- [`tasks/refinements/audience/aud_stylesheet_module_extraction.md`](aud_stylesheet_module_extraction.md), [`tasks/refinements/audience/aud_stylesheet_state_color_extraction.md`](aud_stylesheet_state_color_extraction.md) — prior audience-local extraction precedents; the test-discipline shape (existing tests pass unchanged, dedicated regression pin on the consolidation property) and the "no new ADR for intra-app refactors" posture come from these.
- [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](../shell-package/shell_axiom_marks_extraction.md), [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md) — prior shell-side extractions; reference for the third-caller-trigger pattern that would fire IF a future moderator/participant overlay needed the same scaffolding (NOT today).

### Live code the leaf modifies / creates

- [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) — **NEW**. Houses both hooks. ~120 LOC including the header comment-block. Pure TypeScript, no JSX (hooks return state and predicates, not React elements).
- [`apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx) — **NEW**. ~6–8 Vitest cases pinning the consolidation properties. Uses `cytoscape()` directly (the existing `cytoscapeTestEnv` plumbing) and `renderHook` from `@testing-library/react`.
- [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) — MODIFIED. Effect body lifted; commit becomes a pure function passed to the hook. ~40 LOC removed, ~3 LOC added (the hook call + the function declaration). Net file size shrinks ~35 lines.
- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx) — MODIFIED. Same shape change as PerFacetPill, plus the `useSeenKeysGate` swap at the per-badge site. ~50 LOC removed, ~5 LOC added.
- [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) — MODIFIED. Same shape change as PerFacetPill. The unique node+edge iteration stays inside the caller-supplied `commit` callback. ~45 LOC removed, ~3 LOC added.
- [`apps/audience/src/graph/NodeAppearOverlay.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx) — MODIFIED. Both hooks; same swap as AxiomMark. ~50 LOC removed, ~5 LOC added.
- [`apps/audience/src/graph/PerFacetPillOverlay.test.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.test.tsx) — **UNCHANGED**.
- [`apps/audience/src/graph/AxiomMarkOverlay.test.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.test.tsx) — **UNCHANGED**.
- [`apps/audience/src/graph/AnnotationOverlay.test.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.test.tsx) — **UNCHANGED**.
- [`apps/audience/src/graph/NodeAppearOverlay.test.tsx`](../../../apps/audience/src/graph/NodeAppearOverlay.test.tsx) — **UNCHANGED**.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — **UNCHANGED**. The four overlay components' external prop interface (`cy: Core | null` + `containerRef: RefObject<HTMLDivElement | null>`) is preserved; GraphView's mount lines stay identical.
- [`apps/audience/src/graph/cytoscapeTestEnv.ts`](../../../apps/audience/src/graph/cytoscapeTestEnv.ts) — **UNCHANGED**. The new hook test consumes the existing test env exactly as the four overlay tests do (install once in `beforeAll`).
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — **UNCHANGED**. No CSS change.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — **UNCHANGED**.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — **UNCHANGED**.
- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — **UNCHANGED**.
- `apps/audience/package.json` — **UNCHANGED**. No new dependency (`@testing-library/react`'s `renderHook` is already declared as a dev dep via the existing `@testing-library/react` import in the four overlay test files; if it is somehow not, the closer adds it as a `devDependencies` entry — but the existing tests already pull `@testing-library/react`, so it is present).

### What the surface MUST NOT do

- **No change to any overlay component's public prop interface.** The four `<Audience*Overlay>` exports retain `{ cy: Core | null; containerRef: RefObject<HTMLDivElement | null>; }` props.
- **No change to any rendered DOM attribute.** Outer `data-testid="audience-*-overlay"`, per-element `data-*-row` / `data-*-anim` / `data-element-id`, `aria-hidden`, `pointer-events: none`, the `flex` / `gap: 4px` / `transform: translate(...)` strings — all byte-identical post-refactor.
- **No change to the Cytoscape subscription set.** `cy.on('render pan zoom resize', ...) + cy.on('position', 'node', ...) + cy.on('add remove data', ...)` is preserved exactly as the three-call shape (and the three `cy.off(...)` cleanup calls match it).
- **No change to rAF batching policy.** One commit per frame regardless of how many events fire; the hook MUST keep the singleton-`frameRef` pattern.
- **No change to the seen-Set lazy-init timing.** Gate stays on `currentKeys.length > 0` AND `seenRef.current === null`; literal-first-render with empty placements MUST still seed the set empty and let the first non-empty commit seed it from the actual keys. (Decision §4 of the two predecessor animation refinements; the lessons documented in [`AxiomMarkOverlay.tsx:108-127`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx#L108) and [`NodeAppearOverlay.tsx:97-112`](../../../apps/audience/src/graph/NodeAppearOverlay.tsx#L97) apply verbatim.)
- **No change to the seen-Set side-effect contract.** `isNew(key)` MUST add the key to the set on a `true` return; repeat-call MUST return `false` (this is the existing inline `if (isNew) seen.add(key)` idiom, just inside the hook).
- **No new dependency.** No motion framework, no helper library; the hooks are pure React + Cytoscape API.
- **No change to `<AudienceGraphView>`'s render path.** The mount lines for the four overlays stay byte-identical.
- **No edit to the moderator or participant surfaces.** The hooks are audience-local.
- **No new i18n keys.** No visible text added.
- **No edit to `tasks/50-audience-and-broadcast.tji` beyond the closer's `complete 100`.** The `note` line already names the extraction task; no rewording or restructuring is needed.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` — **NEW**. Shape:

  ```ts
  // Header comment-block: refinement-trail (aud_dom_overlay_extraction
  // Decisions §1-§6), ADR references (0004, 0022, 0026), caller list
  // (PerFacetPillOverlay, AxiomMarkOverlay, AnnotationOverlay,
  // NodeAppearOverlay). Cites aud_node_appear_animation Decision §2 as
  // the source-of-debt.

  import { useEffect, useRef, useState } from 'react';
  import type { Core } from 'cytoscape';

  /**
   * Subscribe to Cytoscape's `render pan zoom resize` + `position node` +
   * `add remove data` events; on each event, schedule a singleton rAF
   * that runs the caller-supplied `commit(cy)` and stores the result
   * via `useState`. Returns the current placement snapshot.
   *
   * The caller's `commit` must be pure with respect to the Cytoscape
   * snapshot — it reads `cy.nodes()` (and/or `cy.edges()`) and returns
   * the placement array. The hook re-subscribes whenever `cy` changes
   * identity (the `useEffect` dep array is `[cy]`). The `commit` ref is
   * not in the dep array — the hook captures the LATEST `commit`
   * passed in via a `commitRef` so callers can use closures over
   * render-scope state without retriggering subscription churn. This
   * mirrors the React-canonical "latest-ref" pattern documented in
   * the React docs and used by many community hook libraries.
   *
   * Returns `readonly P[]`; starts as `[]`.
   */
  export function useCytoscapeOverlayPlacements<P>(
    cy: Core | null,
    commit: (cy: Core) => readonly P[],
  ): readonly P[] {
    const [placements, setPlacements] = useState<readonly P[]>([]);
    const frameRef = useRef<number | null>(null);
    const commitRef = useRef(commit);
    // Keep the commit ref up to date each render so the rAF closure
    // calls the latest version without re-subscribing.
    commitRef.current = commit;

    useEffect(() => {
      if (cy === null) return undefined;

      const runCommit = (): void => {
        frameRef.current = null;
        setPlacements(commitRef.current(cy));
      };

      const scheduleUpdate = (): void => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(runCommit);
      };

      scheduleUpdate();

      cy.on('render pan zoom resize', scheduleUpdate);
      cy.on('position', 'node', scheduleUpdate);
      cy.on('add remove data', scheduleUpdate);

      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        cy.off('render pan zoom resize', scheduleUpdate);
        cy.off('position', 'node', scheduleUpdate);
        cy.off('add remove data', scheduleUpdate);
      };
    }, [cy]);

    return placements;
  }

  /**
   * Lazy-init-on-non-empty-keys seen-Set gate.
   *
   * Returns an `isNew(key)` predicate. The predicate has a side
   * effect: on a `true` return, the key is added to the internal
   * seen-Set, so repeat-calls of `isNew(sameKey)` within the same or
   * subsequent renders return `false`. This matches the inline idiom
   * the predecessor overlays used (`const isNew = !seen.has(k); if
   * (isNew) seen.add(k)`).
   *
   * The seen-Set is lazily seeded on the FIRST render where
   * `currentKeys.length > 0` — when the placements first carry
   * content, every existing key is seeded as "seen" and the predicate
   * returns `false` for all of them. Subsequent renders with new keys
   * return `true` once per new key (then `false` thereafter).
   *
   * Empty-`currentKeys` renders leave the set un-seeded; the FIRST
   * non-empty render does the seeding. This is the Decision §4 contract
   * from `aud_axiom_mark_animation.md` and `aud_node_appear_animation.md`
   * — seeding on the literal first render (when placements is empty
   * because the rAF hasn't fired yet) would leave the set empty and
   * incorrectly animate every initially-present element on the first
   * non-empty commit.
   */
  export function useSeenKeysGate<K>(currentKeys: readonly K[]): (key: K) => boolean {
    const seenRef = useRef<Set<K> | null>(null);

    if (seenRef.current === null && currentKeys.length > 0) {
      seenRef.current = new Set<K>(currentKeys);
    }

    // The predicate captures `seenRef.current` indirectly so future
    // re-seeds are visible to it (though only one seed ever happens).
    return (key: K): boolean => {
      const seen = seenRef.current;
      if (seen === null) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
  }
  ```

  The `commitRef` "latest-ref" pattern is the one detail worth flagging: it keeps the `useEffect`'s dep array narrow (`[cy]`) so a re-render with a fresh inline `commit` arrow does not tear down and re-establish the Cytoscape subscriptions. Without it, every render of an overlay would unsubscribe + resubscribe (the existing inline `useEffect([cy])` works only because the four overlays today have their `commit` declared INSIDE the effect; lifting `commit` to a caller-supplied prop demands the latest-ref pattern to preserve the same subscription stability).

- `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — **NEW**. Pins the consolidation properties via Vitest + `@testing-library/react`'s `renderHook` + a real `cytoscape()` instance. 6 cases:
  1. **rAF batching: multiple events within a frame → one commit.** Mount `renderHook(() => useCytoscapeOverlayPlacements(cy, commitSpy))`; fire `cy.emit('pan')` and `cy.emit('zoom')` synchronously; advance one frame; assert `commitSpy.mock.calls.length === 1` (one frame's worth of commits even though two events fired).
  2. **Subscription cleanup on unmount.** Mount, then `unmount()`; fire `cy.emit('pan')`; advance a frame; assert `commitSpy` was not called post-unmount. (Pins that `cy.off(...)` actually deregisters the listeners.)
  3. **Subscription re-bind on `cy` identity change.** `rerender` the hook with a NEW `cy2` instance; fire `cy2.emit('pan')`; advance a frame; assert `commitSpy` fires once. Fire `cy.emit('pan')` on the OLD instance; advance a frame; assert it does NOT fire (the old subscription was torn down).
  4. **Latest-ref `commit` is called.** `rerender` the hook with a new `commit` callback (different identity); fire `cy.emit('pan')`; advance a frame; assert the NEW `commit` is called, not the original (the latest-ref pattern is what makes the dep-array-narrow choice safe).
  5. **`useSeenKeysGate`: empty-keys render does NOT seed.** Call `renderHook(({ keys }) => useSeenKeysGate(keys), { initialProps: { keys: [] } })`; result.current('a') returns `false` (the set is un-seeded; an un-seeded predicate returns false unconditionally per the implementation). Rerender with `keys: ['x', 'y']`; result.current('x') returns `false` (seeded as initial); result.current('z') returns `true` (genuinely new); result.current('z') returns `false` (idempotent side effect).
  6. **`useSeenKeysGate`: first-non-empty-render seeds, side-effect idempotent on repeat-call.** Render with `keys: ['a', 'b']`; result.current('a') returns `false`; result.current('a') returns `false` (already seeded); result.current('c') returns `true`; result.current('c') returns `false` (added by previous call).

  Existing four overlay tests (`PerFacetPillOverlay.test.tsx`, `AxiomMarkOverlay.test.tsx`, `AnnotationOverlay.test.tsx`, `NodeAppearOverlay.test.tsx`) MUST pass unchanged — they exercise the consumer surface of the hooks via the overlay components and serve as integration coverage that the extraction did not regress observable behavior.

- `apps/audience/src/graph/PerFacetPillOverlay.tsx` — MODIFIED. The component body becomes:

  ```tsx
  export function AudiencePerFacetPillOverlay({
    cy,
    containerRef,
  }: AudiencePerFacetPillOverlayProps): ReactElement {
    void containerRef;
    const placements = useCytoscapeOverlayPlacements<PillRowPlacement>(cy, commitPerFacetPlacements);
    return (
      <div data-testid="audience-per-facet-pill-overlay" className="pointer-events-none absolute inset-0">
        {placements.map((p) => (
          <div
            key={p.id}
            data-facet-pill-row=""
            data-element-id={p.id}
            style={{ position: 'absolute', left: `${String(p.x)}px`, top: `${String(p.y)}px`, transform: 'translate(-50%, -100%)', display: 'flex', gap: '4px' }}
          >
            {FACET_RENDER_ORDER.map((facet) => {
              const status = p.facetStatuses[facet];
              if (status === undefined) return null;
              return <FacetPill key={facet} facet={facet} status={status} />;
            })}
          </div>
        ))}
      </div>
    );
  }

  function commitPerFacetPlacements(cy: Core): readonly PillRowPlacement[] {
    const next: PillRowPlacement[] = [];
    cy.nodes().forEach((node: NodeSingular) => {
      const facetStatuses = node.data('facetStatuses') as
        | Readonly<Partial<Record<FacetName, FacetStatus>>>
        | undefined;
      if (facetStatuses === undefined) return;
      let hasAny = false;
      for (const facet of FACET_RENDER_ORDER) {
        if (facetStatuses[facet] !== undefined) { hasAny = true; break; }
      }
      if (!hasAny) return;
      const bb = node.renderedBoundingBox();
      next.push({ id: node.id(), x: (bb.x1 + bb.x2) / 2, y: bb.y1 - PILL_ROW_OFFSET_Y, facetStatuses });
    });
    return next;
  }
  ```

  Note `commitPerFacetPlacements` is a module-scope pure function (no React-render-scope closures) — this is the cleanest shape when the commit doesn't need anything besides `cy`. The hook's `commitRef` latest-ref pattern is still in play but is a no-op for module-scope callbacks (the ref-write produces the same value every render). Header comment-block extends with the Decisions §1–§6 trail entry.

- `apps/audience/src/graph/AxiomMarkOverlay.tsx` — MODIFIED. Same scaffolding swap; the seen-Set call shape:

  ```tsx
  const placements = useCytoscapeOverlayPlacements<BadgeRowPlacement>(cy, commitAxiomBadgePlacements);
  const markKeys = placements.flatMap((p) => p.marks.map((m) => `${p.id}:${m.participantId}`));
  const isNewMark = useSeenKeysGate(markKeys);
  // ...
  {p.marks.map((mark) => {
    const markKey = `${p.id}:${mark.participantId}`;
    const isNew = isNewMark(markKey);
    return (
      <span key={mark.participantId} data-axiom-mark-anim="" className={isNew ? 'aud-axiom-mark-land' : ''}>
        <AxiomMarkBadge mark={mark} />
      </span>
    );
  })}
  ```

  Header comment-block extends.

- `apps/audience/src/graph/AnnotationOverlay.tsx` — MODIFIED. Same scaffolding swap; the commit callback iterates BOTH `cy.nodes()` and `cy.edges()` (preserving the existing node-and-edge iteration). Module-scope pure function:

  ```ts
  function commitAnnotationPlacements(cy: Core): readonly AnnotationRowPlacement[] {
    const next: AnnotationRowPlacement[] = [];
    cy.nodes().forEach((node: NodeSingular) => { /* existing node loop */ });
    cy.edges().forEach((edge: EdgeSingular) => { /* existing edge loop */ });
    return next;
  }
  ```

  Header comment-block extends.

- `apps/audience/src/graph/NodeAppearOverlay.tsx` — MODIFIED. Both hooks:

  ```tsx
  const placements = useCytoscapeOverlayPlacements<NodeAppearPlacement>(cy, commitNodeAppearPlacements);
  const nodeIds = placements.map((p) => p.id);
  const isNewNode = useSeenKeysGate(nodeIds);
  // ...
  {placements.map((p) => {
    const isNew = isNewNode(p.id);
    return (
      <span key={p.id} data-node-appear-anim="" data-element-id={p.id} className={isNew ? 'aud-node-appear' : ''} style={{ /* existing */ }} />
    );
  })}
  ```

  Header comment-block extends.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/PerFacetPillOverlay.test.tsx`, `apps/audience/src/graph/AxiomMarkOverlay.test.tsx`, `apps/audience/src/graph/AnnotationOverlay.test.tsx`, `apps/audience/src/graph/NodeAppearOverlay.test.tsx` — UNCHANGED (Acceptance criteria pin this).
- `apps/audience/src/graph/GraphView.tsx`, `apps/audience/src/graph/cytoscapeTestEnv.ts`, `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/graph/AnnotationBadge.tsx`, `apps/audience/src/graph/axiomMarks.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx`, `apps/audience/src/index.css`, `apps/audience/src/index.test.ts` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED.
- `docs/adr/**` — UNCHANGED.
- `playwright.config.ts`, `tests/e2e/**` — UNCHANGED.
- `.tji` files — only the closer's `complete 100` lands on this leaf at task-completion time per the [README ritual](../README.md).

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` exists; exports `useCytoscapeOverlayPlacements<P>(cy, commit)` and `useSeenKeysGate<K>(currentKeys)` with the signatures and behaviors specified in Constraints.
- `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` exists; carries the 6 Vitest cases listed in Constraints; all 6 pass.
- All four overlay component files (`PerFacetPillOverlay.tsx`, `AxiomMarkOverlay.tsx`, `AnnotationOverlay.tsx`, `NodeAppearOverlay.tsx`) consume the hooks; the local `frameRef`, `commit` closure, `scheduleUpdate`, `useEffect([cy])` body, and `cy.on/cy.off` calls are removed from each. Header comment-blocks extend with a refinement-trail entry citing this leaf.
- The four overlay component files retain their existing public prop interfaces (`{ cy: Core | null; containerRef: RefObject<HTMLDivElement | null>; }`), their existing default + named exports, and their existing rendered DOM shape (outer `data-testid`, per-element data-attributes, transforms, classes, child element types).
- All four existing overlay test files (`PerFacetPillOverlay.test.tsx`, `AxiomMarkOverlay.test.tsx`, `AnnotationOverlay.test.tsx`, `NodeAppearOverlay.test.tsx`) pass **byte-unchanged**. If the implementation requires any change to these files to make them pass, that is a signal the extraction has accidentally altered observable behavior and the implementation must be revised — NOT the tests (Decision §5).
- `apps/audience/src/graph/GraphView.tsx` is byte-unchanged.
- `apps/audience/src/index.css` is byte-unchanged.
- `apps/audience/src/index.test.ts` is byte-unchanged.
- `packages/shell/**` is byte-unchanged.
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins (a) the consolidation properties via the 6 new hook tests, AND (b) preserved observable overlay behavior via the four existing overlay test files (passing byte-unchanged is the regression pin). Animation-timing pixel capture remains out of scope.
- **No new Playwright debt added to the `aud_session_url` chain.** This refactor is behavior-preserving; the per-overlay Playwright scenarios already queued under `aud_session_url` (six refinements' worth, per [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) Decision §6) cover the live behavior. If the implementer discovers a behavior regression during the refactor that requires a Playwright pin, that is itself a signal the refactor failed (revise rather than add new pins).
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by exactly 6 new cases; no existing case removed or modified). Per the [test-output handling memory](../../../.claude/projects/-home-ruoso-devel-a-conversa/memory/feedback_test_output_handling.md), redirect test output to a file and inspect via an Explore sub-agent rather than piping to tail.
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is **negative** (net LOC drop in the overlay components exceeds the LOC added in the hook module; ~150 lines duplicated scaffolding lifted into ~80 lines of shared hook code).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_dom_overlay_extraction` in the same commit (the closer's ritual). No other `.tji` edit (no `depends` adjustment; no new task registration — see "no new tasks" below).
- **No new tech-debt registered.** This leaf clears debt rather than registering it. The two animation-overlay siblings' Decision §2 hand-off to this task is now satisfied. The remaining `aud_animations.*` siblings inherit the cleaner scaffolding when they ship. If during implementation a NEW seam emerges that the hooks could absorb but currently don't (e.g., a generic "test-seam attribute on the root overlay div" pattern), the implementer surfaces it in the Status block as either a follow-up task or — preferably — folds it into this refactor before shipping.
- **Infra debt to flag in Status block (if observed)**: per the prior closer-time pattern, if the pre-existing `foundation.ci.cucumber_v8_wasm_jit_crash` (Node v24 pglite WASM JIT crash in cucumber teardown — tests still pass, teardown emits an error) appears during the build+test gate, the closer notes it so the fixer sub-agent recognizes it as pre-existing.

## Decisions

### §1 — Two hooks (`useCytoscapeOverlayPlacements` + `useSeenKeysGate`) instead of one `<KeyedCytoscapeOverlay>` component primitive

Three options for the extraction shape:

A. **Two hooks.** `useCytoscapeOverlayPlacements<P>(cy, commit)` returns the placements snapshot; `useSeenKeysGate<K>(currentKeys)` returns the `isNew` predicate. Each overlay component owns its render path entirely; the hooks contribute lifecycle and gating state but no JSX.

B. **One component primitive — `<KeyedCytoscapeOverlay<P, K>>` with render-prop / children-as-function.** Mount the primitive once per overlay; pass `commit`, `deriveKeys`, and a `renderItem: (placement, isNew) => ReactElement` callback. The primitive emits the root `<div>` and the placements loop; the caller's render-prop emits the per-element wrapper.

C. **One component primitive with extensive configuration props.** Same as B but configure-by-props instead of render-prop: `rootTestId`, `wrapperAttribute`, `wrapperTransform`, `wrapperFlexGap`, `renderItem`, `animationClass`, etc.

**Chosen: A.** Two hooks. The four overlays' render geometries diverge enough that lifting the shape into a component primitive would either (B) introduce a render-prop / children-as-function pattern the codebase has zero precedent for (per the Explore survey of prior extractions — Provider+Hook, module-scope-constant, memoized-component are the three established patterns; no render-prop appears anywhere) OR (C) push N configuration props through a primitive whose "configuration surface" eventually matches the source code it was meant to absorb. The Explore survey of the four overlays catalogued these divergences:

- Different root `data-testid` (`audience-per-facet-pill-overlay` / `-axiom-mark-overlay` / `-annotation-overlay` / `-node-appear-overlay`)
- Different per-element wrapper data-attribute (`data-facet-pill-row` / `-axiom-mark-row` / `-annotation-row` / `data-node-appear-anim`)
- Different per-element transform string (`-50%, -100%` / `-50%, 0` / `-50%, 0` + `flexWrap` / `-50%, -50%`)
- Different per-element child type (`<FacetPill>` map / `<span data-axiom-mark-anim>` wrap of `<AxiomMarkBadge>` / `<AudienceAnnotationBadge>` map / empty halo `<span>`)
- Different `aria-hidden` posture (only NodeAppear emits `aria-hidden="true"`)
- Different commit iteration target (nodes only / nodes only / nodes + edges / nodes only)

Hooks parameterize the LIFECYCLE & STATE without claiming any opinion on the render shape; components keep ownership of what they render. This is the cleanest grain for this surface and matches the codebase's "extract the seam, not the shape" cumulative posture (cf. `aud_stylesheet_module_extraction.md`, `shell_substrate_extraction.md`).

Option B is rejected because the codebase has zero render-prop / CAAF precedent, and the API would be the first such pattern — introducing it for an intra-package refactor is disproportionate. Option C is rejected because the configuration-prop surface would balloon: the four overlays each have ~5–7 distinct render-shape parameters, and absorbing all of them as props produces a component whose interface IS more code than the duplicated scaffolding it replaces.

### §2 — Home is `apps/audience/src/graph/`, not `packages/shell/`

Two options for where the hooks live:

A. **`apps/audience/src/graph/cytoscapeOverlayHooks.ts`** — intra-app extraction. Only audience consumes the hooks today; the moderator uses ReactFlow (different graph library entirely; the rAF + `cy.on(...)` pattern does not transfer); the participant has no current overlay surface using Cytoscape.

B. **`packages/shell/src/graph/cytoscapeOverlayHooks.ts`** — cross-package extraction with a shell-side home. Exported via the shell's `index.ts`; consumed by the audience via the existing `@a-conversa/shell` import path.

**Chosen: A.** The shell-extraction precedent (`shell_axiom_marks_extraction.md`, `shell_substrate_extraction.md`) is "third-caller trigger" — extraction to the shell happens when three or more workspaces (typically moderator + audience + participant) consume the same code. Today the audience is the SOLE caller of the rAF + Cytoscape-event-subscription scaffolding. The moderator's `<StatementNode>` uses ReactFlow's own event vocabulary (not Cytoscape's `cy.on(...)`) and cannot consume these hooks; the participant currently has no Cytoscape overlay. The third-caller threshold is not met, and pre-emptive shell extraction would invent a cross-surface contract for a single-surface need.

If a future participant-side or moderator-side Cytoscape overlay materializes (currently nothing in the WBS suggests it), THAT moment fires the third-caller trigger and the shell lift happens then. The current hooks' API is small (two functions, narrow type signatures) so a future shell lift would be mechanical. The shell extraction is **NOT pre-registered** today; per the prior pattern, future-task registration happens when the need becomes concrete, not in advance.

Option B is rejected because pre-emptive shell-lifting an intra-app refactor would create a cross-package contract for a single-package need, growing the shell's surface area without any consumer asking for it. This is the inverse of the established extraction discipline ("the third caller fires the lift, not the second").

### §3 — Rename from `KeyedCytoscapeNodeOverlay` (the `.tji` `note` name) to `useCytoscapeOverlayPlacements` + `useSeenKeysGate`

The `.tji` `note` line at [`tasks/50-audience-and-broadcast.tji:361`](../../50-audience-and-broadcast.tji#L361) names the extraction target as `KeyedCytoscapeNodeOverlay` (a single primitive). Two issues with the original name:

1. **"Node"** is incorrect: the `AnnotationOverlay` iterates both `cy.nodes()` and `cy.edges()` ([`AnnotationOverlay.tsx:142-163`](../../../apps/audience/src/graph/AnnotationOverlay.tsx#L142)). The Annotation refinement explicitly added the edge iteration in `aud_annotation_rendering_edges`. Naming the primitive `*Node*` would bake an incorrect assumption into the contract; either the Annotation overlay would have to be exempted from the consolidation (defeating the rule-of-four trigger) or the primitive's name would mislead future readers about what it actually does.
2. **"Overlay"** suggests a component (Decision §1 rejected the component shape). Naming a hook `*Overlay` is convention-incoherent in a React codebase where `use*` is the hook convention.

The chosen names:

- **`useCytoscapeOverlayPlacements<P>`** — describes what it returns (a Cytoscape-derived placements snapshot for an overlay) rather than committing to "node" or "edge".
- **`useSeenKeysGate<K>`** — describes its purpose (a lazy-seeded seen-keys gate) without coupling to "axiom marks" or "node appearance".

Both names follow the `use*` hook convention; both are descriptive without overconstraining. The `.tji` `note` line keeps its current text (the closer does NOT rewrite it) — its purpose is to point at the source-of-debt, not to commit to an API name. This refinement explains the rename. Future readers tracing the `.tji` `note` to this refinement will see the name decision documented here.

### §4 — `commit` is a caller-supplied callback (latest-ref pattern), NOT baked into the hook

Two sub-options for how the hook gets the commit logic:

A. **Caller-supplied `commit: (cy: Core) => readonly P[]` callback, captured via `commitRef.current = commit` "latest-ref" pattern.** The hook's `useEffect` dep array is `[cy]` only; the latest commit is read through the ref on each rAF tick. Callers can use module-scope pure functions (the common case) or render-scope closures (if the commit needs render-scope state).

B. **Caller-supplied `commit` with the hook's dep array `[cy, commit]`.** Conventional dep-array discipline; React's exhaustive-deps lint would suggest this. Every render with a new `commit` identity tears down and re-subscribes.

**Chosen: A.** The four current overlay sites all have stable commits (they could be module-scope pure functions), but the latest-ref pattern future-proofs the hook for callers whose commit needs render-scope state without forcing them into a `useCallback`-wrapping ceremony. Critically, the latest-ref pattern keeps the Cytoscape subscription stable across re-renders, preserving the property that `cy.on(...)`/`cy.off(...)` only run on `cy`-identity change.

Option B is rejected because adopting the conventional `[cy, commit]` dep-array discipline would tear down and re-subscribe to Cytoscape events on every parent re-render whose `commit` is an inline arrow — a cost the current overlays avoid by inlining their commit INSIDE the effect. Preserving that subscription-stability property is the whole point of the latest-ref pattern.

The latest-ref pattern's only subtlety is that the `commit` SHOULD NOT have observable side effects beyond returning a placement array (which is its existing contract today — the current commits only read `cy.nodes()` / `cy.edges()` and `node.data(...)`). Documenting this in the hook's JSDoc is enough; the four current callers already satisfy it.

### §5 — Existing overlay tests pass byte-unchanged; this is the regression pin

Two options for verifying behavior preservation:

A. **The four existing overlay test files (`PerFacetPillOverlay.test.tsx`, `AxiomMarkOverlay.test.tsx`, `AnnotationOverlay.test.tsx`, `NodeAppearOverlay.test.tsx`) pass byte-unchanged.** If any test requires modification to pass, the extraction has accidentally altered observable behavior and the implementation must be revised. New tests on the hooks themselves pin the consolidation properties (rAF batching, cleanup, lazy-init timing).

B. **Migrate the four overlay test suites to exercise the hooks directly; trim per-overlay tests to focus on render-shape contracts.** Reduce test volume by deduplicating the per-overlay rAF / subscription / seen-Set tests into the hook test.

**Chosen: A.** Byte-unchanged overlay tests are the strongest possible regression pin for a behavior-preserving refactor: by definition, the refactor preserves observable behavior IF the existing tests pass without modification. Any need to touch a test file is a signal that the extraction broke an observable contract that the test was pinning — at which point the right response is to fix the extraction, not the test. The new hook test (6 cases per Constraints) pins the consolidation properties (the thing the extraction ADDS: shared rAF batching, shared cleanup, shared lazy-init timing) following the precedent established by `shell_substrate_extraction.md`'s "one-fetch-per-provider" pin.

Option B is rejected because trimming the overlay tests would lose integration coverage — the per-overlay tests exercise the hook + the render shape + the data extraction together, catching regressions that hook-only tests would miss (e.g., a typo in the per-overlay `commit` callback). The current overlay tests are already exercising the right surface; the extraction's correctness is best demonstrated by them continuing to pass unchanged.

A practical consequence of this choice: the implementer should run the overlay tests AFTER making the hook changes, BEFORE making any test changes. If any overlay test fails, the implementer revises the hook or the per-overlay rewire — not the test. This is documented in Acceptance criteria.

### §6 — Behavior preservation means NO new Playwright debt on the `aud_session_url` chain

The `aud_session_url`-deferred-e2e chain currently inherits two scenarios from each of six refinements (per [`aud_node_appear_animation.md`](aud_node_appear_animation.md) Decision §6: `aud_cytoscape_init.md`, `aud_state_management.md`, `aud_ws_client.md`, `aud_axiom_mark_decoration.md`, `aud_axiom_mark_animation.md`, `aud_node_appear_animation.md`). Six refinements is already at the "pay debt down" threshold the orchestrator brief flagged ("if it's inheriting from 2+ refinements already, pay debt down instead — either scope a small Playwright spec inline, or split the deferral target").

This leaf does NOT add to the chain because it is a behavior-preserving refactor — every live scenario the chain already covers continues to apply unchanged. Specifically:

- The two animation scenarios from `aud_axiom_mark_animation.md` ("freshly-arrived badge wrapper carries the `aud-axiom-mark-land` class" / "initially-present badge does not") continue to hold under the refactored code (the `useSeenKeysGate` hook is the same logic, lifted).
- The two animation scenarios from `aud_node_appear_animation.md` ("freshly-arrived node's halo carries the `aud-node-appear` class" / "node already present at page load does NOT carry the class") continue to hold for the same reason.
- The decoration scenarios from `aud_axiom_mark_decoration.md` (badge placement, badge visibility on nodes with axiom-marks, badge absence on nodes without) continue to hold (the rAF + subscription logic is the same, lifted).

If the implementation accidentally introduces a behavior regression, the right response is to fix the implementation — NOT to add a new Playwright scenario. This contrasts with the prior animation siblings, which DID need to scope new Playwright scenarios because they added new user-visible behavior (the animation classes themselves).

The refinement explicitly notes this in Acceptance criteria so the closer of `aud_session_url` (when that task runs) does not look for inherited scenarios from this leaf — there are none.

Pixel-stable post-animation steady state is unchanged (the halos still fade to `opacity: 0`; the badges still paint at their per-state palette). The `aud_visual_regression` task's fixtures continue to apply unchanged.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` (NEW) — exports `useCytoscapeOverlayPlacements<P>(cy, commit)` (rAF-batched commit + 3-event Cytoscape subscription, latest-ref `commit` capture, re-subscribes on `cy`-identity change) and `useSeenKeysGate<K>(currentKeys)` (lazy-init-on-non-empty seen-Set returning `isNew(key)` predicate with add-on-true side effect).
- `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` (NEW) — 6 Vitest cases pinning: rAF batching (multiple events → one commit per frame); cleanup-on-unmount; re-bind on cy-identity change; latest-ref commit capture; `useSeenKeysGate` empty-keys-doesn't-seed; first-non-empty seeds + idempotent isNew.
- `apps/audience/src/graph/PerFacetPillOverlay.tsx` (MODIFIED) — drops local rAF + subscription + cleanup (~40 LOC); consumes `useCytoscapeOverlayPlacements`; commit extracted as module-scope pure `commitPerFacetPlacements`.
- `apps/audience/src/graph/AxiomMarkOverlay.tsx` (MODIFIED) — same scaffolding swap + `useSeenKeysGate` for `${nodeId}:${participantId}` keys; commit extracted as `commitAxiomBadgePlacements`.
- `apps/audience/src/graph/AnnotationOverlay.tsx` (MODIFIED) — same scaffolding swap; commit extracted as `commitAnnotationPlacements` preserving `cy.nodes()` + `cy.edges()` iteration.
- `apps/audience/src/graph/NodeAppearOverlay.tsx` (MODIFIED) — both hooks; commit extracted as `commitNodeAppearPlacements`; `useSeenKeysGate` for node-id keys.
- All four existing overlay test files pass byte-unchanged (behavior-preserving refactor confirmed). No new Playwright debt (Decision §6). No new tech-debt registered (this leaf clears debt).
