# Audience diagnostic-fire animation — node-overlay seeding alignment (replace the shared `useSeenKeysGate` call in `<AudienceDiagnosticFireOverlay>` with a local `useRef<Set<string>>` seeded synchronously from the store-derived `tuples` on first render, mirroring the surgical fix the edge-fire fixer sub-agent already shipped on `<AudienceDiagnosticEdgeFireOverlay>`, so a fresh-session post-empty-mount fire animates without requiring a pre-seed workaround; rip out the pre-seed workaround in the node-fire test (c); add the previously-deferred Playwright cycle-fire scenario inline on `tests/e2e/audience-live-session.spec.ts` since the node-fire path now genuinely fires the animation at the system seam after the fix)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_animations.aud_diagnostic_fire_animation_seeding_alignment` (lines 364-377).
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!audience.aud_animations.aud_diagnostic_edge_fire_animation` (settled — [`tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md`](aud_diagnostic_edge_fire_animation.md)). This is the **source-of-debt predecessor**. The edge-fire leaf shipped a fix in its fixer sub-agent attempt 1 (Status block bullet 7): it replaced the shared `useSeenKeysGate(compositeKeys)` call inside `<AudienceDiagnosticEdgeFireOverlay>` with a local `useRef<Set<string>>` seeded synchronously from `tuples` on the first render. The replacement lives in [`apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx:143-153`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx#L143). The accompanying test (c) in [`apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx:268-298`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx#L268) was updated to NOT pre-seed an unrelated diagnostic — a fresh-session contradiction-fire from empty-mount animates correctly. The edge sibling's refinement comment on the new code ([`apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx:130-142`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx#L130)) explicitly names the node sibling's latent variant as out-of-scope for that leaf and source-of-debt for this one. This leaf pays the debt: same fix transplanted to `<AudienceDiagnosticFireOverlay>`, same test (c) cleanup, plus the Playwright scenario the node sibling deferred.
- Prose-only context (NOT a `.tji` edge): `audience.aud_animations.aud_diagnostic_fire_animation` (settled — [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md)). The grand-predecessor that shipped the original `<AudienceDiagnosticFireOverlay>` with the latent gate bug. Its Decision §4 (composite-key `useSeenKeysGate` over `(identityKey, nodeId)` pairs, "the first non-empty commit seeds with whatever pairs are already active at audience-join") is correct in intent but its *implementation* via the shared `useSeenKeysGate` is the latent-bug source: the shared hook seeds lazily on the first non-empty `currentKeys` render, conflating store-empty-at-mount with first-fire-after-empty-mount. The grand-predecessor also explicitly deferred its Playwright scenario to `aud_url_routing.aud_session_url` (Decision §6, chain-count 9). `aud_session_url` has since shipped (`complete 100` per the edge sibling's §6 framing); this leaf pays down that deferred-e2e debt as the inherited-debt rule requires.
- Prose-only context: `aud_dom_overlay_extraction` (settled — [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md)). Established the shared `useSeenKeysGate<K>` hook in [`apps/audience/src/graph/cytoscapeOverlayHooks.ts:196-210`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L196) and explicitly documented its "lazy-init on first non-empty `currentKeys`" semantics in the JSDoc block at [`apps/audience/src/graph/cytoscapeOverlayHooks.ts:168-195`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L168). That semantic is **load-bearing** for the four cy-driven overlay siblings (`<AudiencePerFacetPillOverlay>`, `<AudienceAxiomMarkOverlay>`, `<AudienceAnnotationOverlay>`, `<AudienceNodeAppearOverlay>`, plus the later `<AudienceWithdrawalHaloOverlay>`) whose `currentKeys` derive synchronously from `cy.nodes()` / `cy.edges()` — for them, "first non-empty commit" IS "first arrival in cy," and the lazy-init is correct. This leaf MUST NOT change that shared hook's contract; it does the surgical local-ref fix on the one store-driven consumer that the contract does not fit. Decision §1 below.
- Prose-only context: `aud_url_routing.aud_session_url` (settled — [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md), TJI `complete 100`). The audience surface is reachable at `/a/sessions/:sessionId`; the dev-only `window.__aConversaWsStore` seam is the Playwright harness the edge sibling's scenario already exercises in [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts). This leaf appends one more scenario to the same spec.

## What this task is

A surgical 0.5d alignment of the node-fire overlay's seen-Set seeding pattern with the fix already shipped in the edge-fire overlay. Three deltas end-to-end:

1. **Replace `useSeenKeysGate(compositeKeys)` in `<AudienceDiagnosticFireOverlay>`** ([`apps/audience/src/graph/DiagnosticFireOverlay.tsx:151-152`](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx#L151)) with a local `useRef<Set<string>>` seeded synchronously from `tuples` on the first render — byte-identical to the pattern at [`apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx:143-153`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx#L143), substituting `nodeId` for `edgeId` in the composite-key formula. The `useSeenKeysGate` import is dropped from the node-fire overlay; the `useRef` import is added. The shared hook itself ([`apps/audience/src/graph/cytoscapeOverlayHooks.ts:196-210`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L196)) is **byte-unchanged** — the four cy-driven consumers and the per-facet-pill / withdrawal-halo consumers all keep the existing lazy-init semantic that is correct for their cy-driven key derivation.

2. **Rip out the pre-seed workaround in the node-fire overlay's test (c)** ([`apps/audience/src/graph/DiagnosticFireOverlay.test.tsx:242-274`](../../../apps/audience/src/graph/DiagnosticFireOverlay.test.tsx#L242)). The current test pre-fires an unrelated `danglingClaim(NODE_D)` on a different node SOLELY to "seed the gate" before firing the cycle on `[A, B, C]`. After this leaf, the post-mount cycle-fire from empty-active animates correctly without the pre-seed — the test (c) is updated to mirror the edge sibling's test (c) shape ([`apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx:268-298`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx#L268)): seed the cy with nodes, fire the cycle directly, assert the three halos all carry `aud-diagnostic-fire-blocking`. Test (d) is similarly cleaned (it currently seeds with `cycle([NODE_B])` for the same workaround reason) — fire the advisory diagnostic directly and assert the advisory class lands. Test (b) (initial-mount with already-active cycle on 3 nodes renders 3 halos with NO animation class) is **byte-unchanged**: the local-ref fix seeds the set from `tuples` at first render, so mid-session-joiner halos for already-active diagnostics correctly start un-animated — that property the original Decision §4 was trying to preserve is preserved by the fix.

3. **Append a Playwright cycle-fire scenario to `tests/e2e/audience-live-session.spec.ts`** that asserts the fresh-session post-empty-mount fire animates at the system seam. Same shape as the edge sibling's new scenario [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) (route → seed → fire → assert-halo), substituting a `cycle` payload for the `contradiction` and asserting `[data-diagnostic-fire-anim]:not([data-diagnostic-fire-locus="edge"])` halos carry the blocking class. This pays down the deferred-e2e debt the grand-predecessor `aud_diagnostic_fire_animation` registered against `aud_session_url` (now `complete 100`) AND pins the fix at the system seam — Vitest test (c) alone would not prove the fix works end-to-end through the real wsStore → rAF → overlay → DOM round-trip.

After this leaf:

- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — MODIFIED. ~15 LOC delta: one import swap (`useSeenKeysGate` removed; `useRef` added to the React imports), the `const isNewPair = useSeenKeysGate(compositeKeys);` call ([line 152](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx#L152)) replaced with the local-ref block from the edge sibling, the `compositeKeys` line ([line 151](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx#L151)) removed (the local-ref pattern reads composite keys directly inside `isNewPair`), and one new comment block explaining the seeding rationale + cross-reference to the refinement.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — MODIFIED. Tests (c) and (d) lose their pre-seed workaround (~10 LOC removed each). All other cases unchanged. One new comment near case (c) cross-referencing the refinement.
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts` — UNCHANGED. The shared hook's contract is preserved verbatim; only the node-fire overlay (a store-driven consumer for whom the contract does not fit) stops using it.
- `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — UNCHANGED.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx` — UNCHANGED. The fix it already carries IS the canonical reference; this leaf transplants it verbatim to the node sibling.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` — UNCHANGED.
- `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `AxiomMarkOverlay.tsx`, `NodeAppearOverlay.tsx`, `WithdrawalHaloOverlay.tsx`, `AnnotationOverlay.tsx` — UNCHANGED. They keep consuming `useSeenKeysGate` — the shared lazy-init contract is correct for their cy-driven key derivation.
- `apps/audience/src/ws/wsStore.ts`, `apps/audience/src/ws/useAudienceActiveDiagnostics.ts` — UNCHANGED.
- `apps/audience/src/graph/diagnosticHighlights.ts` — UNCHANGED.
- `apps/audience/src/graph/GraphView.tsx` — UNCHANGED. The overlay mount is byte-identical; only the overlay's internal seeding implementation changes.
- `apps/audience/src/graph/GraphView.test.tsx` — UNCHANGED.
- `tests/e2e/audience-live-session.spec.ts` — MODIFIED. One new scenario appended (~60 LOC of Playwright setup + assertions) exercising cycle-fire on the node overlay. The header docblock's scenario enumeration gains one entry.
- `apps/audience/src/index.css`, `apps/audience/src/index.test.ts` — UNCHANGED. No new CSS.
- `apps/audience/package.json` — UNCHANGED. No new dependency.
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: closer adds `complete 100` to `aud_diagnostic_fire_animation_seeding_alignment`.

Out of scope (deferred or already covered):

- **Lift the synchronous-seed pattern into a third shared hook (`useSyncSeededKeysGate<K>`)**. Considered (Decision §1, option C); rejected as premature abstraction with two callers today. If a third store-driven overlay surfaces (e.g., a hypothetical `aud_diagnostic_clear_animation` or a participant-side mirror), the consolidation becomes worth doing — at that point this leaf's local-ref block and the edge sibling's local-ref block are mechanical to lift. Pre-investing today buys nothing and changes the diff's risk surface.
- **Broaden `useSeenKeysGate` to accept an optional `seedKeys?: readonly K[]` parameter** routing through the existing hook. Considered (Decision §1, option B); rejected because it adds a configuration branch to a hook whose JSDoc explicitly documents a single semantic — every existing caller would now need to reason about which branch they want. The two-call-site local-ref pattern is clearer than a parameterized hook with one branch unused by 80% of callers.
- **A new ADR documenting "store-driven overlays use synchronous seed; cy-driven overlays use lazy seed."** Considered (Decision §2); rejected — the distinction is a consequence of the existing seam (the gate's contract is about *when keys first become available*; for cy-driven overlays that's mid-render after cy populates, for store-driven overlays that's the first-render readSync of the store), not a new architectural commitment. Documenting it inline at the local-ref usage sites + cross-referencing this refinement is sufficient.
- **Playwright self-contradicts coherency-hint scenario on the node axis.** The edge sibling's Vitest case 4 already pins the self-contradicts → advisory class path for the edge overlay; the node sibling's Vitest test (d) (now cleaned) pins it for the node overlay. The Playwright scenario this leaf adds covers the cycle / blocking path — the highest-stakes failure mode (the visible cycle fire that the grand-predecessor's deferred Playwright would have caught). Advisory-class coverage is left to Vitest, mirroring the edge sibling's Decision §6 framing on this scoping.
- **Visual-regression scenario.** Post-animation steady state is unchanged (Decision §8 of the grand-predecessor); no `aud_vr_*` debt added.
- **Pacing changes.** The animation constants are untouched; `aud_animation_pacing` revisits them across the group.
- **Folding the node-fire and edge-fire overlays into one.** Out of scope by Decision §1 of the edge sibling (the one-overlay-per-semantic-class pattern stays). This leaf preserves the parallel-overlay structure.
- **Shell-side lift.** The local-ref block stays audience-local; `shell_diagnostic_highlights_extract` is the registered destination for the helper consolidation, NOT for the overlay-internal seeding pattern.

## Why it needs to be done

Three reasons converge:

1. **The latent bug is real and reachable.** The grand-predecessor's Decision §4 says the gate should treat existing-at-audience-join diagnostics as already-seen AND fire-after-audience-join diagnostics as new. The shared `useSeenKeysGate`'s lazy-init implementation gets the *first* property right (the first non-empty commit's keys ARE seeded as "seen") but gets the *second* property wrong **only for the case where `activeDiagnostics` is empty at audience-join**: the first fire after empty mount produces the gate's first non-empty `currentKeys`; the gate seeds with those keys, marking them as already-seen; the predicate returns `false` for every key; no halo gets the animation class. The cycle/contradiction silently fails to halo on the audience surface for any joiner whose mount preceded the first fire — which is the typical broadcast posture (audience opens the route empty, then watches diagnostics arrive). The bug is invisible in Vitest test (c)/(d) today **only because** those tests pre-seed an unrelated diagnostic as a workaround; the workaround mirrors the bug's shape and is itself diagnostic of the problem. The edge sibling's fixer sub-agent surfaced this exact failure mode on the edge overlay and patched it; the node sibling carries the same bug verbatim.

2. **The deferred-e2e debt the grand-predecessor registered against `aud_session_url` is unpaid.** The grand-predecessor's Decision §6 deferred Playwright with the framing "ninth refinement on that inherited-debt chain." `aud_session_url` has since shipped and the edge sibling paid down its own deferral inline by appending a scenario to `audience-live-session.spec.ts`. The grand-predecessor's deferral is still open — the only audience-route Playwright scenario exercising a diagnostic-fire end-to-end is the edge sibling's contradiction case, and it asserts only the edge-locus halo. A cycle-fire scenario asserting the non-edge-locus halo would have caught the latent bug at the system seam; adding it now pins the fix at the seam AND closes the grand-predecessor's debt entry.

3. **Test (c) and (d)'s pre-seed workaround is anti-documentation.** A future reader of `DiagnosticFireOverlay.test.tsx` who tries to apply the gate's documented "first non-empty commit seeds" contract to reason about fresh-session behavior will be misled — the tests prove that "after a pre-seed, post-fire animates" but say nothing about the case that matters in production. Removing the workaround makes the tests document the real contract: post-mount fire from empty-active animates correctly.

After the fix:

- `<AudienceDiagnosticFireOverlay>` and `<AudienceDiagnosticEdgeFireOverlay>` carry byte-equivalent seeding implementations modulo `nodeId`/`edgeId` keying. Future readers grep one and find the other; the two are unambiguously a pair.
- The `aud_animations` group's six shipped animations (node-appear, proposed→agreed, withdrawal, diagnostic-fire-node, diagnostic-fire-edge, axiom-mark) all behave consistently at audience-join and on first fire after mount.
- The grand-predecessor's deferred Playwright debt is closed; the audience-live-session spec gains a `(10)` cycle-fire scenario alongside the edge sibling's `(9)` contradiction scenario.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — `renderedBoundingBox` and the cy event vocabulary are the canonical seams; this leaf changes neither.
- [ADR 0008 — E2E framework: Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright is the audience-surface E2E layer; the new scenario lands in `tests/e2e/audience-live-session.spec.ts`.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest test cleanups in (c) / (d) preserve permanent coverage of the per-render class logic; the Playwright scenario is a permanent system-seam pin.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the overlay continues to ship inside the audience artifact; no cross-app surface changes.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — diagnostics remain entity-axis; no change.

No new ADR. The seeding-pattern divergence between store-driven and cy-driven overlays is documented inline at the call-sites + in Decision §1 below; it is not an architectural commitment that warrants ADR-level scoping. Decision §2 spells out the rationale.

### Sibling refinements

- [`tasks/refinements/audience/aud_diagnostic_edge_fire_animation.md`](aud_diagnostic_edge_fire_animation.md) — **the source-of-debt predecessor**; carries the fix this leaf transplants. Its Status block bullet 7 ("Fixer sub-agent replaced `useSeenKeysGate` with a local `useRef<Set>` seeded synchronously from `tuples` on first render, fixing mid-session-joiner latent gate bug in `DiagnosticEdgeFireOverlay.tsx`; test (c) updated accordingly. Tech-debt follow-up registered: `aud_diagnostic_fire_animation_seeding_alignment`") is this leaf's authoring brief.
- [`tasks/refinements/audience/aud_diagnostic_fire_animation.md`](aud_diagnostic_fire_animation.md) — the grand-predecessor; its Decision §4 is the load-bearing seen-Set contract; its Decision §6 is the deferred Playwright debt this leaf pays. Neither decision is invalidated — the fix preserves §4's intent (mid-session joiners do NOT animate already-active diagnostics; fires after audience-join DO animate); §6's "chain too long" rationale no longer applies after `aud_session_url` shipped.
- [`tasks/refinements/audience/aud_dom_overlay_extraction.md`](aud_dom_overlay_extraction.md) — defines the shared `useSeenKeysGate` contract. Decision §5 framed the four existing overlay test files as the behavior-preservation regression pin; this leaf preserves all four (the four cy-driven consumers stay unchanged), so that pin remains intact.
- [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md) — established the dev-seam Playwright harness reused by the new scenario.

### Live code the leaf modifies

- [`apps/audience/src/graph/DiagnosticFireOverlay.tsx`](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx) — MODIFIED. The current implementation at [lines 88-186](../../../apps/audience/src/graph/DiagnosticFireOverlay.tsx#L88) is:

  ```tsx
  import { useMemo, type ReactElement, type RefObject } from 'react';
  // …
  import { useCytoscapeOverlayPlacements, useSeenKeysGate } from './cytoscapeOverlayHooks.js';
  // …
  export function AudienceDiagnosticFireOverlay({
    cy, containerRef, sessionId,
  }: AudienceDiagnosticFireOverlayProps): ReactElement {
    void containerRef;
    const active = useAudienceActiveDiagnostics(sessionId);
    const tuples = useMemo(() => flattenActiveDiagnosticsForFire(active), [active]);
    const placements = useCytoscapeOverlayPlacements<DiagnosticFirePlacement>(
      cy,
      (cyInstance) => commitDiagnosticFirePlacements(cyInstance, tuples),
      [tuples],
    );
    const compositeKeys = placements.map((p) => p.compositeKey);
    const isNewPair = useSeenKeysGate(compositeKeys);
    // … render …
  }
  ```

  The replacement mirrors [`apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx:72-158`](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx#L72) substituting `nodeId` for `edgeId`:

  ```tsx
  import { useMemo, useRef, type ReactElement, type RefObject } from 'react';
  // …
  import { useCytoscapeOverlayPlacements } from './cytoscapeOverlayHooks.js';
  // (useSeenKeysGate import removed)
  // …
  export function AudienceDiagnosticFireOverlay({
    cy, containerRef, sessionId,
  }: AudienceDiagnosticFireOverlayProps): ReactElement {
    void containerRef;
    const active = useAudienceActiveDiagnostics(sessionId);
    const tuples = useMemo(() => flattenActiveDiagnosticsForFire(active), [active]);
    // Seed the seen-Set synchronously on the FIRST render from the
    // store-derived tuples, not lazily on the first non-empty placement
    // commit. Rationale: tuples are read synchronously from the WS store
    // at mount time, so mid-session joiners with already-active
    // diagnostics seed their composite keys here (no retro animation),
    // AND fresh sessions (tuples empty at mount) seed with an empty set
    // so the next arrival is "new" and animates. The shared
    // `useSeenKeysGate` cannot make this distinction — it seeds on the
    // first non-empty placement commit, which conflates "store hydration
    // after mount" with "first fire after mount" and therefore swallows
    // the fresh-session-fire animation. Mirrors the edge sibling at
    // DiagnosticEdgeFireOverlay.tsx; the four cy-driven overlays
    // (PerFacetPill, AxiomMark, NodeAppear, Withdrawal) keep
    // useSeenKeysGate since their currentKeys derive synchronously from
    // cy.nodes() — for them "first non-empty commit" IS "first arrival".
    const seenKeysRef = useRef<Set<string> | null>(null);
    if (seenKeysRef.current === null) {
      seenKeysRef.current = new Set(tuples.map((t) => `${t.identityKey}\0${t.nodeId}`));
    }
    const isNewPair = (key: string): boolean => {
      const seen = seenKeysRef.current;
      if (seen === null) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const placements = useCytoscapeOverlayPlacements<DiagnosticFirePlacement>(
      cy,
      (cyInstance) => commitDiagnosticFirePlacements(cyInstance, tuples),
      [tuples],
    );
    // … render unchanged …
  }
  ```

  The render block and the module-scope `commitDiagnosticFirePlacements` helper are byte-unchanged. The header docblock gains one refinement-trail entry pointing at this leaf.

- [`apps/audience/src/graph/DiagnosticFireOverlay.test.tsx`](../../../apps/audience/src/graph/DiagnosticFireOverlay.test.tsx) — MODIFIED. Two surgical cleanups:

  - **Test (c)** ([lines 242-274](../../../apps/audience/src/graph/DiagnosticFireOverlay.test.tsx#L242)). Currently pre-fires `danglingClaim(NODE_D)` solely to seed the gate. After this leaf: seed the cy with nodes A/B/C, fire the cycle directly, assert the three halos all carry `aud-diagnostic-fire-blocking`. Mirrors the edge sibling's test (c) shape ([lines 268-298](../../../apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx#L268)). The new comment block in the test (c) body explains the seeding rationale + cross-references the refinement (one paragraph, ~5 lines).
  - **Test (d)** ([lines 276-295](../../../apps/audience/src/graph/DiagnosticFireOverlay.test.tsx#L276)). Currently pre-fires `cycle([NODE_B], 10)` for the same workaround reason. After this leaf: seed cy with nodes A/B, fire `danglingClaim(NODE_A)` directly, assert the halo carries `aud-diagnostic-fire-advisory`. No new comment needed — symmetric with the cleaned (c).
  - **Tests (a), (b), (e)-(n)** — byte-unchanged. Test (b) (mid-session joiner with already-active cycle) still passes because the local-ref pattern seeds from `tuples` at first render → already-active pairs ARE seeded as "seen" → no animation class, exactly as before. Tests (e)-(n) all run after a pre-seed step that becomes redundant but is harmless (the gate is already seeded from the empty tuples on first render; the pre-seed just adds keys to the already-seeded set).

- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — MODIFIED. One new scenario `(10) Diagnostic-fire NODE halo on cycle` appended after the edge sibling's `(9) Diagnostic-fire edge halo on contradiction`. Sketched shape (mirrors the edge sibling's scenario; substitute `cycle` for `contradiction` and a non-edge-locus selector for the assertion):

  ```ts
  test('(10) Diagnostic-fire node halo on cycle', async ({ browser }, testInfo) => {
    const context = await freshAuthedContext(browser);
    await loginAs(context, /* one of the unallocated DEV_USER_POOL users — implementer picks */);
    const page = await context.newPage();
    const sessionId = await createSession(page, {
      topic: 'Diagnostic-fire node halo on a cycle over the audience route',
      privacy: 'public',
    });
    await page.goto(`/a/sessions/${sessionId}`);
    await expect(page.getByTestId('audience-graph-root')).toBeVisible();

    // Seed three nodes so cy has elements to halo against.
    await seedNodeCreated(page, /* node A */);
    await seedNodeCreated(page, /* node B */);
    await seedNodeCreated(page, /* node C */);

    // Pre-fire snapshot: no node-locus diagnostic halos (the only halos
    // in the DOM at this point are from sibling overlays — node-appear
    // halos for the three newly-arrived nodes, none of which carry the
    // diagnostic-fire data attributes).
    const nodeHaloLocator = page.locator(
      '[data-diagnostic-fire-anim]:not([data-diagnostic-fire-locus="edge"])'
    );
    expect(await nodeHaloLocator.count()).toBe(0);

    // Apply a cycle diagnostic via the dev seam.
    await applyDiagnostic(page, {
      sessionId,
      status: 'fired',
      severity: 'blocking',
      kind: 'cycle',
      payload: { nodes: ['A', 'B', 'C'] },
    });

    // Three node halos appear, all carrying the blocking animation class
    // within the rAF settle window.
    await expect(nodeHaloLocator).toHaveCount(3);
    await expect(nodeHaloLocator.first()).toHaveClass(/aud-diagnostic-fire-blocking/);
    await expect(nodeHaloLocator.nth(1)).toHaveClass(/aud-diagnostic-fire-blocking/);
    await expect(nodeHaloLocator.nth(2)).toHaveClass(/aud-diagnostic-fire-blocking/);
  });
  ```

  The `applyDiagnostic`, `seedNodeCreated`, `freshAuthedContext`, `loginAs`, and `createSession` helpers were established by the edge sibling's scenario landing in the same file — reused verbatim. The spec's header docblock gets one new enumerated entry.

  The selector `[data-diagnostic-fire-anim]:not([data-diagnostic-fire-locus="edge"])` is the stable node-locus discriminator: the node overlay's halos carry `data-node-id` and lack the `data-diagnostic-fire-locus` attribute, while edge overlay halos carry `data-diagnostic-fire-locus="edge"`. The edge sibling's Decision §1 commentary established this discriminator posture.

### What the surface MUST NOT do

- **No edit to `useSeenKeysGate`'s implementation or JSDoc contract** ([`apps/audience/src/graph/cytoscapeOverlayHooks.ts:196-210`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L196)). The four cy-driven consumers depend on its lazy-init semantic.
- **No edit to `<AudienceDiagnosticEdgeFireOverlay>` or its test.** The fix it already carries is the reference; this leaf transplants verbatim.
- **No new shared hook (e.g., `useSyncSeededKeysGate`)** in `cytoscapeOverlayHooks.ts`. Decision §1 rejects the abstraction at two callers.
- **No widening of `useSeenKeysGate`'s parameter list** to support both seed modes. Decision §1 rejects the parameterized-hook option.
- **No edit to `flattenActiveDiagnosticsForFire`, `affectedEntities`, `diagnosticIdentityKey`, or any other helper in `diagnosticHighlights.ts`.** The fix is internal to the overlay.
- **No change to the rendered DOM shape, attribute names, or animation classes.** External observers (tests, Playwright selectors, future readers) see byte-equivalent output post-fix — modulo the cycle-fire actually animating on fresh-session mount, which is the bug-fix's load-bearing observable change.
- **No new CSS, no new keyframes, no new utility classes.** The animation styling is the grand-predecessor's; reused verbatim.
- **No new dependency.** The `useRef` import is from `react` (already imported in the file).
- **No new i18n keys.** Halos carry no visible text.
- **No edit to the moderator/participant surfaces.** Their diagnostic-highlighting paths are independent and have their own gates.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — MODIFIED. ~15 LOC delta as sketched under Inputs / context.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — MODIFIED. Test (c) and test (d) cleanup; ~20 LOC removed across the two, plus one ~5-line comment block in test (c).
- `tests/e2e/audience-live-session.spec.ts` — MODIFIED. One new scenario `(10) Diagnostic-fire node halo on cycle` appended; the header docblock's scenario enumeration gains one entry.
- `tasks/50-audience-and-broadcast.tji` — MODIFIED at close-time only: closer adds `complete 100`.

### Files this task does NOT touch

- `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `apps/audience/src/graph/cytoscapeOverlayHooks.test.tsx` — UNCHANGED.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx`, `apps/audience/src/graph/DiagnosticEdgeFireOverlay.test.tsx` — UNCHANGED.
- `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `AxiomMarkOverlay.tsx`, `NodeAppearOverlay.tsx`, `WithdrawalHaloOverlay.tsx`, `AnnotationOverlay.tsx` and their `*.test.tsx` siblings — UNCHANGED.
- `apps/audience/src/graph/diagnosticHighlights.ts`, `diagnosticHighlights.test.ts` — UNCHANGED.
- `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/src/graph/GraphView.tsx`, `GraphView.test.tsx` — UNCHANGED.
- `apps/audience/src/index.css`, `apps/audience/src/index.test.ts` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED.
- `apps/server/**`, `apps/moderator/**`, `apps/participant/**`, `apps/root/**` — UNCHANGED.
- `packages/shell/**`, `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §2).
- `playwright.config.ts` — UNCHANGED.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` imports `useRef` from React, does NOT import `useSeenKeysGate`, and implements the local-ref seeded-from-`tuples` pattern at module-call-site shape byte-equivalent (modulo identifier substitution) to `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx`. The header docblock carries a refinement-trail entry pointing at this leaf.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` test (c) no longer pre-fires `danglingClaim(NODE_D)`; it seeds the cy with nodes A/B/C, fires `cycle([A,B,C])` directly, and asserts three halos all carry `aud-diagnostic-fire-blocking`. Test (d) no longer pre-fires `cycle([NODE_B])`; it seeds cy with nodes A/B, fires `danglingClaim(NODE_A)` directly, and asserts the halo carries `aud-diagnostic-fire-advisory`. Tests (a), (b), (e)-(n) pass byte-unchanged.
- `apps/audience/src/graph/cytoscapeOverlayHooks.ts`, `cytoscapeOverlayHooks.test.tsx` remain byte-unchanged. `useSeenKeysGate`'s JSDoc and implementation are preserved.
- `apps/audience/src/graph/DiagnosticEdgeFireOverlay.tsx`, `DiagnosticEdgeFireOverlay.test.tsx` remain byte-unchanged.
- `apps/audience/src/graph/PerFacetPillOverlay.tsx`, `AxiomMarkOverlay.tsx`, `NodeAppearOverlay.tsx`, `WithdrawalHaloOverlay.tsx`, `AnnotationOverlay.tsx` and their tests remain byte-unchanged.
- `apps/audience/src/graph/GraphView.tsx`, `GraphView.test.tsx`, `apps/audience/src/index.css`, `apps/audience/src/index.test.ts`, `apps/audience/package.json` remain byte-unchanged.
- Per ADR 0022, no throwaway smoke scripts. The Vitest cleanups in (c) / (d) replace a workaround with the actual contract the overlay now satisfies; coverage of the per-render class logic is preserved.
- **Playwright spec — INLINE, NOT DEFERRED.** `tests/e2e/audience-live-session.spec.ts` carries the appended scenario `(10) Diagnostic-fire node halo on cycle`. Asserts: (a) pre-fire, no `[data-diagnostic-fire-anim]:not([data-diagnostic-fire-locus="edge"])` halos render; (b) after `applyDiagnostic(...)` with a `cycle` payload naming three nodes, exactly 3 such node-locus halos render within the rAF settle window, each carrying `aud-diagnostic-fire-blocking`. Uses a distinct `DEV_USER_POOL` member to preserve `fullyParallel: true` semantics — implementer picks an unallocated user when scoping the diff. The spec's header docblock gets one new enumerated scenario entry. **This scenario pays down the deferred-e2e debt registered by `aud_diagnostic_fire_animation` Decision §6** (chain target `aud_session_url` is `complete 100`; the debt closes here).
- `pnpm run check` clean (strict TS pass).
- `pnpm run test:smoke` green (Vitest count unchanged net — the 2 tests modified pass with the new shape; no count delta).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is negligible (~15 LOC swap).
- Playwright suite green (the new scenario passes; the existing nine scenarios pass byte-unchanged).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_diagnostic_fire_animation_seeding_alignment`.

The leaf does NOT register named-future-tasks. The two registered-elsewhere follow-ons (`shell_diagnostic_highlights_extract` against the grand-predecessor; `aud_animation_pacing` against the group) are unaffected.

## Decisions

### §1 — Surgical local-ref fix on `<AudienceDiagnosticFireOverlay>` only; preserve `useSeenKeysGate`'s shared contract verbatim

Three options for "where the synchronous-seed pattern lives":

A. **Replace the `useSeenKeysGate` call in `<AudienceDiagnosticFireOverlay>` with a local `useRef<Set<string>>` block byte-equivalent to the edge sibling's existing block.** The shared hook is unchanged; the four cy-driven overlay consumers (PerFacetPill, AxiomMark, NodeAppear, Withdrawal — and the AnnotationOverlay's edge-iteration cousin) keep the lazy-init contract that is correct for them.

B. **Broaden `useSeenKeysGate` to accept an optional `seedKeys?: readonly K[]` parameter** that, when provided, seeds the set synchronously on first render from the parameter; when omitted, falls back to the existing lazy-init-on-first-non-empty-render. Both store-driven and cy-driven overlays consume the same hook with different argument shapes.

C. **Lift the synchronous-seed pattern into a new shared hook** (`useSyncSeededKeysGate<K>(seedKeys: readonly K[]): (key: K) => boolean`) alongside the existing `useSeenKeysGate`. The two store-driven overlays consume the new hook; the four cy-driven overlays keep the existing one. The two hooks compose via two distinct call-sites with no overloading.

**Chosen: A.** Four reasons:

1. **Two callers is below the rule-of-three-or-four extraction threshold.** The audience-codebase pattern (per `aud_node_appear_animation` Decision §2, which registered `aud_dom_overlay_extraction` only after the FOURTH duplicate of the overlay scaffolding) is to extract on the third or fourth call-site, not the second. Today's two store-driven callers (node-fire + edge-fire) are exactly the rule's "wait" zone. A third store-driven call-site (a hypothetical `aud_diagnostic_clear_animation`, a participant-side mirror, a moderator-side mirror) would trip the threshold; at that point the consolidation is mechanical because the local-ref blocks are byte-equivalent. Pre-investing today buys nothing and adds an abstraction that has zero in-tree precedent for "hook with two seeding modes."

2. **Option B widens the shared contract in a way the JSDoc would have to apologize for.** The hook's current JSDoc ([`apps/audience/src/graph/cytoscapeOverlayHooks.ts:168-195`](../../../apps/audience/src/graph/cytoscapeOverlayHooks.ts#L168)) is a tight ~25-line explanation of ONE semantic ("lazy-init on first non-empty render"). Adding a `seedKeys?` parameter requires the JSDoc to explain two semantics, and every existing caller's reader now has to determine which branch their call-site lives in. The semantic distinction (store-driven vs cy-driven) is a property of the call-site's data flow, not a property the hook itself knows about — pushing it through the hook adds indirection without consolidation.

3. **Option C codifies a partition that may not be the right one.** The split "store-driven uses sync seed; cy-driven uses lazy seed" is the right characterization TODAY because all store-driven keys are available synchronously at first render and all cy-driven keys are not. A future overlay whose keys come from a slower-than-render external system (e.g., a fetch-backed selector that resolves on a tick after mount) would belong in neither bucket. Codifying the today-correct partition into two named hooks before there's a third call-site risks miscategorizing the future one. The local-ref pattern in-line at each call-site keeps the seeding semantic legible and easy to retune per-callsite.

4. **Zero blast radius.** Option A touches one production file (`DiagnosticFireOverlay.tsx`) and one test file. Option B touches `cytoscapeOverlayHooks.ts` + its JSDoc + the hook's test file + both store-driven overlays + at minimum a smoke check that the four cy-driven overlays still behave (they would — the optional parameter would default to today's behavior — but the smoke check needs to exist). Option C touches `cytoscapeOverlayHooks.ts` + its JSDoc + adds a new hook test file or expands the existing one + both store-driven overlays. Option A has the smallest reviewable diff for the same observable fix.

Option B is rejected. Option C is rejected (revisitable when a third store-driven overlay appears). Option A is shipped.

The cross-reference comment block in the node-fire overlay's new code names the parallel at the edge sibling so future readers grep one and find the other.

### §2 — No new ADR; document the seeding-pattern distinction inline at the call-sites

The "store-driven overlays seed synchronously from `tuples`; cy-driven overlays seed lazily on first non-empty placement commit" distinction is a *consequence* of the data-flow seam each overlay sits at, not a fresh architectural commitment.

- The shared hook's lazy-init contract is established by [`aud_dom_overlay_extraction`](aud_dom_overlay_extraction.md) Decision §1 — extraction at the audience layer with two purpose-built hooks rather than a render-prop primitive. That decision is preserved.
- The "tuples are read synchronously from the WS store at mount" property is established by the grand-predecessor's wsStore extension + selector hook (`useAudienceActiveDiagnostics`). That seam exists and is unchanged.
- The local-ref block is a small per-overlay implementation detail describing how that overlay reconciles a store-derived placement set with React-keyed reconciliation. It is not an architectural seam.

An ADR would commit the codebase to "always handle store-driven seeding with a local ref" or "split shared hooks by data-source." Neither commitment is right to make at two callers, per Decision §1. If a third store-driven overlay arrives and tips into the consolidation Decision §1 §3 envisions, *that* leaf's refinement deliberates on whether the consolidation needs ADR-level scoping.

The inline comment block in the new code (under Inputs / context above) carries the rationale; future readers don't need to traverse out-of-tree to understand the pattern.

### §3 — Cleanup tests (c) and (d) in place; do NOT add new test cases that try to "prove the fix"

Three options for the test surface:

A. **Remove the pre-seed workaround from (c) and (d); keep the test count the same.** The cleaned tests prove the new behavior (fresh-session post-empty-mount fire animates) AND continue to prove the per-severity class logic. No new test cases needed — the workaround's removal IS the new-behavior assertion.

B. **Keep (c) and (d) as-is (with pre-seed workaround) and add new cases (o) and (p) covering "post-empty-mount cycle/dangling-claim fire animates."** Test count goes from 13 → 15.

C. **Refactor (c) and (d) into parameterized cases driving over a `(payload, expectedClass)` table.** Test count drops or stays the same; the underlying assertions broaden.

**Chosen: A.** Three reasons:

1. **The workaround IS the bug's anti-test.** Pre-firing `danglingClaim(NODE_D)` to "seed the gate" before firing the cycle is a load-bearing accidental adaptation to the bug — without the bug, the pre-fire would be redundant. Removing the workaround is the cleanest expression of "after the fix, the workaround is unnecessary." Adding parallel new cases (option B) leaves the workaround in the file as anti-documentation; a future reader has to figure out why (c) takes a circuitous path while (o) takes a direct one. Option A removes the indirection.

2. **Test (b) already pins the mid-session-joiner posture.** Test (b) (initial-mount with already-active cycle on 3 nodes renders 3 halos with NO animation class) is the load-bearing pin for "the synchronous seed correctly absorbs already-active keys." Option A's cleaned (c) is the load-bearing pin for "post-empty-mount fire DOES animate." Together (b) + cleaned (c) prove both halves of Decision §4 of the grand-predecessor without any redundant cases.

3. **Option C is over-engineered for a 0.5d leaf.** Refactoring (c) and (d) into a parameterized table is gratuitous; the two named cases read fine and match the edge sibling's named-case pattern.

Option B is rejected (leaves anti-documentation in the file). Option C is rejected (premature refactor).

### §4 — Playwright cycle-fire scenario inline; pay the grand-predecessor's deferred-e2e debt

Three observations close the question:

1. **The audience surface is reachable.** `aud_session_url` shipped (`complete 100`); the dev-seam exposing `window.__aConversaWsStore` is the harness the edge sibling's `(9) Diagnostic-fire edge halo on contradiction` scenario already exercises. The grand-predecessor's "component not yet reachable" rationale no longer holds.

2. **The grand-predecessor's chain-9 debt is unpaid.** The grand-predecessor (`aud_diagnostic_fire_animation`) deferred its Playwright scenario to `aud_session_url` as the ninth refinement on that chain. `aud_session_url` shipped its six enumerated scenarios; the chain is closed from the routing side but the diagnostic-fire-node scenario the grand-predecessor would have queued there is missing. The orchestrator brief's "wiring tasks inherit deferred e2e debt" rule applies — though strictly this leaf is not a wiring task, it IS the smallest leaf whose work touches the same overlay whose Playwright spec was deferred, AND it ships a behavior change at the system seam that only a Playwright spec can pin. Adding the spec here is the right place.

3. **The scenario is small (~60 LOC) and reuses helpers the edge sibling already established.** `applyDiagnostic`, `seedNodeCreated`, `freshAuthedContext`, `loginAs`, `createSession` are all in-tree. The only delta from the edge scenario is the payload (`cycle` instead of `contradiction`) and the selector (`:not([data-diagnostic-fire-locus="edge"])` instead of `[data-diagnostic-fire-locus="edge"]`).

Inlining the spec also makes the fix's effect observable end-to-end: WITHOUT the fix, the new scenario fails (the three halos render but lack the animation class — the bug); WITH the fix, it passes. Vitest test (c) post-cleanup is the unit-level pin; the Playwright scenario is the system-seam pin. Both are permanent (per ADR 0022).

The scenario covers the cycle / blocking / three-node path. Advisory / single-node coverage stays at the unit level via test (d). The edge sibling's scenario already covers contradiction / blocking / two-edge; the two Playwright scenarios together pin the (node-locus, blocking) and (edge-locus, blocking) corners of the matrix. Adding more Playwright scenarios for advisory severity or for the self-contradicts coherency-hint path would be redundant with Vitest coverage already in place — the wire-message-to-overlay round-trip is the same regardless of severity, so duplicating the Playwright cost buys little.

The implementer selects one unallocated `DEV_USER_POOL` user; alice/ben/maria/dave/erin/frank are taken by the original six scenarios and one more is taken by the edge sibling's `(9)` scenario. Implementer picks the next unallocated entry (or adds a new pool member if the pool is closed, per the harness convention `freshAuthedContext()` establishes).

### §5 — Per-Vitest case-(c) and case-(d) comment cross-references this refinement, NOT a wholesale docblock rewrite

The two cleaned test cases each get one small comment block (~3-5 lines) cross-referencing this refinement and noting that the workaround was removed. The test file's top-of-file docblock is byte-unchanged (the existing trail entry for `aud_diagnostic_fire_animation.md` covers the test file's overall provenance). One refinement-trail entry on the production-side file (`DiagnosticFireOverlay.tsx`) docblock is added.

This keeps the documentation surface terse and lets the new comment block carry the case-specific narrative.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/audience/src/graph/DiagnosticFireOverlay.tsx` — replaced `useSeenKeysGate(compositeKeys)` with a local `useRef<Set<string>>` seeded synchronously from `tuples` on first render; dropped `useSeenKeysGate` import; added `useRef` to React imports; added comment block cross-referencing this refinement and the edge sibling.
- `apps/audience/src/graph/DiagnosticFireOverlay.test.tsx` — removed pre-seed workaround from test (c) (`danglingClaim(NODE_D)` pre-fire) and test (d) (`cycle([NODE_B])` pre-fire); both now fire the target diagnostic directly from empty-mount and assert animation class; added cross-reference comment in test (c).
- `tests/e2e/audience-live-session.spec.ts` — appended scenario `(10) Diagnostic-fire node halo on cycle: seeded nodes halo amber-blocking when the cycle fires`; uses dev-pool member `henry`; pays down deferred-e2e debt from `aud_diagnostic_fire_animation` Decision §6.
- Pre-seed workarounds removed from Vitest tests (c) and (d): fresh-session post-empty-mount fire now animates correctly without seed workaround; the local-ref fix preserves mid-session-joiner no-retro-animation (test (b) byte-unchanged).
- `useSeenKeysGate` in `cytoscapeOverlayHooks.ts` and all four cy-driven overlay consumers remain byte-unchanged.
