// Tests for `<ParticipantDiagnosticsList>` — the participant footer's
// session-wide structural-diagnostics inventory + its toggle affordance.
//
// Refinement: tasks/refinements/participant-ui/part_diagnostics_list.md
//             (Acceptance §2 — Vitest component suite, with the i18n
//             provider mounted per the existing participant pattern.)
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - rows render in the shared total order (blocking-first, ascending
//     sequence) for a seeded multi-diagnostic map;
//   - each row shows the correct severity badge + `diagnostics.<kind>.title`;
//   - the empty state renders the single localized empty message and the
//     toggle shows count `0` when the map is empty;
//   - the toggle reflects `aria-expanded` and the list shows/hides on
//     toggle.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import {
  I18nProvider,
  affectedEntities,
  createI18nInstance,
  type I18nInstance,
} from '@a-conversa/shell';

import { ParticipantDiagnosticsList } from './ParticipantDiagnosticsList';
import { useUiStore } from '../stores/uiStore';
import { useWsStore } from '../ws/wsStore';

const SESSION = '00000000-0000-4000-8000-000000000099';
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const EDGE_1 = 'edge-1';

function cyclePayload(sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B, NODE_C] },
  };
}

function contradictionPayload(sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'contradiction', nodeA: NODE_A, nodeB: NODE_B, edges: [EDGE_1] },
  };
}

function multiWarrantPayload(sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'multi-warrant',
    severity: 'advisory',
    status: 'fired',
    sequence,
    diagnostic: {
      kind: 'multi-warrant',
      dataNodeId: NODE_A,
      claimNodeId: NODE_B,
      warrantNodeIds: [NODE_C],
    },
  };
}

// A cycle whose node list repeats an id — exercises the dedup before
// stamping/focusing (`affectedEntities` does not deduplicate).
function cycleWithDuplicatePayload(sequence: number): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'cycle', nodes: [NODE_A, NODE_B, NODE_A] },
  };
}

function applyDiagnostic(payload: DiagnosticPayload): void {
  act(() => {
    useWsStore.getState().applyDiagnostic(payload);
  });
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useUiStore.setState({ currentTab: 'graph', focusRequest: null });
});

function renderList(): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <ParticipantDiagnosticsList sessionId={SESSION} />
    </I18nProvider>,
  );
}

function openPanel(): void {
  fireEvent.click(screen.getByTestId('participant-diagnostics-toggle'));
}

describe('<ParticipantDiagnosticsList> — empty state', () => {
  it('shows the toggle with count 0 and a quiet tone when no diagnostic is active', () => {
    renderList();
    const toggle = screen.getByTestId('participant-diagnostics-toggle');
    expect(toggle.getAttribute('data-count')).toBe('0');
    expect(toggle.getAttribute('data-tone')).toBe('quiet');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the single localized empty message and no rows when opened empty', () => {
    renderList();
    openPanel();
    expect(screen.getByTestId('participant-diagnostic-empty').textContent).toBe(
      'No structural problems are open right now.',
    );
    expect(screen.queryAllByTestId('participant-diagnostic-row')).toHaveLength(0);
    expect(screen.queryByTestId('participant-diagnostic-list')).toBeNull();
  });
});

describe('<ParticipantDiagnosticsList> — populated inventory', () => {
  it('renders rows in the shared total order (blocking-first, ascending sequence)', () => {
    // Advisory lands first (lowest sequence), then two blocking in
    // descending seed order — the rendered order must be blocking-first
    // then ascending sequence: contradiction(3), cycle(5), multi-warrant(1).
    applyDiagnostic(multiWarrantPayload(1));
    applyDiagnostic(cyclePayload(5));
    applyDiagnostic(contradictionPayload(3));
    renderList();
    openPanel();

    const rows = screen.getAllByTestId('participant-diagnostic-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute('data-diagnostic-kind')).toBe('contradiction');
    expect(rows[0]?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(rows[1]?.getAttribute('data-diagnostic-kind')).toBe('cycle');
    expect(rows[1]?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(rows[2]?.getAttribute('data-diagnostic-kind')).toBe('multi-warrant');
    expect(rows[2]?.getAttribute('data-diagnostic-severity')).toBe('advisory');
  });

  it('shows the severity badge + localized kind title in each row', () => {
    applyDiagnostic(cyclePayload(5));
    applyDiagnostic(multiWarrantPayload(1));
    renderList();
    openPanel();

    const titles = screen
      .getAllByTestId('participant-diagnostic-kind-title')
      .map((el) => el.textContent);
    expect(titles).toContain('Cycle in supports');
    expect(titles).toContain('Multiple warrants');

    const badges = screen
      .getAllByTestId('participant-diagnostic-severity')
      .map((el) => el.textContent);
    expect(badges).toContain('Blocking');
    expect(badges).toContain('Advisory');
  });

  it('renders the parameter-free detail copy (not the moderator action prose)', () => {
    applyDiagnostic(cyclePayload(5));
    renderList();
    openPanel();
    const detail = screen.getByTestId('participant-diagnostic-detail').textContent ?? '';
    expect(detail).toContain('circular reasoning');
    expect(detail).not.toContain('Break one supports edge');
  });

  it('tones the toggle blocking when any blocking diagnostic is active', () => {
    applyDiagnostic(multiWarrantPayload(1));
    applyDiagnostic(cyclePayload(5));
    renderList();
    const toggle = screen.getByTestId('participant-diagnostics-toggle');
    expect(toggle.getAttribute('data-count')).toBe('2');
    expect(toggle.getAttribute('data-tone')).toBe('blocking');
  });
});

describe('<ParticipantDiagnosticsList> — tap to focus', () => {
  function focusButtonForKind(kind: string): HTMLElement {
    const row = screen
      .getAllByTestId('participant-diagnostic-row')
      .find((r) => r.getAttribute('data-diagnostic-kind') === kind);
    if (row === undefined) throw new Error(`no row for kind ${kind}`);
    return within(row).getByTestId('participant-diagnostic-focus-button');
  }

  it('renders a focus button in every row', () => {
    applyDiagnostic(cyclePayload(5));
    applyDiagnostic(multiWarrantPayload(1));
    renderList();
    openPanel();
    expect(screen.getAllByTestId('participant-diagnostic-focus-button')).toHaveLength(2);
  });

  it('clicking the focus button switches to the graph tab and dispatches that row’s region', () => {
    const cycle = cyclePayload(5);
    applyDiagnostic(cycle);
    renderList();
    openPanel();

    // Start on another tab to prove the tap foregrounds the graph tab.
    act(() => {
      useUiStore.getState().setCurrentTab('proposals');
    });
    expect(useUiStore.getState().focusRequest).toBeNull();

    fireEvent.click(focusButtonForKind('cycle'));

    expect(useUiStore.getState().currentTab).toBe('graph');
    const request = useUiStore.getState().focusRequest;
    const expected = affectedEntities(cycle);
    expect(request?.nodeIds).toEqual(dedupe(expected.nodes));
    expect(request?.edgeIds).toEqual(dedupe(expected.edges));
    expect(request?.nonce).toBe(1);
  });

  it('clicking a non-head (advisory) row dispatches that row’s region, not the head’s', () => {
    const cycle = cyclePayload(5); // blocking head
    const multi = multiWarrantPayload(1); // advisory, not the head
    applyDiagnostic(cycle);
    applyDiagnostic(multi);
    renderList();
    openPanel();

    fireEvent.click(focusButtonForKind('multi-warrant'));

    const request = useUiStore.getState().focusRequest;
    const expected = affectedEntities(multi);
    expect(request?.nodeIds).toEqual(dedupe(expected.nodes));
    expect(request?.edgeIds).toEqual(dedupe(expected.edges));
  });

  it('dispatches deduped node ids when affectedEntities repeats one', () => {
    const dup = cycleWithDuplicatePayload(5);
    applyDiagnostic(dup);
    renderList();
    openPanel();

    fireEvent.click(focusButtonForKind('cycle'));

    const request = useUiStore.getState().focusRequest;
    expect(request?.nodeIds).toEqual([NODE_A, NODE_B]);
  });

  it('stamps data-diagnostic-affected-nodes / -edges as the deduped affectedEntities per row', () => {
    const cycle = cyclePayload(5);
    const contradiction = contradictionPayload(3);
    applyDiagnostic(cycle);
    applyDiagnostic(contradiction);
    renderList();
    openPanel();

    for (const row of screen.getAllByTestId('participant-diagnostic-row')) {
      const kind = row.getAttribute('data-diagnostic-kind');
      const payload = kind === 'cycle' ? cycle : contradiction;
      const expected = affectedEntities(payload);
      expect(row.getAttribute('data-diagnostic-affected-nodes')).toBe(
        dedupe(expected.nodes).join(' '),
      );
      expect(row.getAttribute('data-diagnostic-affected-edges')).toBe(
        dedupe(expected.edges).join(' '),
      );
    }
  });

  it('stamps an empty edges seam when the diagnostic affects no edges', () => {
    applyDiagnostic(cyclePayload(5));
    renderList();
    openPanel();
    const row = screen.getByTestId('participant-diagnostic-row');
    expect(row.getAttribute('data-diagnostic-affected-edges')).toBe('');
  });

  it('the focus button aria-label resolves via participant.diagnostics.focusAria', () => {
    applyDiagnostic(cyclePayload(5));
    renderList();
    openPanel();
    const label = focusButtonForKind('cycle').getAttribute('aria-label') ?? '';
    // The interpolated kind title (not the raw key) must be present.
    expect(label).toContain('Cycle in supports');
    expect(label).not.toContain('focusAria');
  });
});

describe('participant.diagnostics.focusAria — i18n parity', () => {
  it('resolves in en-US / pt-BR / es-419', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
      const instance = await createI18nInstance(locale);
      const value = instance.t('participant.diagnostics.focusAria', { title: 'Cycle' });
      expect(value).not.toBe('participant.diagnostics.focusAria');
      expect(value).toContain('Cycle');
    }
  });
});

describe('<ParticipantDiagnosticsList> — open/close interaction', () => {
  it('reflects aria-expanded and mounts/unmounts the list on toggle', () => {
    applyDiagnostic(cyclePayload(5));
    renderList();
    const toggle = screen.getByTestId('participant-diagnostics-toggle');

    // Closed by default — the list is absent from the DOM.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('participant-diagnostic-list')).toBeNull();

    // Open — list mounts, aria-expanded flips.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('participant-diagnostic-list')).toBeTruthy();

    // Close again — list unmounts.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('participant-diagnostic-list')).toBeNull();
  });
});
