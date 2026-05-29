# Audience diagnostic-fire animation (one-shot CSS `@keyframes` amber-tinted halos painted by a new DOM-overlay sibling `<AudienceDiagnosticFireOverlay>` centered on each Cytoscape node that becomes affected by an `activeDiagnostics` entry mid-broadcast — severity-keyed palette (amber-700 for `'blocking'`, amber-400 for `'advisory'`), gated by `useSeenKeysGate` keyed by `${diagnosticIdentityKey}:${nodeId}` so initially-active diagnostics at audience-join do NOT animate, suppressed under `prefers-reduced-motion: reduce`)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_diagnostic_fire_animation` (lines 345-348).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_graph_rendering` (settled — the entire group is `complete 100`). The audience surface paints node bodies via Cytoscape's canvas-side `STYLESHEET` (lifted to [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts)) and projects per-tick element data via [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts). This leaf adds an **entity-layer animation** when a node first appears as an affected entity of an active diagnostic; the canvas-side steady state is unchanged (the audience never has, and continues to lack, a persistent diagnostic-highlight border — only the transient halo).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_withdrawal_animation` (settled — [`tasks/refinements/audience/aud_withdrawal_animation.md`](aud_withdrawal_animation.md)). The direct structural precedent: a per-node halo overlay mounted as a DOM sibling of the Cytoscape canvas (`<AudienceWithdrawalHaloOverlay>` at [`apps/audience/src/graph/WithdrawalHaloOverlay.tsx`](../../../apps/audience/src/graph/WithdrawalHaloOverlay.tsx)). Decision §1 (CSS keyframe on React-keyed halo `<span>`, NOT `cy.animate()`), §2 (new overlay file rather than fold), §4 (transition-keyed `useSeenKeysGate` with target-state filter, lazy-init-on-first-non-empty seed), §5 (450 ms `cubic-bezier(0.16, 1, 0.3, 1)` `forwards` — halo geometry justifies the slower entrance), §6 (Vitest pins React-side + CSS file presence; Playwright deferred) all apply verbatim modulo (a) the data source (`activeDiagnostics` from the WS store instead of `data.rollupStatus` from cy.data()), (b) the per-node multiplicity (a single node may be affected by several active diagnostics, requiring a composite key), and (c) the per-severity palette split (two animation classes instead of one).
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_node_appear_animation` (settled — [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md)). The 96px-halo geometry, the radial-gradient pattern, and the 450 ms decelerated curve are mirrored from this predecessor.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_proposed_to_agreed_animation` (settled — [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md)). The composite-key `useSeenKeysGate` precedent (its key is `${nodeId}:${facet}`); this leaf adopts the same shape with `${diagnosticIdentityKey}:${nodeId}` as the composite.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_axiom_mark_animation` (settled — [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md)). Established the CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS, Vitest-pins-class-logic posture. Decisions §1, §2, §6 apply verbatim.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_dom_overlay_extraction` (settled — [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md)). The shared hooks `useCytoscapeOverlayPlacements<P>` and `useSeenKeysGate<K>` at [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) are consumed verbatim. This leaf is the third new caller of both hooks since the extraction landed (after `aud_proposed_to_agreed_animation` and `aud_withdrawal_animation`).
- Prose-only context (NOT a `.tji` edge): `audience.aud_ws_client` (settled — [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md)). The audience WS store uses the shell's default factory (`createDefaultWsStore()` at [`packages/shell/src/ws/defaultStore.ts`](../../../packages/shell/src/ws/defaultStore.ts)) which intentionally omits `activeDiagnostics`. The refinement notes "the audience surface is the eventual extract trigger" for diagnostic state ([`apps/audience/src/ws/wsStore.ts:8-13`](../../../apps/audience/src/ws/wsStore.ts#L8), [`aud_ws_client.md` Decision §B](aud_ws_client.md)). **This leaf is that trigger** for the diagnostic axis: it extends the audience-local `audienceWsStore` to track `activeDiagnostics` (the same `Map<identityKey, DiagnosticPayload>` shape participant/moderator carry), and registers the shell-side extraction as a named-future-task. The shell extraction is deferred — Decision §3 below.
- Prose-only context (NOT a `.tji` edge): `participant.part_diagnostic_highlights` (settled — `tasks/refinements/participant-ui/part_diagnostic_highlights.md`). Established the per-entity `DiagnosticHighlight` shape (`severity` + `kinds[]`) and the `projectDiagnosticHighlights(activeDiagnostics)` projection ([`apps/participant/src/graph/diagnosticHighlights.ts`](../../../apps/participant/src/graph/diagnosticHighlights.ts)). The audience does NOT today paint a persistent diagnostic-highlight border (Decision §8 below) but consumes the same identity-key formula, the same `affectedEntities()` rollup, and the same wire types — this leaf ports the minimum subset to `apps/audience/src/graph/diagnosticHighlights.ts`. The lift to `@a-conversa/shell` is deferred as a named-future-task (Decision §3).
- Prose-only context (NOT a `.tji` edge): `aud_animations.aud_animation_pacing` (sibling, future — [`tasks/50-audience-and-broadcast.tji:354-358`](../../50-audience-and-broadcast.tji#L354)). The cross-cutting cadence-tuning task. The closer of this leaf adds `!aud_diagnostic_fire_animation` to that `depends` line so the pacing task sees all five shipped animation durations when it rebalances — see Acceptance criteria.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (sibling, future). The deferred-e2e debt collector for the audience surface. Every prior `aud_animations.*` leaf routes its Playwright debt there; this leaf joins the same chain (Decision §6).
- Prose-only context (NOT a `.tji` edge): `audience.aud_meta_disagreement_split` (settled). Its own scope-fence explicitly defers the structural-diagnostic visual axis to **this leaf** ([`aud_meta_disagreement_split.md` Out-of-scope §1](aud_meta_disagreement_split.md)): "Structural diagnostics (cycles, contradictions) are a separate visual axis from agreement-layer rollups; this leaf does NOT cross into structural-diagnostic styling." This refinement is the consumer that opens that axis on the audience surface.

## What this task is

The 1d leaf that lights up the **entity-layer arrival animation** when a node becomes an affected entity of a diagnostic mid-broadcast. Structural diagnostics — cycles ([`apps/server/src/diagnostics/cycle-detection.ts`](../../../apps/server/src/diagnostics/cycle-detection.ts)), contradictions, multi-warrant, dangling-claim, coherency-hint sub-kinds — are emitted by the methodology engine and broadcast to clients via the `diagnostic` WS message ([`packages/shared-types/src/ws-envelope.ts:1452-1468`](../../../packages/shared-types/src/ws-envelope.ts#L1452)). Each broadcast carries `status: 'fired' | 'cleared'`, a `severity` (`'blocking'` for cycles + contradictions; `'advisory'` for the other three), the per-kind payload, and an event-log `sequence`. The participant and moderator surfaces already extend the shell's WS store to track an `activeDiagnostics: Map<identityKey, DiagnosticPayload>` and project per-entity highlights ([`apps/participant/src/graph/diagnosticHighlights.ts:290-351`](../../../apps/participant/src/graph/diagnosticHighlights.ts#L290)); the audience surface does NOT yet, by design — its WS store uses `createDefaultWsStore()` ([`packages/shell/src/ws/defaultStore.ts`](../../../packages/shell/src/ws/defaultStore.ts)) which omits the map. This leaf is the third-caller trigger that closes the gap on the audience side.

Concretely the leaf does three things end-to-end:

1. **Extends `audienceWsStore` to track `activeDiagnostics`** — mirrors the participant's `WsSessionState extends BaseWsSessionState` pattern at [`apps/participant/src/ws/wsStore.ts:54-199`](../../../apps/participant/src/ws/wsStore.ts#L54). The override of `applyDiagnostic` uses `diagnosticIdentityKey(payload)` to key the map, adds on `'fired'`, deletes on `'cleared'`.
2. **Ports `diagnosticIdentityKey`, `affectedEntities`, and the per-kind wire types** to `apps/audience/src/graph/diagnosticHighlights.ts` — a verbatim mirror of the participant's identity-key + affected-entity-rollup logic (the audience does NOT need the full `projectDiagnosticHighlights` because it is not painting per-entity steady-state borders; it only needs the `(identityKey, nodeId) → severity` flattening). The lift to `@a-conversa/shell` is registered as a named-future-task `shell_diagnostic_highlights_extract` (Decision §3) — this leaf does the third-caller port that triggers the extract, not the extract itself, mirroring how `aud_axiom_mark_decoration` ported the moderator's `axiomMarks.ts` rather than lifting it.
3. **Adds a `<AudienceDiagnosticFireOverlay>` DOM sibling** inside `<AudienceGraphView>`'s render tree (after the existing `<AudienceWithdrawalHaloOverlay>` mount at [`GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx)). The overlay subscribes to `audienceWsStore`'s `activeDiagnostics` via a Zustand selector hook; combined with `useCytoscapeOverlayPlacements`'s subscription to `cy` for positions, it emits one placement per `(diagnosticIdentityKey, nodeId, severity)` tuple. `useSeenKeysGate<string>` keys on `${identityKey}\0${nodeId}` over the currently-active set; halo `<span>`s for newly-arrived (diagnostic, node) pairs get the severity-specific animation class.

The animation gives the diagnostic-fire moment a temporal signal: a brief amber halo expanding outward from each affected node and fading to transparent over 450 ms. The halo's hue distinguishes blocking from advisory — amber-700 (`#b45309`) for blocking diagnostics (cycles, contradictions), amber-400 (`#fbbf24`) for advisory (multi-warrant, dangling-claim, coherency-hint). The palette is sampled from the moderator's already-shipped diagnostic borders at [`apps/moderator/src/graph/GraphView.tsx:548-599`](../../../apps/moderator/src/graph/GraphView.tsx#L548) for cross-surface palette continuity.

The seen-set semantics mirror `aud_withdrawal_animation`'s transition-keyed gate: `currentKeys` is filtered to the (identityKey, nodeId) pairs currently active. The first non-empty commit seeds with whatever diagnostics are already active at audience-join (mid-session joiners do NOT see retrospective animation for diagnostics they missed — the rose-600 disputed surface tells them about state arrived-at, not about state-just-arrived). Subsequent activeDiagnostics changes that produce a new (identityKey, nodeId) pair fire the halo for that pair exactly once per session.

A `'cleared'` event removes the diagnostic from `activeDiagnostics` and thus removes its (identityKey, nodeId) pairs from `currentKeys`. The seen-Set still holds those keys (it's only ever added, never removed), so a subsequent re-`'fired'` of the **same identityKey** does NOT re-animate. This is intentional — re-firing of a cleared diagnostic is rare (most commonly a moderator-edit-and-revert; the methodology does not loop on the same cycle nodes repeatedly) and treating it as a fresh fire would visually duplicate the first arrival. The conservative "animate the first observation of each (identityKey, nodeId) pair per session" gate is correct.

After this leaf:

- `apps/audience/src/ws/wsStore.ts` — MODIFIED. Replace the `createDefaultWsStore()` re-export with an extension pattern mirroring [`apps/participant/src/ws/wsStore.ts:54-199`](../../../apps/participant/src/ws/wsStore.ts#L54): `WsSessionState extends BaseWsSessionState` adding `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`, an `ensureSession` helper that defaults `activeDiagnostics: new Map()`, an `applyDiagnostic` override that keys by `diagnosticIdentityKey(payload)` and add/removes per `status`. The other shell-default methods (`applyEvents`, `applyAxiomMark`, etc.) are inherited unchanged. ~50 LOC.
- `apps/audience/src/ws/wsStore.test.ts` — MODIFIED (or new). Add ~4 cases: (a) `applyDiagnostic` with `status: 'fired'` adds an entry keyed by identity; (b) `applyDiagnostic` with `status: 'cleared'` removes it; (c) re-`'fired'` of the same identity replaces the entry; (d) initial state has empty `activeDiagnostics: ReadonlyMap`.
- `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` — NEW. A selector hook `useAudienceActiveDiagnostics(sessionId): ReadonlyMap<string, DiagnosticPayload>` returning the per-session active diagnostics. Parallels [`apps/audience/src/ws/useAudienceConnectionStatus.ts`](../../../apps/audience/src/ws/useAudienceConnectionStatus.ts)'s shape; ~15 LOC.
- `apps/audience/src/graph/diagnosticHighlights.ts` — NEW. Ports `diagnosticIdentityKey()` (the `\0`-separated identity formula) and `affectedEntities(payload): { nodes: readonly string[]; edges: readonly string[] }` from the participant's [`diagnosticHighlights.ts`](../../../apps/participant/src/graph/diagnosticHighlights.ts) verbatim. Adds a thin helper `flattenActiveDiagnosticsForFire(activeDiagnostics): readonly { identityKey: string; nodeId: string; severity: DiagnosticHighlightSeverity }[]` that walks the map and produces the (identityKey, nodeId, severity) tuples this leaf's overlay consumes (edges deferred per Decision §7). ~150 LOC including the wire-type interfaces. Re-exports the wire-payload type aliases for downstream re-use by future audience-side diagnostic surfaces.
- `apps/audience/src/graph/diagnosticHighlights.test.ts` — NEW. Vitest cases pinning the identity-key formula (cycle / contradiction / multi-warrant / dangling-claim / coherency-hint sub-kinds — round-trip with hand-built payloads), the `affectedEntities` projection per kind, and the `flattenActiveDiagnosticsForFire` output (empty input → empty array; single cycle of [A,B,C] → three tuples; severity-mixed map → mixed-severity tuples). ~12 cases.
- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — NEW. ~150 LOC. The overlay subscribes to `useAudienceActiveDiagnostics(sessionId)` via the Zustand hook, flattens with `flattenActiveDiagnosticsForFire`, then feeds the (identityKey, nodeId) pairs into a `commitDiagnosticFirePlacements(cy)` closure that resolves each `nodeId` to a `renderedBoundingBox()` center on `cy`. The composite key `${identityKey}\0${nodeId}` drives `useSeenKeysGate<string>`. Two severity-specific animation classes: `aud-diagnostic-fire-blocking` and `aud-diagnostic-fire-advisory`. The wrapper `<span data-diagnostic-fire-anim="" data-severity={...} data-identity-key={...} data-node-id={...}>` carries presence markers + per-severity attribute for test selectors.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — NEW. ~14 Vitest cases (initial-mount no-class across both severities, post-mount fire animates correctly per severity, post-mount clear does not re-animate on subsequent re-fire, multiple nodes of one cycle each animate once, multi-node diagnostic that includes a pre-seen node animates only the new nodes, no animation on `'cleared'`, re-render with identical activeDiagnostics no-op, parameterized severity test for each diagnostic kind).
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. One new import (`AudienceDiagnosticFireOverlay`), one new mount line after the existing `<AudienceWithdrawalHaloOverlay>` mount, one prop drill of `sessionId` if not already accessible from inside the overlay (it is, via context — see Constraints), header docblock refinement-trail entry.
- `apps/audience/src/graph/GraphView.test.tsx` — POSSIBLY MODIFIED. If existing assertions count overlays, bump 5 → 6. Otherwise byte-unchanged.
- `apps/audience/src/index.css` — MODIFIED. Append `[data-diagnostic-fire-anim]` selector (96px halo, two background gradients — blocking + advisory — keyed by `[data-severity="blocking"]` / `[data-severity="advisory"]`), `@keyframes aud-diagnostic-fire-blocking` and `@keyframes aud-diagnostic-fire-advisory` (or one shared keyframe with two utility classes parameterizing `animation-name`), the two `.aud-diagnostic-fire-blocking` / `.aud-diagnostic-fire-advisory` utility classes (each 450 ms `cubic-bezier(0.16, 1, 0.3, 1) forwards`), and the matching `prefers-reduced-motion: reduce` overrides for both.
- `apps/audience/src/index.test.ts` — MODIFIED. 4 new Vitest cases appended: presence of both keyframes + presence of both reduced-motion overrides.
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: closer adds `complete 100` to `aud_diagnostic_fire_animation`, edits the `aud_animation_pacing` `depends` line to include `!aud_diagnostic_fire_animation`, and registers the named-future-tasks (`shell_diagnostic_highlights_extract`, `aud_diagnostic_edge_fire_animation`) per the closer-registration request in Acceptance criteria.

Out of scope (deferred to existing or future leaves):

- **Per-edge diagnostic-fire halo.** Contradictions carry `edges: readonly string[]` (the contradicting edge pair), and coherency-hint sub-kinds carry edge identifiers. Edge halos require a separate overlay iteration (`cy.edges()`-driven, with edge-midpoint geometry) and a separate keyframe. Splitting node + edge halves keeps each leaf single-concern, follows the consolidated `aud_per_facet_visualization` Decision §3 "nodes-only" precedent the prior DOM-overlay siblings have respected, and matches the 1d effort budget. Deferred to `aud_diagnostic_edge_fire_animation` (NEW, ~0.5d, closer registers in WBS) — Decision §7 below.
- **A persistent steady-state diagnostic-highlight border on the audience.** The moderator and participant paint amber borders for `node[diagnosticSeverity = 'blocking' | 'advisory']` (moderator [`GraphView.tsx:548-599`](../../../apps/moderator/src/graph/GraphView.tsx#L548)). The audience does NOT mirror this — the broadcast surface is intentionally minimal, and the post-animation steady state is no border, the animation IS the entire diagnostic surface. Decision §8 below records the rationale. If product later surfaces a need for persistent diagnostic styling on the broadcast (e.g., long-running cycles that should stay visible), a future task `aud_diagnostic_steady_styling` (~1d, NOT pre-registered today) opens the question.
- **Lifting `diagnosticHighlights.ts` into `@a-conversa/shell`.** Three callers now carry near-identical ports (moderator, participant, audience). The natural unification point is the shell, mirroring how `axiomMarks.ts` and `annotations.ts` followed the "extract on the third caller" policy. This leaf ports rather than lifts — the lift carries cross-surface drift risk and a much larger blast radius (touching all three apps' import paths + their test fixtures) and belongs in its own focused task. Deferred to `shell_diagnostic_highlights_extract` (NEW, ~1d, closer registers in WBS) — Decision §3.
- **Lifting `activeDiagnostics` into `createDefaultWsStore()`.** Once the shell carries the projection helpers, the natural follow-on is to fold `activeDiagnostics` into the default WS store so the audience's `wsStore.ts` can collapse back to a one-line re-export. The lift is a small mechanical follow-on to `shell_diagnostic_highlights_extract`; bundled into the same future task to avoid an extra single-purpose leaf.
- **Cycle-as-ring directed visualization.** A cycle's `nodes: ['A','B','C']` describes a directed adjacency loop; a visualization that draws an explicit ring or animates along the cycle edges (chase-light) would be a richer cue than per-node halos. NOT pre-registered. The per-node halo conveys "these nodes are jointly the cycle" without overclaiming a graphical-language commitment; a future `aud_diagnostic_cycle_chase_animation` (~1d) could opt into the directed visualization once product surfaces the need.
- **Cleared-diagnostic fade-out animation.** A `'cleared'` event removes the diagnostic from `activeDiagnostics` and the halo `<span>` unmounts. A graceful fade-out (`@keyframes aud-diagnostic-clear`) before unmount would be a parallel decoration to the fire animation. NOT pre-registered: the broadcast viewer's primary attention is on diagnostic arrivals; clears are quieter by design and the abrupt-unmount is acceptable. A future `aud_diagnostic_clear_animation` (~0.5d, NOT pre-registered today) opens the question if product surfaces a need.
- **Pixel-stable frame-by-frame capture.** Animation timing is not captured by `aud_visual_regression`'s steady-state snapshots; the regression task pins post-animation steady state. Here the post-animation steady state is the absence of any decoration (the halo fades to `opacity: 0` and the node body is unchanged), so no new VR scenario is registered. Animation-timing capture would be the speculative `aud_animation_video_regression` (~1d, NOT pre-registered today).
- **Pacing constant tuning across the animation set.** This leaf chooses 450 ms ease-out (parity with the halo siblings — Decision §5 below); `aud_animation_pacing` is the cross-cutting cadence-tuning task that will revisit the constant alongside the other animation siblings' durations. The closer of THIS leaf adds `!aud_diagnostic_fire_animation` to that pacing task's `depends` line so it sees five shipped durations.
- **A Playwright spec exercising the live diagnostic-fire transition.** Per the deferred-e2e exception in the orchestrator brief (component not yet reachable): the audience surface is still placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); the per-session route lands in `aud_url_routing.aud_session_url`. Full deferral applies — the Vitest pins cover the behavioural seam. Decision §6 documents the routing of this debt onto the already-accumulating chain.
- **Moderator-side fire animation** (separate from the already-shipped moderator persistent diagnostic-highlight border). Not part of this leaf's surface.
- **`framer-motion`, `react-spring`, or any motion-framework dependency.** Rejected (Decision §1; cumulative posture).
- **Editing the Cytoscape `STYLESHEET` constant.** The audience does NOT add a persistent diagnostic-highlight selector (Decision §8); the steady-state canvas paint is unchanged.

## Why it needs to be done

Structural diagnostics are the methodology engine's pointed feedback to the moderator: "the argument graph just developed a cycle" or "two nodes contradict via the existing edge set" or "this claim has multiple warrants — methodology suggests reconciliation." These events are the proximate cause of moderator action (rule application, withdrawal request, decomposition prompt) and are thus among the most methodologically-significant moments a broadcast viewer can witness. Without a temporal cue, a viewer not already watching the affected nodes has no way to know the methodology engine just flagged them — the rest of the broadcast canvas continues painting steady-state colors as if nothing happened.

The animation gives each fire a moment-of-arrival signal: an amber halo expanding outward from each affected node and fading to transparent over 450 ms. The halo's two-tone palette tells the viewer at a glance whether the diagnostic is **blocking** (the moderator MUST address it before proceeding — cycle, contradiction) or **advisory** (the methodology suggests attention but proceeding is allowed — multi-warrant, dangling-claim, coherency-hint). The post-animation steady state is intentionally no decoration: the broadcast surface remains visually clean, and the absence of persistent borders preserves the at-a-glance reading of the per-state palette (`STATE_COLORS`) that the prior `aud_*_styling` siblings established.

The `aud_animations` task group exists precisely to render the moment-of-arrival for each structural-event class — `aud_axiom_mark_animation` settled the per-participant declarative-mark class, `aud_node_appear_animation` settled the new-node class, `aud_proposed_to_agreed_animation` settled the per-facet agreement class, `aud_withdrawal_animation` settled the entity-rollup regression class. This leaf settles the **structural-diagnostic** class — the fifth shipped member of the group. The remaining unshipped sibling is `aud_decomposition_animation` (parent fading, components emerging).

Downstream concretely:

- **`aud_animation_pacing`** ([`tasks/50-audience-and-broadcast.tji:354-358`](../../50-audience-and-broadcast.tji#L354)) sees five shipped durations once this lands (350 ms axiom-mark, 450 ms node-appear, 350 ms pill-agreed, 450 ms withdrawal, 450 ms diagnostic-fire) and can rebalance. The closer adds `!aud_diagnostic_fire_animation` to its `depends` line.
- **`aud_session_url`** is the audience-reachability task; once it lands the inherited Playwright debt clears (Decision §6).
- **`shell_diagnostic_highlights_extract`** (NEW, named-future-task — Decision §3) lifts the duplicated helpers to the shell once a third caller's port is in hand. This leaf produces that third port.
- **`aud_diagnostic_edge_fire_animation`** (NEW, named-future-task — Decision §7) lights the edge counterparts; today's leaf scopes nodes-only.

Architecturally, this leaf is the audience surface's first reading of the WS broadcast's diagnostic axis. By keeping the audience's store extension structurally identical to the participant/moderator pattern, the future shell extraction is a near-mechanical refactor — no API reshaping required. The shell-extraction backstop is named and scoped so the duplication does not silently linger.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience uses Cytoscape with React DOM overlays. Per-element React decoration is the canonical pattern; Cytoscape's canvas-side `cy.animate(...)` is rejected for the same reasons the four predecessor animations rejected it (Decision §1).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — audience CSS lives at `apps/audience/src/index.css` with Tailwind v4 directives. The four predecessor keyframes coexist with Tailwind utilities ([`apps/audience/src/index.css`](../../../apps/audience/src/index.css)); this leaf appends two more.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest pins the React-side per-render behaviour AND the wsStore + helpers contract. The CSS-file presence pins use string-grep over the disk-read file content. Pixel-level animation capture is out of scope.
- [ADR 0024 — i18n: react-i18next + per-app catalogs](../../../docs/adr/0024-i18n-react-i18next-with-per-app-catalogs.md) — NO new i18n keys (halos carry no visible text; the per-kind translated description belongs to `i18n_diagnostic_descriptions.md`, consumed elsewhere). The halo `<span>` is `aria-hidden="true"`.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience artifact owns its CSS and its WS store extension; the new keyframes ship inside the audience bundle and do not leak to other artifacts.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — diagnostics live at the entity layer (cycles and contradictions are properties of the graph structure, not of a facet); the halo decorates entity-layer node bodies. The facet-pill layer is untouched.

No new ADR. The architectural seams (DOM-overlay halo with CSS-first keyframe, audience-local `activeDiagnostics` extension with shell-extraction deferred to a named-future-task, identity-key port mirroring the participant) are either settled by existing ADRs or by the cumulative posture three (now four) animation predecessors established and this leaf reinforces.

### Sibling refinements

- [`tasks/refinements/audience/aud_withdrawal_animation.md`](aud_withdrawal_animation.md) — direct structural precedent for the halo overlay shape; the 450 ms `cubic-bezier(0.16, 1, 0.3, 1)` `forwards` duration, the `useSeenKeysGate` posture, the test discipline are all adopted modulo the data source and the composite key.
- [`tasks/refinements/audience/aud_node_appear_animation.md`](aud_node_appear_animation.md) — the halo geometry (96px square, radial gradient fading to transparent at 75%) is mirrored.
- [`tasks/refinements/audience/aud_proposed_to_agreed_animation.md`](aud_proposed_to_agreed_animation.md) — composite-key `useSeenKeysGate` precedent (`${nodeId}:${facet}` → `${identityKey}\0${nodeId}` here).
- [`tasks/refinements/audience/aud_axiom_mark_animation.md`](aud_axiom_mark_animation.md) — established the CSS-first, no-motion-framework, `prefers-reduced-motion`-in-CSS, Vitest-pins posture.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — established the shared hooks consumed unchanged.
- [`tasks/refinements/audience/aud_ws_client.md`](aud_ws_client.md) — explicitly named the audience as the "third caller" trigger for the `activeDiagnostics` extension; this leaf executes that trigger.
- [`tasks/refinements/audience/aud_meta_disagreement_split.md`](aud_meta_disagreement_split.md) — explicitly defers the structural-diagnostic visual axis to this leaf.
- `tasks/refinements/participant-ui/part_diagnostic_highlights.md` — the participant's reference implementation; the helpers ported here mirror its module structure.
- `tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md` — the moderator's persistent-border pattern, used here only as palette source (amber-700 / amber-400) not as steady-state model.
- `tasks/refinements/backend/ws_diagnostic_broadcast.md` — the wire contract this leaf consumes (`DiagnosticPayload` envelope, `fired`/`cleared` status semantics).

### Live code the leaf modifies / creates

- [`apps/audience/src/ws/wsStore.ts`](../../../apps/audience/src/ws/wsStore.ts) — MODIFIED. Currently a thin one-liner re-export of `createDefaultWsStore()`. Replaced with an extension pattern mirroring [`apps/participant/src/ws/wsStore.ts:54-199`](../../../apps/participant/src/ws/wsStore.ts#L54) verbatim modulo the `WsSessionState` interface name (kept as-is for symmetry) and the absence of any non-diagnostic extensions. The docblock retains the "third caller trigger" comment but updates it to note the diagnostic axis is now lifted locally and the shell-side extract is named-future.
- `apps/audience/src/ws/wsStore.test.ts` — NEW or MODIFIED. The audience does not currently have wsStore tests (the shell's default factory has its own coverage). Add ~4 cases pinning the four `applyDiagnostic` behaviours.
- `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` — NEW. Selector hook mirroring [`apps/audience/src/ws/useAudienceConnectionStatus.ts`](../../../apps/audience/src/ws/useAudienceConnectionStatus.ts)'s shape:

  ```ts
  export function useAudienceActiveDiagnostics(
    sessionId: string,
  ): ReadonlyMap<string, DiagnosticPayload> {
    return audienceWsStore(
      (s) => s.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS,
    );
  }
  ```

- `apps/audience/src/graph/diagnosticHighlights.ts` — NEW. Mirrors [`apps/participant/src/graph/diagnosticHighlights.ts`](../../../apps/participant/src/graph/diagnosticHighlights.ts) lines 32–280 (wire types + `diagnosticIdentityKey` + `affectedEntities`); SKIPS the full `projectDiagnosticHighlights` because the audience does not stamp per-entity highlights into `cy.data()` (Decision §8). Adds a focused `flattenActiveDiagnosticsForFire(activeDiagnostics)` helper:

  ```ts
  export interface DiagnosticFireTuple {
    readonly identityKey: string;
    readonly nodeId: string;
    readonly severity: DiagnosticHighlightSeverity;
  }

  export function flattenActiveDiagnosticsForFire(
    activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
  ): readonly DiagnosticFireTuple[] {
    const tuples: DiagnosticFireTuple[] = [];
    for (const [identityKey, payload] of activeDiagnostics) {
      const { nodes } = affectedEntities(payload);
      for (const nodeId of nodes) {
        tuples.push({ identityKey, nodeId, severity: payload.severity });
      }
    }
    return tuples;
  }
  ```

  The wire-type interfaces and the identity-key formula are byte-identical to the participant's port to keep the `diagnosticHighlights.test.ts` round-trip pins valid against the same hand-built payloads. Header docblock cites both the participant and moderator predecessors, the shell-extraction named-future-task, and the cross-surface drift invariant.

- `apps/audience/src/graph/diagnosticHighlights.test.ts` — NEW. ~12 Vitest cases:
  1. `diagnosticIdentityKey` matches the participant's formula for cycle, contradiction, multi-warrant, dangling-claim, and each coherency-hint sub-kind (5 cases — hand-built payloads, identity strings asserted literal).
  2. `affectedEntities` returns the expected `{ nodes, edges }` shape for each kind (5 cases).
  3. `flattenActiveDiagnosticsForFire` (a) returns empty for empty input, (b) flattens a single cycle of 3 nodes into 3 tuples carrying the same identityKey, (c) preserves severity from each payload (mixed-severity map yields mixed-severity tuples).

- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — NEW. ~150 LOC mirroring the structural shape of `WithdrawalHaloOverlay.tsx` with three differences: (a) the placement source is `useAudienceActiveDiagnostics(sessionId)` flattened via `flattenActiveDiagnosticsForFire`, intersected with `cy.nodes()` positions; (b) the composite key is `${identityKey}\0${nodeId}`; (c) the className gate selects between two classes by severity. Sketch:

  ```tsx
  import { type ReactElement, type RefObject } from 'react';
  import type { Core, NodeSingular } from 'cytoscape';
  import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';
  import { flattenActiveDiagnosticsForFire } from './diagnosticHighlights.js';
  import { useAudienceActiveDiagnostics } from '../ws/useAudienceActiveDiagnostics.js';

  export interface AudienceDiagnosticFireOverlayProps {
    readonly cy: Core | null;
    readonly containerRef: RefObject<HTMLDivElement | null>;
    readonly sessionId: string;
  }

  interface DiagnosticFirePlacement {
    readonly compositeKey: string;
    readonly identityKey: string;
    readonly nodeId: string;
    readonly severity: 'blocking' | 'advisory';
    readonly x: number;
    readonly y: number;
  }

  export function AudienceDiagnosticFireOverlay({
    cy,
    containerRef,
    sessionId,
  }: AudienceDiagnosticFireOverlayProps): ReactElement {
    void containerRef;
    const active = useAudienceActiveDiagnostics(sessionId);
    const tuples = useMemo(() => flattenActiveDiagnosticsForFire(active), [active]);
    const placements = useCytoscapeOverlayPlacements<DiagnosticFirePlacement>(
      cy,
      (cyInstance) => commitDiagnosticFirePlacements(cyInstance, tuples),
    );
    const compositeKeys = placements.map((p) => p.compositeKey);
    const isNewPair = useSeenKeysGate(compositeKeys);

    return (
      <div
        data-testid="audience-diagnostic-fire-overlay"
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        {placements.map((p) => {
          const isNew = isNewPair(p.compositeKey);
          const animClass = isNew
            ? p.severity === 'blocking'
              ? 'aud-diagnostic-fire-blocking'
              : 'aud-diagnostic-fire-advisory'
            : '';
          return (
            <span
              key={p.compositeKey}
              data-diagnostic-fire-anim=""
              data-severity={p.severity}
              data-identity-key={p.identityKey}
              data-node-id={p.nodeId}
              className={animClass}
              style={{
                position: 'absolute',
                left: `${String(p.x)}px`,
                top: `${String(p.y)}px`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          );
        })}
      </div>
    );
  }

  function commitDiagnosticFirePlacements(
    cy: Core,
    tuples: readonly DiagnosticFireTuple[],
  ): readonly DiagnosticFirePlacement[] {
    const next: DiagnosticFirePlacement[] = [];
    for (const t of tuples) {
      const node = cy.getElementById(t.nodeId) as NodeSingular;
      if (node.empty()) continue;
      const bb = node.renderedBoundingBox();
      next.push({
        compositeKey: `${t.identityKey}\0${t.nodeId}`,
        identityKey: t.identityKey,
        nodeId: t.nodeId,
        severity: t.severity,
        x: (bb.x1 + bb.x2) / 2,
        y: (bb.y1 + bb.y2) / 2,
      });
    }
    return next;
  }
  ```

  Two subtle things in the sketch: (i) the `commit` closure depends on `tuples`; the `useCytoscapeOverlayPlacements` hook uses a latest-ref for `commit` so the dep array `[cy]` stays stable — but `tuples` changing does NOT trigger a re-commit by itself, so we need a second mechanism: when `tuples` changes (the Zustand selector emits a new map), force a re-commit by either (a) calling `cy.emit('add')` from a `useEffect` watching `tuples`, (b) including `tuples` in a second `useEffect` that calls the underlying commit-trigger imperatively, or (c) restructuring the hook to expose a `revalidate()` callback. The simplest is option (b) — a `useEffect([tuples])` that toggles a forced-commit signal that the `useCytoscapeOverlayPlacements` consumes. The implementer should follow the simplest of these that the existing hook contract supports (the hook's commit closure runs once per rAF tick; nudging it to re-run on `tuples` change is the load-bearing piece). If the hook needs a minor extension to accept an extra trigger-key, that extension is in-scope as a hook addition — `useCytoscapeOverlayPlacements(cy, commit, [...triggers])` would be the smallest surface change. Decision §3a documents the trade-off.

- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — NEW. ~14 cases:
  1. Initial mount with `activeDiagnostics` empty → no halos rendered.
  2. Initial mount with one cycle already active over 3 nodes → 3 halos rendered, none carry the animation class (lazy-init seed).
  3. Post-mount fire of a new cycle (3 nodes, previously empty) → 3 halos appear AND each carries the `aud-diagnostic-fire-blocking` class on first render.
  4. Post-mount fire of an advisory diagnostic (e.g., dangling-claim on node A) → halo carries `aud-diagnostic-fire-advisory`.
  5. Post-mount fire of a multi-warrant diagnostic with 3 nodes → 3 halos each carrying `aud-diagnostic-fire-advisory`.
  6. Post-mount `'cleared'` event removes the halos (they unmount).
  7. Re-`'fired'` of the same identityKey on the same node after a `'cleared'` does NOT re-add the class (seen-Set retains the composite key).
  8. Post-mount fire that re-adds an identical identityKey (server re-emits) is a no-op — same composite keys already seen.
  9. Re-render with identical activeDiagnostics no-op — same composite keys do not re-add the class.
  10. Multi-diagnostic on overlapping nodes (cycle [A,B,C] AND dangling-claim on A) → A carries TWO halos with different composite keys; the blocking one carries `aud-diagnostic-fire-blocking`, the advisory one carries `aud-diagnostic-fire-advisory`.
  11. Halo `<span>` carries `data-diagnostic-fire-anim`, `data-severity`, `data-identity-key`, `data-node-id` attributes for test selector stability.
  12. Wrapper carries `aria-hidden="true"`.
  13. A node referenced by a diagnostic but absent from `cy` (`cy.getElementById(...).empty()`) is silently skipped (no halo, no crash).
  14. Parameterized severity case across all five diagnostic kinds: cycle (blocking), contradiction (blocking), multi-warrant (advisory), dangling-claim (advisory), coherency-hint (advisory) — each kind's fire yields the expected severity class.

- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — MODIFIED. Three additive edits: one import line for `AudienceDiagnosticFireOverlay`, one mount line after the existing `<AudienceWithdrawalHaloOverlay>`, one header refinement-trail entry. The `sessionId` prop is already in `<AudienceGraphView>`'s prop set (verify at implementation; if not, drill from parent — the route owns the id).
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — POSSIBLY MODIFIED. Bump overlay count 5 → 6 if asserted; otherwise byte-unchanged.
- [`apps/audience/src/graph/cytoscapeOverlayHooks.ts`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts) — POSSIBLY MINOR EDIT. If the existing `useCytoscapeOverlayPlacements` signature does not accept an external trigger-keys array, a small additive extension lands here: a third optional parameter `triggers?: readonly unknown[]` (default `[]`) included alongside `cy` in the subscription effect's dep array, so a change to `triggers` re-runs the latest-ref-`commit`. The extension is additive — the four existing callers pass nothing and behave unchanged. Decision §3a below justifies this minor hook extension vs the alternative of a sibling effect inside the overlay.
- [`apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx) — POSSIBLY MODIFIED. If the hook gains the optional `triggers` parameter, add 2 cases: (i) changing a trigger key re-runs the commit, (ii) the four existing callers' tests (consumed unchanged) still pass.
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — UNCHANGED. The audience does NOT stamp per-entity diagnostic data into `cy.data()` (Decision §8). The overlay reads from the WS store directly via the selector hook.
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — UNCHANGED. No new selectors (Decision §8).
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — MODIFIED. Two new keyframes + two utility classes + two `prefers-reduced-motion` overrides + one shared base selector.
- [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts) — MODIFIED. 4 new CSS smoke pins (keyframe presence × 2, reduced-motion override × 2).
- [`packages/shell/src/ws/defaultStore.ts`](../../../packages/shell/src/ws/defaultStore.ts) — UNCHANGED. The shell continues to omit `activeDiagnostics`; the extraction is deferred to a named-future-task.
- `packages/shell/src/graph/diagnosticHighlights.ts` — DOES NOT YET EXIST. The shell extraction is deferred (Decision §3).
- `apps/moderator/**`, `apps/participant/**`, `apps/server/**`, `apps/root/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. No new dependency.

### What the surface MUST NOT do

- **No new dependency.** `framer-motion`, `react-spring`, `@react-spring/web`, `motion`, `react-transition-group` are all rejected.
- **No edit to `@a-conversa/shell`.** The shell's `createDefaultWsStore()` continues to omit `activeDiagnostics`. The audience extends locally; the shell lift is named-future.
- **No edit to the Cytoscape `STYLESHEET`.** The audience does NOT add a persistent diagnostic-highlight border (Decision §8). The static canvas paint is unchanged.
- **No `cy.animate(...)` call.** The halo is a React DOM overlay.
- **No JavaScript-driven tween loop.** The CSS keyframe runs on the GPU compositor; JS only decides which halos carry the class.
- **No animation on initial mount.** The lazy-init seed under `useSeenKeysGate` ensures diagnostics already active at audience-join do not animate.
- **No animation re-fire on pan/zoom/resize.** React reconciliation keys the wrapper `<span>` by composite key; the seen-Set retains keys across re-renders.
- **No animation on `'cleared'` events.** A clear removes the diagnostic from `activeDiagnostics`, the composite key drops out of `currentKeys`, the halo `<span>` unmounts. No "fade-out" cue (deferred to future `aud_diagnostic_clear_animation`).
- **No animation on re-`'fired'` of the same identityKey.** The seen-Set retains the composite key after the first observation; subsequent re-fires of the same (identityKey, nodeId) pair do not re-animate.
- **No edge halo.** Edges affected by contradictions / coherency-hints are NOT halo'd by this leaf (deferred to `aud_diagnostic_edge_fire_animation`).
- **No new i18n keys.** The halo has no visible text; `aria-hidden="true"`.
- **No port of the FULL `projectDiagnosticHighlights`.** The audience does not paint per-entity steady-state highlights; it consumes only `affectedEntities` + the identity formula via the focused `flattenActiveDiagnosticsForFire` helper.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/ws/wsStore.ts` — MODIFIED. ~50 LOC replacement of the one-line re-export. Mirrors `apps/participant/src/ws/wsStore.ts:54-199` shape verbatim:

  ```ts
  import { create } from 'zustand';
  import {
    type BaseWsSessionState,
    type BaseWsStoreState,
    createDefaultWsStoreImpl,
    ensureDefaultSession,
  } from '@a-conversa/shell';
  import type { DiagnosticPayload } from '@a-conversa/shared-types';
  import { diagnosticIdentityKey } from '../graph/diagnosticHighlights.js';

  export interface WsSessionState extends BaseWsSessionState {
    readonly activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>;
  }

  export interface WsStoreState extends BaseWsStoreState {
    readonly sessionState: Readonly<Record<string, WsSessionState>>;
    applyDiagnostic: (payload: DiagnosticPayload) => void;
    // (inherited methods declared here per the participant's pattern)
  }

  const EMPTY_ACTIVE: ReadonlyMap<string, DiagnosticPayload> = new Map();

  function ensureSession(state: WsStoreState, sessionId: string): WsSessionState {
    const base = ensureDefaultSession(state, sessionId);
    return { ...base, activeDiagnostics: base.activeDiagnostics ?? EMPTY_ACTIVE };
  }

  export const audienceWsStore = create<WsStoreState>((set, get, api) => {
    const base = createDefaultWsStoreImpl(set, get, api);
    return {
      ...base,
      applyDiagnostic: (payload) =>
        set((state) => {
          const session = ensureSession(state as WsStoreState, payload.sessionId);
          const key = diagnosticIdentityKey(payload);
          const nextActive = new Map(session.activeDiagnostics);
          if (payload.status === 'fired') {
            nextActive.set(key, payload);
          } else {
            nextActive.delete(key);
          }
          return {
            sessionState: {
              ...state.sessionState,
              [payload.sessionId]: {
                ...session,
                lastDiagnostic: payload,
                activeDiagnostics: nextActive,
              },
            },
          } as Partial<WsStoreState>;
        }),
    };
  });
  ```

  The exact shape may need to invoke whatever extension primitives the shell exports (the participant's reference shows `BaseWsSessionState`, `createDefaultWsStoreImpl`, `ensureDefaultSession` or equivalent — the implementer reads the participant's wsStore.ts as the canonical pattern). If the shell does NOT expose primitives suitable for an "extend BaseWs..." pattern (and the participant instead duplicates the whole factory), the audience adopts the same duplication — symmetry with the participant is the load-bearing concern, not surface-area minimization.

- `apps/audience/src/ws/wsStore.test.ts` — NEW or MODIFIED (file exists if audience already has a small test for the shell-default re-export; otherwise new). ~4 cases pinning the `applyDiagnostic` contract per the four behaviours enumerated above.
- `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` — NEW. ~15 LOC selector hook.
- `apps/audience/src/graph/diagnosticHighlights.ts` — NEW. ~150 LOC port of the participant's identity-key + affected-entities subset + the new `flattenActiveDiagnosticsForFire` helper.
- `apps/audience/src/graph/diagnosticHighlights.test.ts` — NEW. ~12 Vitest cases.
- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — NEW. ~150 LOC. Structure per the sketch above.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — NEW. ~14 cases.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Three additive edits.
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` — POSSIBLY MODIFIED. Optional `triggers` parameter, additive.
- `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — POSSIBLY MODIFIED. 2 new cases if the optional parameter lands.
- `apps/audience/src/index.css` — MODIFIED. Appended block:

  ```css
  /* `aud_diagnostic_fire_animation` — one-shot amber halos on nodes affected
   * by a newly-fired structural diagnostic (cycle, contradiction, multi-warrant,
   * dangling-claim, coherency-hint). Severity-keyed: amber-700 for `'blocking'`,
   * amber-400 for `'advisory'`. The two-tone palette tells the broadcast viewer
   * "this fire MUST be addressed" vs "this fire SHOULD be reviewed" at a glance.
   * Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
   *   Decision §1 — CSS `@keyframes` on a React-keyed halo `<span>` in a
   *   new `<AudienceDiagnosticFireOverlay>`. NOT `cy.animate()`, NOT a JS
   *   tween, NOT a motion-framework dependency.
   *   Decision §4 — `useSeenKeysGate` over `${identityKey}\0${nodeId}`
   *   composite keys; first non-empty commit seeds with diagnostics
   *   already active at audience-join (no retrospective animation);
   *   subsequent fires animate exactly once per (identityKey, nodeId, session).
   *   Decision §5 — 450 ms with `cubic-bezier(0.16, 1, 0.3, 1) forwards`;
   *   parity with the node-appear and withdrawal halos.
   *   Decision §6 — `prefers-reduced-motion: reduce` suppression in CSS.
   *   Decision §7 — node halos only; edge halos deferred.
   *   Decision §8 — animation is the entire diagnostic surface; no
   *   persistent steady-state border. */
  [data-diagnostic-fire-anim] {
    width: 96px;
    height: 96px;
    pointer-events: none;
    opacity: 0;
    border-radius: 50%;
  }
  [data-diagnostic-fire-anim][data-severity='blocking'] {
    background-image: radial-gradient(
      circle,
      rgba(180, 83, 9, 0.50) 0%,
      rgba(180, 83, 9, 0.18) 50%,
      rgba(180, 83, 9, 0) 75%
    );
  }
  [data-diagnostic-fire-anim][data-severity='advisory'] {
    background-image: radial-gradient(
      circle,
      rgba(251, 191, 36, 0.45) 0%,
      rgba(251, 191, 36, 0.15) 50%,
      rgba(251, 191, 36, 0) 75%
    );
  }

  @keyframes aud-diagnostic-fire-blocking {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(0.6);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.8);
    }
  }

  @keyframes aud-diagnostic-fire-advisory {
    from {
      opacity: 1;
      transform: translate(-50%, -50%) scale(0.6);
    }
    to {
      opacity: 0;
      transform: translate(-50%, -50%) scale(1.7);
    }
  }

  .aud-diagnostic-fire-blocking {
    animation: aud-diagnostic-fire-blocking 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .aud-diagnostic-fire-advisory {
    animation: aud-diagnostic-fire-advisory 450ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .aud-diagnostic-fire-blocking,
    .aud-diagnostic-fire-advisory {
      animation: none;
    }
  }
  ```

  The two keyframes are near-identical (only the final `scale` differs: 1.8 for blocking, 1.7 for advisory — a subtle differentiation echoing the "blocking is heavier" semantics). The implementer MAY consolidate into a single keyframe + CSS-variable-driven `--halo-end-scale` if the resulting code is clearer; either pattern is acceptable.

- `apps/audience/src/index.test.ts` — MODIFIED. 4 cases appended:
  1. `@keyframes aud-diagnostic-fire-blocking` present.
  2. `@keyframes aud-diagnostic-fire-advisory` present.
  3. `prefers-reduced-motion: reduce` clause overrides `.aud-diagnostic-fire-blocking { animation: none }`.
  4. Same clause overrides `.aud-diagnostic-fire-advisory { animation: none }`.

### Files this task does NOT touch

- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**` (other than possibly importing extension primitives — read-only), `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/stylesheet.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/AxiomMarkOverlay.tsx`, `apps/audience/src/graph/AnnotationOverlay.tsx`, `apps/audience/src/graph/NodeAppearOverlay.tsx`, `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `apps/audience/src/graph/WithdrawalHaloOverlay.tsx`, `apps/audience/src/graph/axiomMarks.ts`, `apps/audience/src/graph/annotations.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED (no new dep).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/ws/wsStore.ts` carries the `activeDiagnostics` extension mirroring the participant's pattern; previous one-line re-export removed.
- `apps/audience/src/ws/wsStore.test.ts` carries the 4 cases pinning `applyDiagnostic` fired/cleared/replace/initial-empty behaviour; all pass.
- `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` exists; selector hook returns the per-session map.
- `apps/audience/src/graph/diagnosticHighlights.ts` exists with `diagnosticIdentityKey`, `affectedEntities`, the wire-type interfaces, and `flattenActiveDiagnosticsForFire`. The identity-key formula is byte-identical to the participant's.
- `apps/audience/src/graph/diagnosticHighlights.test.ts` carries ~12 cases; the identity-key round-trips for all five diagnostic kinds, `affectedEntities` returns expected node/edge sets per kind, `flattenActiveDiagnosticsForFire` emits expected tuples; all pass.
- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` exists with the structure given under Constraints; subscribes to `useAudienceActiveDiagnostics`, consumes `flattenActiveDiagnosticsForFire`, gates on `${identityKey}\0${nodeId}` composite key, applies severity-keyed animation classes.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` carries ~14 cases; all pass.
- `apps/audience/src/graph/GraphView.tsx` carries the new import + mount + header-trail edits; the overlay mounts as the sixth DOM-overlay sibling.
- `apps/audience/src/graph/GraphView.test.tsx` is byte-unchanged unless it asserts an overlay count, in which case 5 → 6.
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` either accepts the new optional `triggers` parameter additively (no caller break) OR the overlay uses an in-component effect mechanism that does not require the hook extension — the implementer chooses; whichever, the four existing overlay callers' tests pass byte-unchanged.
- `apps/audience/src/index.css` carries the `[data-diagnostic-fire-anim]` base + per-severity selector pair, the two `@keyframes`, the two utility classes, and the `prefers-reduced-motion: reduce` overrides per Constraints.
- `apps/audience/src/index.test.ts` carries the 4 new cases; total assertion count rises by 4.
- `apps/audience/package.json` is byte-unchanged (no new dependency).
- All existing audience overlay tests + `cytoscapeOverlayHooks.test.tsx` pass byte-unchanged (modulo the 2 additive hook-extension cases if the implementer takes that path).
- Per ADR 0022, no throwaway smoke scripts. Vitest pins the React-side per-render class logic (~14 overlay cases), the wsStore extension (~4 cases), the helpers port (~12 cases), and the CSS file presence (~4 cases). Animation-timing pixel capture is left to speculative future tooling.
- Per the orchestrator brief's deferred-e2e exception ("component not yet reachable"): Playwright coverage for the animation is **deferred to `aud_url_routing.aud_session_url`** — the same destination as the four animation predecessors. Decision §6 records the chain-length tally and routing rationale. Two scenarios this leaf contributes (i) on initial load with no active diagnostics, no `[data-diagnostic-fire-anim]` halos render; (ii) on a WS-stream `'fired'` event delivering a cycle / contradiction / advisory diagnostic, halos appear on each affected node and carry the correct `aud-diagnostic-fire-blocking` / `aud-diagnostic-fire-advisory` class within the rAF settle window.
- **The closer adds `!aud_diagnostic_fire_animation` to the `aud_animation_pacing` `depends` line** at [`tasks/50-audience-and-broadcast.tji:357`](../../50-audience-and-broadcast.tji#L357) in the same commit as `complete 100` (verified at refinement-time the line currently reads `depends !aud_node_appear_animation, !aud_proposed_to_agreed_animation, !aud_axiom_mark_animation, !aud_withdrawal_animation` and does NOT yet name this leaf).
- **The closer registers the two named-future-tasks in the WBS**:
  - `shell_diagnostic_highlights_extract` (~1d) — under `tasks/27-shell-package.tji` (or the area the closer judges canonical for shell-package work): "Lift `diagnosticHighlights.ts` + `activeDiagnostics` extension into `@a-conversa/shell` once the three callers (moderator, participant, audience) stabilize; collapse the per-app duplications." Depends on this leaf having shipped its third caller.
  - `aud_diagnostic_edge_fire_animation` (~0.5d) — under `audience.aud_animations` (sibling of this leaf): "Animate diagnostic firing on affected edges (contradiction edges, coherency-hint edges); mirrors `aud_diagnostic_fire_animation` shape with an edge-midpoint overlay." Depends on this leaf.
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by ~14 overlay + ~12 helpers + ~4 wsStore + ~4 CSS smoke = ~34 new cases; ±2 hook-extension cases if that path is taken).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is small — three new files (~350 LOC combined after compression), one CSS block (~50 lines), no new dependency.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_diagnostic_fire_animation`, the `aud_animation_pacing` `depends` line edit, and the two new task entries in the same commit cluster (the closer's ritual).

## Decisions

### §1 — CSS `@keyframes` on a React-keyed halo `<span>` in a NEW DOM-overlay sibling (NOT `cy.animate()`, NOT JS tween, NOT motion framework, NOT fold into existing overlay)

Five options for "animate nodes when an active diagnostic newly references them":

A. **A new `<AudienceDiagnosticFireOverlay>` DOM sibling** mirroring `<AudienceWithdrawalHaloOverlay>`'s halo overlay structure. Per-(diagnostic, node) halo `<span>` centered on each currently-affected node; `useSeenKeysGate` keyed on `${identityKey}\0${nodeId}` over currently-active pairs.

B. **In-place wrap inside an existing overlay** (e.g., fold into `<AudienceNodeAppearOverlay>`). Rejected: there is no React-rendered element associated with the diagnostic-affected node body to wrap; the node body lives on Cytoscape's canvas.

C. **Animate via Cytoscape's `cy.animate(...)`** (canvas-side). Rejected by the four predecessor animations' Decision §1 verbatim.

D. **JS-driven tween via `requestAnimationFrame` directly**. Rejected by the cumulative posture.

E. **`framer-motion` or `react-spring`.** Rejected.

**Chosen: A.** Option A is the direct structural mirror of `aud_withdrawal_animation` / `aud_node_appear_animation`. The halo geometry and the React+CSS contract are identical; the only delta is the data source (WS-store-driven instead of cy.data-driven). The five-options enumeration here mirrors the predecessor refinements' enumerations to make the alignment explicit, not to relitigate settled posture.

### §2 — A NEW overlay file, NOT a fold into an existing overlay (subsumed under §1 but called out structurally)

The overlay is the sixth React file in `apps/audience/src/graph/`. Each existing overlay paints one semantic class of decoration; mixing diagnostic-fire into another would conflate semantic classes, complicate testing, and obscure the symmetry of the `aud_animations.*` group. The same rationale `aud_withdrawal_animation` Decision §2 surfaced applies verbatim.

### §3 — Audience-local extension of `activeDiagnostics` + audience-local port of `diagnosticHighlights.ts`; SHELL extraction deferred to a named-future-task

Four options for plumbing the diagnostic axis into the audience:

A. **Extend audience's `wsStore.ts` locally + port `diagnosticHighlights.ts` locally; defer shell extraction to a named-future-task.** Three callers (moderator, participant, audience) now carry near-identical ports; the natural unification is `@a-conversa/shell`, mirroring the `axiomMarks.ts` / `annotations.ts` "extract on third caller" policy. But the lift itself is a substantial refactor touching all three apps' import paths and their test fixtures; bundling it into this leaf doubles the blast radius. The closer registers `shell_diagnostic_highlights_extract` (~1d) as a named-future-task; this leaf does the third-caller port that *triggers* the future extraction.

B. **Lift to `@a-conversa/shell` as part of this leaf.** Most architecturally pure — the third caller materialises and immediately consolidates the duplication. Rejected because (i) the lift touches three apps + their test fixtures + the shell's exported surface, expanding blast radius beyond a 1d budget; (ii) the moderator and participant ports may have drifted subtly from one another since their original landing dates, and reconciling those drifts under THIS leaf's budget risks a sloppy merge; (iii) the closer-managed named-future-task path is the same path `aud_axiom_mark_decoration` and `aud_annotation_rendering` chose (port verbatim; defer the shell lift to a focused task); option A is in lockstep with established precedent.

C. **Read the moderator's or participant's ported file directly from the audience (relative import across app boundaries).** Rejected — `@a-conversa/shell` is the cross-app sharing seam; reaching into a sibling app's source is architecturally forbidden.

D. **Implement diagnostic data flow without the audience-local wsStore extension** — subscribe directly to `lastDiagnostic` in the overlay and maintain a local Map. Rejected because (i) `lastDiagnostic` does not capture the audience's join-time existing-diagnostic snapshot (the audience joins mid-session; the server's catch-up will fire each currently-active diagnostic in sequence, and lastDiagnostic only retains the most recent), (ii) keeping the diagnostic Map inside the overlay duplicates state that belongs in the WS store, (iii) future audience surfaces that want to read activeDiagnostics (e.g., a producer-facing diagnostic chip) would have nowhere to read from. Option A's wsStore extension is the canonical seam.

**Chosen: A.** This leaf is the third caller (the explicit `aud_ws_client` Decision §B prophecy fulfilled); the shell extraction is registered as a named-future-task `shell_diagnostic_highlights_extract` (closer registers in WBS). The audience-local extension's shape is byte-identical (modulo the type/file names) to the participant's, so the future shell lift is a near-mechanical refactor.

### §3a — Hook extension (`triggers` parameter) on `useCytoscapeOverlayPlacements` if needed for store-driven re-commit

A subtle structural concern: the existing `useCytoscapeOverlayPlacements` hook re-runs its commit closure on Cytoscape events (`'render pan zoom resize'`, `'position'`, `'add remove data'`) but NOT on external state changes. The diagnostic-fire overlay's source-of-truth is the WS-store `activeDiagnostics` Map; when that Map changes (without any cy event), the overlay needs to re-commit.

Three options:

A. **Extend `useCytoscapeOverlayPlacements` additively to accept an optional `triggers: readonly unknown[]` parameter** included in the subscription effect's dep array. The four existing callers pass nothing (or `[]`) and are unaffected. The diagnostic-fire overlay passes `[tuples]` so a change to the flattened diagnostic tuples re-runs the commit closure.

B. **Maintain a parallel `useEffect([tuples])` inside `<AudienceDiagnosticFireOverlay>` that imperatively triggers cy to emit an event the hook subscribes to**, e.g., `cy.emit('data')`. Functional but hacky; the cy event is being abused as a re-commit signal.

C. **Restructure the hook to expose a `revalidate()` callback** the overlay can invoke from a `useEffect`. More structurally honest than B but a larger surface change.

**Chosen: A.** Option A is the minimal additive extension — the hook's behaviour is unchanged for the four existing callers, and the new caller gets the trigger plumbing it needs without an imperative side-channel. The change is one optional parameter + one entry in the dep array; the hook tests gain 2 cases. Option B muddles the hook's contract by abusing cy events for non-cy state changes. Option C is correct but over-scoped for a small extension. Option A's "extend additively on the new caller's demand" is the simplest path that respects the hook's purity.

### §4 — `useSeenKeysGate` keyed by `${identityKey}\0${nodeId}` composite over currently-active (diagnostic, node) pairs

Three options for the seen-Set / key-shape:

A. **`useSeenKeysGate(compositeKeys)` where `compositeKeys = placements.map(p => p.compositeKey)` AND `compositeKey = ${identityKey}\0${nodeId}`.** Mirrors the `aud_proposed_to_agreed_animation` composite-key pattern (`${nodeId}:${facet}`). Each unique (diagnostic-identity, node-identity) pair gets its own gate entry; a node affected by two diagnostics gets two halos; the same node re-affected by the same diagnostic (after a clear/re-fire) does not re-animate.

B. **`useSeenKeysGate(identityKeys)` keyed on `identityKey` only, with the overlay rendering one halo per affected node but the gate seeded once per diagnostic.** Rejected: a cycle's first observation would gate-seed ONE composite key but render THREE halos (the three cycle nodes); only one of the three would animate, the other two would silently fail to animate. Breaks the per-node-arrival semantics.

C. **`useSeenKeysGate(nodeIds)` keyed on `nodeId` only.** Rejected: a node already affected by some prior advisory diagnostic, then re-affected by a cycle (blocking), would NOT animate because its `nodeId` was already seen. Breaks the per-diagnostic-arrival semantics — a methodologically distinct event class would be silenced.

**Chosen: A.** The composite key is the only shape that captures both "first observation per session" AND "per (diagnostic-identity, affected-node) pair". The cumulative posture `aud_proposed_to_agreed_animation` Decision §4 surfaced (composite keys for multi-axis transitions) applies directly.

Subtle properties:

- **Multi-node diagnostic, mid-session join: only the new arrivals animate.** Cycle [A,B,C] fires after a prior cycle [A,D,E] cleared. The seen-Set holds `cycle\0A\0D\0E\0A` (the composite key for A from the prior cycle). The new cycle's composite keys are `cycle\0A\0B\0C\0A`, `cycle\0A\0B\0C\0B`, `cycle\0A\0B\0C\0C` — all three are new (the identity-key differs even though node A appears in both cycles), all three animate.
- **Re-fire of an identical identityKey is a no-op.** If the server re-emits `cycle\0A\0B\0C` after clearing it (rare), the composite keys are identical to the prior fire's composites; the seen-Set retains them; nothing animates.
- **Severity is NOT part of the composite key.** A diagnostic that flips severity (server re-classifies blocking → advisory) WOULD re-animate under the wrong design; we expect the identity-key formula to be severity-stable, so a severity change implies a new identity. The participant's identity-key formula is already severity-stable (it encodes the kind + payload-specific identifiers, not severity), so this is implicit.

The lazy-init-on-non-empty contract of `useSeenKeysGate` handles the rAF-batched-empty-first-render correctly per the hook's contract.

### §5 — 450 ms `cubic-bezier(0.16, 1, 0.3, 1)` with `forwards` fill-mode (parity with halo siblings); per-severity scale differentiation (1.8 blocking / 1.7 advisory)

Three options for the timing curve and duration:

A. **450 ms `cubic-bezier(0.16, 1, 0.3, 1)` with `forwards` fill** (parity with `aud_node_appear_animation` and `aud_withdrawal_animation`).

B. **350 ms with the same curve** (parity with `aud_axiom_mark_animation` and `aud_proposed_to_agreed_animation`).

C. **600 ms slower for the heavier "diagnostic-fire" semantics.**

**Chosen: A.** Halo geometry (96px square, radial gradient) is identical to the two predecessor halos; the geometry-driven argument from `aud_node_appear_animation` Decision §5 ("larger halo benefits from a slower entrance than a small badge or pill chip") applies verbatim. The 450 ms with decelerated easing maintains the "lands and sticks" semantics for a halo-class decoration.

Option B is rejected by the same geometry argument.

Option C is rejected because the methodology does not treat diagnostic-fire as more weighty than node-arrival or withdrawal-regression — all are structural events of comparable broadcast significance. Slowing this one would skew the cadence; pacing tuning later may reach for it.

**Per-severity scale differentiation: blocking 1.8, advisory 1.7.** The two severities reach slightly different final scales (the keyframes' `to.transform` differ by 0.1 in scale). This is a subtle differentiation echoing the "blocking is heavier" semantics — the blocking halo spreads slightly farther before fading. Two alternatives considered: (i) same scale, different timing (450 ms blocking, 400 ms advisory); rejected because timing differences feel choppy on overlapping fires (multi-warrant is advisory, the warrant nodes may share a node with a cycle's blocking); (ii) same scale, different opacity peak; rejected because halo opacity peak is geometry-coupled (the radial-gradient stops set the visible spread). Scale differentiation is the cleanest axis.

The `forwards` fill-mode is load-bearing per the predecessors' Decision §5.

The 450 ms constant is initial; `aud_animation_pacing` revisits.

### §6 — Vitest pins React-side class logic + wsStore extension + helpers port + CSS file presence; Playwright deferred to `aud_session_url` (chain count now 9)

Vitest cases pin:

- Per-render decision logic in `<AudienceDiagnosticFireOverlay>` across the 14 cases enumerated under Constraints.
- `activeDiagnostics` extension in `wsStore.ts` across 4 cases.
- Identity-key + affected-entities + flatten helpers across 12 cases in `diagnosticHighlights.test.ts`.
- CSS keyframe + reduced-motion override presence in `index.css` across 4 cases.

What the tests deliberately do NOT pin:

- Pixel-by-pixel frame capture of the animation.
- Live transition in a real audience session (Playwright deferred per the orchestrator brief's "component not yet reachable" exception — the audience is still placeholder-routed).

**Playwright destination check.** As of this leaf, the chain pointing at `aud_session_url`'s Playwright scope includes the eight prior refinements (`aud_cytoscape_init.md`, `aud_state_management.md`, `aud_ws_client.md`, `aud_axiom_mark_decoration.md`, `aud_axiom_mark_animation.md`, `aud_node_appear_animation.md`, `aud_proposed_to_agreed_animation.md`, `aud_withdrawal_animation.md`); adding this leaf brings the count to **nine**. The orchestrator brief warns: "If it's inheriting from 2+ refinements already, pay debt down instead."

**Justification for continuing to defer rather than splitting.** The same justification the four immediate predecessors surfaced applies verbatim and is reinforced by their precedent: (a) every refinement in the chain exercises the same surface, (b) the spec for `aud_session_url` necessarily mounts the full audience under a real route, (c) the per-leaf scenarios are mostly assertion-additions onto a single test fixture, (d) the chain's growth is bounded — the remaining unshipped `aud_animations.*` sibling is `aud_decomposition_animation` only, capping the chain at approximately ten refinements. The structural decision (one large spec vs multiple focused specs) belongs to the `aud_session_url` refinement, not to this leaf. If the `aud_session_url` closer judges nine inherited scenarios too large for a single spec, they SHOULD split into a small set of focused specs (`aud_pw_animations.spec.ts`, `aud_pw_state_arrivals.spec.ts`, etc.) at that point; the per-leaf deferral entries here name their scenarios crisply enough to route mechanically.

This leaf contributes two scenarios to the chain:

1. After mounting a session whose initial state includes one or more active diagnostics, the rendered `[data-diagnostic-fire-anim]` halos (one per (identityKey, nodeId) pair) do NOT carry the `aud-diagnostic-fire-blocking` / `aud-diagnostic-fire-advisory` animation class — the lazy-init seed treats them as already-observed.
2. After a `'fired'` diagnostic event arrives via the WS stream, the halos for the (identityKey, nodeId) pairs the diagnostic introduces DO carry the matching severity-class within the rAF settle window. Halos for already-active diagnostics' pairs do NOT carry the class.

Pixel-stable post-animation steady state needs no new VR scenario: the halo fades to `opacity: 0` and the canvas paint is unchanged (Decision §8 — no persistent diagnostic border).

### §7 — Nodes only; edges deferred to `aud_diagnostic_edge_fire_animation` (named-future-task)

Two options:

A. **Nodes only this leaf; edges in a follow-on `aud_diagnostic_edge_fire_animation` (~0.5d, closer registers).** Contradictions carry `edges: readonly string[]` (the contradicting edge pair); coherency-hint sub-kinds carry warrant-bridge edge identifiers. Edge halos require a separate iteration (`cy.edges()`-driven with midpoint geometry) and a separate keyframe; the geometry, the placement-emission, and the test cases all parallel the node overlay but cannot share the same overlay component.

B. **Nodes + edges in this leaf.** Doubles the surface area; the leaf's effort estimate is 1d (already optimistic given the data-plumbing); shipping both halves under one leaf compounds risk.

**Chosen: A.** Splitting matches the 1d budget and follows the consolidated "nodes-only" precedent the DOM-overlay siblings have respected (`aud_per_facet_visualization` Decision §3). The closer registers `aud_diagnostic_edge_fire_animation` (~0.5d) under `audience.aud_animations` with a `depends` on this leaf. The future task's refinement mirrors this leaf's shape (the same wsStore, the same helpers, a parallel `<AudienceDiagnosticEdgeFireOverlay>` iterating `cy.edges()` with edge-midpoint geometry).

The visual incompleteness during the deferral window is acknowledged: a contradiction firing will halo the two affected nodes but not the contradicting edge that connects them. The broadcast viewer can read "these two nodes contradict" from the node halos; the edge is structurally implied. This is acceptable as a phased rollout — the node halos are the dominant carrier of the diagnostic-fire signal.

### §8 — No persistent steady-state diagnostic-highlight border on the audience surface; the fire animation IS the entire diagnostic surface

Three options:

A. **The fire animation is the entire diagnostic surface; no persistent border, no per-entity steady-state styling, no diagnosticSeverity stamping in `data`.** The audience's broadcast posture favors a clean canvas; persistent diagnostic borders would clutter the surface (cycles can persist for many minutes while the moderator deliberates) and conflict with the per-state palette (`STATE_COLORS` already carries semantic color for `'agreed'`/`'disputed'`/`'committed'`/etc.). The transient halo's value is precisely its transience — it tells the viewer "this just happened" and then dissolves, leaving the state-colored canvas intact.

B. **Mirror the moderator/participant: amber border on `[diagnosticSeverity = 'blocking' | 'advisory']` nodes, plus the fire animation on top.** The moderator's working surface needs to keep the diagnostic visible because the moderator is acting on it; the participant's surface uses it for per-facet diagnostic indicators. The audience is a passive broadcast surface — a persistent border on an active cycle for the duration of moderator deliberation would visually overload the canvas and conflict with state-color semantics.

C. **A fading-out steady state**: amber border at firing, slowly fading over ~5 seconds to no border. Compromise option — preserves attention briefly past the fire animation, decays cleanly. Rejected because it conflates two animation semantics in one effect (the fire animation is "this just happened"; the fade-out border is "this is still happening"); two parallel animations are clearer per leaf if both are needed, and only the fire is needed by this leaf's scope.

**Chosen: A.** The fire animation is the audience's complete diagnostic surface for now. If product later surfaces a need for persistent diagnostic visibility (e.g., long-running cycles obscured by post-animation steady-state coloring), a future `aud_diagnostic_steady_styling` task (~1d, NOT pre-registered today) opens that question with its own ADR-level deliberation on the visual-language commitment.

A corollary of this decision: `AudienceNodeData` / `AudienceEdgeData` do NOT gain a `diagnosticSeverity` field, `projectGraph.ts` is unchanged, `stylesheet.ts` is unchanged. The diagnostic axis enters the audience surface ONLY through the WS store + the new overlay. This keeps the projection layer pure (events → entity/facet state, no diagnostic mixing) and matches the strict-separation posture ADR 0027 establishes for entity vs facet — diagnostics live in their own observable axis adjacent to entity-state, not as a property of entity-state.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- Extended `apps/audience/src/ws/wsStore.ts` with `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` extension mirroring participant/moderator pattern; replaced one-line `createDefaultWsStore()` re-export.
- Added `apps/audience/src/ws/wsStore.test.ts` with 5 cases: empty-map default + 4 `applyDiagnostic` cases (fired/cleared/replace/re-fired same identity).
- Created `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` — selector hook returning per-session active diagnostics map.
- Created `apps/audience/src/graph/diagnosticHighlights.ts` — ports `diagnosticIdentityKey`, `affectedEntities`, wire-type interfaces, and new `flattenActiveDiagnosticsForFire` helper from participant's implementation.
- Created `apps/audience/src/graph/diagnosticHighlights.test.ts` — ~12 cases covering identity-key round-trips for all 5 diagnostic kinds, `affectedEntities` projections, and `flattenActiveDiagnosticsForFire` tuples.
- Created `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — sixth DOM-overlay sibling painting severity-keyed amber halos; gated by `useSeenKeysGate` over `${identityKey}\0${nodeId}` composite keys.
- Created `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — 13 named cases + 5 parameterized severity cases = 18 total.
- Extended `apps/audience/src/graph/cytoscapeOverlayHooks.ts` with optional `triggers?` param enabling store-driven re-commit; `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` + 2 cases.
- Updated `apps/audience/src/graph/GraphView.tsx` with header docblock, import, `sessionId` destructure, and sixth overlay mount.
- Updated `apps/audience/src/index.css` with two keyframes (`aud-diagnostic-fire-blocking`, `aud-diagnostic-fire-advisory`), per-severity gradient selectors, two utility classes, and `prefers-reduced-motion: reduce` overrides.
- Updated `apps/audience/src/index.test.ts` with 4 new CSS smoke pins (both keyframes + both reduced-motion overrides).
- Updated `apps/audience/src/ws/index.ts` and `apps/audience/src/ws/index.test.ts` to export `useAudienceActiveDiagnostics`.
- Added `zustand: 5.0.13` to `apps/audience/package.json` (fixer: was missing, caused 330+ type errors); removed bogus `eslint-disable` directive.
- Playwright E2E deferred to `audience.aud_url_routing.aud_session_url` (component not yet reachable; chain now 9 refinements).
- Tech-debt: `shell_diagnostic_highlights_extract` (~1d, `tasks/27-shell-package.tji`) and `aud_diagnostic_edge_fire_animation` (~0.5d, `tasks/50-audience-and-broadcast.tji`) registered in WBS by closer.
