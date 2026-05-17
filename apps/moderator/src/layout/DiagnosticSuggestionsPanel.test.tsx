// Tests for `<DiagnosticSuggestionsPanel>` — the sidebar-pane panel that
// surfaces the methodology's per-diagnostic next-action move catalog as
// a row of disabled-placeholder chips.
//
// Refinement: tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - Empty-state row when no diagnostic is active.
//   - Focused-diagnostic panel for a single blocking cycle: header
//     localized, action prose localized, chip row contains the
//     methodology-pinned moves in canonical order, every chip is
//     disabled + aria-disabled.
//   - Contradiction chip row (decompose / amend / axiom-mark-both).
//   - Focus-pick rule: blocking wins over advisory; oldest sequence
//     wins; lexicographic identity-key wins on ties.
//   - Inert click discipline (placeholder chips are no-ops).
//   - Per-severity panel chrome palette (rose for blocking, amber for
//     advisory).
//   - Cross-locale catalog parity (en-US / pt-BR / es-419) for the
//     panel header + every per-move label.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { DiagnosticSuggestionsPanel } from './DiagnosticSuggestionsPanel';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';
import { diagnosticIdentityKey } from '../graph/diagnosticHighlights';

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
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('DiagnosticSuggestionsPanel — empty state', () => {
  it('renders the empty-state row when no diagnostic is active', () => {
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    expect(screen.getByTestId('diagnostic-suggestions-empty')).toBeTruthy();
    // No chip row rendered.
    expect(screen.queryByTestId('diagnostic-suggestions-moves')).toBeNull();
    // The panel root carries the `data-diagnostic-kind="none"` marker.
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.getAttribute('data-diagnostic-kind')).toBe('none');
  });

  it('renders the empty-state row when the active map is empty for this session', () => {
    // Apply a diagnostic for a different session — this session's
    // active map stays empty.
    applyDiagnostic({
      ...cycleFiredPayload(),
      sessionId: '00000000-0000-4000-8000-0000000000aa',
    });
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    expect(screen.getByTestId('diagnostic-suggestions-empty')).toBeTruthy();
  });

  it('uses the localized empty-state copy in en-US', () => {
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    expect(screen.getByTestId('diagnostic-suggestions-empty').textContent).toBe(
      'No active diagnostics',
    );
  });
});

describe('DiagnosticSuggestionsPanel — focused-diagnostic render (cycle)', () => {
  it('renders the panel root with the cycle kind + blocking severity', () => {
    applyDiagnostic(cycleFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.getAttribute('data-diagnostic-kind')).toBe('cycle');
    expect(panel.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(panel.getAttribute('data-diagnostic-key')).toBe(
      diagnosticIdentityKey(cycleFiredPayload()),
    );
  });

  it('renders the localized kind title + action prose in the header', () => {
    applyDiagnostic(cycleFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    expect(screen.getByTestId('diagnostic-suggestions-kind-title').textContent).toBe(
      'Cycle in supports',
    );
    const action = screen.getByTestId('diagnostic-suggestions-action-prose').textContent ?? '';
    // The action prose is the localized `diagnostics.cycle.action` key.
    expect(action.length).toBeGreaterThan(0);
    expect(action).toContain('Break one supports edge');
  });

  it('renders the cycle chips in canonical order (break-edge, decompose, axiom-mark)', () => {
    applyDiagnostic(cycleFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const chips = screen.getAllByTestId(/^diagnostic-suggestions-move-/);
    expect(chips).toHaveLength(3);
    expect(chips[0]?.getAttribute('data-suggestion-move')).toBe('break-edge');
    expect(chips[1]?.getAttribute('data-suggestion-move')).toBe('decompose');
    expect(chips[2]?.getAttribute('data-suggestion-move')).toBe('axiom-mark');
    for (const chip of chips) {
      expect(chip.getAttribute('data-suggestion-diagnostic-kind')).toBe('cycle');
      expect(chip.getAttribute('disabled')).not.toBeNull();
      expect(chip.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('panel aria-label substitutes the localized kind title', () => {
    applyDiagnostic(cycleFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    const ariaLabel = panel.getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!).toContain('Cycle in supports');
    // Should not leak the wire identifier into the aria label.
    expect(ariaLabel!).not.toBe('moderator.diagnostic.suggestions.panelAriaLabel');
  });
});

describe('DiagnosticSuggestionsPanel — contradiction chips', () => {
  it('renders [decompose, amend, axiom-mark-both] for a contradiction', () => {
    applyDiagnostic(contradictionFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const chips = screen.getAllByTestId(/^diagnostic-suggestions-move-/);
    expect(chips).toHaveLength(3);
    expect(chips[0]?.getAttribute('data-suggestion-move')).toBe('decompose');
    expect(chips[1]?.getAttribute('data-suggestion-move')).toBe('amend');
    expect(chips[2]?.getAttribute('data-suggestion-move')).toBe('axiom-mark-both');
    for (const chip of chips) {
      expect(chip.getAttribute('data-suggestion-diagnostic-kind')).toBe('contradiction');
    }
  });
});

describe('DiagnosticSuggestionsPanel — focus-pick rule', () => {
  it('focuses on the blocking diagnostic when both blocking and advisory are active', () => {
    // Advisory lands first (lower sequence) — blocking must still win.
    applyDiagnostic(multiWarrantFiredPayload(1));
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(panel.getAttribute('data-diagnostic-kind')).toBe('cycle');
  });

  it('focuses on the lower-sequence blocking diagnostic when two blocking are active', () => {
    // Two cycles at different sequences — oldest (lower) wins.
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B], 7));
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_C], 3));
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    // The cycle [NODE_A, NODE_C] has the lower sequence (3) — it wins.
    // Its identity key sorts NODE_A then NODE_C.
    const expectedKey = diagnosticIdentityKey(cycleFiredPayload([NODE_A, NODE_C], 3));
    expect(panel.getAttribute('data-diagnostic-key')).toBe(expectedKey);
  });

  it('breaks identity ties lexicographically (deterministic tiebreak)', () => {
    // Two contradictions at the same sequence, same severity.
    // Identity keys differ on (nodeA, nodeB) — pin which sorts first.
    const earlier = contradictionFiredPayload('node-aa', 'node-ab', 4);
    const later = contradictionFiredPayload('node-ba', 'node-bb', 4);
    applyDiagnostic(later);
    applyDiagnostic(earlier);
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    // `earlier` identity key prefix `contradiction\0node-aa\0node-ab`
    // sorts before `contradiction\0node-ba\0node-bb`.
    const earlierKey = diagnosticIdentityKey(earlier);
    expect(panel.getAttribute('data-diagnostic-key')).toBe(earlierKey);
  });
});

describe('DiagnosticSuggestionsPanel — inert chip click', () => {
  it('clicking a chip does not mutate the WS store or change the focused panel', () => {
    applyDiagnostic(cycleFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const before = useWsStore.getState().sessionState[SESSION]?.activeDiagnostics;
    const chip = screen.getByTestId('diagnostic-suggestions-move-break-edge');
    fireEvent.click(chip);
    const after = useWsStore.getState().sessionState[SESSION]?.activeDiagnostics;
    // The map reference must stay identical (no mutation went through).
    expect(after).toBe(before);
    // The panel still shows the same focused diagnostic.
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.getAttribute('data-diagnostic-kind')).toBe('cycle');
  });
});

describe('DiagnosticSuggestionsPanel — per-severity chrome palette', () => {
  it('blocking panel carries the rose palette tokens', () => {
    applyDiagnostic(cycleFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.className).toContain('border-rose-400');
    expect(panel.className).toContain('bg-rose-50');
  });

  it('advisory panel carries the amber palette tokens', () => {
    applyDiagnostic(multiWarrantFiredPayload());
    render(<DiagnosticSuggestionsPanel sessionId={SESSION} />);
    const panel = screen.getByTestId('diagnostic-suggestions-panel');
    expect(panel.className).toContain('border-amber-300');
    expect(panel.className).toContain('bg-amber-50');
  });
});

describe('DiagnosticSuggestionsPanel — i18n catalog parity', () => {
  const KEYS = [
    'moderator.diagnostic.suggestions.panelHeader',
    'moderator.diagnostic.suggestions.panelAriaLabel',
    'moderator.diagnostic.suggestions.empty',
    'moderator.diagnostic.suggestions.move.break-edge',
    'moderator.diagnostic.suggestions.move.decompose',
    'moderator.diagnostic.suggestions.move.axiom-mark',
    'moderator.diagnostic.suggestions.move.amend',
    'moderator.diagnostic.suggestions.move.axiom-mark-both',
    'moderator.diagnostic.suggestions.move.prompt-for-support',
    'moderator.diagnostic.suggestions.move.mark-conceded',
    'moderator.diagnostic.suggestions.move.review-configuration',
    'moderator.diagnostic.suggestions.move.repair-configuration',
    'moderator.diagnostic.suggestions.move.leave-as-intentional',
  ] as const;

  it('resolves all keys to non-empty strings in each locale', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (const key of KEYS) {
        const value = i18next.t(key);
        expect(value, `${locale}::${key} resolved`).toBeTruthy();
        expect(value, `${locale}::${key} not literal key`).not.toBe(key);
      }
    }
    await i18next.changeLanguage('en-US');
  });

  it('non-en-US locale values differ from en-US for the header + every per-move label', async () => {
    await i18next.changeLanguage('en-US');
    const enValues = KEYS.map((k) => i18next.t(k));
    for (const locale of ['pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i] as (typeof KEYS)[number];
        const localized = i18next.t(key);
        expect(localized, `${locale}::${key} differs from en-US`).not.toBe(enValues[i]);
      }
    }
    await i18next.changeLanguage('en-US');
  });
});
