// Tests for `<BlockingDiagnosticBanner>` — the global blocked-session status
// indicator mounted at the top of the operate console. Present ONLY while ≥1
// `blocking`-severity diagnostic is active; absent (renders `null`) otherwise,
// including the advisory-only case.
//
// Refinement: tasks/refinements/moderator-ui/mod_blocking_diagnostic_banner.md
//             (Acceptance §1)
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//
//   - No active diagnostics → renders nothing.
//   - Advisory-only active → renders nothing (the blocking/advisory pin).
//   - One blocking active → banner present, `data-blocking-count="1"`,
//     `data-diagnostic-kind` matches the seeded kind, message + head title
//     resolve from the catalog.
//   - Mixed → `data-blocking-count` counts only blocking; head is blocking-first.
//   - Clicking review dispatches `requestCanvasFocus` with the head's deduped
//     affected entities, and `setActiveSidebarPane('diagnostic-flags')`.
//   - i18n catalog parity for the new `moderator.diagnostic.banner.*` keys
//     across en-US / pt-BR / es-419.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { affectedEntities, createI18nInstance } from '@a-conversa/shell';

import { BlockingDiagnosticBanner } from './BlockingDiagnosticBanner';
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
  useUiStore.setState({ focusRequest: null, activeSidebarPane: 'pending-proposals' });
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('BlockingDiagnosticBanner — absent unless blocked', () => {
  it('renders nothing when no diagnostic is active', () => {
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);
    expect(screen.queryByTestId('blocking-diagnostic-banner')).toBeNull();
  });

  it('renders nothing when only advisory diagnostics are active', () => {
    // The blocking-vs-advisory discriminator pin: advisory never raises it.
    applyDiagnostic(multiWarrantFiredPayload(1));
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);
    expect(screen.queryByTestId('blocking-diagnostic-banner')).toBeNull();
  });
});

describe('BlockingDiagnosticBanner — present while blocked', () => {
  it('renders the banner with the blocking count, head kind, and localized copy', () => {
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);

    const banner = screen.getByTestId('blocking-diagnostic-banner');
    expect(banner.getAttribute('data-blocking-count')).toBe('1');
    expect(banner.getAttribute('data-diagnostic-kind')).toBe('cycle');
    // Polite live region, not an assertive alert (Decision §D3).
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');

    expect(screen.getByTestId('blocking-diagnostic-banner-message').textContent).toBe(
      '1 blocking diagnostic must be resolved',
    );
    // The head's localized kind title is shown on the review button.
    expect(screen.getByTestId('blocking-diagnostic-banner-review').textContent).toBe(
      'Cycle in supports',
    );
  });

  it('counts only blocking diagnostics and takes the blocking-first head when mixed', () => {
    // Advisory lands first (lower sequence) — the blocking cycle must still be
    // the head, and the count must exclude the advisory.
    applyDiagnostic(multiWarrantFiredPayload(1));
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    applyDiagnostic(contradictionFiredPayload('node-aa', 'node-ab', 6));
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);

    const banner = screen.getByTestId('blocking-diagnostic-banner');
    // Two blocking (cycle, contradiction); the advisory multi-warrant excluded.
    expect(banner.getAttribute('data-blocking-count')).toBe('2');
    // Blocking-first head: cycle (sequence 5) precedes contradiction (6).
    expect(banner.getAttribute('data-diagnostic-kind')).toBe('cycle');
    expect(screen.getByTestId('blocking-diagnostic-banner-message').textContent).toBe(
      '2 blocking diagnostics must be resolved',
    );
  });
});

describe('BlockingDiagnosticBanner — review click', () => {
  it('dispatches requestCanvasFocus with the head deduped affectedEntities and foregrounds the pane', () => {
    const payload = cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5);
    applyDiagnostic(payload);
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);

    expect(useUiStore.getState().focusRequest).toBeNull();
    expect(useUiStore.getState().activeSidebarPane).toBe('pending-proposals');

    fireEvent.click(screen.getByTestId('blocking-diagnostic-banner-review'));

    const request = useUiStore.getState().focusRequest;
    const expected = affectedEntities(payload);
    expect(request?.nodeIds).toEqual([...new Set(expected.nodes)]);
    expect(request?.edgeIds).toEqual([...new Set(expected.edges)]);
    expect(request?.nonce).toBe(1);
    expect(useUiStore.getState().activeSidebarPane).toBe('diagnostic-flags');
  });

  it('dispatches the head region (blocking-first), not a non-head advisory region', () => {
    const cycle = cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5);
    applyDiagnostic(multiWarrantFiredPayload(1));
    applyDiagnostic(cycle);
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);

    fireEvent.click(screen.getByTestId('blocking-diagnostic-banner-review'));

    const request = useUiStore.getState().focusRequest;
    const expected = affectedEntities(cycle);
    expect(request?.nodeIds).toEqual([...new Set(expected.nodes)]);
  });

  it('dedupes repeated ids before dispatching', () => {
    const payload = cycleFiredPayload([NODE_A, NODE_B, NODE_A], 5);
    applyDiagnostic(payload);
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);

    fireEvent.click(screen.getByTestId('blocking-diagnostic-banner-review'));
    expect(useUiStore.getState().focusRequest?.nodeIds).toEqual([NODE_A, NODE_B]);
  });

  it('the review button aria-label resolves via moderator.diagnostic.banner.reviewAria', () => {
    applyDiagnostic(cycleFiredPayload([NODE_A, NODE_B, NODE_C], 5));
    render(<BlockingDiagnosticBanner sessionId={SESSION} />);
    const label =
      screen.getByTestId('blocking-diagnostic-banner-review').getAttribute('aria-label') ?? '';
    expect(label).toBe('Review the blocking Cycle in supports diagnostic');
    expect(label).not.toContain('reviewAria');
  });
});

describe('BlockingDiagnosticBanner — i18n catalog parity', () => {
  const KEYS = [
    'moderator.diagnostic.banner.message',
    'moderator.diagnostic.banner.reviewAria',
  ] as const;

  it('resolves all new banner keys to non-empty, non-literal strings in each locale', async () => {
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

  it('message pluralizes the blocking count in en-US', async () => {
    await i18next.changeLanguage('en-US');
    expect(i18next.t('moderator.diagnostic.banner.message', { count: 1 })).toBe(
      '1 blocking diagnostic must be resolved',
    );
    expect(i18next.t('moderator.diagnostic.banner.message', { count: 3 })).toBe(
      '3 blocking diagnostics must be resolved',
    );
  });
});
