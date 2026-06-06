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
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AuthProvider, createI18nInstance } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { useCaptureStore } from '../stores/captureStore';
import { resetSnapshotFlowStore, useSnapshotFlowStore } from '../layout/useSnapshotFlowStore';
import { resetKeymapHelpStore, useKeymapHelpStore } from '../layout/useKeymapHelpStore';

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
  BottomStripCapture: (props: {
    modeBanner?: React.ReactNode;
    textInput?: React.ReactNode;
    classificationPalette?: React.ReactNode;
    edgeRoleSelector?: React.ReactNode;
    proposeAction?: React.ReactNode;
  }) => (
    <div data-testid="bottom-strip-stub">
      <div data-testid="slot-mode-banner">{props.modeBanner}</div>
      <div data-testid="slot-text-input">{props.textInput}</div>
      <div data-testid="slot-classification-palette">{props.classificationPalette}</div>
      <div data-testid="slot-edge-role-selector">{props.edgeRoleSelector}</div>
      <div data-testid="slot-propose-action">{props.proposeAction}</div>
    </div>
  ),
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
  useCaptureStore.getState().reset();
  resetSnapshotFlowStore();
  resetKeymapHelpStore();
  // Belt-and-suspenders: scrub the window namespace in case a test
  // left a leak behind (e.g., a test that failed before unmount ran).
  const w = window as unknown as { __testHooks?: Record<string, unknown> };
  if (w.__testHooks !== undefined) {
    delete w.__testHooks.killWebSocket;
  }
});

const SESSION_ID = '00000000-0000-4000-8000-0000000000ab';

function stubAuthMeFetch() {
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

describe('Operate route — bottom-strip slot swap for meta-move mode (mod_meta_move_action)', () => {
  it('mounts <MetaMoveCapturePanel> in textInput slot, null in edgeRoleSelector, and <MetaMoveProposeAction> in proposeAction slot when mode is meta-move', async () => {
    global.fetch = stubAuthMeFetch();
    // Pre-stage the meta-move mode before the route mounts so the first
    // render observes the F8 mode. The store is shared; the afterEach()
    // reset keeps tests isolated.
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
    });
    renderRoute();
    await waitFor(() => {
      const stripStub = document.querySelector('[data-testid="bottom-strip-stub"]');
      expect(stripStub).not.toBeNull();
    });
    // textInput → meta-move panel
    const textInputSlot = document.querySelector('[data-testid="slot-text-input"]');
    expect(textInputSlot?.querySelector('[data-testid="meta-move-capture-pane"]')).not.toBeNull();
    // edgeRoleSelector → null (no CaptureTargetAndRole inside the slot)
    const edgeRoleSlot = document.querySelector('[data-testid="slot-edge-role-selector"]');
    expect(edgeRoleSlot?.querySelector('[data-testid="capture-target-and-role"]')).toBeNull();
    expect(edgeRoleSlot?.children.length ?? 0).toBe(0);
    // proposeAction → meta-move propose button
    const proposeSlot = document.querySelector('[data-testid="slot-propose-action"]');
    expect(proposeSlot?.querySelector('[data-testid="meta-move-propose-button"]')).not.toBeNull();
    // modeBanner → meta-move exit button
    const modeBannerSlot = document.querySelector('[data-testid="slot-mode-banner"]');
    expect(modeBannerSlot?.querySelector('[data-testid="meta-move-mode-exit"]')).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe('Operate route — bottom-strip slot swap for capture-defeater mode (mod_defeater_node_creation)', () => {
  it('mounts <CaptureDefeaterCapturePanel> in textInput slot, null in edgeRoleSelector, and <ProposeCaptureDefeaterAction> in proposeAction slot when mode is capture-defeater', async () => {
    global.fetch = stubAuthMeFetch();
    // Pre-stage the mode + target before the route mounts so the
    // first render observes capture-defeater. The store is shared;
    // the afterEach() reset keeps tests isolated.
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode('11111111-1111-4111-8111-111111111111');
    });
    renderRoute();
    await waitFor(() => {
      const stripStub = document.querySelector('[data-testid="bottom-strip-stub"]');
      expect(stripStub).not.toBeNull();
    });
    // textInput → capture-defeater panel
    const textInputSlot = document.querySelector('[data-testid="slot-text-input"]');
    expect(
      textInputSlot?.querySelector('[data-testid="capture-defeater-capture-pane"]'),
    ).not.toBeNull();
    // edgeRoleSelector → null (no CaptureTargetAndRole inside the slot)
    const edgeRoleSlot = document.querySelector('[data-testid="slot-edge-role-selector"]');
    expect(edgeRoleSlot?.querySelector('[data-testid="capture-target-and-role"]')).toBeNull();
    expect(edgeRoleSlot?.children.length ?? 0).toBe(0);
    // proposeAction → capture-defeater propose button
    const proposeSlot = document.querySelector('[data-testid="slot-propose-action"]');
    expect(
      proposeSlot?.querySelector('[data-testid="capture-defeater-propose-button"]'),
    ).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe('Operate route — F10 snapshot trigger wiring (mod_snapshot_action)', () => {
  it('mounts <SnapshotActionButton> inside the rightSidebar slot, ABOVE the <RightSidebar /> stub', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="snapshot-action-button"]')).not.toBeNull();
    });
    const button = document.querySelector('[data-testid="snapshot-action-button"]');
    const sidebarStub = document.querySelector('[data-testid="right-sidebar-stub"]');
    expect(button).not.toBeNull();
    expect(sidebarStub).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (bit 0x04) means `sidebarStub` comes
    // AFTER `button` — i.e., the button is positioned above the pane
    // stack in the right-sidebar slot, matching Decision §2.b.
    expect(button!.compareDocumentPosition(sidebarStub!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('clicking the snapshot button flips useSnapshotFlowStore.isLabelInputOpen to true', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="snapshot-action-button"]')).not.toBeNull();
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="snapshot-action-button"]')!);
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('Cmd/Ctrl+S dispatched at the document level flips useSnapshotFlowStore.isLabelInputOpen', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="snapshot-action-button"]')).not.toBeNull();
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    // happy-dom's default navigator.platform is empty — the dispatcher
    // (useGlobalKeymap, which mod_global_keymap consolidated the
    // Cmd/Ctrl+S binding into) resolves isMacPlatform() to false, so it
    // watches for Ctrl+S.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe('Operate route — F10 snapshot-label modal mount wiring (mod_snapshot_label_input)', () => {
  it('mounts <SnapshotLabelInputMount /> as a sibling of <OperateLayout> inside <main data-testid="route-operate">', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="route-operate"]')).not.toBeNull();
    });
    // When the flag is false, the mount renders null — flip it on and
    // observe the modal appear as a direct child of <main>.
    expect(document.querySelector('[data-testid="snapshot-label-input-modal"]')).toBeNull();
    act(() => {
      useSnapshotFlowStore.getState().open();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="snapshot-label-input-modal"]')).not.toBeNull();
    });
    // The modal is a sibling of the OperateLayout stub, not a child.
    const main = document.querySelector('[data-testid="route-operate"]');
    const modal = document.querySelector('[data-testid="snapshot-label-input-modal"]');
    expect(main?.contains(modal)).toBe(true);
    const layoutStub = document.querySelector('[data-testid="operate-layout-stub"]');
    expect(layoutStub?.contains(modal)).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('flipping isLabelInputOpen back to false unmounts the modal', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="route-operate"]')).not.toBeNull();
    });
    act(() => {
      useSnapshotFlowStore.getState().open();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="snapshot-label-input-modal"]')).not.toBeNull();
    });
    act(() => {
      useSnapshotFlowStore.getState().close();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="snapshot-label-input-modal"]')).toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe('Operate route — `?` keymap-help overlay wiring (mod_keymap_help_overlay)', () => {
  it('mounts <KeymapHelpButton /> in the rightSidebar slot', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="keymap-help-button"]')).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('pressing `?` at the document level flips the overlay open; Escape closes it', async () => {
    global.fetch = stubAuthMeFetch();
    renderRoute();
    await waitFor(() => {
      expect(document.querySelector('[data-testid="route-operate"]')).not.toBeNull();
    });
    // Overlay starts closed → KeymapHelpMount renders null.
    expect(document.querySelector('[data-testid="keymap-help-overlay"]')).toBeNull();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);

    // Bare `?` toggles the overlay open (no editable target focused).
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="keymap-help-overlay"]')).not.toBeNull();
    });

    // Escape closes it (the overlay's local window-level listener).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="keymap-help-overlay"]')).toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
  });
});

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
