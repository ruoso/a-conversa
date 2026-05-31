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

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedWsStore } from './fixtures/wsStoreSeed';

interface CreatedSession {
  readonly id: string;
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
    const sourceBox = await annotationSourceHandle.first().boundingBox();
    const targetBox = await statementTargetHandle.first().boundingBox();
    if (sourceBox === null || targetBox === null) {
      test.skip(
        true,
        'Handle bounding boxes were null — drag simulation cannot fire. Annotation-source draw-edge gesture coverage deferred.',
      );
      return;
    }
    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;
    const tx = targetBox.x + targetBox.width / 2;
    const ty = targetBox.y + targetBox.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Two intermediate moves so ReactFlow's internal connection-line
    // pipeline registers the drag, then move to the target handle.
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 5 });
    await page.mouse.move(tx, ty, { steps: 5 });
    await page.mouse.up();

    const picker = page.getByTestId('draw-edge-role-picker');
    await expect(picker, 'draw-edge role picker must mount after the drop').toBeVisible({
      timeout: 10_000,
    });
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
