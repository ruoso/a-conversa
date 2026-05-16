// Tests for `<PendingProposalsPane>` — the right-sidebar pane that
// lists every in-flight proposal for the current session.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposal_list.md
//
// Per ADR 0022 these are committed Vitest cases. They pin:
//   (a) Empty event log renders the localized empty-state paragraph.
//   (b) One `proposal` event renders one row with the expected
//       chip / summary / author / timestamp test ids.
//   (c) The row's `data-proposal-id` matches the event id.
//   (d) Two proposals render in newest-first order.
//   (e) After a `commit` event lands, the corresponding row disappears.
//   (f) The pane updates on store push (push a `proposal` event via
//       `applyEvent`; assert the new row appears without re-render-by-hand).
//   (g) All eleven proposal sub-kinds resolve to a non-empty chip label.
//   (h) `classify-node` proposals reuse the `methodology.kind.*` catalog
//       values for the chip.
//   (i) The author column renders the 8-char UUID prefix.
//   (j) The timestamp column flows through `formatRelativeTime` (assert
//       the formatter is called rather than asserting prose — locale-
//       stable test).
//
// The pane subscribes to `useWsStore` via the standard Zustand selector
// pattern. The component reads `sessionState[sessionId].events`, so the
// test pushes envelopes into the store via the public `applyEvent`
// writer (the same seam the WS client subscriber uses) — no mocking.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import { formatRelativeTime, __resetFormatterCache } from '@a-conversa/i18n-catalogs';

import { PendingProposalsPane } from './PendingProposalsPane';
import { initI18n } from '../i18n';
import { useWsStore } from '../ws/wsStore';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const OTHER_SESSION = '00000000-0000-4000-8000-0000000000a2';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const ACTOR_BOB = '00000000-0000-4000-8000-0000000000ab';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const EDGE_E = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const PROPOSAL_Q = '00000000-0000-4000-8000-0000000000fe';
const PROPOSAL_R = '00000000-0000-4000-8000-0000000000fd';
const PARTICIPANT_A = '00000000-0000-4000-8000-0000000000c1';
// 2026-05-16T00:01:30.000Z — used as the fixed "now" so the relative
// timestamps in test cases are stable across runs.
const NOW_MS = Date.parse('2026-05-16T00:01:30.000Z');

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

function proposalEvent(
  seq: number,
  envelopeId: string,
  proposal: ProposalPayload,
  overrides: { actor?: string | null; createdAt?: string; sessionId?: string } = {},
): Event {
  return {
    id: envelopeId,
    sessionId: overrides.sessionId ?? SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: overrides.actor === undefined ? ACTOR : overrides.actor,
    payload: { proposal },
    createdAt: overrides.createdAt ?? '2026-05-16T00:01:00.000Z',
  };
}

function commitEvent(seq: number, proposalId: string): Event {
  return {
    id: envId('c', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      proposal_id: proposalId,
      moderator: ACTOR,
      committed_at: '2026-05-16T00:01:20.000Z',
    },
    createdAt: '2026-05-16T00:01:20.000Z',
  };
}

const classifyNodeFact: ProposalPayload = {
  kind: 'classify-node',
  node_id: NODE_X,
  classification: 'fact',
};

const classifyNodeValue: ProposalPayload = {
  kind: 'classify-node',
  node_id: NODE_Y,
  classification: 'value',
};

beforeEach(async () => {
  // Reset the WS store to the documented initial state so each test
  // starts from an empty `sessionState`.
  useWsStore.getState().reset();
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('PendingProposalsPane — empty state', () => {
  it('renders the localized empty-state paragraph when the event log is empty', () => {
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const empty = screen.getByTestId('pending-proposals-pane-empty');
    expect(empty.textContent).toBe('No pending proposals');
    // No list, no rows.
    expect(screen.queryByTestId('pending-proposals-pane-list')).toBeNull();
    expect(screen.queryAllByTestId('pending-proposal-row')).toHaveLength(0);
  });

  it('renders the localized aria-label on the container', () => {
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const container = screen.getByTestId('pending-proposals-pane');
    expect(container.getAttribute('aria-label')).toBe('Pending proposals list');
  });

  it('renders the empty state when only non-proposal events exist in the session', () => {
    act(() => {
      useWsStore.getState().applyEvent({
        id: envId('n', 1),
        sessionId: SESSION,
        sequence: 1,
        kind: 'node-created',
        actor: ACTOR,
        payload: {
          node_id: NODE_X,
          wording: 'synthetic node',
          created_by: ACTOR,
          created_at: '2026-05-16T00:01:00.000Z',
        },
        createdAt: '2026-05-16T00:01:00.000Z',
      });
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.getByTestId('pending-proposals-pane-empty')).toBeTruthy();
  });
});

describe('PendingProposalsPane — single row rendering', () => {
  it('renders one row per surviving proposal with the expected test ids', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
    // The four columns each have their own test id.
    expect(screen.getByTestId('pending-proposal-row-kind').textContent).toBe('Fact');
    expect(screen.getByTestId('pending-proposal-row-summary').textContent).toContain(
      NODE_X.slice(0, 8),
    );
    expect(screen.getByTestId('pending-proposal-row-author').textContent).toBe(ACTOR.slice(0, 8));
    expect(screen.getByTestId('pending-proposal-row-timestamp').textContent).toBeTruthy();
  });

  it('uses the methodology.kind.<kind> catalog value for classify-node chips', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.getByTestId('pending-proposal-row-kind').textContent).toBe(
      i18next.t('methodology.kind.fact'),
    );
  });

  it('renders the localized "System" label when actor is null', () => {
    act(() => {
      useWsStore
        .getState()
        .applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact, { actor: null }));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.getByTestId('pending-proposal-row-author').textContent).toBe('System');
  });
});

describe('PendingProposalsPane — multi-row ordering and lifecycle', () => {
  it('renders rows newest-first by event sequence (descending)', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_Q, classifyNodeValue));
      useWsStore
        .getState()
        .applyEvent(proposalEvent(3, PROPOSAL_R, classifyNodeFact, { actor: ACTOR_BOB }));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('data-proposal-id'))).toEqual([
      PROPOSAL_R,
      PROPOSAL_Q,
      PROPOSAL_P,
    ]);
  });

  it('removes the row when a commit event referencing the proposal lands', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_Q, classifyNodeValue));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(2);
    act(() => {
      useWsStore.getState().applyEvent(commitEvent(3, PROPOSAL_P));
    });
    const remaining = screen.getAllByTestId('pending-proposal-row');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_Q);
  });

  it('returns to the empty state when every proposal is committed away', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(1);
    act(() => {
      useWsStore.getState().applyEvent(commitEvent(2, PROPOSAL_P));
    });
    expect(screen.queryByTestId('pending-proposal-row')).toBeNull();
    expect(screen.getByTestId('pending-proposals-pane-empty')).toBeTruthy();
  });

  it('updates in real time when a proposal event lands AFTER mount (store push)', () => {
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.queryByTestId('pending-proposal-row')).toBeNull();
    // Push the event into the store AFTER the initial render — the
    // pane re-renders on the Zustand subscription firing.
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });
});

describe('PendingProposalsPane — session isolation', () => {
  it('ignores proposals from other sessions in the shared store', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore
        .getState()
        .applyEvent(proposalEvent(2, PROPOSAL_Q, classifyNodeValue, { sessionId: OTHER_SESSION }));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });
});

describe('PendingProposalsPane — all eleven proposal sub-kinds resolve to a non-empty chip label', () => {
  const subKinds: { name: string; payload: ProposalPayload }[] = [
    {
      name: 'classify-node',
      payload: { kind: 'classify-node', node_id: NODE_X, classification: 'fact' },
    },
    {
      name: 'set-node-substance',
      payload: { kind: 'set-node-substance', node_id: NODE_X, value: 'agreed' },
    },
    {
      name: 'set-edge-substance',
      payload: { kind: 'set-edge-substance', edge_id: EDGE_E, value: 'agreed' },
    },
    {
      name: 'edit-wording (reword)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_X,
        new_wording: 'updated wording',
      },
    },
    {
      name: 'edit-wording (restructure)',
      payload: {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: NODE_X,
        new_wording: 'rebuilt wording',
        new_node_id: NODE_Y,
      },
    },
    {
      name: 'decompose',
      payload: {
        kind: 'decompose',
        parent_node_id: NODE_X,
        components: [
          { wording: 'first component', classification: 'fact' },
          { wording: 'second component', classification: 'fact' },
        ],
      },
    },
    {
      name: 'interpretive-split',
      payload: {
        kind: 'interpretive-split',
        parent_node_id: NODE_X,
        readings: [
          { wording: 'reading one', classification: 'value' },
          { wording: 'reading two', classification: 'value' },
        ],
      },
    },
    {
      name: 'axiom-mark',
      payload: { kind: 'axiom-mark', node_id: NODE_X, participant: PARTICIPANT_A },
    },
    {
      name: 'meta-move',
      payload: {
        kind: 'meta-move',
        meta_kind: 'reframe',
        content: 'reframing the discussion',
        target_kind: 'node',
        target_id: NODE_X,
      },
    },
    {
      name: 'break-edge',
      payload: { kind: 'break-edge', edge_id: EDGE_E },
    },
    {
      name: 'amend-node',
      payload: { kind: 'amend-node', node_id: NODE_X, new_content: 'amended content' },
    },
    {
      name: 'annotate',
      payload: {
        kind: 'annotate',
        target_kind: 'node',
        target_id: NODE_X,
        annotation_kind: 'note',
        content: 'a clarifying note',
      },
    },
  ];

  for (let i = 0; i < subKinds.length; i += 1) {
    const sub = subKinds[i]!;
    it(`renders a non-empty chip + summary for sub-kind '${sub.name}'`, () => {
      // Fresh store per case (beforeEach reset) so each pane sees only
      // its own event.
      useWsStore.getState().reset();
      act(() => {
        useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, sub.payload));
      });
      render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
      const chip = screen.getByTestId('pending-proposal-row-kind');
      const summary = screen.getByTestId('pending-proposal-row-summary');
      expect(chip.textContent).toBeTruthy();
      expect(summary.textContent).toBeTruthy();
      cleanup();
    });
  }
});

describe('PendingProposalsPane — author column', () => {
  it('renders the 8-char UUID prefix of the proposal envelope actor', () => {
    act(() => {
      useWsStore
        .getState()
        .applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact, { actor: ACTOR_BOB }));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const author = screen.getByTestId('pending-proposal-row-author');
    expect(author.textContent).toBe(ACTOR_BOB.slice(0, 8));
    expect(author.textContent?.length).toBe(8);
  });
});

describe('PendingProposalsPane — timestamp formatting goes through formatRelativeTime', () => {
  it('the rendered timestamp matches what formatRelativeTime produces for the same input', () => {
    // Locale-stable contract: the pane's timestamp column equals
    // `formatRelativeTime(-secondsAgo, 'second')` for the row's
    // `createdAt`. Asserting equality against the helper (rather than a
    // hard-coded prose string) keeps the test locale-stable and
    // shields it from `Intl.RelativeTimeFormat` ICU updates.
    __resetFormatterCache();
    const createdAt = '2026-05-16T00:01:00.000Z';
    act(() => {
      useWsStore
        .getState()
        .applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact, { createdAt }));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    const expectedSecondsAgo = Math.round((NOW_MS - Date.parse(createdAt)) / 1000);
    const expected = formatRelativeTime(-expectedSecondsAgo, 'second');
    expect(screen.getByTestId('pending-proposal-row-timestamp').textContent).toBe(expected);
  });

  it('renders a stable fallback (the raw ISO string) when createdAt does not parse', () => {
    act(() => {
      useWsStore
        .getState()
        .applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact, { createdAt: 'not-a-date' }));
    });
    render(<PendingProposalsPane sessionId={SESSION} nowMs={NOW_MS} />);
    expect(screen.getByTestId('pending-proposal-row-timestamp').textContent).toBe('not-a-date');
  });
});

describe('PendingProposalsPane — i18n catalog parity', () => {
  const KEYS = [
    'moderator.proposalList.emptyState',
    'moderator.proposalList.paneAriaLabel',
    'moderator.proposalList.rowAriaLabel',
    'moderator.proposalList.systemAuthor',
  ];
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('non-en-US locales differ from en-US for each title (translation, not copy)', async () => {
    await i18next.changeLanguage('en-US');
    const enValues = KEYS.map((k) => i18next.t(k));
    for (const locale of ['pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (let i = 0; i < KEYS.length; i++) {
        const v = i18next.t(KEYS[i] as string);
        expect(v, `${locale}::${KEYS[i] as string} should differ from en-US`).not.toBe(enValues[i]);
      }
    }
    await i18next.changeLanguage('en-US');
  });
});
