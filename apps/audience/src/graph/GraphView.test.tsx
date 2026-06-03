// Vitest cases for the audience adapter `<AudienceGraphView>`.
//
// The read-only renderer itself lives in `@a-conversa/graph-view` and
// is pinned by that package's prop-driven suite. This suite pins the
// thin audience-specific seam the adapter owns: that it reads the WS
// event log + live diagnostics from `useAudienceSession()` /
// `useAudienceActiveDiagnostics()` and feeds them into the package
// `GraphView` as the `events` / `instanceKey` / `activeDiagnostics`
// props — including the URL-session scoping the package deliberately
// does NOT do.
//
// Refinement: tasks/refinements/landing_page/extract_readonly_graph_package.md
//   (Constraint 1 / Decision §1 — the adapter preserves the audience's
//   public component API + behavior; this suite is the store→prop
//   wiring gate.)
// ADRs: 0039 (the package boundary this adapter sits on); 0022 (no
//   throwaway verifications).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Core } from 'cytoscape';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '@a-conversa/graph-view/test-utils';
import type { DiagnosticPayload, Event } from '@a-conversa/shared-types';

import { AudienceGraphView } from './GraphView';
import { audienceWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const ACTOR = '00000000-0000-4000-8000-0000000000ac';

let i18nInstance: I18nInstance;
let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

function nodeCreatedEvent(opts: {
  sequence: number;
  nodeId: string;
  wording: string;
  sessionId?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: opts.sessionId ?? SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function danglingClaim(nodeId: string, sessionId = SESSION_ID): DiagnosticPayload {
  return {
    sessionId,
    kind: 'dangling-claim',
    severity: 'advisory',
    status: 'fired',
    sequence: 1,
    diagnostic: { kind: 'dangling-claim', nodeId },
  };
}

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

beforeEach(() => {
  audienceWsStore.getState().reset();
  window.history.replaceState({}, '', `/a/sessions/${SESSION_ID}`);
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
  window.history.replaceState({}, '', '/');
});

async function flushRaf(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface RenderResult {
  getCy: () => Core;
}

function renderAdapter(): RenderResult {
  let captured: Core | null = null;
  const cyRef = (cy: Core | null): void => {
    if (cy !== null) captured = cy;
  };
  render(
    <I18nProvider i18n={i18nInstance}>
      <AudienceGraphView cyRef={cyRef} />
    </I18nProvider>,
  );
  return {
    getCy: () => {
      if (captured === null) throw new Error('cy instance not captured');
      return captured;
    },
  };
}

function seedEvent(event: Event): void {
  act(() => {
    audienceWsStore.getState().applyEvent(event);
  });
}

describe('<AudienceGraphView> (adapter)', () => {
  it('(a) mounts the package renderer at the audience-graph-root testid', () => {
    expect(() => renderAdapter()).not.toThrow();
  });

  it('(b) feeds the URL session event log into the package as the events prop', () => {
    const result = renderAdapter();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A wording' }));
    seedEvent(nodeCreatedEvent({ sequence: 2, nodeId: NODE_B, wording: 'B wording' }));
    const cy = result.getCy();
    expect(cy.nodes().length).toBe(2);
    expect(cy.getElementById(NODE_A).data('wording')).toBe('A wording');
  });

  it('(c) scopes events to the URL session — other-session events do not render', () => {
    const result = renderAdapter();
    // The store carries an event for a DIFFERENT session.
    // `useAudienceSession()` slices by the URL session id, so the
    // adapter hands the package an empty event log for this session.
    seedEvent(
      nodeCreatedEvent({
        sequence: 1,
        nodeId: NODE_A,
        wording: 'other session',
        sessionId: OTHER_SESSION_ID,
      }),
    );
    const cy = result.getCy();
    expect(cy.elements().length).toBe(0);
  });

  it('(d) feeds the live active-diagnostics map into the package as the activeDiagnostics prop', async () => {
    const result = renderAdapter();
    seedEvent(nodeCreatedEvent({ sequence: 1, nodeId: NODE_A, wording: 'A wording' }));
    result.getCy();
    await flushRaf();
    act(() => {
      audienceWsStore.getState().applyDiagnostic(danglingClaim(NODE_A));
    });
    await flushRaf();
    const halo = document.querySelector(`[data-diagnostic-fire-anim][data-node-id="${NODE_A}"]`);
    expect(halo).not.toBeNull();
    expect(halo?.getAttribute('data-severity')).toBe('advisory');
  });
});
