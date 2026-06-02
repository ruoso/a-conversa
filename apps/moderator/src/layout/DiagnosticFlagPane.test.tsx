// Tests for `<DiagnosticFlagPane>` — the sidebar-pane flag list that
// renders every active diagnostic as a flag row (severity badge +
// localized kind title + one-line action prose) in the shared
// `orderActiveDiagnostics(...)` order, wrapping the shipped
// `<DiagnosticSuggestionsPanel>` for the focused flag.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md
//             (Acceptance §2)
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - Empty store → one `diagnostic-flag-empty` message, no flag rows.
//   - One blocking cycle + one advisory multi-warrant → exactly two
//     `diagnostic-flag-row`s, cycle first with `data-focused="true"` /
//     `data-diagnostic-severity="blocking"`, multi-warrant second with
//     `data-focused="false"`.
//   - Each row shows `t('diagnostics.<kind>.title')` + its severity badge.
//   - The embedded `diagnostic-suggestions-panel` focuses the same flag
//     whose row is `data-focused="true"` (continuity check).
//   - i18n catalog parity for the new `moderator.diagnostic.flags.*` keys
//     across en-US / pt-BR / es-419.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { affectedEntities, createI18nInstance, diagnosticIdentityKey } from '@a-conversa/shell';

import { DiagnosticFlagPane } from './DiagnosticFlagPane';
import { useWsStore } from '../ws/wsStore';
import { useUiStore } from '../stores/uiStore';

const SESSION = '00000000-0000-4000-8000-000000000099';
const NODE_A = 'node-a';
const NODE_B = 'node-b';
const NODE_C = 'node-c';
const EDGE_1 = 'edge-1';

function cycleFiredPayload(
  nodes: readonly string[] = [NODE_A, NODE_B, NODE_C],
  sequence = 1,
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'cycle',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'cycle', nodes },
  };
}

function contradictionFiredPayload(
  nodeA = NODE_A,
  nodeB = NODE_B,
  sequence = 1,
): DiagnosticPayload {
  return {
    sessionId: SESSION,
    kind: 'contradiction',
    severity: 'blocking',
    status: 'fired',
    sequence,
    diagnostic: { kind: 'contradiction', nodeA, nodeB, edges: [EDGE_1] },
  };
}

function multiWarrantFiredPayload(sequence = 1): DiagnosticPayload {
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

function applyDiagnostic(payload: DiagnosticPayload): void {
  act(() => {
    useWsStore.getState().applyDiagnostic(payload);
  });
}

beforeEach(async () => {
  useWsStore.getState().reset();
  useUiStore.setState({ focusRequest: null });
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('DiagnosticFlagPane — empty state', () => {
  it('renders one empty message and no flag rows when no diagnostic is active', () => {
    render(<DiagnosticFlagPane sessionId={SESSION} />);
    expect(screen.getByTestId('diagnostic-flag-empty')).toBeTruthy();
    expect(screen.queryAllByTestId('diagnostic-flag-row')).toHaveLength(0);
    // Exactly one empty message — the suggestions panel's own empty
    // state is not mounted in the empty case (Constraint §6).
    expect(screen.queryByTestId('diagnostic-suggestions-empty')).toBeNull();
  });

  it('uses the localized empty-state copy in en-US', () => {
    render(<DiagnosticFlagPane sessionId={SESSION} />);
    expect(screen.getByTestId('diagnostic-flag-empty').textContent).toBe('No active diagnostics');
  });

  it('renders the localized pane header from moderator.diagnostic.flags.header', () => {
    render(<DiagnosticFlagPane sessionId={SESSION} />);
    const pane = screen.getByTestId('diagnostic-flag-pane');
    expect(pane.getAttribute('aria-label')).toBe('Diagnostic flags');
  });
});

describe('DiagnosticFlagPane — flag list (blocking cycle + advisory multi-warrant)', () => {
  it('renders exactly two rows in blocking-first order with the right seams', () => {
    // Advisory lands first (lower sequence) — blocking must still win
    // the top slot.
    applyDiagnostic(multiWarrantFiredPayload(1));
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    const rows = screen.getAllByTestId('diagnostic-flag-row');
    expect(rows).toHaveLength(2);

    expect(rows[0]?.getAttribute('data-diagnostic-kind')).toBe('cycle');
    expect(rows[0]?.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(rows[0]?.getAttribute('data-focused')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBe('true');
    expect(rows[0]?.getAttribute('data-diagnostic-key')).toBe(
      diagnosticIdentityKey(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5)),
    );

    expect(rows[1]?.getAttribute('data-diagnostic-kind')).toBe('multi-warrant');
    expect(rows[1]?.getAttribute('data-diagnostic-severity')).toBe('advisory');
    expect(rows[1]?.getAttribute('data-focused')).toBe('false');
    expect(rows[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('shows the localized kind title + severity badge in each row', () => {
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    applyDiagnostic(multiWarrantFiredPayload(1));
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    const titles = screen.getAllByTestId('diagnostic-flag-kind-title').map((el) => el.textContent);
    expect(titles).toContain('Cycle in supports');
    expect(titles).toContain('Multiple warrants');

    const badges = screen.getAllByTestId('diagnostic-flag-severity').map((el) => el.textContent);
    expect(badges).toContain('Blocking');
    expect(badges).toContain('Advisory');
  });

  it('renders the one-line action prose for each kind', () => {
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<DiagnosticFlagPane sessionId={SESSION} />);
    const action = screen.getByTestId('diagnostic-flag-action-prose').textContent ?? '';
    expect(action).toContain('Break one supports edge');
  });

  it('each row wraps its content in a real focus button (keyboard-operable)', () => {
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<DiagnosticFlagPane sessionId={SESSION} />);
    const row = screen.getAllByTestId('diagnostic-flag-row')[0];
    expect(row?.tagName.toLowerCase()).toBe('li');
    // The clickable affordance is a native `<button type="button">`
    // (Decision §D3) — Enter/Space activation + focus-ring for free.
    const button = row?.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('data-testid')).toBe('diagnostic-flag-focus-button');
  });
});

describe('DiagnosticFlagPane — click focuses the affected region (Decision §D1)', () => {
  it('clicking a row dispatches requestCanvasFocus with its deduped affectedEntities', () => {
    const payload = cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5);
    applyDiagnostic(payload);
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    expect(useUiStore.getState().focusRequest).toBeNull();
    fireEvent.click(screen.getByTestId('diagnostic-flag-focus-button'));

    const request = useUiStore.getState().focusRequest;
    const expected = affectedEntities(payload);
    expect(request?.nodeIds).toEqual([...new Set(expected.nodes)]);
    expect(request?.edgeIds).toEqual([...new Set(expected.edges)]);
    expect(request?.nonce).toBe(1);
  });

  it('dedupes repeated ids before dispatching and stamping', () => {
    // A cycle whose node list repeats NODE_A — the dispatch + seam must
    // each carry NODE_A once.
    const payload = cycleFiredPayload([NODE_A, NODE_B, NODE_A], 5);
    applyDiagnostic(payload);
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    fireEvent.click(screen.getByTestId('diagnostic-flag-focus-button'));
    expect(useUiStore.getState().focusRequest?.nodeIds).toEqual([NODE_A, NODE_B]);

    const row = screen.getByTestId('diagnostic-flag-row');
    expect(row.getAttribute('data-diagnostic-affected-nodes')).toBe(`${NODE_A} ${NODE_B}`);
  });

  it("clicking a non-head (advisory) row dispatches that row's region, not the head's", () => {
    const cycle = cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5); // blocking head
    const multiWarrant = multiWarrantFiredPayload(1); // advisory tail
    applyDiagnostic(multiWarrant);
    applyDiagnostic(cycle);
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    const rows = screen.getAllByTestId('diagnostic-flag-row');
    expect(rows[0]?.getAttribute('data-diagnostic-kind')).toBe('cycle');
    // Click the advisory (non-head) row's button.
    const advisoryButton = rows[1]?.querySelector(
      '[data-testid="diagnostic-flag-focus-button"]',
    ) as HTMLButtonElement;
    fireEvent.click(advisoryButton);

    const request = useUiStore.getState().focusRequest;
    const expected = affectedEntities(multiWarrant);
    expect(request?.nodeIds).toEqual([...new Set(expected.nodes)]);
  });

  it('each row stamps data-diagnostic-affected-nodes / -edges from its deduped affectedEntities', () => {
    const cycle = cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5);
    const contradiction = contradictionFiredPayload('node-aa', 'node-ab', 6);
    applyDiagnostic(cycle);
    applyDiagnostic(contradiction);
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    for (const row of screen.getAllByTestId('diagnostic-flag-row')) {
      const kind = row.getAttribute('data-diagnostic-kind');
      const payload = kind === 'cycle' ? cycle : contradiction;
      const expected = affectedEntities(payload);
      expect(row.getAttribute('data-diagnostic-affected-nodes')).toBe(
        [...new Set(expected.nodes)].join(' '),
      );
      expect(row.getAttribute('data-diagnostic-affected-edges')).toBe(
        [...new Set(expected.edges)].join(' '),
      );
    }
  });

  it('the focus button aria-label resolves via moderator.diagnostic.flags.focusAria', () => {
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<DiagnosticFlagPane sessionId={SESSION} />);
    const button = screen.getByTestId('diagnostic-flag-focus-button');
    const label = button.getAttribute('aria-label') ?? '';
    expect(label).toBe('Focus the canvas on Cycle in supports');
    expect(label).not.toContain('focusAria');
  });
});

describe('DiagnosticFlagPane — focus continuity with the suggestions panel', () => {
  it('the embedded suggestions panel focuses the same flag as the data-focused row', () => {
    applyDiagnostic(multiWarrantFiredPayload(1));
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    const focusedRow = screen
      .getAllByTestId('diagnostic-flag-row')
      .find((row) => row.getAttribute('data-focused') === 'true');
    expect(focusedRow).toBeTruthy();

    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.getAttribute('data-diagnostic-key')).toBe(
      focusedRow?.getAttribute('data-diagnostic-key'),
    );
    expect(panel.getAttribute('data-diagnostic-kind')).toBe('cycle');
  });

  it('breaks blocking ties consistently between the list head and the suggestions panel', () => {
    // Two blocking at equal sequence — identity-key tiebreak picks the
    // contradiction (contradiction\0... < cycle\0...).
    const cycle = cycleFiredPayload([NODE_A, NODE_B], 4);
    const contradiction = contradictionFiredPayload('node-aa', 'node-ab', 4);
    applyDiagnostic(cycle);
    applyDiagnostic(contradiction);
    render(<DiagnosticFlagPane sessionId={SESSION} />);

    const rows = screen.getAllByTestId('diagnostic-flag-row');
    expect(rows[0]?.getAttribute('data-diagnostic-kind')).toBe('contradiction');
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.getAttribute('data-diagnostic-key')).toBe(
      rows[0]?.getAttribute('data-diagnostic-key'),
    );
  });
});

describe('DiagnosticFlagPane — i18n catalog parity', () => {
  const KEYS = [
    'moderator.diagnostic.flags.header',
    'moderator.diagnostic.flags.severity.blocking',
    'moderator.diagnostic.flags.severity.advisory',
    'moderator.diagnostic.flags.countAria',
    'moderator.diagnostic.flags.focusAria',
  ] as const;

  it('resolves all new flag keys to non-empty, non-literal strings in each locale', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (const key of KEYS) {
        const value = i18next.t(key, { count: 2, title: 'X' });
        expect(value, `${locale}::${key} resolved`).toBeTruthy();
        expect(value, `${locale}::${key} not literal key`).not.toBe(key);
      }
    }
    await i18next.changeLanguage('en-US');
  });

  it('countAria pluralizes the active-diagnostic count in en-US', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('moderator.diagnostic.flags.countAria', { count: 1 })).toBe(
      '1 active diagnostic',
    );
    expect(i18next.t('moderator.diagnostic.flags.countAria', { count: 3 })).toBe(
      '3 active diagnostics',
    );
  });
});
