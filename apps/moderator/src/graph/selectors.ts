// Store-derived selectors that translate the WS event log into the
// ReactFlow node / edge / annotation shapes the canvas consumes.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_rendering.md
//
// This module's first inhabitant — `selectEdgesForSession` — walks the
// per-session event log in `useWsStore` and projects every
// `edge-created` event into a ReactFlow `Edge<{ role }>`. The selector is
// a pure function over `WsState`; it does not subscribe to the store
// itself (the consuming component decides how to subscribe). Pure means
// fully unit-testable without a React render.
//
// Sibling selectors (`selectNodesForSession`, `selectAnnotationsForSession`)
// land with `mod_node_rendering` / `mod_annotation_rendering`. Co-locating
// them in this file keeps the store-to-canvas projection in one place so
// downstream state-styling tasks have a single seam to extend.

import type { Edge } from 'reactflow';
import type { EdgeRole } from '@a-conversa/shared-types';

import type { WsState } from '../ws/wsStore.js';

/** Payload carried on each rendered edge — the role drives the label and (later) the per-state styling. */
export interface StatementEdgeData {
  role: EdgeRole;
}

/**
 * Project the per-session WS event log into the ReactFlow edge list.
 *
 * Walks `state.sessionState[sessionId]?.events` once, picks every
 * `edge-created` envelope, and maps each to a ReactFlow `Edge` with
 * `type: 'statement'` (the single entry in `edgeTypes`) and the role
 * stashed on `data` so `<StatementEdge>` can render the localized label
 * and so downstream state-styling tasks have a stable discriminator.
 *
 * Empty for an unknown `sessionId` or an empty event log — the consuming
 * component renders no edges in that case, which is the expected idle
 * state before the WS catch-up replay lands the first events.
 */
export function selectEdgesForSession(
  state: WsState,
  sessionId: string,
): Edge<StatementEdgeData>[] {
  const session = state.sessionState[sessionId];
  if (!session) return [];
  const out: Edge<StatementEdgeData>[] = [];
  for (const event of session.events) {
    if (event.kind !== 'edge-created') continue;
    out.push({
      id: event.payload.edge_id,
      source: event.payload.source_node_id,
      target: event.payload.target_node_id,
      type: 'statement',
      data: { role: event.payload.role },
    });
  }
  return out;
}
