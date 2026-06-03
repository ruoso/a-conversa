// `<AudienceGraphView>` — the audience-side adapter over the shared
// `@a-conversa/graph-view` renderer.
//
// Per ADR 0039 the read-only Cytoscape renderer, its projector, layout,
// stylesheet, overlay hooks, and the eight DOM overlays now live in the
// `@a-conversa/graph-view` package, consumed by both this surface and
// the landing walkthrough. The single audience-specific coupling — the
// WS/session data source — stays here: this thin adapter calls
// `useAudienceSession()` for the event log + session id and
// `useAudienceActiveDiagnostics()` for the live diagnostic map, then
// passes them into the package component as plain props. The public
// `AudienceGraphView` API (the `cyRef` observability seam) and the
// rendered output are unchanged, so the audience surface and its test
// suite see no behavior change.
//
// Refinement: tasks/refinements/landing_page/extract_readonly_graph_package.md
//   (Decision §1 — props-in inversion: the renderer moves to the
//   package; the audience keeps this adapter as the store seam.)
//
// ADRs: 0039 (shared read-only graph-view package — the boundary this
//             adapter sits on); 0026 (micro-frontend root app — the
//             surface owns its mounted region and reads the WS event log
//             from the audience workspace's read-only state barrel);
//             0024 (react-i18next — localization stays inside the
//             package renderer, the host registers the methodology keys).

import { type ReactElement } from 'react';
import type { Core } from 'cytoscape';

import { GraphView } from '@a-conversa/graph-view';

import { useAudienceSession } from '../state/index.js';
import { useAudienceActiveDiagnostics } from '../ws/useAudienceActiveDiagnostics.js';

export interface AudienceGraphViewProps {
  /**
   * Optional callback fired with the Cytoscape `Core` instance on
   * mount and `null` on unmount. The Vitest layer consumes this seam
   * to capture the instance for `cy.elements()` assertions; the
   * audience does NOT expose a `window.__aConversaAudienceCyInstance`
   * test seam (Decision §8).
   */
  readonly cyRef?: (cy: Core | null) => void;
}

export function AudienceGraphView({ cyRef }: AudienceGraphViewProps): ReactElement {
  const { events, sessionId } = useAudienceSession();
  const activeDiagnostics = useAudienceActiveDiagnostics(sessionId);
  return (
    <GraphView
      events={events}
      instanceKey={sessionId ?? ''}
      activeDiagnostics={activeDiagnostics}
      {...(cyRef !== undefined ? { cyRef } : {})}
    />
  );
}

export default AudienceGraphView;
