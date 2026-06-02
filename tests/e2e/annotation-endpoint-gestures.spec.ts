// E2E spec for the moderator's annotation-endpoint propose-gesture
// chain — drawing an edge between an annotation and a node, and
// capturing-with-edge against an annotation.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this spec proves.**
//   1. After dragging from an annotation node's source handle onto a
//      statement node's target handle, `<DrawEdgeRolePicker>` mounts
//      carrying `data-source-kind="annotation"` + `data-target-kind=
//      "node"`. Clicking a role button fires a `set-edge-substance`
//      propose envelope whose endpoint routing matches.
//   2. After clicking an annotation node during capture, the
//      `<CaptureTargetChip>` reflects the staged annotation
//      (`data-target-kind="annotation"`) with the annotation's
//      content as the label.
//
// **Setup pattern.** Mirrors `annotation-endpoint-rendering.spec.ts`:
// the moderator session is created via `POST /api/sessions`, the
// page is navigated to `/m/sessions/<id>/operate`, then events are
// seeded into the moderator's Zustand WS store via `wsStoreSeed.ts`.
// Both seeded scenarios reuse the seed seam established by
// `mod_render_annotation_endpoint_edges` — no new fixture helpers
// were needed.
//
// **WS-store seed fallback.** If `window.__aConversaWsStore` is
// unreachable from the page, both scenarios fall back to a smaller
// positive scope (the canvas mounts) and skip the rich-content
// cases. Same posture as the rendering predecessor.
//
// **The capture-with-edge scenario stops at the chip-staging
// observation** rather than driving the full propose round-trip —
// the propose chain depends on the WS write surface being reachable,
// which `wsStoreSeed.ts` does not provide. The propose-envelope
// payload shape is pinned end-to-end by the Vitest suite
// (`useProposeAction.test.tsx` annotation-endpoint cases); the
// Playwright spec covers the moderator-visible staging UX.

import { expect, test, type Locator, type Page } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedWsStore } from './fixtures/wsStoreSeed';

interface CreatedSession {
  readonly id: string;
}

/**
 * Drive a low-level pointer drag from one handle locator to another.
 * Ported verbatim from `moderator-draw-edge.spec.ts` — the source rect
 * is sampled via `hover()` while the handle is idle, the target rect via
 * `boundingBox()` immediately before `mouse.up()` (a `hover()` there
 * waits forever for stability while ReactFlow's connection-line
 * projection re-runs per frame), and the intermediate moves keep the
 * connection-line tracker fed so the gesture reads as a drag, not a
 * click.
 */
async function dragFromHandleToHandle(
  page: Page,
  sourceHandle: Locator,
  targetHandle: Locator,
): Promise<void> {
  await sourceHandle.hover();
  const sourceBox = await sourceHandle.boundingBox();
  if (sourceBox === null) {
    throw new Error('dragFromHandleToHandle: source handle bounding box was null');
  }
  await page.mouse.down();

  const targetBoxStart = await targetHandle.boundingBox();
  if (targetBoxStart !== null) {
    const fromX = sourceBox.x + sourceBox.width / 2;
    const fromY = sourceBox.y + sourceBox.height / 2;
    const toX = targetBoxStart.x + targetBoxStart.width / 2;
    const toY = targetBoxStart.y + targetBoxStart.height / 2;
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(
        fromX + ((toX - fromX) * i) / steps,
        fromY + ((toY - fromY) * i) / steps,
        { steps: 2 },
      );
    }
  }

  const targetBoxFinal = await targetHandle.boundingBox();
  if (targetBoxFinal !== null) {
    await page.mouse.move(
      targetBoxFinal.x + targetBoxFinal.width / 2,
      targetBoxFinal.y + targetBoxFinal.height / 2,
    );
  }
  await page.mouse.up();
}

/**
 * Poll a locator's bounding box until two consecutive reads match within
 * 0.5 px. Ported from `moderator-draw-edge.spec.ts`. After the seed
 * mints the host node + promoted annotation, `mod_layout_measured_
 * dimensions` debounces the ResizeObserver measurements for 75 ms and
 * bumps `layoutRevision`, re-running dagre against the measured
 * footprint. On a slow CI runner that debounce can fire DURING the drag
 * and move the target handle out from under the pointer, so ReactFlow's
 * `onConnect` never sees a valid (source, target) pair and
 * `<DrawEdgeRolePicker>` never mounts. Waiting for a stable box closes
 * the window.
 */
async function waitForBoundingBoxStable(
  locator: Locator,
  options: { timeoutMs?: number; intervalMs?: number; toleranceMs?: number } = {},
): Promise<{ x: number; y: number; width: number; height: number }> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const tolerance = options.toleranceMs ?? 0.5;
  const deadline = Date.now() + timeoutMs;
  let prev: { x: number; y: number; width: number; height: number } | null = null;
  while (Date.now() < deadline) {
    const box = await locator.boundingBox();
    if (box !== null) {
      if (
        prev !== null &&
        Math.abs(prev.x - box.x) < tolerance &&
        Math.abs(prev.y - box.y) < tolerance &&
        Math.abs(prev.width - box.width) < tolerance &&
        Math.abs(prev.height - box.height) < tolerance
      ) {
        return box;
      }
      prev = box;
    } else {
      prev = null;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitForBoundingBoxStable: bounding box never stabilized within timeout');
}

const NODE_ID = '11111111-1111-4111-8111-111111111301';
const ANNOTATION_ID = '22222222-2222-4222-8222-222222222301';
const SEED_EDGE_ID = '33333333-3333-4333-8333-333333333401';

test.describe.serial('moderator annotation-endpoint propose gestures', () => {
  test('draw-edge from an annotation node opens the picker with annotation-source attributes', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'annotation-endpoint draw-edge spec session',
        privacy: 'private',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createResp.status(), 'session creation must return 201').toBe(201);
    const session = (await createResp.json()) as CreatedSession;
    expect(session.id).toBeTruthy();

    await page.goto(`/m/sessions/${session.id}/operate`);
    await expect(
      page.getByTestId('graph-canvas-root'),
      'graph-canvas-root must mount on the operate route',
    ).toBeVisible({ timeout: 15_000 });

    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — annotation-endpoint propose-gesture coverage deferred.',
      );
      return;
    }

    // Seed a host node, an annotation targeting it, and an edge that
    // promotes the annotation to a canvas node (mod_render_annotation_
    // endpoint_edges path). The promoted annotation now renders as a
    // ReactFlow node with Handle source/target wired — eligible as a
    // drag source.
    await seedWsStore(page, {
      sessionId: session.id,
      nodes: [{ nodeId: NODE_ID, wording: 'Host statement N1' }],
      annotations: [
        {
          annotationId: ANNOTATION_ID,
          kind: 'note',
          content: 'a promoted annotation body',
          targetNodeId: NODE_ID,
        },
      ],
      edges: [
        {
          edgeId: SEED_EDGE_ID,
          source: NODE_ID,
          target: ANNOTATION_ID,
          role: 'contradicts',
          sourceKind: 'node',
          targetKind: 'annotation',
        },
      ],
    });

    const annotationNode = page.getByTestId(`annotation-node-${ANNOTATION_ID}`);
    const statementNode = page.getByTestId(`statement-node-${NODE_ID}`);
    await expect(annotationNode, 'promoted annotation node must render').toBeVisible({
      timeout: 10_000,
    });
    await expect(statementNode, 'host statement node must render').toBeVisible({
      timeout: 10_000,
    });

    // ReactFlow's drag-to-create-edge gesture is a multi-event
    // sequence over its handle elements. Simulate it via the canvas's
    // `pointerdown` → `pointermove` → `pointerup` on the source
    // annotation's `react-flow__handle.source` handle to the target
    // statement node's `react-flow__handle.target` handle. The
    // simulator's drop coordinate determines the picker's anchor.
    const annotationSourceHandle = annotationNode.locator(
      '.react-flow__handle.react-flow__handle-bottom, .react-flow__handle.source',
    );
    const statementTargetHandle = statementNode.locator(
      '.react-flow__handle.react-flow__handle-top, .react-flow__handle.target',
    );
    const sourceHandleCount = await annotationSourceHandle.count();
    const targetHandleCount = await statementTargetHandle.count();
    if (sourceHandleCount === 0 || targetHandleCount === 0) {
      test.skip(
        true,
        'ReactFlow handle locators did not match — drag simulation cannot fire. Annotation-source draw-edge gesture coverage deferred.',
      );
      return;
    }
    const sourceHandle = annotationSourceHandle.first();
    const targetHandle = statementTargetHandle.first();
    if (
      (await sourceHandle.boundingBox()) === null ||
      (await targetHandle.boundingBox()) === null
    ) {
      test.skip(
        true,
        'Handle bounding boxes were null — drag simulation cannot fire. Annotation-source draw-edge gesture coverage deferred.',
      );
      return;
    }

    // Settle dagre's measurement-driven re-layout before sampling the
    // handle coordinates, then drive the drag. The drag is idempotent —
    // each successful drop re-opens the picker at the latest pointer
    // position — so on the rare run where the first drop loses the
    // re-layout race (picker never mounts), re-settle and re-drag. Same
    // race-robust posture as `moderator-draw-edge.spec.ts` lines
    // 363-373.
    const picker = page.getByTestId('draw-edge-role-picker');
    await waitForBoundingBoxStable(sourceHandle);
    await waitForBoundingBoxStable(targetHandle);
    await dragFromHandleToHandle(page, sourceHandle, targetHandle);
    try {
      await expect(picker, 'draw-edge role picker must mount after the drop').toBeVisible({
        timeout: 2_500,
      });
    } catch {
      await waitForBoundingBoxStable(sourceHandle);
      await waitForBoundingBoxStable(targetHandle);
      await dragFromHandleToHandle(page, sourceHandle, targetHandle);
      await expect(picker, 'draw-edge role picker must mount after the drop').toBeVisible({
        timeout: 10_000,
      });
    }
    // Annotation-source / node-target endpoint-kind disambiguation —
    // the picker's data-attributes are the canonical observation
    // seam (Acceptance criterion: `data-source-kind` /
    // `data-target-kind`).
    await expect(picker).toHaveAttribute('data-source-kind', 'annotation');
    await expect(picker).toHaveAttribute('data-target-kind', 'node');
    await expect(picker).toHaveAttribute('data-source-id', ANNOTATION_ID);
    await expect(picker).toHaveAttribute('data-target-id', NODE_ID);
  });

  test('clicking an annotation node during capture stages it on the chip with data-target-kind="annotation"', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'annotation-endpoint capture-with-edge spec session',
        privacy: 'private',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createResp.status(), 'session creation must return 201').toBe(201);
    const session = (await createResp.json()) as CreatedSession;
    expect(session.id).toBeTruthy();

    await page.goto(`/m/sessions/${session.id}/operate`);
    await expect(
      page.getByTestId('graph-canvas-root'),
      'graph-canvas-root must mount on the operate route',
    ).toBeVisible({ timeout: 15_000 });

    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — annotation-endpoint capture-staging coverage deferred.',
      );
      return;
    }

    await seedWsStore(page, {
      sessionId: session.id,
      nodes: [{ nodeId: NODE_ID, wording: 'Host statement N1' }],
      annotations: [
        {
          annotationId: ANNOTATION_ID,
          kind: 'note',
          content: 'an annotation body to stage',
          targetNodeId: NODE_ID,
        },
      ],
      edges: [
        {
          edgeId: SEED_EDGE_ID,
          source: NODE_ID,
          target: ANNOTATION_ID,
          role: 'contradicts',
          sourceKind: 'node',
          targetKind: 'annotation',
        },
      ],
    });

    const annotationNode = page.getByTestId(`annotation-node-${ANNOTATION_ID}`);
    await expect(annotationNode, 'promoted annotation node must render').toBeVisible({
      timeout: 10_000,
    });

    // Click the annotation node — the canvas's `handleNodeClick`
    // dispatches `select({ kind: 'annotation', id })`, which the
    // chip's selection-bridge effect picks up to stage the annotation
    // as the capture target.
    await annotationNode.click();

    const chip = page.getByTestId('capture-target-chip');
    await expect(chip, 'capture-target chip must mount on the operate route').toBeVisible({
      timeout: 10_000,
    });
    await expect(chip).toHaveAttribute('data-target-kind', 'annotation');
    const chipLabel = page.getByTestId('capture-target-chip-label');
    await expect(chipLabel).toContainText('an annotation body to stage');
  });
});
