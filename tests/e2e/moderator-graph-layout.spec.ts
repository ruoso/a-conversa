// E2E spec for the moderator's graph auto-layout (dagre, TB).
//
// Refinement: tasks/refinements/moderator-ui/mod_layout_engine_choice.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0025-graph-layout-engine-dagre.md
//
// **What this spec proves.**
//   1. The moderator's operate route is reachable after `loginAs(...)`.
//   2. Seeding a 6-node / 5-edge claim+evidence+rebut graph produces a
//      canvas where every rendered card's bounding rect is non-
//      overlapping (the load-bearing assertion that the layout engine
//      actually placed nodes rather than piling them at the origin).
//   3. For every seeded edge, the source card's `y` is strictly less
//      than the target card's `y` — pinning the `rankdir: 'TB'`
//      direction (source above target).
//   4. Stability: adding one more node + one more edge after the
//      initial layout settles MUST NOT move any of the original six
//      cards by more than 2 px (sub-pixel rounding tolerance). The
//      position-cache strategy is the stability seam.
//
// **Setup pattern.** Mirrors `moderator-hover-details.spec.ts`:
// `loginAs` → POST /api/sessions → goto operate → probe WS-store
// reachability → `seedWsStore(...)` with the layout fixture →
// assertions. The fallback branch (window-attached store unreachable)
// mirrors hover-details, marking the rich-content cases skipped with
// a reference to the same `playwright_session_seed_helper` future
// task.
//
// **Project entry.** Runs under a new `chromium-moderator-layout`
// project in `playwright.config.ts` (en-US locale, ignoreHTTPSErrors
// for the OIDC redirect, en-US storage state). Single-locale: the
// layout assertions are locale-independent (positions, not text), so
// running the spec three times would triple wall-clock cost for zero
// signal.

import { expect, test, type Page } from '@playwright/test';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedWsStore } from './fixtures/wsStoreSeed';

interface CreatedSession {
  readonly id: string;
}

// Six-node fixture: one claim, three supporting evidences, two rebuts
// of the claim. Five edges total — each evidence supports the claim,
// each rebut rebuts the claim.
const CLAIM_ID = '11111111-1111-4111-8111-11111111c001';
const EV_ID_1 = '11111111-1111-4111-8111-11111111e001';
const EV_ID_2 = '11111111-1111-4111-8111-11111111e002';
const EV_ID_3 = '11111111-1111-4111-8111-11111111e003';
const REBUT_ID_1 = '11111111-1111-4111-8111-11111111r001';
const REBUT_ID_2 = '11111111-1111-4111-8111-11111111r002';

const EDGE_EV1 = '22222222-2222-4222-8222-22222222e001';
const EDGE_EV2 = '22222222-2222-4222-8222-22222222e002';
const EDGE_EV3 = '22222222-2222-4222-8222-22222222e003';
const EDGE_RB1 = '22222222-2222-4222-8222-22222222r001';
const EDGE_RB2 = '22222222-2222-4222-8222-22222222r002';

// One additional node + edge for the stability assertion.
const EXTRA_NODE_ID = '11111111-1111-4111-8111-11111111e004';
const EXTRA_EDGE_ID = '22222222-2222-4222-8222-22222222e004';

// Three-node fixture for the tall-node measured-dimensions assertion
// (refinement `mod_layout_measured_dimensions`). The tall node carries
// a ≥ 200-character wording; the rendered card grows vertically to fit
// (no `line-clamp`, no `max-h` — see `<StatementNode>`). The two
// baseline nodes connect to it; the layout must respect the measured
// height so non-overlap holds.
const TALL_NODE_ID = '33333333-3333-4333-8333-33333333a001';
const TALL_NEIGHBOR_ID_1 = '33333333-3333-4333-8333-33333333b001';
const TALL_NEIGHBOR_ID_2 = '33333333-3333-4333-8333-33333333b002';
const TALL_EDGE_ID_1 = '33333333-3333-4333-8333-33333333e001';
const TALL_EDGE_ID_2 = '33333333-3333-4333-8333-33333333e002';

interface RectSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Read the bounding client rects of every `data-testid="statement-
 * node-*"` card on the page. Returns a snapshot keyed by node id.
 */
async function snapshotCardRects(page: Page, nodeIds: readonly string[]): Promise<RectSnapshot[]> {
  return page.evaluate(
    (ids) => {
      return ids
        .map((id) => {
          const el = document.querySelector(`[data-testid="statement-node-${id}"]`);
          if (el === null) return null;
          const rect = el.getBoundingClientRect();
          return {
            id,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((r): r is RectSnapshot => r !== null);
    },
    [...nodeIds],
  );
}

function rectsOverlap(a: RectSnapshot, b: RectSnapshot): boolean {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  return !(aRight <= b.x || bRight <= a.x || aBottom <= b.y || bBottom <= a.y);
}

function rectCenter(r: RectSnapshot): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

test.describe.serial('moderator graph layout (dagre, TB)', () => {
  test('seeded graph renders without overlap, TB direction holds, existing nodes do not move on incremental events', async ({
    page,
  }) => {
    // 1. Log in as a dev user.
    await loginAs(page, { username: 'alice' });

    // 2. Create a fresh session.
    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'graph-layout spec session',
        privacy: 'private',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createResp.status(), 'session creation must return 201').toBe(201);
    const session = (await createResp.json()) as CreatedSession;
    expect(session.id, 'session id must be present in the response').toBeTruthy();

    // 3. Navigate to the operate route.
    await page.goto(`/sessions/${session.id}/operate`);
    await expect(
      page.getByTestId('graph-canvas-root'),
      'graph-canvas-root must mount on the operate route',
    ).toBeVisible({ timeout: 15_000 });

    // 4. Probe whether the WS-store seed path is available.
    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      // Fallback: the canvas mounts but the rich-content cases can't
      // run. Same policy as `moderator-hover-details.spec.ts`.
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable from the moderator SPA — the dev-only attachment did not fire. Layout assertions deferred to a future `playwright_session_seed_helper` task.',
      );
      return;
    }

    // 5. Seed the 6-node / 5-edge claim+evidence+rebut fixture.
    await seedWsStore(page, {
      sessionId: session.id,
      nodes: [
        { nodeId: CLAIM_ID, wording: 'The minimum wage should be raised to $20/hour.' },
        { nodeId: EV_ID_1, wording: 'BLS data shows current minimum wage trails inflation.' },
        { nodeId: EV_ID_2, wording: 'Studies in Seattle show modest employment effects.' },
        { nodeId: EV_ID_3, wording: 'Household survey: 35% report wage shortfall.' },
        { nodeId: REBUT_ID_1, wording: 'Small businesses cite hiring freezes.' },
        { nodeId: REBUT_ID_2, wording: 'Automation accelerates above wage thresholds.' },
      ],
      edges: [
        { edgeId: EDGE_EV1, source: EV_ID_1, target: CLAIM_ID, role: 'supports' },
        { edgeId: EDGE_EV2, source: EV_ID_2, target: CLAIM_ID, role: 'supports' },
        { edgeId: EDGE_EV3, source: EV_ID_3, target: CLAIM_ID, role: 'supports' },
        { edgeId: EDGE_RB1, source: REBUT_ID_1, target: CLAIM_ID, role: 'rebuts' },
        { edgeId: EDGE_RB2, source: REBUT_ID_2, target: CLAIM_ID, role: 'rebuts' },
      ],
    });

    // 6. Wait for all six cards to render.
    const allNodeIds = [CLAIM_ID, EV_ID_1, EV_ID_2, EV_ID_3, REBUT_ID_1, REBUT_ID_2];
    for (const id of allNodeIds) {
      await expect(
        page.getByTestId(`statement-node-${id}`),
        `seeded node ${id} card must render on the canvas`,
      ).toBeVisible({ timeout: 10_000 });
    }

    // Wait past the 75 ms measurement-driven re-layout debounce (per
    // refinement `mod_layout_measured_dimensions`). A generous 250 ms
    // covers the debounce + the React render cycle + any post-render
    // ResizeObserver aftershocks under headed-browser conditions.
    // Without this wait, the snapshot below might land between the
    // constant-dimension first paint and the measured re-layout,
    // producing a stability-assertion failure when the post-settle
    // snapshot taken later (rectsAfter) reflects measured positions.
    await page.waitForTimeout(250);

    // 7. Non-overlap assertion: every pair of rendered cards must have
    //    disjoint bounding rects.
    const rects = await snapshotCardRects(page, allNodeIds);
    expect(rects.length, 'every seeded card must have a measurable rect').toBe(allNodeIds.length);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a === undefined || b === undefined) continue;
        expect(
          rectsOverlap(a, b),
          `cards ${a.id} and ${b.id} must not overlap (a=${JSON.stringify(a)} b=${JSON.stringify(b)})`,
        ).toBe(false);
      }
    }

    // 8. TB-direction assertion: for every seeded edge, source.y <
    //    target.y. The dagre TB layout places source ranks above
    //    target ranks.
    const edgeFixtures: Array<{ source: string; target: string }> = [
      { source: EV_ID_1, target: CLAIM_ID },
      { source: EV_ID_2, target: CLAIM_ID },
      { source: EV_ID_3, target: CLAIM_ID },
      { source: REBUT_ID_1, target: CLAIM_ID },
      { source: REBUT_ID_2, target: CLAIM_ID },
    ];
    const rectById = new Map(rects.map((r) => [r.id, r] as const));
    for (const { source, target } of edgeFixtures) {
      const s = rectById.get(source);
      const t = rectById.get(target);
      expect(s, `source rect for ${source} must exist`).toBeDefined();
      expect(t, `target rect for ${target} must exist`).toBeDefined();
      if (s === undefined || t === undefined) continue;
      expect(
        s.y < t.y,
        `source ${source} (y=${s.y}) must be above target ${target} (y=${t.y}) under rankdir=TB`,
      ).toBe(true);
    }

    // 9. Stability assertion: snapshot centres of the six original
    //    cards; seed one more node + one more edge; re-read the same
    //    centres; assert each moved by ≤ 2 px.
    const beforeCenters = rects.map((r) => ({ id: r.id, center: rectCenter(r) }));

    await seedWsStore(page, {
      sessionId: session.id,
      nodes: [
        { nodeId: EXTRA_NODE_ID, wording: 'Real-wage trends among single-parent households.' },
      ],
      edges: [{ edgeId: EXTRA_EDGE_ID, source: EXTRA_NODE_ID, target: CLAIM_ID, role: 'supports' }],
    });

    // Wait for the new card to render before re-measuring.
    await expect(
      page.getByTestId(`statement-node-${EXTRA_NODE_ID}`),
      'incremental node card must render',
    ).toBeVisible({ timeout: 10_000 });

    // Wait past the measurement-driven re-layout debounce again — the
    // new node triggers a measurement event for its own id, which the
    // debounced effect commits 75 ms later. Existing nodes' positions
    // stay cached and only the new node's id is evicted, but we wait
    // here so the snapshot below sees the post-debounce steady state.
    // Refinement: `mod_layout_measured_dimensions`.
    await page.waitForTimeout(250);

    const rectsAfter = await snapshotCardRects(page, allNodeIds);
    const afterById = new Map(rectsAfter.map((r) => [r.id, r] as const));
    for (const { id, center } of beforeCenters) {
      const r = afterById.get(id);
      expect(r, `card ${id} must still render after incremental seed`).toBeDefined();
      if (r === undefined) continue;
      const c = rectCenter(r);
      const dx = Math.abs(c.x - center.x);
      const dy = Math.abs(c.y - center.y);
      expect(
        dx,
        `card ${id} centre x moved by ${dx} px (>2 px tolerance) on incremental layout`,
      ).toBeLessThanOrEqual(2);
      expect(
        dy,
        `card ${id} centre y moved by ${dy} px (>2 px tolerance) on incremental layout`,
      ).toBeLessThanOrEqual(2);
    }
  });

  // Refinement: tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md
  //
  // **What this test proves.** A node forced to ≥ 140 px rendered height
  // (long wording paragraph in the un-truncated `<StatementNode>` card)
  // produces a layout where non-overlap STILL holds. Before the
  // measurement-driven re-layout landed (ADR 0025 Consequences trade-off),
  // dagre was fed a constant 90 px node height, and a 140+ px rendered
  // card overflowed into the rank below — neighbouring cards visually
  // collided. With per-node measured dimensions threaded through to
  // dagre via `LayoutOptions.dimensions`, the layout respects the actual
  // rendered footprint and the non-overlap contract holds.
  //
  // The fixture seeds three nodes: one tall (forced ≥ 140 px height by
  // a ≥ 200-char wording) and two baseline neighbours edge-connected to
  // it. The tall node sits in the middle rank; the two neighbours are
  // below it (children connected by `supports` edges). The assertion
  // proves pairwise non-overlap across every rendered card after the
  // measurement-driven re-layout settles.
  test('tall node fixture: non-overlap holds after measured re-layout (mod_layout_measured_dimensions)', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'graph-layout tall-node spec session',
        privacy: 'private',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createResp.status(), 'session creation must return 201').toBe(201);
    const session = (await createResp.json()) as CreatedSession;
    expect(session.id, 'session id must be present in the response').toBeTruthy();

    await page.goto(`/sessions/${session.id}/operate`);
    await expect(
      page.getByTestId('graph-canvas-root'),
      'graph-canvas-root must mount on the operate route',
    ).toBeVisible({ timeout: 15_000 });

    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable from the moderator SPA — the dev-only attachment did not fire. Tall-node assertion deferred to a future `playwright_session_seed_helper` task.',
      );
      return;
    }

    // Long wording forces the card to grow vertically. The
    // `<StatementNode>` card has `max-w-[18rem]` (288 px) with no
    // height cap and `whitespace-pre-line break-words`, so a 200+
    // character paragraph wraps onto multiple lines, producing a
    // rendered height well above 140 px. This wording is intentionally
    // multi-sentence + multi-clause to maximize the line count under
    // the max-width cap.
    const longWording =
      'The 2026 macroeconomic outlook suggests that demand-side stimulus, broad-based wage growth, and supply-chain normalization will jointly contribute to a soft-landing scenario. Continued monitoring of housing affordability, household debt service ratios, and small-business credit access remains essential to mitigate downside risks.';

    await seedWsStore(page, {
      sessionId: session.id,
      nodes: [
        { nodeId: TALL_NODE_ID, wording: longWording },
        { nodeId: TALL_NEIGHBOR_ID_1, wording: 'Neighbour A — short wording.' },
        { nodeId: TALL_NEIGHBOR_ID_2, wording: 'Neighbour B — short wording.' },
      ],
      edges: [
        {
          edgeId: TALL_EDGE_ID_1,
          source: TALL_NODE_ID,
          target: TALL_NEIGHBOR_ID_1,
          role: 'supports',
        },
        {
          edgeId: TALL_EDGE_ID_2,
          source: TALL_NODE_ID,
          target: TALL_NEIGHBOR_ID_2,
          role: 'supports',
        },
      ],
    });

    const allNodeIds = [TALL_NODE_ID, TALL_NEIGHBOR_ID_1, TALL_NEIGHBOR_ID_2];
    for (const id of allNodeIds) {
      await expect(
        page.getByTestId(`statement-node-${id}`),
        `seeded node ${id} card must render on the canvas`,
      ).toBeVisible({ timeout: 10_000 });
    }

    // Wait until the tall card's rendered height crosses the 140 px
    // threshold. This is the seam the refinement names: the measured
    // height MUST exceed the 90 px constant the layout USED to feed
    // dagre, otherwise the fixture isn't actually exercising the
    // tall-node path. We poll the bounding rect every 50 ms up to 5 s.
    await page.waitForFunction(
      (tallId) => {
        const el = document.querySelector(`[data-testid="statement-node-${tallId}"]`);
        if (el === null) return false;
        return el.getBoundingClientRect().height >= 140;
      },
      TALL_NODE_ID,
      { timeout: 5000, polling: 50 },
    );

    // Wait past the 75 ms measurement-driven re-layout debounce + one
    // render cycle. 250 ms is a generous safety margin under headed-
    // browser conditions. Refinement: `mod_layout_measured_dimensions`.
    await page.waitForTimeout(250);

    // Snapshot every rendered card's bounding rect.
    const rects = await snapshotCardRects(page, allNodeIds);
    expect(rects.length, 'every seeded card must have a measurable rect').toBe(allNodeIds.length);

    // The tall card's height must be ≥ 140 px — verifies the fixture
    // is actually exercising the multi-row vertical-growth case the
    // task ships.
    const tallRect = rects.find((r) => r.id === TALL_NODE_ID);
    expect(tallRect, 'tall node rect must exist').toBeDefined();
    if (tallRect !== undefined) {
      expect(
        tallRect.height,
        `tall node rendered height (${tallRect.height} px) must exceed 140 px`,
      ).toBeGreaterThanOrEqual(140);
    }

    // Pairwise non-overlap — the load-bearing assertion. With the
    // measurement-driven re-layout, dagre received the actual rendered
    // footprint for the tall node, so the rank below the tall node is
    // placed far enough down that the neighbour cards don't collide
    // with the tall card's overflow.
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a === undefined || b === undefined) continue;
        expect(
          rectsOverlap(a, b),
          `tall-node-fixture cards ${a.id} and ${b.id} must not overlap (a=${JSON.stringify(a)} b=${JSON.stringify(b)})`,
        ).toBe(false);
      }
    }

    // TB-direction holds: the tall node is the source of every edge in
    // the fixture, so its y must be less than both neighbour ys.
    const rectById = new Map(rects.map((r) => [r.id, r] as const));
    const tall = rectById.get(TALL_NODE_ID);
    const n1 = rectById.get(TALL_NEIGHBOR_ID_1);
    const n2 = rectById.get(TALL_NEIGHBOR_ID_2);
    expect(tall).toBeDefined();
    expect(n1).toBeDefined();
    expect(n2).toBeDefined();
    if (tall === undefined || n1 === undefined || n2 === undefined) return;
    expect(
      tall.y < n1.y,
      `tall source y=${tall.y} must be above neighbour 1 y=${n1.y} under TB`,
    ).toBe(true);
    expect(
      tall.y < n2.y,
      `tall source y=${tall.y} must be above neighbour 2 y=${n2.y} under TB`,
    ).toBe(true);
  });
});
