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
const NODE_ID_2 = '11111111-1111-4111-8111-111111111202';
const ANNOTATION_ID = '22222222-2222-4222-8222-222222222201';
const EDGE_HOSTED_ANNOTATION_ID = '22222222-2222-4222-8222-222222222202';
const EDGE_ID = '33333333-3333-4333-8333-333333333301';
const HOST_EDGE_ID = '33333333-3333-4333-8333-333333333302';
const ENDPOINT_EDGE_TO_EDGE_HOSTED_ID = '33333333-3333-4333-8333-333333333303';

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

    // -- Endpoint-kind disambiguation in the edge-hover popover ------
    //
    // Refinement: `mod_hover_popover_endpoint_kind_disambiguation`.
    // The edge-hover popover's endpoint-references row now surfaces a
    // localized parenthesized kind label (`(node)` / `(annotation)`)
    // after each id, plus matching `data-hover-popover-source-kind` /
    // `data-hover-popover-target-kind` attributes for stable test
    // observation. The canonical surface for the assertion is the
    // annotation-endpoint edge already on the canvas — hovering the
    // edge label opens the popover; the seeded `N1 -[contradicts]-> A1`
    // shape pins `source-kind=node` + `target-kind=annotation`.
    //
    // Pattern mirrors `tests/e2e/moderator-hover-details.spec.ts`
    // (the canonical edge-popover spec for node→node edges) — same
    // hover seam + same `data-hover-target-kind="edge"` + same
    // endpoints-row selector vocabulary.
    const edgeLabel = page.getByTestId(`graph-edge-label-${EDGE_ID}`);
    await expect(edgeLabel, 'annotation-endpoint edge label must render').toBeVisible({
      timeout: 10_000,
    });
    await edgeLabel.hover();
    const edgePopover = page.getByTestId(`hover-popover-${EDGE_ID}`);
    await expect(
      edgePopover,
      'hover popover must appear when the annotation-endpoint edge is hovered',
    ).toBeVisible();
    await expect(edgePopover).toHaveAttribute('data-hover-target-kind', 'edge');
    const endpointsRow = edgePopover.locator('[data-hover-popover-section="endpoints"]');
    // Stable data-attribute seams — locale-independent.
    await expect(endpointsRow).toHaveAttribute('data-hover-popover-source-kind', 'node');
    await expect(endpointsRow).toHaveAttribute('data-hover-popover-target-kind', 'annotation');
    // Rendered text under the en-US default locale — pins the catalog
    // + selector + renderer chain end-to-end. Per Decision §3, the
    // kind labels live inline in the existing ICU template; a catalog
    // miss surfaces here as the `(?)` fallback, not as a thrown error.
    await expect(endpointsRow).toContainText('(node)');
    await expect(endpointsRow).toContainText('(annotation)');

    // -- Edge-hosted annotation midpoint rendering --------------------
    //
    // Refinement: `mod_annotation_node_edge_host_midpoint`. Seed a
    // second node N2, a host node→node edge E (N1→N2), an annotation
    // A2 whose `target_edge_id` references E, and an annotation-
    // endpoint edge promoting A2. The canvas must render:
    //   1. A 0×0 `<AnnotationHostMidpointNode>` keyed on E's id
    //      (`annotation-host-midpoint-<edge-id>`).
    //   2. A host pseudo-edge for A2 tethering the midpoint to A2.
    // The midpoint is invisible (0×0), so the locator pins to
    // `toBeAttached` rather than `toBeVisible`.
    await seedWsStore(page, {
      sessionId: session.id,
      nodes: [{ nodeId: NODE_ID_2, wording: 'Second host statement N2' }],
      edges: [
        {
          edgeId: HOST_EDGE_ID,
          source: NODE_ID,
          target: NODE_ID_2,
          role: 'supports',
          sourceKind: 'node',
          targetKind: 'node',
        },
      ],
      annotations: [
        {
          annotationId: EDGE_HOSTED_ANNOTATION_ID,
          kind: 'note',
          content: 'an annotation about the N1 → N2 edge',
          targetEdgeId: HOST_EDGE_ID,
        },
      ],
    });
    await seedWsStore(page, {
      sessionId: session.id,
      edges: [
        {
          edgeId: ENDPOINT_EDGE_TO_EDGE_HOSTED_ID,
          source: NODE_ID,
          target: EDGE_HOSTED_ANNOTATION_ID,
          role: 'contradicts',
          sourceKind: 'node',
          targetKind: 'annotation',
        },
      ],
    });
    // Midpoint node renders, keyed on host edge id (invisible: assert
    // attachment, not visibility).
    await expect(
      page.locator(`[data-testid="annotation-host-midpoint-${HOST_EDGE_ID}"]`),
      'midpoint node must render for an edge-hosted promoted annotation',
    ).toBeAttached({ timeout: 10_000 });
    // Promoted annotation node for the edge-hosted annotation renders.
    await expect(
      page.getByTestId(`annotation-node-${EDGE_HOSTED_ANNOTATION_ID}`),
      'edge-hosted promoted annotation node must render',
    ).toBeVisible({ timeout: 10_000 });
    // Host pseudo-edge for the edge-hosted annotation renders.
    await expect(
      page.locator(`[data-testid="annotation-host-edge-${EDGE_HOSTED_ANNOTATION_ID}"]`),
      'host pseudo-edge for the edge-hosted annotation must render alongside its midpoint',
    ).toBeAttached({ timeout: 10_000 });
  });
});
