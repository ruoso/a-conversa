// E2E spec for the moderator's dedicated annotation context menu.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this spec proves.**
//   1. Right-clicking a promoted annotation node opens a menu stamped
//      with `data-target-kind="annotation"` and shows both v1 items
//      (`graph-context-menu-item-annotate` and
//      `graph-context-menu-item-meta-disagree`).
//   2. Clicking the annotate item opens the `<AnnotateSubmenu>` with
//      `data-target-kind="annotation"` and the right `data-target-id`.
//   3. Clicking the meta-disagree item opens the submenu pre-biased
//      to the `stance` annotation kind (`data-selected="true"` on
//      `annotate-submenu-kind-stance`).
//
// **Setup pattern.** Mirrors `annotation-endpoint-gestures.spec.ts`:
// the moderator session is created via `POST /api/sessions`, the page
// is navigated to `/m/sessions/<id>/operate`, then events are seeded
// into the moderator's Zustand WS store via `wsStoreSeed.ts`. Reuses
// the same promoted-annotation seed (host node + annotation +
// promotion edge) the predecessor relied on.
//
// **WS-store seed fallback.** If `window.__aConversaWsStore` is
// unreachable from the page, both scenarios fall back to a smaller
// positive scope (the canvas mounts) and skip the rich-content
// assertions.
//
// **Stops at submenu-open observation** rather than driving the full
// propose round-trip — the propose chain depends on the WS write
// surface being reachable, which `wsStoreSeed.ts` does not provide.
// The end-to-end propose-envelope shape for annotation targets is
// pinned by Vitest (`useAnnotateAction.test.tsx` annotation-target
// case) and Cucumber (the propose-annotate-on-annotation scenarios).

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedWsStore } from './fixtures/wsStoreSeed';

interface CreatedSession {
  readonly id: string;
}

const NODE_ID = '11111111-1111-4111-8111-111111111501';
const ANNOTATION_ID = '22222222-2222-4222-8222-222222222501';
const SEED_EDGE_ID = '33333333-3333-4333-8333-333333333501';

async function seedHostNodePlusPromotedAnnotation(
  page: Parameters<typeof seedWsStore>[0],
  sessionId: string,
): Promise<void> {
  await seedWsStore(page, {
    sessionId,
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
}

test.describe.serial('moderator annotation context menu', () => {
  test('right-clicking an annotation node opens the dedicated annotation menu with both v1 items', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'annotation context-menu spec session',
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
        'window.__aConversaWsStore is not reachable — annotation context-menu coverage deferred.',
      );
      return;
    }

    await seedHostNodePlusPromotedAnnotation(page, session.id);

    const annotationNode = page.getByTestId(`annotation-node-${ANNOTATION_ID}`);
    await expect(annotationNode, 'promoted annotation node must render').toBeVisible({
      timeout: 10_000,
    });

    // Right-click the annotation node. The canvas's `handleNodeContextMenu`
    // discriminates on `endpointKindFromNodeType(node.type)` and routes
    // the open menu to `data-target-kind="annotation"`.
    await annotationNode.click({ button: 'right' });

    const menu = page.getByTestId('graph-context-menu');
    await expect(menu, 'context menu must mount on the annotation right-click').toBeVisible({
      timeout: 10_000,
    });
    await expect(menu).toHaveAttribute('data-target-kind', 'annotation');
    await expect(menu).toHaveAttribute('data-target-id', ANNOTATION_ID);

    // The two v1 annotation-scope items render.
    await expect(page.getByTestId('graph-context-menu-item-annotate')).toBeVisible();
    await expect(page.getByTestId('graph-context-menu-item-meta-disagree')).toBeVisible();
    // None of the node-scope items leak into the annotation menu.
    await expect(page.getByTestId('graph-context-menu-item-propose-vote')).toHaveCount(0);
    await expect(page.getByTestId('graph-context-menu-item-propose-decompose')).toHaveCount(0);
    await expect(page.getByTestId('graph-context-menu-item-axiom-mark')).toHaveCount(0);
  });

  test('picking "annotate" opens the AnnotateSubmenu against the annotation target', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'annotation context-menu annotate spec session',
        privacy: 'private',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createResp.status(), 'session creation must return 201').toBe(201);
    const session = (await createResp.json()) as CreatedSession;
    expect(session.id).toBeTruthy();

    await page.goto(`/m/sessions/${session.id}/operate`);
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible({ timeout: 15_000 });

    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — annotate-submenu coverage deferred.',
      );
      return;
    }

    await seedHostNodePlusPromotedAnnotation(page, session.id);

    const annotationNode = page.getByTestId(`annotation-node-${ANNOTATION_ID}`);
    await expect(annotationNode).toBeVisible({ timeout: 10_000 });

    await annotationNode.click({ button: 'right' });
    await expect(page.getByTestId('graph-context-menu')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('graph-context-menu-item-annotate').click();

    const submenu = page.getByTestId('annotate-submenu');
    await expect(submenu, 'annotate submenu must mount').toBeVisible({ timeout: 10_000 });
    await expect(submenu).toHaveAttribute('data-target-kind', 'annotation');
    await expect(submenu).toHaveAttribute('data-target-id', ANNOTATION_ID);
    // The plain annotate opener carries no initialAnnotationKind pre-bias
    // — the default 'note' kind is selected.
    await expect(page.getByTestId('annotate-submenu-kind-note')).toHaveAttribute(
      'data-selected',
      'true',
    );
  });

  test('picking "meta-disagree" opens the AnnotateSubmenu pre-biased to stance', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'annotation context-menu meta-disagree spec session',
        privacy: 'private',
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(createResp.status(), 'session creation must return 201').toBe(201);
    const session = (await createResp.json()) as CreatedSession;
    expect(session.id).toBeTruthy();

    await page.goto(`/m/sessions/${session.id}/operate`);
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible({ timeout: 15_000 });

    const seedAvailable = await isWsStoreReachable(page);
    if (!seedAvailable) {
      test.skip(
        true,
        'window.__aConversaWsStore is not reachable — meta-disagree submenu coverage deferred.',
      );
      return;
    }

    await seedHostNodePlusPromotedAnnotation(page, session.id);

    const annotationNode = page.getByTestId(`annotation-node-${ANNOTATION_ID}`);
    await expect(annotationNode).toBeVisible({ timeout: 10_000 });

    await annotationNode.click({ button: 'right' });
    await expect(page.getByTestId('graph-context-menu')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('graph-context-menu-item-meta-disagree').click();

    const submenu = page.getByTestId('annotate-submenu');
    await expect(submenu, 'annotate submenu must mount on meta-disagree').toBeVisible({
      timeout: 10_000,
    });
    await expect(submenu).toHaveAttribute('data-target-kind', 'annotation');
    await expect(submenu).toHaveAttribute('data-target-id', ANNOTATION_ID);
    // The disagree opener pre-biases the kind-radio to 'stance' — the
    // closest existing AnnotationKind to a moderator's disagreement
    // (`meta-disagreement` is a facet-state, not an annotation kind).
    await expect(page.getByTestId('annotate-submenu-kind-stance')).toHaveAttribute(
      'data-selected',
      'true',
    );
  });
});
