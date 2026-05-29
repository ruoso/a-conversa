// Tests for `<OperateRoute>` — the `/sessions/:id/operate` install
// site for the `window.__testHooks.killWebSocket` Playwright test seam.
//
// Refinement: tasks/refinements/moderator-ui/mod_pw_reconnect_seed_visible_styling.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_graph_rendering.mod_pw_reconnect_seed_visible_styling
//
// **Scope.** This file pins exactly the install / unmount lifecycle the
// refinement's Decision §D3 nails to `OperateRouteInner` — the
// `useEffect(() => { window.__testHooks.killWebSocket = … }, [client])`
// that exposes the shell's `client.killWebSocket()` method to
// `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts`'s
// Scenario 3 reconnect sub-step. The route's other concerns (graph
// canvas, capture pane, propose flow) are tested by their own files.
//
// **Heavy children stubbed.** The route's real children
// (`<GraphCanvasPane>`, `<BottomStripCapture>`, `<RightSidebar>` and
// friends) pull ReactFlow, the capture store, and a dozen other
// layout components into scope. They're stubbed with `vi.mock` to
// placeholder `<div>`s so the test stays fast and isolated to the
// install effect's contract; the production wiring is exercised by
// the Playwright e2e suite end-to-end.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, createI18nInstance } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';

// ────────────────────────────────────────────────────────────────────────
// Stub the heavy children so the test renders the install effect
// without ReactFlow / capture-store wiring. The stubs preserve the
// minimal data-testid contract `<OperateRoute>` itself asserts
// (`route-operate`, `session-id`); everything below the strip / canvas
// / sidebar slots is opaque.
// ────────────────────────────────────────────────────────────────────────
vi.mock('../graph/GraphCanvasPane', () => ({
  GraphCanvasPane: () => <div data-testid="graph-canvas-pane-stub" />,
}));
vi.mock('../layout/BottomStripCapture', () => ({
  BottomStripCapture: () => <div data-testid="bottom-strip-stub" />,
}));
vi.mock('../layout/RightSidebar', () => ({
  RightSidebar: () => <div data-testid="right-sidebar-stub" />,
}));
vi.mock('../layout/OperateLayout', () => ({
  OperateLayout: (props: {
    graphPane: React.ReactNode;
    bottomStrip: React.ReactNode;
    rightSidebar: React.ReactNode;
  }) => (
    <div data-testid="operate-layout-stub">
      {props.graphPane}
      {props.bottomStrip}
      {props.rightSidebar}
    </div>
  ),
}));

// `useProposeAction` and the per-capture-mode layout components are
// only referenced from within the BottomStripCapture / propose-action
// slots; with the strip stubbed they're unreachable but the imports at
// the top of `Operate.tsx` still resolve them, so we leave them alone.

import { OperateRoute } from './Operate';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

// ────────────────────────────────────────────────────────────────────────
// `WebSocket` polyfill — happy-dom does NOT expose `WebSocket` as a
// constructor. The route mounts its own `<WsClientProvider>` which
// constructs a real `WsClient`; under `auth.status === 'loading'` (the
// default `AuthProvider` start state, with the `/api/auth/me` fetch
// in-flight) the provider's connect-effect short-circuits, but the
// client is still created and threaded through `useWsClient()`. We
// supply a fake constructor so the create path is safe even if the
// effect later fires.
// ────────────────────────────────────────────────────────────────────────
class FakeWebSocketCtor {
  readyState = 0;
  constructor(_url: string) {
    /* no-op */
  }
  close(): void {
    /* no-op */
  }
  send(): void {
    /* no-op */
  }
  addEventListener(): void {
    /* no-op */
  }
  removeEventListener(): void {
    /* no-op */
  }
}
const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocketCtor;
});
afterAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
});

const originalFetch = global.fetch;
afterAll(() => {
  global.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  // Belt-and-suspenders: scrub the window namespace in case a test
  // left a leak behind (e.g., a test that failed before unmount ran).
  const w = window as unknown as { __testHooks?: Record<string, unknown> };
  if (w.__testHooks !== undefined) {
    delete w.__testHooks.killWebSocket;
  }
});

const SESSION_ID = '00000000-0000-4000-8000-0000000000ab';

function stubAuthMeFetch(): ReturnType<typeof vi.fn> {
  // `<AuthProvider>` fires `/api/auth/me` on mount. Resolve it to an
  // authenticated payload so the inner `<WsClientProvider>`'s
  // connect-effect can fire (even though the WS factory is the
  // no-op polyfill above, the effect's call paths still run).
  return vi.fn((input: URL | RequestInfo) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/auth/me') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: '00000000-0000-4000-8000-000000000001',
            screenName: 'alice',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(new Response('not stubbed', { status: 404 }));
  });
}

function renderRoute(): { unmount: () => void } {
  const { unmount } = render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
        <Routes>
          <Route path="/sessions/:id/operate" element={<OperateRoute />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  return { unmount };
}

describe('Operate route — window.__testHooks.killWebSocket install (mod_pw_reconnect_seed_visible_styling)', () => {
  it('mount installs window.__testHooks.killWebSocket as a function reference', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      const hooks = (window as unknown as { __testHooks?: { killWebSocket?: unknown } })
        .__testHooks;
      expect(hooks).toBeDefined();
      expect(typeof hooks?.killWebSocket).toBe('function');
    });
    // Let the AuthProvider's `/api/auth/me` resolution flush so
    // post-render state updates don't bleed into the next test as
    // unwrapped `act()` warnings (vitest.setup.ts treats those as
    // hard failures).
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('unmount removes window.__testHooks.killWebSocket; a re-mount re-installs it', async () => {
    global.fetch = stubAuthMeFetch();
    const { unmount } = renderRoute();
    const w = window as unknown as { __testHooks?: { killWebSocket?: unknown } };
    await waitFor(() => {
      expect(typeof w.__testHooks?.killWebSocket).toBe('function');
    });
    unmount();
    // The namespace object may survive (we only own `killWebSocket`),
    // but the property itself must be gone.
    expect(w.__testHooks?.killWebSocket).toBeUndefined();
    // Re-mount fresh — the property comes back, pointing at the new
    // client instance.
    renderRoute();
    await waitFor(() => {
      expect(typeof w.__testHooks?.killWebSocket).toBe('function');
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
});
