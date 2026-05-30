// E2E spec for the moderator's annotation-endpoint canvas rendering.
//
// Refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this spec proves.**
//   1. A test-seeded event log carrying an annotation-endpoint edge
//      surfaces both the host statement node AND the promoted
//      annotation node on the moderator canvas.
//   2. The host pseudo-edge (`AnnotationHostEdge`) renders alongside
//      the methodology edge so dagre can place the annotation node
//      near its host (Decision §4).
//   3. The annotation is rendered as a node, NOT as a badge — the
//      mutual-exclusion contract (Decision §1 + §3) holds end-to-end.
//
// **Setup pattern.** Mirrors `moderator-hover-details.spec.ts`:
// `loginAs(...)` drives the OIDC handshake; a fresh session is
// created via `POST /api/sessions`; then the spec seeds a synthetic
// node + annotation + annotation-endpoint edge into the moderator's
// Zustand WS store via the `wsStoreSeed.ts` helper. The
// `wsStoreSeed` helper supports the polymorphic-endpoint payload
// shape per `edge_target_annotation_schema_extension`.
//
// **WS-store seed fallback.** If `window.__aConversaWsStore` is
// unreachable from the page, the spec falls back to a smaller
// positive scope (the canvas mounts, no popover surfaces) and skips
// the rich-content cases — same posture as the hover-details spec.

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';
import { isWsStoreReachable, seedWsStore } from './fixtures/wsStoreSeed';

interface CreatedSession {
  readonly id: string;
}

const NODE_ID = '11111111-1111-4111-8111-111111111201';
const ANNOTATION_ID = '22222222-2222-4222-8222-222222222201';
const EDGE_ID = '33333333-3333-4333-8333-333333333301';

test.describe.serial('moderator annotation-endpoint canvas rendering', () => {
  test('an annotation-endpoint edge surfaces a promoted AnnotationNode + host pseudo-edge on the canvas', async ({
    page,
  }) => {
    await loginAs(page, { username: 'alice' });

    const createResp = await page.request.post('/api/sessions', {
      data: {
        topic: 'annotation-endpoint rendering spec session',
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
        'window.__aConversaWsStore is not reachable — dev-only assignment did not fire. Annotation-endpoint rendering coverage deferred.',
      );
      return;
    }

    // Seed: one node, one annotation targeting that node, one edge
    // whose target is the annotation (annotation-endpoint).
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
          edgeId: EDGE_ID,
          source: NODE_ID,
          target: ANNOTATION_ID,
          role: 'contradicts',
          sourceKind: 'node',
          targetKind: 'annotation',
        },
      ],
    });

    // Host statement node renders.
    await expect(
      page.getByTestId(`statement-node-${NODE_ID}`),
      'host statement node must be visible after seed',
    ).toBeVisible({ timeout: 10_000 });

    // Promoted annotation node renders.
    await expect(
      page.getByTestId(`annotation-node-${ANNOTATION_ID}`),
      'promoted annotation node must be visible after seed',
    ).toBeVisible({ timeout: 10_000 });

    // Host pseudo-edge renders.
    await expect(
      page.locator(`[data-testid="annotation-host-edge-${ANNOTATION_ID}"]`),
      'annotation host pseudo-edge must render alongside the promoted annotation node',
    ).toBeAttached({ timeout: 10_000 });

    // Mutual exclusion: the badge surface for the promoted annotation
    // must NOT appear (the annotation is a node now, not a badge).
    await expect(
      page.locator(`[data-testid="annotation-badge-${ANNOTATION_ID}"]`),
      'annotation badge must NOT render for a promoted annotation (mutual exclusion)',
    ).toHaveCount(0);
  });
});
