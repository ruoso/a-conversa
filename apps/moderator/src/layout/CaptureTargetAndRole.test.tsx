// Tests for `<CaptureTargetAndRole>` — the two-surface composer that
// fills the `bottom-strip-edge-role` sub-slot of `<BottomStripCapture>`.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
//
// Per ADR 0022 these are committed Vitest smoke cases. They lock the
// wrapper's composition contract:
//   1. Both children (`<CaptureTargetChip>` and `<EdgeRoleSelector>`)
//      mount inside the wrapper's stable testid.
//   2. The selector half collapses to null DOM when no target is
//      staged; the chip half remains mounted in its empty state.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';

import { CaptureTargetAndRole } from './CaptureTargetAndRole';
import { useCaptureStore } from '../stores/captureStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = 'test-session';

function renderWrapper(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <Routes>
        <Route path="/sessions/:id/operate" element={<CaptureTargetAndRole />} />
      </Routes>
    </MemoryRouter>,
  );
}

const captureInitial = useCaptureStore.getState();
const selectionInitial = useSelectionStore.getState();
const wsInitial = useWsStore.getState();

beforeEach(async () => {
  useCaptureStore.setState(captureInitial, true);
  useSelectionStore.setState(selectionInitial, true);
  useWsStore.setState(wsInitial, true);
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('CaptureTargetAndRole — composition', () => {
  it('mounts the wrapper testid', () => {
    renderWrapper();
    expect(screen.getByTestId('capture-target-and-role')).toBeTruthy();
  });

  it('mounts the chip; selector is absent in the no-target state', () => {
    renderWrapper();
    expect(screen.getByTestId('capture-target-chip')).toBeTruthy();
    expect(screen.queryByTestId('edge-role-selector')).toBeNull();
  });

  it('mounts both children inside the wrapper when a target is staged', () => {
    renderWrapper();
    act(() => {
      useCaptureStore.getState().setTargetEntityId('n-1');
    });
    const wrapper = screen.getByTestId('capture-target-and-role');
    const chip = screen.getByTestId('capture-target-chip');
    const selector = screen.getByTestId('edge-role-selector');
    expect(wrapper.contains(chip)).toBe(true);
    expect(wrapper.contains(selector)).toBe(true);
  });
});
