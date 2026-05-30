// Playwright helper for seeding synthetic events into the moderator's
// Zustand WS store directly from a page evaluation, bypassing the
// server.
//
// Refinement: tasks/refinements/moderator-ui/mod_hover_details.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// **Why this helper exists.** The hover-popover spec needs the canvas
// to render at least one node and one edge so we can hover them. The
// canonical path (POST /api/sessions, drive the WS protocol's capture
// flow, wait for the server to echo back events) is correct but
// significantly slower and more coupled to the server contract than
// what the hover-popover test needs to pin. The hover behavior is a
// pure canvas-rendering concern: given a node / edge in the projection,
// the popover surfaces on hover. So we seed the projection directly.
//
// **How it works.** `apps/moderator/src/main.tsx` exposes
// `useWsStore` on `window.__aConversaWsStore` when
// `import.meta.env.DEV` is true (the dev compose bring-up uses the
// dev Vite build by default — see commit `6aa9ea3`). The helper
// invokes `page.evaluate(...)` to call `store.applyEvent(event)` for
// each synthetic event, producing the same `events` array shape the
// real WS client would populate. The canvas's `useMemo`-gated
// projection sees the new events on the next render tick and emits
// the node / edge for the popover to attach to.
//
// **Why the helper exists in a separate file.** Reuse: future graph-
// rendering e2e specs (pan/zoom, layout, capture flow) will want the
// same seed primitive. Keeping it in `fixtures/` mirrors the
// established pattern from `auth.ts` / `locales.ts`.
//
// **Fallback path.** If the WS-store seed approach is blocked at
// implementation time (e.g. the store isn't on `window` because a
// bundler / scope mismatch prevents the dev-only assignment), the
// hover-popover spec falls back to a smaller positive scope: assert
// the canvas reaches `/sessions/:id/operate` and renders the empty
// `graph-canvas-root` without the popover surfacing. The reduced
// coverage is annotated in the spec with `test.skip` referencing a
// future `playwright_session_seed_helper` task to inherit the
// deferred coverage.

import type { Page } from '@playwright/test';

/**
 * One synthetic `node-created` event the seeder injects into the
 * moderator's per-session events array. Shape mirrors the wire payload
 * the server emits on a real `propose-node` + commit pair, narrowed to
 * the fields the canvas projection consumes.
 */
export interface SeedNode {
  readonly nodeId: string;
  readonly wording: string;
}

/**
 * One synthetic `edge-created` event the seeder injects. Shape mirrors
 * the wire payload narrowed to the fields the projection consumes; the
 * `role` defaults to `'supports'` (the most-used methodology role) when
 * unspecified.
 *
 * Per `edge_target_annotation_schema_extension`, each endpoint may
 * target either a node id OR an annotation id (XOR enforced on the
 * wire). `sourceKind` / `targetKind` opt the endpoint into the
 * annotation slot; the default is `'node'` for backward compatibility
 * with the pre-widening seeds.
 */
export interface SeedEdge {
  readonly edgeId: string;
  readonly source: string;
  readonly target: string;
  readonly role?:
    | 'supports'
    | 'rebuts'
    | 'qualifies'
    | 'bridges-from'
    | 'bridges-to'
    | 'defines'
    | 'contradicts';
  readonly sourceKind?: 'node' | 'annotation';
  readonly targetKind?: 'node' | 'annotation';
}

/**
 * One synthetic `annotation-created` event the seeder injects. Per
 * `mod_render_annotation_endpoint_edges`, annotations referenced by
 * annotation-endpoint edges promote to standalone `<AnnotationNode>`s
 * on the moderator canvas.
 */
export interface SeedAnnotation {
  readonly annotationId: string;
  readonly kind: 'note' | 'reframe' | 'scope-change' | 'stance';
  readonly content: string;
  readonly targetNodeId?: string | null;
  readonly targetEdgeId?: string | null;
}

export interface SeedSessionOptions {
  readonly sessionId: string;
  readonly nodes?: readonly SeedNode[];
  readonly edges?: readonly SeedEdge[];
  readonly annotations?: readonly SeedAnnotation[];
}

/**
 * Seed synthetic `node-created` / `edge-created` events into the
 * moderator's Zustand WS store for the given `sessionId`. The helper
 * MUST be invoked AFTER the moderator SPA has mounted (i.e. after
 * `page.goto('/sessions/.../operate')` settles) — the dev-only window
 * attachment happens during the React bootstrap.
 *
 * Returns the `__aConversaWsStore.getState()` snapshot after the
 * seeding, so callers can sanity-check the events array length.
 *
 * Throws when the window-attached store is unreachable; that's the
 * signal the dev-only `window.__aConversaWsStore` assignment didn't
 * fire (production build / bundler scope mismatch) and callers should
 * branch to the fallback path.
 */
export async function seedWsStore(
  page: Page,
  options: SeedSessionOptions,
): Promise<{ eventCount: number }> {
  const { sessionId, nodes = [], edges = [], annotations = [] } = options;
  return page.evaluate(
    ({ sessionId, nodes, edges, annotations }) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState(): {
              applyEvent(event: unknown): boolean;
              sessionState: Record<string, { events: unknown[]; lastAppliedSequence: number }>;
            };
          };
        }
      ).__aConversaWsStore;
      if (store === undefined) {
        throw new Error(
          'seedWsStore: window.__aConversaWsStore is undefined — the dev-only assignment did not run. Ensure the SPA is running in dev mode (Vite import.meta.env.DEV === true).',
        );
      }
      const actor = '00000000-0000-4000-8000-0000000000aa';
      const createdAt = '2026-05-11T00:00:00.000Z';
      // Continue the sequence from the store's current high-water mark
      // so consecutive `seedWsStore` calls on the same session don't
      // collide with `lastAppliedSequence` — the store rejects events
      // whose `sequence <= lastAppliedSequence`. Fresh sessions start
      // at 0, so the first seeded event lands at sequence 1.
      const existing = store.getState().sessionState[sessionId];
      let sequence = (existing?.lastAppliedSequence ?? 0) + 1;
      for (const node of nodes) {
        store.getState().applyEvent({
          id: `00000000-0000-4000-8000-${(0x1000 + sequence).toString(16).padStart(12, '0')}`,
          sessionId,
          sequence,
          kind: 'node-created',
          actor,
          payload: {
            node_id: node.nodeId,
            wording: node.wording,
            created_by: actor,
            created_at: createdAt,
          },
          createdAt,
        });
        sequence += 1;
      }
      for (const annotation of annotations) {
        store.getState().applyEvent({
          id: `00000000-0000-4000-8000-${(0x5000 + sequence).toString(16).padStart(12, '0')}`,
          sessionId,
          sequence,
          kind: 'annotation-created',
          actor,
          payload: {
            annotation_id: annotation.annotationId,
            kind: annotation.kind,
            content: annotation.content,
            target_node_id: annotation.targetNodeId ?? null,
            target_edge_id: annotation.targetEdgeId ?? null,
            created_by: actor,
            created_at: createdAt,
          },
          createdAt,
        });
        sequence += 1;
      }
      for (const edge of edges) {
        const sourceKind = edge.sourceKind ?? 'node';
        const targetKind = edge.targetKind ?? 'node';
        const payload: Record<string, unknown> = {
          edge_id: edge.edgeId,
          role: edge.role ?? 'supports',
          created_by: actor,
          created_at: createdAt,
        };
        if (sourceKind === 'annotation') {
          payload.source_annotation_id = edge.source;
        } else {
          payload.source_node_id = edge.source;
        }
        if (targetKind === 'annotation') {
          payload.target_annotation_id = edge.target;
        } else {
          payload.target_node_id = edge.target;
        }
        store.getState().applyEvent({
          id: `00000000-0000-4000-8000-${(0x2000 + sequence).toString(16).padStart(12, '0')}`,
          sessionId,
          sequence,
          kind: 'edge-created',
          actor,
          payload,
          createdAt,
        });
        sequence += 1;
      }
      const after = store.getState().sessionState[sessionId];
      return { eventCount: after?.events.length ?? 0 };
    },
    { sessionId, nodes, edges, annotations },
  );
}

/**
 * Probe whether the moderator SPA exposes `window.__aConversaWsStore`.
 * Used by the spec's setup phase to decide whether to drive the full-
 * content path or the empty-canvas fallback.
 */
export async function isWsStoreReachable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return (
      typeof (window as unknown as { __aConversaWsStore?: unknown }).__aConversaWsStore !==
      'undefined'
    );
  });
}

/**
 * One synthetic participant the seeder injects via a
 * `participant-joined` event. Shape mirrors the wire payload narrowed
 * to the fields the invite view's slot reducer consumes (per
 * `apps/moderator/src/routes/InviteParticipants.tsx:97-126`).
 */
export interface SeedParticipant {
  readonly userId: string;
  readonly role: 'moderator' | 'debater-A' | 'debater-B';
  readonly screenName: string;
}

export interface SeedParticipantsOptions {
  readonly sessionId: string;
  readonly participants?: readonly SeedParticipant[];
  readonly left?: readonly string[];
}

/**
 * Seed synthetic `participant-joined` / `participant-left` events into
 * the moderator's Zustand WS store for the given `sessionId`. The
 * helper MUST be invoked AFTER the moderator SPA has mounted — the
 * dev-only window attachment happens during the React bootstrap (see
 * `apps/moderator/src/main.tsx`).
 *
 * Mirrors `seedWsStore` in shape but stays narrow to participant
 * lifecycle events (per `mod_session_lobby` Decision §5: sibling helper
 * keeps each function's scope tight rather than turning `seedWsStore`
 * into a swiss-army-knife). Reuses the same `window.__aConversaWsStore`
 * lookup and the same `applyEvent` seam.
 *
 * The helper continues the sequence from the store's current high-water
 * mark so consecutive seed calls on the same session don't collide
 * with `lastAppliedSequence` (the store rejects events whose
 * `sequence <= lastAppliedSequence`).
 *
 * Throws when the window-attached store is unreachable; that's the
 * signal the dev-only `window.__aConversaWsStore` assignment didn't
 * fire (production build / bundler scope mismatch) and callers should
 * branch to a fallback path.
 */
export async function seedParticipants(
  page: Page,
  options: SeedParticipantsOptions,
): Promise<{ eventCount: number }> {
  const { sessionId, participants = [], left = [] } = options;
  return page.evaluate(
    ({ sessionId, participants, left }) => {
      const store = (
        window as unknown as {
          __aConversaWsStore?: {
            getState(): {
              applyEvent(event: unknown): boolean;
              sessionState: Record<string, { events: unknown[]; lastAppliedSequence: number }>;
            };
          };
        }
      ).__aConversaWsStore;
      if (store === undefined) {
        throw new Error(
          'seedParticipants: window.__aConversaWsStore is undefined — the dev-only assignment did not run. Ensure the SPA is running in dev mode (Vite import.meta.env.DEV === true).',
        );
      }
      const createdAt = '2026-05-16T00:00:00.000Z';
      const existing = store.getState().sessionState[sessionId];
      let sequence = (existing?.lastAppliedSequence ?? 0) + 1;
      for (const participant of participants) {
        store.getState().applyEvent({
          id: `00000000-0000-4000-8000-${(0x3000 + sequence).toString(16).padStart(12, '0')}`,
          sessionId,
          sequence,
          kind: 'participant-joined',
          actor: participant.userId,
          payload: {
            user_id: participant.userId,
            role: participant.role,
            screen_name: participant.screenName,
            joined_at: createdAt,
          },
          createdAt,
        });
        sequence += 1;
      }
      for (const userId of left) {
        store.getState().applyEvent({
          id: `00000000-0000-4000-8000-${(0x4000 + sequence).toString(16).padStart(12, '0')}`,
          sessionId,
          sequence,
          kind: 'participant-left',
          actor: userId,
          payload: {
            user_id: userId,
            left_at: createdAt,
          },
          createdAt,
        });
        sequence += 1;
      }
      const after = store.getState().sessionState[sessionId];
      return { eventCount: after?.events.length ?? 0 };
    },
    { sessionId, participants, left },
  );
}
