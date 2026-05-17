// Tests for `<CaptureTargetChip>` — the staged edge-target chip for
// the bottom-strip capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   - The chip's three render states (empty / auto-suggested /
//     overridden) and their stable testids.
//   - The auto-stage no-stomp ref contract — a moderator override
//     survives subsequent selection changes.
//   - The wording-truncation display rule and the raw-id fallback when
//     no `node-created` event is present.
//   - Per-locale parity round-trip for the four new catalog keys.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { act, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';
import type { Event } from '@a-conversa/shared-types';

import { CaptureTargetChip } from './CaptureTargetChip';
import { useCaptureStore } from '../stores/captureStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = 'test-session';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const SHORT_WORDING = 'Short wording.';
const LONG_WORDING = 'The proposed minimum wage would raise prices for everyone, allegedly.';
const LONG_WORDING_TRUNCATED = `${LONG_WORDING.slice(0, 32)}…`;

function makeNodeCreated(sequence: number, nodeId: string, wording: string): Event {
  return {
    id: `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: nodeId,
      wording,
      created_by: ACTOR,
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

/**
 * Seed `useWsStore.sessionState[SESSION_ID].events` with the given list.
 * The chip's render-side wording lookup reads from this slice; tests
 * inject events directly without dispatching through `applyEvent` so
 * the seeding stays deterministic and ordering-stable.
 */
function seedEvents(events: Event[]): void {
  useWsStore.setState((prev) => ({
    ...prev,
    sessionState: {
      ...prev.sessionState,
      [SESSION_ID]: {
        lastAppliedSequence: events.length,
        events,
        pendingProposals: {},
        activeDiagnostics: new Map(),
      },
    },
  }));
}

// Async render shadow — `useTranslation()` schedules a microtask-deferred
// setState when its internal i18next subscription registers on mount.
// The deferred update fires AFTER a synchronous render's act() wrapper
// closes, so React emits "An update to <Component> was not wrapped in
// act(...)". `await act(async () => { ... })` flushes pending microtasks
// before the act block resolves, absorbing the deferred update.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  // `act` takes the async (microtask-flushing) path when the callback
  // returns a thenable — `return Promise.resolve()` is enough; no
  // `async` keyword (which would trip `require-await` since the body
  // does not await anything).
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

async function renderChip(): Promise<RenderResult> {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <Routes>
        <Route path="/sessions/:id/operate" element={<CaptureTargetChip />} />
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

describe('CaptureTargetChip — render structure', () => {
  it('renders the wrapper testid', async () => {
    await renderChip();
    expect(screen.getByTestId('capture-target-chip')).toBeTruthy();
  });

  it('exposes the localized aria-label on the wrapper', async () => {
    await renderChip();
    expect(screen.getByTestId('capture-target-chip').getAttribute('aria-label')).toBe(
      'Edge target — auto-suggested from the most recently selected node',
    );
  });
});

describe('CaptureTargetChip — empty state', () => {
  it('renders the localized empty-state label when both stores are empty', async () => {
    await renderChip();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });

  it('carries the dimmed text-slate-400 class in the empty state', async () => {
    await renderChip();
    const chip = screen.getByTestId('capture-target-chip');
    expect(chip.className).toContain('text-slate-400');
  });

  it('does NOT render the override marker in the empty state', async () => {
    await renderChip();
    expect(screen.queryByTestId('capture-target-chip-override-marker')).toBeNull();
  });
});

describe('CaptureTargetChip — auto-stage from node selection', () => {
  it('auto-stages the selected node id onto useCaptureStore.targetEntityId', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      `Target: ${SHORT_WORDING}`,
    );
    expect(screen.queryByTestId('capture-target-chip-override-marker')).toBeNull();
  });

  it('updates the slice when the selection moves to a different node', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', 'first node'), makeNodeCreated(2, 'n-2', 'second node')]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('Target: first node');

    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-2' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-2');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('Target: second node');
  });
});

describe('CaptureTargetChip — non-node selections do not auto-stage', () => {
  it('edge selection does NOT write to the target slice', async () => {
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'edge', id: 'e-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });

  it('annotation selection does NOT write to the target slice', async () => {
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'annotation', id: 'a-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });

  it('preserves an existing auto-suggested id when an edge is selected afterwards', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'edge', id: 'e-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      `Target: ${SHORT_WORDING}`,
    );
  });
});

describe('CaptureTargetChip — pane-click does not clear the chip', () => {
  it('clearing the selection store does NOT clear the staged target', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    act(() => {
      useSelectionStore.getState().clear();
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      `Target: ${SHORT_WORDING}`,
    );
  });
});

describe('CaptureTargetChip — override no-stomp contract', () => {
  it('an override survives subsequent node selections (Decision §5)', async () => {
    seedEvents([
      makeNodeCreated(1, 'n-1', 'first'),
      makeNodeCreated(2, 'n-2', 'second'),
      makeNodeCreated(3, 'n-other', 'manually chosen target'),
    ]);
    await renderChip();
    // 1. Auto-suggest fires after a deliberate selection of n-1.
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');

    // 2. A future override gesture writes a different target. The
    //    auto-stage effect must NOT undo this on the next selection.
    act(() => {
      useCaptureStore.getState().setTargetEntityId('n-other');
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-other');

    // 3. The moderator clicks a different node. The auto-stage runs
    //    but sees the slice no longer matches the ref-tracked
    //    last-auto-staged id — so it skips.
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-2' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-other');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      'Target: manually chosen target',
    );

    // 4. The override marker is visible (staged !== suggested).
    expect(screen.getByTestId('capture-target-chip-override-marker')).toBeTruthy();
  });

  it('override marker is invisible when staged equals the auto-suggestion', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(screen.queryByTestId('capture-target-chip-override-marker')).toBeNull();
  });

  it('override marker carries the localized aria-label', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', 'first'), makeNodeCreated(2, 'n-2', 'second')]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    act(() => {
      useCaptureStore.getState().setTargetEntityId('n-2');
    });
    const marker = screen.getByTestId('capture-target-chip-override-marker');
    expect(marker.getAttribute('aria-label')).toBe('Override (manually staged target)');
    expect(marker.getAttribute('role')).toBe('img');
  });
});

describe('CaptureTargetChip — reset clears the chip', () => {
  it('reset() returns the chip to the empty state', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      `Target: ${SHORT_WORDING}`,
    );
    act(() => {
      useCaptureStore.getState().reset();
      useSelectionStore.getState().clear();
    });
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });
});

describe('CaptureTargetChip — wording label resolution', () => {
  it('truncates wording longer than 32 characters and appends an ellipsis', async () => {
    seedEvents([makeNodeCreated(1, 'n-long', LONG_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-long' } });
    });
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      `Target: ${LONG_WORDING_TRUNCATED}`,
    );
  });

  it('falls back to the raw node id when no node-created event exists for the staged target', async () => {
    // No events seeded — the lookup returns null and the chip falls
    // back to rendering the raw id.
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-missing' } });
    });
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('Target: n-missing');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_target_clear_override.md
//
// These cases pin the × button and the `Esc` keyboard gesture: both
// reach the same `handleClear` implementation, both null the slice,
// both bump `userHasClearedRef` so the auto-stage effect does not
// immediately re-suggest from the still-selected node. The
// re-engagement test pins that a NEW node selection after the clear
// re-engages the auto-stage path.
describe('CaptureTargetChip — × button gesture', () => {
  it('renders the × button in the filled state with a localized aria-label and title', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    const clearButton = screen.getByTestId('capture-target-chip-clear');
    expect(clearButton.tagName).toBe('BUTTON');
    expect(clearButton.getAttribute('type')).toBe('button');
    expect(clearButton.getAttribute('aria-label')).toBe('Clear target');
    expect(clearButton.getAttribute('title')).toBe('Clear staged target (Esc)');
  });

  it('does NOT render the × button in the empty state', async () => {
    await renderChip();
    expect(screen.queryByTestId('capture-target-chip-clear')).toBeNull();
  });

  it('clicking the × button clears the slice and flips the chip to empty state', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');

    act(() => {
      fireEvent.click(screen.getByTestId('capture-target-chip-clear'));
    });

    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
    expect(screen.queryByTestId('capture-target-chip-clear')).toBeNull();
  });

  it('clicking × during an override produces a clean empty state (no marker, no button)', async () => {
    seedEvents([
      makeNodeCreated(1, 'n-1', 'first'),
      makeNodeCreated(2, 'n-other', 'manually chosen target'),
    ]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    act(() => {
      useCaptureStore.getState().setTargetEntityId('n-other');
    });
    expect(screen.getByTestId('capture-target-chip-override-marker')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('capture-target-chip-clear'));
    });

    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.queryByTestId('capture-target-chip-override-marker')).toBeNull();
    expect(screen.queryByTestId('capture-target-chip-clear')).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });
});

describe('CaptureTargetChip — Esc gesture', () => {
  it('Esc keydown clears the slice when no editable target has focus', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });

  it('Esc keydown bails when a textarea is the active element (editable-target guard)', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe(
      `Target: ${SHORT_WORDING}`,
    );

    textarea.remove();
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
//
// The chip's `handleClear` callback was extended (this commit) to also
// null the new `edgeRole` slice (Decision §5: a role-without-target
// state is methodologically nonsensical, so the single clear sink
// nulls both slices in one step). Both affordances (× button, Esc)
// reach the same handler, so the contract is symmetric.
describe('CaptureTargetChip — coupled clear (target + edgeRole)', () => {
  it('× button clears both targetEntityId and edgeRole', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    act(() => {
      useCaptureStore.getState().setEdgeRole('supports');
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(useCaptureStore.getState().edgeRole).toBe('supports');

    act(() => {
      fireEvent.click(screen.getByTestId('capture-target-chip-clear'));
    });

    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });

  it('Esc keydown clears both targetEntityId and edgeRole', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    act(() => {
      useCaptureStore.getState().setEdgeRole('rebuts');
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');
    expect(useCaptureStore.getState().edgeRole).toBe('rebuts');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(useCaptureStore.getState().edgeRole).toBeNull();
  });
});

describe('CaptureTargetChip — re-engagement after clear', () => {
  it('a new node selection after clear re-engages the auto-stage path', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', 'first node'), makeNodeCreated(2, 'n-2', 'second node')]);
    await renderChip();

    // Auto-suggest n-1.
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-1');

    // Clear via × button — the userHasClearedRef bump now blocks
    // immediate re-suggestion from the still-selected n-1.
    act(() => {
      fireEvent.click(screen.getByTestId('capture-target-chip-clear'));
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();

    // Select n-2 — re-engagement fires (different node id).
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-2' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBe('n-2');
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('Target: second node');
    // The auto-stage path is re-engaged — no override marker.
    expect(screen.queryByTestId('capture-target-chip-override-marker')).toBeNull();
  });

  it('staying on the same node after clear does NOT re-suggest', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('capture-target-chip-clear'));
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();

    // Re-dispatch the same n-1 selection (no-op write — paranoid case).
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });

  it('pane-click after clear does NOT re-suggest', async () => {
    seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
    await renderChip();
    act(() => {
      useSelectionStore.setState({ selected: { kind: 'node', id: 'n-1' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('capture-target-chip-clear'));
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();

    // Pane-click — selection clears; the auto-stage effect's leading
    // guard (recentlyActiveNodeId === null) short-circuits.
    act(() => {
      useSelectionStore.getState().clear();
    });
    expect(useCaptureStore.getState().targetEntityId).toBeNull();
    expect(screen.getByTestId('capture-target-chip-label').textContent).toBe('No target yet');
  });
});

describe('CaptureTargetChip — i18n catalog parity', () => {
  const KEYS = [
    'moderator.captureTargetChip.empty',
    'moderator.captureTargetChip.suggested',
    'moderator.captureTargetChip.overrideMarkerAria',
    'moderator.captureTargetChip.ariaLabel',
    'moderator.captureTargetChip.clearAria',
    'moderator.captureTargetChip.clearTitle',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value =
          key === 'moderator.captureTargetChip.suggested'
            ? i18next.t(key, { label: 'X' })
            : i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        expect(value).not.toContain('[t-missing]');
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('per-locale render: no raw catalog-key string nor [t-missing] in the chip DOM', async () => {
    for (const locale of LOCALES) {
      // `i18next.changeLanguage` notifies subscribed `useTranslation()`
      // hooks on already-mounted chips from a previous loop iteration —
      // wrap in `act(async)` so React absorbs the resulting setState
      // before the assertion phase.
      await act(async () => {
        await i18next.changeLanguage(locale);
      });
      cleanup();
      seedEvents([makeNodeCreated(1, 'n-1', SHORT_WORDING)]);
      useCaptureStore.setState({ ...captureInitial, targetEntityId: 'n-1' }, true);
      await renderChip();
      const chip = screen.getByTestId('capture-target-chip');
      expect(chip.textContent).not.toContain('moderator.captureTargetChip');
      expect(chip.textContent).not.toContain('[t-missing]');
    }
    await act(async () => {
      await i18next.changeLanguage('en-US');
    });
  });
});
