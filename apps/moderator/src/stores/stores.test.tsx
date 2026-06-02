// Smoke tests for the moderator's local-state Zustand stores.
//
// Refinement: tasks/refinements/moderator-ui/mod_state_management.md
//
// Covers the acceptance criteria the refinement spells out:
//   1. Each of the three store slices (`useCaptureStore`,
//      `useSelectionStore`, `useUiStore`) can be read and mutated via
//      its setters.
//   2. A trivial React component subscribed to each store re-renders
//      on an update (the headline AC).
//   3. The UI store clamps zoom to the documented bounds.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { useCaptureStore, useSelectionStore, useUiStore, MAX_ZOOM, MIN_ZOOM } from './index.js';

// Helper: capture the pristine snapshot of each store's state at module
// load time, so individual tests can reset between cases without each
// having to spell out every default. Zustand stores hold their state
// outside React, so leaking state across tests would silently couple
// them.
const captureInitial = useCaptureStore.getState();
const selectionInitial = useSelectionStore.getState();
const uiInitial = useUiStore.getState();

beforeEach(() => {
  useCaptureStore.setState(captureInitial, true);
  useSelectionStore.setState(selectionInitial, true);
  useUiStore.setState(uiInitial, true);
});

afterEach(() => {
  cleanup();
});

describe('useCaptureStore', () => {
  it('starts with empty text, no classification, no target, no edge role, idle mode, not proposing', () => {
    const state = useCaptureStore.getState();
    expect(state.text).toBe('');
    expect(state.classification).toBeNull();
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
    expect(state.mode).toBe('idle');
    expect(state.proposing).toBe(false);
  });

  it('setters mutate the corresponding slice', () => {
    useCaptureStore.getState().setText('the sky is blue');
    useCaptureStore.getState().setClassification('fact');
    useCaptureStore.getState().setTargetEntityId('node-1');
    useCaptureStore.getState().setEdgeRole('supports');
    useCaptureStore.getState().setMode('capture-statement');

    const state = useCaptureStore.getState();
    expect(state.text).toBe('the sky is blue');
    expect(state.classification).toBe('fact');
    expect(state.targetEntityId).toBe('node-1');
    expect(state.edgeRole).toBe('supports');
    expect(state.mode).toBe('capture-statement');
  });

  // Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
  it('setProposing toggles the proposing slice', () => {
    expect(useCaptureStore.getState().proposing).toBe(false);
    useCaptureStore.getState().setProposing(true);
    expect(useCaptureStore.getState().proposing).toBe(true);
    useCaptureStore.getState().setProposing(false);
    expect(useCaptureStore.getState().proposing).toBe(false);
  });

  it('reset() returns proposing to false even if it was true', () => {
    useCaptureStore.getState().setProposing(true);
    useCaptureStore.getState().reset();
    expect(useCaptureStore.getState().proposing).toBe(false);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
  it('setEdgeRole accepts null (toggle-off path)', () => {
    useCaptureStore.getState().setEdgeRole('rebuts');
    expect(useCaptureStore.getState().edgeRole).toBe('rebuts');
    useCaptureStore.getState().setEdgeRole(null);
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('reset() returns the store to its initial state (including edgeRole)', () => {
    useCaptureStore.getState().setText('something');
    useCaptureStore.getState().setEdgeRole('qualifies');
    useCaptureStore.getState().setMode('decompose');
    useCaptureStore.getState().reset();
    const state = useCaptureStore.getState();
    expect(state.text).toBe('');
    expect(state.edgeRole).toBeNull();
    expect(state.mode).toBe('idle');
  });
});

describe('useSelectionStore', () => {
  it('starts with nothing selected', () => {
    expect(useSelectionStore.getState().selected).toBeNull();
  });

  it('select() stores the selection and clear() resets it', () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'node-42' });
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'node', id: 'node-42' });
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().selected).toBeNull();
  });
});

describe('useUiStore', () => {
  it('starts with pending-proposals foregrounded and zoom 1', () => {
    const state = useUiStore.getState();
    expect(state.activeSidebarPane).toBe('pending-proposals');
    expect(state.zoom).toBe(1);
  });

  it('setActiveSidebarPane() switches the visible pane', () => {
    useUiStore.getState().setActiveSidebarPane('change-history');
    expect(useUiStore.getState().activeSidebarPane).toBe('change-history');
  });

  it('setZoom() clamps to the documented bounds', () => {
    useUiStore.getState().setZoom(MAX_ZOOM + 10);
    expect(useUiStore.getState().zoom).toBe(MAX_ZOOM);
    useUiStore.getState().setZoom(MIN_ZOOM - 0.5);
    expect(useUiStore.getState().zoom).toBe(MIN_ZOOM);
    useUiStore.getState().setZoom(Number.NaN);
    expect(useUiStore.getState().zoom).toBe(1);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_diagnostic_focus_action.md
  //             (Acceptance §1)
  describe('requestCanvasFocus (canvas-focus command)', () => {
    it('starts with no focus request', () => {
      expect(useUiStore.getState().focusRequest).toBeNull();
    });

    it('sets focusRequest with the given ids and nonce 1 from the initial null', () => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1', 'n2'], edgeIds: ['e1'] });
      const request = useUiStore.getState().focusRequest;
      expect(request).toEqual({ nodeIds: ['n1', 'n2'], edgeIds: ['e1'], nonce: 1 });
    });

    it('advances the nonce and replaces the ids on a second call', () => {
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n1'], edgeIds: [] });
      const first = useUiStore.getState().focusRequest;
      useUiStore.getState().requestCanvasFocus({ nodeIds: ['n9'], edgeIds: ['e9'] });
      const second = useUiStore.getState().focusRequest;

      expect(first?.nonce).toBe(1);
      expect(second).toEqual({ nodeIds: ['n9'], edgeIds: ['e9'], nonce: 2 });
      // Fresh object reference each call — the ref-guard consumer keys off
      // identity-via-nonce, never a mutated-in-place object.
      expect(second).not.toBe(first);
    });
  });
});

describe('React components re-render on store updates', () => {
  function CaptureProbe(): ReactElement {
    const mode = useCaptureStore((state) => state.mode);
    return <span data-testid="probe-capture">{mode}</span>;
  }

  function SelectionProbe(): ReactElement {
    const selected = useSelectionStore((state) => state.selected);
    return (
      <span data-testid="probe-selection">
        {selected ? `${selected.kind}:${selected.id}` : 'none'}
      </span>
    );
  }

  function UiProbe(): ReactElement {
    const pane = useUiStore((state) => state.activeSidebarPane);
    return <span data-testid="probe-ui">{pane}</span>;
  }

  it('a component subscribed to useCaptureStore re-renders when mode changes', () => {
    render(<CaptureProbe />);
    expect(screen.getByTestId('probe-capture').textContent).toBe('idle');
    act(() => {
      useCaptureStore.getState().setMode('decompose');
    });
    expect(screen.getByTestId('probe-capture').textContent).toBe('decompose');
  });

  it('a component subscribed to useSelectionStore re-renders when selection changes', () => {
    render(<SelectionProbe />);
    expect(screen.getByTestId('probe-selection').textContent).toBe('none');
    act(() => {
      useSelectionStore.getState().select({ kind: 'edge', id: 'edge-7' });
    });
    expect(screen.getByTestId('probe-selection').textContent).toBe('edge:edge-7');
  });

  it('a component subscribed to useUiStore re-renders when the active pane changes', () => {
    render(<UiProbe />);
    expect(screen.getByTestId('probe-ui').textContent).toBe('pending-proposals');
    act(() => {
      useUiStore.getState().setActiveSidebarPane('diagnostic-flags');
    });
    expect(screen.getByTestId('probe-ui').textContent).toBe('diagnostic-flags');
  });
});
