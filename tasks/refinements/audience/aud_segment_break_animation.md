# aud_segment_break_animation — Brief animation cue at segment break

## TaskJuggler entry

- **Task:** `audience.aud_segment_markers.aud_segment_break_animation`
- **Defined in:** [`tasks/50-audience-and-broadcast.tji:496`](../../50-audience-and-broadcast.tji) (inside `task aud_segment_markers` at line 489).
- **Note back-link:** this refinement.

## Effort estimate

`1d` (from the `.tji` leaf). One `@keyframes` rule + reduced-motion override appended to the existing audience stylesheet, a small change to one component (`ChapterMarker`) to gate a one-shot class, its Vitest coverage, the CSS smoke-pin pair, and one Playwright scenario appended to the existing audience-live spec. No new files, no new dependency.

## Inherited dependencies

The leaf declares `depends !aud_chapter_marker_render`; the parent `aud_segment_markers` adds `depends !aud_graph_rendering, data_and_methodology.event_types.snapshot_events`, all inherited.

**Settled:**

- **`aud_chapter_marker_render`** — `complete 100` (shipped 2026-06-05). It landed exactly the seam this task animates: the persistent `<ChapterMarker>` caption at [`apps/audience/src/routes/ChapterMarker.tsx`](../../../apps/audience/src/routes/ChapterMarker.tsx), driven by `useAudienceLatestSnapshot(sessionId)` ([`apps/audience/src/state/useAudienceLatestSnapshot.ts`](../../../apps/audience/src/state/useAudienceLatestSnapshot.ts)) over `latestSnapshotFrom(events)` ([`apps/audience/src/state/latestSnapshot.ts`](../../../apps/audience/src/state/latestSnapshot.ts)). The component carries a stable `data-testid="audience-chapter-marker"`, renders nothing until the first snapshot, and exposes `{ snapshotId, label, logPosition }` — the `snapshotId` change is the "segment break" signal this task animates against (predecessor Decision §1). Refinement: [`tasks/refinements/audience/aud_chapter_marker_render.md`](aud_chapter_marker_render.md).
- **`aud_graph_rendering.*` + `data_and_methodology.event_types.snapshot_events`** — both `complete 100`; the live audience route `/a/sessions/:sessionId` mounts `<AudienceLiveRoute>` → `<AudienceGraphView>` + `<ChapterMarker>`, and `snapshot-created` reaches the audience as an `event-applied` broadcast. Documented in full in the predecessor's Inherited dependencies.
- **Animation-pacing tokens** — `aud_animation_pacing` is `complete 100` ([`tasks/50-audience-and-broadcast.tji:413`](../../50-audience-and-broadcast.tji)). The cadence dial lives as CSS custom properties at [`apps/audience/src/index.css:152`](../../../apps/audience/src/index.css): `--aud-anim-easing: cubic-bezier(0.16, 1, 0.3, 1)`, `--aud-anim-commit-ms: 350ms`, `--aud-anim-halo-ms: 450ms`. This task consumes them rather than minting its own duration (pacing Decision §7: future animation siblings MUST consume the variables, not ship inline durations).
- **Seen-keys gate** — `useSeenKeysGate<K>(currentKeys)` at [`packages/graph-view/src/cytoscapeOverlayHooks.ts:196`](../../../packages/graph-view/src/cytoscapeOverlayHooks.ts) (landed by `aud_dom_overlay_extraction`, `complete 100`). A generic, Cytoscape-free, lazy-init-on-non-empty seen-`Set` gate returning an `isNew(key)` predicate; the single source of truth for "fire once per newly-arrived key" used by all five overlay animation leaves.

**Pending:** none.

## What this task is

Add a **brief, one-shot entrance cue** to the live-broadcast chapter marker so that when the moderator labels a new snapshot mid-show, the at-home audience gets a small motion signal that *the segment just changed* — not just a silently-updated caption. The predecessor renders the marker as a static, persistent caption (its Decision §1 deliberately kept motion out and named this sibling as the owner of the "transient entrance cue"). This task is that cue and nothing more: a CSS `@keyframes` reveal applied to the marker the moment a *new* `snapshotId` arrives, suppressed under `prefers-reduced-motion`, firing once per segment break and not on unrelated re-renders.

Concretely:

1. A new `@keyframes aud-segment-break` rule + its `prefers-reduced-motion: reduce` no-op override appended to [`apps/audience/src/index.css`](../../../apps/audience/src/index.css), consuming the shared cadence tokens (commit tier, 350 ms — Decision §3).
2. `ChapterMarker` gains a one-shot `aud-segment-break` class, gated by `useSeenKeysGate([snapshot.snapshotId])` so it lands only on a *live* (post-mount) new snapshot, never on the snapshot that was already current when the viewer loaded the page (Decision §2 + §6). A `data-segment-break-anim` presence marker is added to the marker root (testid convention parity with the overlay animations), and the root is keyed by `snapshotId` so the keyframe re-fires on each supersession (Decision §4).
3. Tests: Vitest on the React-side class logic, the CSS smoke-pin pair, and one inline Playwright scenario.

## Why it needs to be done

`aud_segment_markers` is one of the leaves gating the **show-readiness** milestone ([`tasks/99-milestones.tji:101`](../../99-milestones.tji)). The static marker (predecessor) tells the audience *which* segment they're in; without an entrance cue, a segment change is a silent text swap that a viewer glancing away will miss entirely on a live broadcast. A 350 ms reveal turns the swap into a noticed *moment* — the broadcast-readability concern that the whole `aud_*_animation` family exists to serve ([`apps/audience/src/index.css:104`](../../../apps/audience/src/index.css), the cadence rationale). The predecessor explicitly carved out this seam ("a stable `audience-chapter-marker` testid + a 'latest snapshot changed' signal to animate against"); this task closes it and lets the parent `aud_segment_markers` reach `complete 100`.

## Inputs / context

- **Component to change** — [`apps/audience/src/routes/ChapterMarker.tsx`](../../../apps/audience/src/routes/ChapterMarker.tsx): currently a single root `<div data-testid="audience-chapter-marker" className="pointer-events-none absolute bottom-6 left-6 …">` holding a `sr-only` translated prefix span + the verbatim `snapshot.label` span. It early-returns `null` when `snapshot === null`. The hook call (`useSeenKeysGate`) must precede that early return (Rules of Hooks); the empty-keys path (`[]`) leaves the gate un-seeded, matching the gate's contract.
- **Cadence tokens** — [`apps/audience/src/index.css:152`](../../../apps/audience/src/index.css): `--aud-anim-easing`, `--aud-anim-commit-ms` (350 ms), `--aud-anim-halo-ms` (450 ms). The commit-moment tier rationale block at [`apps/audience/src/index.css:104`](../../../apps/audience/src/index.css) describes the 350 ms "lands and sticks" semantics this cue adopts.
- **Keyframe + reduced-motion precedent** — [`apps/audience/src/index.css:173`](../../../apps/audience/src/index.css) (`@keyframes aud-axiom-mark-land`, `animation: … var(--aud-anim-commit-ms) var(--aud-anim-easing) both;`) and its `@media (prefers-reduced-motion: reduce) { … animation: none; }` block at line 188. The new rule mirrors this exact shape — a commit-tier reveal with a media-query no-op.
- **Seen-keys gate** — [`packages/graph-view/src/cytoscapeOverlayHooks.ts:196`](../../../packages/graph-view/src/cytoscapeOverlayHooks.ts): `useSeenKeysGate<K>(currentKeys: readonly K[]): (key: K) => boolean`. Lazily seeds its `Set` on the first render where `currentKeys.length > 0`; the predicate has the documented "side-effect during render" idiom (returns `true` once per genuinely-new key, then adds it). Used here with `K = string` (the `snapshotId`).
- **Overlay animation precedent (React-side class gating)** — e.g. [`packages/graph-view/src/NodeAppearOverlay.tsx:111`](../../../packages/graph-view/src/NodeAppearOverlay.tsx): `const isNewNode = useSeenKeysGate(nodeIds); … className={isNew ? 'aud-node-appear' : ''}` on a wrapper carrying `data-node-appear-anim`. This task applies the same idiom to a single screen-fixed element.
- **CSS smoke-pin seam** — [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts): reads `index.css` from disk and string-asserts each `@keyframes <name>` definition and its `prefers-reduced-motion` override. New cases append here.
- **Playwright spec + helpers** — [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts): the `seedSnapshotCreated(...)` helper (line 431, added by the predecessor's scenario 12) and the diagnostic-fire scenarios (9, 10, lines 849/947) establish the class-assertion idiom — locate the `[data-*-anim]` element, assert `.toHaveClass(/aud-…/)`. The route used is `/a/sessions/<uuid>`; events seed post-navigation via `applyEvent` over `window.__aConversaWsStore`.
- **OBS constraints** — [`tasks/refinements/audience/aud_obs_transparency.md`](aud_obs_transparency.md) and [`aud_obs_no_input_required.md`](aud_obs_no_input_required.md): animated elements must stay inert (`pointer-events-none`, no `<dialog>`/`[aria-modal]`/`<audio>`/`<video>`/`[data-requires-input]`) and assume a transparent backdrop. The predecessor already satisfies all of these; this task adds only a transform/opacity keyframe and must not regress them.
- **i18n** — no new strings. The animation adds no chrome; the existing `audience.segmentMarker.prefix` key and the verbatim label are unchanged.

## Constraints / requirements

1. **One-shot, on new snapshot only.** The cue fires exactly once per `snapshotId` that arrives *after* the marker is live, and never re-fires on pan/zoom/roster/unrelated re-renders. Detection is `useSeenKeysGate([snapshot.snapshotId])`, consistent with every other audience animation.
2. **No cue for the load-time snapshot.** A viewer who joins mid-show sees the current segment caption appear statically — the snapshot that was already current at first non-empty render seeds the gate and does **not** animate (Decision §6). Only segment breaks that happen *while watching* animate.
3. **Re-fires on supersession.** Each new segment break animates, not just the first. The marker root is keyed by `snapshotId` so React remounts the element on supersession and the keyframe restarts (Decision §4).
4. **Consume the shared cadence tokens.** Use `var(--aud-anim-commit-ms)` + `var(--aud-anim-easing)`; do not introduce a new inline duration or a new `:root` token (pacing Decision §7).
5. **Reduced-motion suppression in CSS, not TS.** The class is always emitted by the render path; a `@media (prefers-reduced-motion: reduce)` override no-ops `aud-segment-break` so reduced-motion viewers get the static caption (uniform family convention, e.g. `aud_animation_pacing` Decision §4).
6. **OBS-safe, no regression.** Keep the marker `pointer-events-none` and inert; add only `transform`/`opacity` motion. No new input-gating element, no opaque-backdrop assumption beyond the existing light-chip treatment.
7. **No new files, no new dependency, no shared-package coupling beyond the existing import.** The change is one CSS rule pair + one component edit. `useSeenKeysGate` is already exported and already reachable from `apps/audience`; reuse it (Decision §2). `packages/graph-view` gains no snapshot semantics.
8. **No wire/broadcast/projector change.** Pure client-side rendering over the already-pinned `snapshot-created` event (Decision §9 — no Cucumber).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) (no throwaway verifications) every check below is a committed, repeatable test — no scratch scripts.

**Vitest (component) — appended to [`apps/audience/src/routes/ChapterMarker.test.tsx`](../../../apps/audience/src/routes/ChapterMarker.test.tsx):**

1. **No animation on the seeding snapshot.** Mount with a snapshot already present (load mid-show); the `audience-chapter-marker` root does **not** carry the `aud-segment-break` class.
2. **Animates on a live new snapshot.** After re-rendering the same mounted tree with a *newer* `snapshotId` (a `snapshot-created` event applied to the store), the marker root carries `aud-segment-break`.
3. **Re-fires on supersession.** A third, newer snapshot again yields the `aud-segment-break` class on the (remounted, `snapshotId`-keyed) root — proving the cue is not a once-per-mount artifact.
4. **No re-fire on unrelated re-render.** Re-rendering with the *same* `snapshotId` (e.g. a roster-only event) leaves the marker without a freshly-triggered class (the gate returns `false`).
5. **OBS-inert preserved.** The animated subtree remains `pointer-events-none` and contains no `<dialog>`/`[aria-modal]`/`<audio>`/`<video>`/`[data-requires-input]` (mirrors the predecessor's OBS-safety assertion, ensuring the animation edit didn't regress it).

**Vitest (CSS smoke pin) — appended to [`apps/audience/src/index.test.ts`](../../../apps/audience/src/index.test.ts):**

6. `index.css` contains the `@keyframes aud-segment-break` definition.
7. `index.css` contains a `prefers-reduced-motion: reduce` override that no-ops `.aud-segment-break`. *(jsdom does not run keyframes, so the behavioral contract is split: cases 1–4 pin that the class lands; cases 6–7 pin that the keyframe + suppression are defined — the same two-layer strategy the family uses.)*

**Playwright (e2e) — IN SCOPE, not deferred.** The surface is reachable (`/a/sessions/:sessionId` mounts `<ChapterMarker>`) and the predecessor + diagnostic-fire scenarios already pay e2e on this surface, so the UI-stream policy default applies and full deferral is *not* warranted. Append one scenario to [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts), reusing `seedSnapshotCreated(...)` and mirroring the diagnostic-fire class-assertion idiom (scenario 9, line 940):

8. Navigate to a live session; seed a first `snapshot-created` (e.g. `"Segment 1 close"`) and assert the `[data-segment-break-anim]` marker is visible **without** the `aud-segment-break` class (it seeded the gate); seed a second `snapshot-created` (e.g. `"Commercial"`) and assert the marker now shows the newer label **and** `toHaveClass(/aud-segment-break/)`. *(The class persists on the live element — `both`/`forwards` fill plus `snapshotId`-keyed identity — so the assertion is deterministic and holds under reduced-motion too, where the class is present but no-op'd.)*

**Out of scope / no new task:**

- **Pixel-level still appearance** (exact corner, chip styling, type scale) stays pinned by the existing audience visual-regression coverage; visual-regression is *not* a substitute for the class-application behavioral pins above — both coexist (UI-stream policy).
- **Cucumber** is not required: no protocol/replay/projector seam crosses the system boundary here; `snapshot-created`'s wire + projection are already pinned by `snapshot_events`, and the predecessor's Cucumber-exemption reasoning carries over unchanged.

## Decisions

1. **CSS `@keyframes` consuming the shared tokens — the established mechanism.** *Rationale:* every audience animation is a CSS keyframe on a React-toggled class, with the cadence centralized in `:root` custom properties; this task is one more instance and reuses the dial verbatim. *Alternatives rejected:* a motion framework (`framer-motion`/`react-spring`) — the codebase maintains zero motion-framework dependencies; a JS-driven `requestAnimationFrame` tween — reinvents the compositor; a one-off inline `transition` with a hard-coded `ms` — violates the single-source-of-truth pacing contract (`aud_animation_pacing` Decision §7).

2. **Reuse `useSeenKeysGate` for the one-shot trigger, not a local `prev`-ref.** *Rationale:* the gate is the family's single source of truth for "fire once per newly-arrived key," already exported and dependency-free; threading `[snapshot.snapshotId]` through it gives identical, already-tested seeding semantics (load-time value seeds → no cue; live arrival → cue) for free, and keeps this leaf consistent with the five overlay leaves. *Alternative rejected:* a bespoke `useRef<string | null>` tracking the previous `snapshotId` would re-implement the gate's lazy-init-on-non-empty subtlety (the very edge case `aud_axiom_mark_animation`/`aud_node_appear_animation` Decision §4 documents) with a fresh chance to get the "don't animate the first one" rule wrong. *Minor cost acknowledged:* the hook lives in a module named `cytoscapeOverlayHooks.ts`, but its body imports nothing from Cytoscape and is generic over `K` — the naming is historical, not a real coupling; relocating/renaming it is out of this leaf's scope.

3. **Commit-moment tier (350 ms), not the halo tier (450 ms), and no new token.** *Rationale:* the segment-break cue is a discrete, foreground "lands and sticks" caption moment — the same semantic family as the axiom-mark badge and the proposed→agreed pill (both commit tier), not a peripheral 96 px graph-state halo. Reusing `--aud-anim-commit-ms` adds zero surface. *Alternatives rejected:* the halo tier reads as "a graph entity changed," which the chapter marker is not; a third dedicated `--aud-anim-segment-ms` token is unjustified for a single consumer — if production tuning later wants a distinct cadence it is a one-line `:root` addition caught by the pacing smoke pins, not an architecture change.

4. **Key the marker root by `snapshotId` so the cue re-fires per break.** *Rationale:* a CSS animation runs once when its class is *added*; if the marker `<div>` is reused across snapshots, toggling an already-present class never re-triggers, so only the first break would animate. Keying the root by `snapshotId` makes React remount it on each supersession — a fresh element runs the keyframe again — exactly the "React keyed reconciliation handles which element is new" idiom the overlays use (`aud_axiom_mark_animation` Decision §1). The gate still independently suppresses the load-time snapshot, so keying does not reintroduce a load-time cue. *Alternative rejected:* a class-toggle-via-`useEffect` (add class, `setTimeout`-remove) reintroduces JS-driven timing the family deliberately avoids and races the 350 ms duration.

5. **Animate the marker root itself; no extra wrapper element.** *Rationale:* the overlay leaves wrap each of *many* node-anchored badges in a keyed `<span data-*-anim>` carrier because there are many siblings and React needs per-element keys; here there is exactly **one** marker, so the class and the `data-segment-break-anim` presence marker go directly on the existing testid root. This keeps the DOM flat and the predecessor's `audience-chapter-marker` testid stable. *Alternative rejected:* adding a wrapper span purely for parity would add an inert layer with no reconciliation benefit.

6. **No cue for the snapshot that was current at page load.** *Rationale:* a viewer joining mid-show should see the current segment caption *present*, not watch it animate in for a break that happened before they arrived — animating it would falsely signal "a segment just changed." The gate's lazy-seed-on-first-non-empty contract delivers this precisely. *Alternative rejected:* animating on first appearance would conflate "this just happened" with "this is the standing state," the same conflation the overlay leaves' seeding rule exists to prevent.

7. **Reduced-motion suppression in CSS.** *Rationale:* the class is always emitted; a `@media (prefers-reduced-motion: reduce)` no-op gives reduced-motion / screen-reader users the static caption (the `sr-only` prefix already narrates "Current segment: <label>") with no motion. Matches the uniform family decision (`aud_animation_pacing` Decision §4) and keeps suppression out of TS branching. *Alternative rejected:* a JS `matchMedia` branch duplicates a concern CSS already owns and diverges from every sibling.

8. **e2e in scope, no deferral.** *Rationale:* the live audience route is reachable and the predecessor (scenario 12) plus the diagnostic-fire animations (scenarios 9, 10) already assert animation classes on this exact surface; the UI-stream policy's "not yet reachable" exception does not apply, and full deferral would needlessly grow catch-all debt. The one scenario mirrors the existing `toHaveClass(/aud-…/)` idiom. *Alternative rejected:* deferring to a future `aud_pw_*`-style catch-all when the surface and the assertion idiom are both already proven here.

9. **No Cucumber.** *Rationale:* this leaf crosses no protocol/replay/projector seam observable at the system boundary — `snapshot-created` and its projection are pinned by `snapshot_events`; the work is client-side motion over an already-reactive event. Vitest + Playwright are the right pins (predecessor Decision §-acceptance carries over).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `apps/audience/src/index.css` — new `@keyframes aud-segment-break` rule consuming `--aud-anim-commit-ms` / `--aud-anim-easing`, plus `@media (prefers-reduced-motion: reduce)` no-op override; mirrors the `aud-axiom-mark-land` shape exactly.
- `apps/audience/src/routes/ChapterMarker.tsx` — `useSeenKeysGate([snapshotId])` gate added (hook call precedes early return per Rules of Hooks); root keyed by `snapshotId` for re-fire on supersession; `aud-segment-break` class applied when gate returns `true`; `data-segment-break-anim` presence marker added.
- `packages/graph-view/src/index.ts` — one-line re-export of `useSeenKeysGate` added to the public barrel (deviation: it was internal; the reuse intent required this minimal coupling; no snapshot semantics added to the package).
- `apps/audience/src/routes/ChapterMarker.test.tsx` — Vitest cases (e)–(i): no-cue on seeding snapshot, live-break fires, re-fires on supersession, no re-fire on same-id re-render, OBS-inert preserved.
- `apps/audience/src/index.test.ts` — CSS smoke pins: `@keyframes aud-segment-break` present, reduced-motion no-op present, commit-token consumption pinned.
- `tests/e2e/audience-live-session.spec.ts` — Playwright scenario 13 `segment-break cue` (user `kate`): seeds first snapshot (no class), seeds second snapshot, asserts `[data-segment-break-anim]` carries `aud-segment-break`.
