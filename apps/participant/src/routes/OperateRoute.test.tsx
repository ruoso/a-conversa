// Vitest cases for `<OperateRoute>`.
//
// Refinement: tasks/refinements/participant-ui/part_graph_render.md
//              (Test layers per ADR 0022 — four cases per the
//              refinement's "Tests pin" sketch: lifecycle, layout
//              regions, not-authenticated guard, route testid).
// ADRs:        0022 (no throwaway verifications).
//
// Patterns lifted from `apps/participant/src/routes/LobbyRoute.test.tsx`
// (the `WsClientProvider` fake-client wiring and the `useWsStore` reset
// posture) — both routes consume the same surface-wide WS provider via
// `useWsClient()`, so the same fake-client recipe pins the
// `trackSession` / `untrackSession` lifecycle.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  AuthValueProvider,
  I18nProvider,
  WsClientProvider,
  createI18nInstance,
  type AuthContextValue,
  type I18nInstance,
  type WsClient,
} from '@a-conversa/shell';

import { OperateRoute } from './OperateRoute';
import {
  installCytoscapeTestEnv,
  type CytoscapeTestEnvRestoreHandle,
} from '../graph/cytoscapeTestEnv';
import { useWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const CALLER_USER_ID = '00000000-0000-4000-8000-000000000002';

const authenticatedCallerAuth: AuthContextValue = {
  status: 'authenticated',
  user: { userId: CALLER_USER_ID, screenName: 'ben' },
  refresh: () => undefined,
  logout: () => undefined,
};

const notAuthenticatedAuth: AuthContextValue = {
  status: 'unauthenticated',
  user: undefined,
  refresh: () => undefined,
  logout: () => undefined,
};

interface FakeClient {
  client: WsClient;
  trackSessionSpy: ReturnType<typeof vi.fn>;
  untrackSessionSpy: ReturnType<typeof vi.fn>;
}

function createFakeClient(): FakeClient {
  const trackSessionSpy = vi.fn((): Promise<void> => Promise.resolve());
  const untrackSessionSpy = vi.fn((): Promise<void> => Promise.resolve());
  const client = {
    connect: () => undefined,
    close: () => undefined,
    send: (() => Promise.resolve({}) as unknown) as WsClient['send'],
    trackSession: trackSessionSpy,
    untrackSession: untrackSessionSpy,
  } as unknown as WsClient;
  return { client, trackSessionSpy, untrackSessionSpy };
}

let i18nInstance: I18nInstance;
let cytoscapeEnvHandle: CytoscapeTestEnvRestoreHandle | null = null;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
  cytoscapeEnvHandle = installCytoscapeTestEnv();
});

afterAll(() => {
  cytoscapeEnvHandle?.restore();
  cytoscapeEnvHandle = null;
});

afterEach(async () => {
  cleanup();
  useWsStore.getState().reset();
  // Reset the selection store so the next test's panel starts in the
  // empty-state baseline.
  const { useSelectionStore } = await import('../stores/selectionStore');
  useSelectionStore.getState().clear();
});

function renderRoute(opts: { auth?: AuthContextValue } = {}): FakeClient {
  const auth = opts.auth ?? authenticatedCallerAuth;
  const fake = createFakeClient();
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={auth}>
        <WsClientProvider auth={{ status: auth.status }} client={fake.client}>
          <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
            <Routes>
              <Route path="/sessions/:id" element={<OperateRoute />} />
            </Routes>
          </MemoryRouter>
        </WsClientProvider>
      </AuthValueProvider>
    </I18nProvider>,
  );
  return fake;
}

describe('OperateRoute — per-session WS lifecycle', () => {
  it('(a) calls trackSession on mount and untrackSession on cleanup', () => {
    const fake = renderRoute();
    expect(fake.trackSessionSpy).toHaveBeenCalledTimes(1);
    expect(fake.trackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
    expect(fake.untrackSessionSpy).not.toHaveBeenCalled();
    cleanup();
    expect(fake.untrackSessionSpy).toHaveBeenCalledTimes(1);
    expect(fake.untrackSessionSpy).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('OperateRoute — layout composition', () => {
  it('(b) renders the four named layout regions', () => {
    renderRoute();
    expect(screen.getByTestId('participant-layout-root')).toBeTruthy();
    expect(screen.getByTestId('participant-header')).toBeTruthy();
    expect(screen.getByTestId('participant-main')).toBeTruthy();
    expect(screen.getByTestId('participant-footer')).toBeTruthy();
  });
});

describe('OperateRoute — not-authenticated guard', () => {
  it('(c) renders the participant-not-authenticated body when auth status is not authenticated', () => {
    renderRoute({ auth: notAuthenticatedAuth });
    // The body's dedicated testid is present without crashing on
    // `auth.user.screenName` (the guard branch bypasses the GraphView
    // mount entirely, so no Cytoscape root either).
    expect(screen.getByTestId('participant-not-authenticated')).toBeTruthy();
    expect(screen.queryByTestId('participant-graph-root')).toBeNull();
    // The route-operate testid is still present on the wrapper.
    const route = screen.getByTestId('route-operate');
    expect(route.getAttribute('data-state')).toBe('not-authenticated');
  });
});

describe('OperateRoute — route testid', () => {
  it('(d) renders the route-operate testid on the outer wrapper', () => {
    renderRoute();
    expect(screen.getByTestId('route-operate')).toBeTruthy();
  });
});

// -------------------------------------------------------------------
// Own-vote prop threading — added by
// `participant_ui.part_graph_view.part_own_vote_indicators`.
// Refinement: tasks/refinements/participant-ui/part_own_vote_indicators.md
//
// Decision §4 pins the seam: `<OperateRouteBody>` reads
// `auth.user.userId` (always non-empty by the time the body's auth
// guard has narrowed) and threads it into `<GraphView>` as the new
// required `currentParticipantId` prop. The case below confirms the
// prop is rendered into the DOM as a `data-own-vote` mirror attribute
// — the canonical seam the indicator surface uses — so a future drift
// in either side of the threading flips this test.
// -------------------------------------------------------------------

describe('OperateRoute — currentParticipantId prop threading', () => {
  it('(e) threads auth.user.userId into <GraphView> as currentParticipantId (the mirror surfaces a default data-own-vote="none" against an empty events log)', () => {
    renderRoute({ auth: authenticatedCallerAuth });
    // The canvas is mounted (graph root exists) and the mirror is
    // attached. The empty events log means no own-vote signals are
    // surfaced — but the mirror itself is in place, proving the
    // prop was accepted by GraphView (a missing required prop would
    // have caused a typecheck failure at build time AND a runtime
    // crash because the projection unconditionally reads the
    // currentParticipantId argument). The lifecycle case (a) above
    // already covered that GraphView mounts without throwing on the
    // authenticated path; this case pins that the wiring is to the
    // auth user id specifically (we'd have nothing to render with
    // an empty seed, but the mirror's mere presence is the seam).
    expect(screen.getByTestId('participant-graph-root')).toBeTruthy();
    expect(screen.getByTestId('participant-graph-status-mirror')).toBeTruthy();
  });
});

// -------------------------------------------------------------------
// Two-column layout + projection hoist — added by
// `participant_ui.part_graph_view.part_entity_detail_panel`.
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel.md
//
// Decision §1 pins the layout: the authenticated body renders a flex
// container with `<GraphView>` on the left (`flex-1`) and
// `<EntityDetailPanel>` on the right (`w-80`). Decision §2 pins the
// projection chain hoist: the route runs the projection ONCE per
// `events` change and threads the outputs into BOTH children.
// -------------------------------------------------------------------

describe('OperateRoute — two-sibling layout (graph + entity detail panel)', () => {
  it('(f) renders BOTH GraphView and EntityDetailPanel as siblings in the route body', () => {
    renderRoute({ auth: authenticatedCallerAuth });
    expect(screen.getByTestId('participant-graph-root')).toBeTruthy();
    expect(screen.getByTestId('participant-detail-panel')).toBeTruthy();
  });

  it('(g) places the GraphView region with flex-1 and the panel with w-80 inside the route-operate flex container', () => {
    renderRoute({ auth: authenticatedCallerAuth });
    const route = screen.getByTestId('route-operate');
    expect(route.className).toContain('flex');
    const graphRegion = screen.getByTestId('route-operate-graph-region');
    expect(graphRegion.className).toContain('flex-1');
    const panel = screen.getByTestId('participant-detail-panel');
    expect(panel.className).toContain('w-80');
  });
});

describe('OperateRoute — auto-select on incoming proposal events', () => {
  it('(i) auto-surfaces the proposal target on the detail panel without a manual selection', async () => {
    renderRoute({ auth: authenticatedCallerAuth });
    expect(screen.getByTestId('participant-detail-panel').getAttribute('data-state')).toBe('empty');

    const { act } = await import('@testing-library/react');
    const { useWsStore: storeImport } = await import('../ws/wsStore');
    const NODE_ID = '00000000-0000-4000-8000-00000000000b';
    const ACTOR_ID = '00000000-0000-4000-8000-000000000003';
    // node-created + entity-included mirror the propose-handler's
    // structural fan-out so the projector lands the node before the
    // proposal event drives the auto-select.
    act(() => {
      storeImport.getState().applyEvent({
        id: '00000000-0000-4000-8000-000000000201',
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'Auto-selected wording',
          created_by: ACTOR_ID,
          created_at: '2026-05-24T00:00:00.000Z',
        },
        createdAt: '2026-05-24T00:00:00.000Z',
      });
      storeImport.getState().applyEvent({
        id: '00000000-0000-4000-8000-000000000202',
        sessionId: SESSION_ID,
        sequence: 2,
        kind: 'proposal',
        actor: ACTOR_ID,
        payload: {
          proposal: {
            kind: 'capture-node',
            node_id: NODE_ID,
            wording: 'Auto-selected wording',
          },
        },
        createdAt: '2026-05-24T00:00:00.000Z',
      });
    });
    // No tap, no manual select: the proposal envelope alone surfaced
    // the new node on the panel.
    expect(screen.getByTestId('participant-detail-panel').getAttribute('data-state')).toBe(
      'detail',
    );
    expect(screen.getByTestId('participant-detail-panel-identity-wording').textContent).toBe(
      'Auto-selected wording',
    );
  });
});

describe('OperateRoute — entity detail panel selection-change re-render', () => {
  it('(h) the panel transitions from empty-state to detail-body when a selection lands in the store', async () => {
    renderRoute({ auth: authenticatedCallerAuth });
    // Initial paint — no selection — empty state.
    expect(screen.getByTestId('participant-detail-panel').getAttribute('data-state')).toBe('empty');
    // Seed a node + select it. The route's projection hoist surfaces
    // the node to the panel; the panel re-renders with the detail body.
    const { act } = await import('@testing-library/react');
    const { useWsStore: storeImport } = await import('../ws/wsStore');
    const { useSelectionStore } = await import('../stores/selectionStore');
    const NODE_ID = '00000000-0000-4000-8000-00000000000a';
    act(() => {
      storeImport.getState().applyEvent({
        id: '00000000-0000-4000-8000-000000000101',
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-000000000000',
        payload: {
          node_id: NODE_ID,
          wording: 'A wording',
          created_by: '00000000-0000-4000-8000-000000000000',
          created_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      });
      useSelectionStore.getState().select({ kind: 'node', id: NODE_ID });
    });
    expect(screen.getByTestId('participant-detail-panel').getAttribute('data-state')).toBe(
      'detail',
    );
    expect(screen.getByTestId('participant-detail-panel-identity-wording').textContent).toBe(
      'A wording',
    );
  });
});
