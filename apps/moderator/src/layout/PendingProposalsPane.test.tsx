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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import { formatRelativeTime, __resetFormatterCache } from '@a-conversa/i18n-catalogs';

import { PendingProposalsPane } from './PendingProposalsPane';
import { createI18nInstance } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { resetCommitStore, useCommitStore } from './useCommitAction';
import { resetWithdrawProposalStore } from './useWithdrawProposalAction';
import { AuthValueProvider, WsClientProvider } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

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
      target: 'proposal',
      proposal_id: proposalId,
      committed_by: ACTOR,
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

// A minimal, no-op WS client for tests that exercise the pane's
// rendering surface without exercising the commit-button's WS round-
// trip. The commit-action hook calls `useWsClient()` from inside each
// `<PendingProposalRow>` — without a provider, the hook throws. The
// stub returns `'open'` from `status()` so any sibling subscription
// that reads it would observe a healthy socket.
function makeStubWsClient(): WsClient {
  const send: SendFn = (): Promise<WsEnvelopeUnion> =>
    new Promise<WsEnvelopeUnion>(() => {
      /* never resolves — tests that exercise the click path use a real spy */
    });
  return {
    status: (): WsClientStatus => 'open',
    connect: (): void => undefined,
    close: (): void => undefined,
    killWebSocket: (): void => undefined,
    send,
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
}

/**
 * Render the pane inside the providers it needs:
 *   - `<MemoryRouter>` so the row's `useCommitAction` hook can read
 *     the `:id` route param;
 *   - `<WsClientProvider>` (with an optional injected client) so
 *     `useCommitAction`'s `useWsClient()` call succeeds.
 */
function renderPane(
  options: {
    sessionIdOverride?: string;
    nowMs?: number;
    client?: WsClient;
    /**
     * Optional authenticated userId — defaults to `ACTOR`, which is
     * the actor on every proposal event the test fixtures emit. Tests
     * that need to exercise the proposer-only withdraw-button guard
     * from a non-proposer perspective override this.
     */
    authUserId?: string;
  } = {},
): { client: WsClient } {
  const sessionPath = options.sessionIdOverride ?? SESSION;
  const client = options.client ?? makeStubWsClient();
  const userId = options.authUserId ?? ACTOR;
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={[`/sessions/${sessionPath}/operate`]}>
        <AuthValueProvider
          value={{
            status: 'authenticated',
            user: { userId, screenName: 'Tester' },
            refresh: () => undefined,
            logout: () => undefined,
          }}
        >
          <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
            <Routes>
              <Route path="/sessions/:id/operate" element={children} />
            </Routes>
          </WsClientProvider>
        </AuthValueProvider>
      </MemoryRouter>
    );
  }
  render(
    <Wrapper>
      <PendingProposalsPane sessionId={SESSION} nowMs={options.nowMs ?? NOW_MS} />
    </Wrapper>,
  );
  return { client };
}

beforeEach(async () => {
  // Reset the WS store to the documented initial state so each test
  // starts from an empty `sessionState`.
  useWsStore.getState().reset();
  resetCommitStore();
  resetWithdrawProposalStore();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('PendingProposalsPane — empty state', () => {
  it('renders the localized empty-state paragraph when the event log is empty', () => {
    renderPane();
    const empty = screen.getByTestId('pending-proposals-pane-empty');
    expect(empty.textContent).toBe('No pending proposals');
    // No list, no rows.
    expect(screen.queryByTestId('pending-proposals-pane-list')).toBeNull();
    expect(screen.queryAllByTestId('pending-proposal-row')).toHaveLength(0);
  });

  it('renders the localized aria-label on the container', () => {
    renderPane();
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
    renderPane();
    expect(screen.getByTestId('pending-proposals-pane-empty')).toBeTruthy();
  });
});

describe('PendingProposalsPane — single row rendering', () => {
  it('renders one row per surviving proposal with the expected test ids', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
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
    renderPane();
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
    renderPane();
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
    renderPane();
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
    renderPane();
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
    renderPane();
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(1);
    act(() => {
      useWsStore.getState().applyEvent(commitEvent(2, PROPOSAL_P));
    });
    expect(screen.queryByTestId('pending-proposal-row')).toBeNull();
    expect(screen.getByTestId('pending-proposals-pane-empty')).toBeTruthy();
  });

  it('updates in real time when a proposal event lands AFTER mount (store push)', () => {
    renderPane();
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
    renderPane();
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
          {
            wording: 'first component',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f031',
          },
          {
            wording: 'second component',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000f032',
          },
        ],
      },
    },
    {
      name: 'interpretive-split',
      payload: {
        kind: 'interpretive-split',
        parent_node_id: NODE_X,
        readings: [
          {
            wording: 'reading one',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000f033',
          },
          {
            wording: 'reading two',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000f034',
          },
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
      renderPane();
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
    renderPane();
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
    renderPane();
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
    renderPane();
    expect(screen.getByTestId('pending-proposal-row-timestamp').textContent).toBe('not-a-date');
  });
});

// Per-facet breakdown integration coverage —
// `tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`.
// The pane now renders a `<ProposalFacetBreakdown>` inside each
// `<PendingProposalRow>`'s body, beneath the existing one-line header.
// These cases pin:
//   (a) multi-facet — two pending proposals of distinct sub-kinds
//       each surface the expected facet chip;
//   (b) server-precedence — pushing a `proposal-status` envelope via
//       `applyProposalStatus` updates the chip's `data-facet-status`
//       to the server value (not the client mirror);
//   (c) header-unaffected — the existing one-line header test ids
//       (`pending-proposal-row-kind`, `-summary`, `-author`,
//       `-timestamp`) all remain on the page after the breakdown
//       lands beneath them.
describe('PendingProposalsPane — per-facet breakdown integration', () => {
  it('renders one facet chip per row for two pending proposals of distinct sub-kinds', () => {
    const editWording: ProposalPayload = {
      kind: 'edit-wording',
      edit_kind: 'reword',
      node_id: NODE_X,
      new_wording: 'updated wording',
    };
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_Q, editWording));
    });
    renderPane();
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(2);
    // Each row has its own breakdown container.
    const breakdowns = screen.getAllByTestId('proposal-facet-breakdown');
    expect(breakdowns).toHaveLength(2);
    // The newer proposal (PROPOSAL_Q, edit-wording) renders first;
    // its breakdown surfaces a `wording` chip.
    const firstChip = breakdowns[0]?.querySelector('[data-testid="proposal-facet-row"]');
    expect(firstChip?.getAttribute('data-facet-name')).toBe('wording');
    // The older proposal (PROPOSAL_P, classify-node) renders second;
    // its breakdown surfaces a `classification` chip.
    const secondChip = breakdowns[1]?.querySelector('[data-testid="proposal-facet-row"]');
    expect(secondChip?.getAttribute('data-facet-name')).toBe('classification');
    // Both chips default to `proposed` (no votes yet).
    expect(firstChip?.getAttribute('data-facet-status')).toBe('proposed');
    expect(secondChip?.getAttribute('data-facet-status')).toBe('proposed');
  });

  it('the chip data-facet-status reflects the server perFacetStatus after applyProposalStatus pushes a frame', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
    // Before any server frame, the chip is the default `proposed`.
    expect(screen.getByTestId('proposal-facet-row').getAttribute('data-facet-status')).toBe(
      'proposed',
    );
    // Push a `proposal-status` envelope — the pane re-renders on the
    // Zustand subscription firing.
    act(() => {
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION,
        proposalId: PROPOSAL_P,
        sequence: 1,
        perFacetStatus: { classification: 'disputed' },
      });
    });
    expect(screen.getByTestId('proposal-facet-row').getAttribute('data-facet-status')).toBe(
      'disputed',
    );
  });

  it('the existing one-line header test ids remain on the page after the breakdown is added', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
    // The header's four test ids must still resolve — the breakdown
    // is additive, not a replacement.
    expect(screen.getByTestId('pending-proposal-row-kind')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-summary')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-author')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-timestamp')).toBeTruthy();
    // And the breakdown surface mounts alongside.
    expect(screen.getByTestId('proposal-facet-breakdown')).toBeTruthy();
    expect(screen.getByTestId('proposal-facet-row')).toBeTruthy();
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md
//
// The pane now threads a `votesByFacetIndex` memo
// (`projectVotesByFacet(events)`) into every row's
// `<ProposalFacetBreakdown>`, so each chip grows a per-participant
// indicator row when votes for its `(entityId, facet)` pair land in
// the event log. These cases pin:
//   (a) push a `proposal` + a `vote` event into `useWsStore` via
//       `applyEvent`; the row's breakdown chip grows one indicator
//       with the expected `data-choice`;
//   (b) two participants on the same facet render two indicators in
//       arrival order;
//   (c) the chip's `data-facet-status` remains correct alongside the
//       indicator row (no regression from the predecessor's
//       facet-status assertions);
//   (d) Decision §7 — the no-vote-yet baseline: a freshly proposed
//       item has zero indicators in its chip.
describe('PendingProposalsPane — per-participant vote indicators integration', () => {
  function voteEvent(opts: {
    seq: number;
    proposalEnvelopeId: string;
    participant: string;
    choice: 'agree' | 'dispute' | 'withdraw';
  }): Event {
    return {
      id: envId('v', opts.seq),
      sessionId: SESSION,
      sequence: opts.seq,
      kind: 'vote',
      actor: opts.participant,
      payload: {
        target: 'proposal' as const,
        proposal_id: opts.proposalEnvelopeId,
        participant: opts.participant,
        choice: opts.choice as 'agree' | 'dispute',
        voted_at: '2026-05-16T00:01:05.000Z',
      },
      createdAt: '2026-05-16T00:01:05.000Z',
    };
  }

  it('the freshly-proposed chip starts with zero indicators (no-vote-yet baseline)', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
    // The chip is present but the indicator row is omitted entirely
    // until a vote lands.
    expect(screen.getByTestId('proposal-facet-row')).toBeTruthy();
    expect(screen.queryByTestId('proposal-facet-vote-indicator-row')).toBeNull();
  });

  it('one vote landing via applyEvent grows one indicator with the expected data-choice', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
    // No vote yet → no indicator.
    expect(screen.queryByTestId('proposal-facet-vote-indicator-row')).toBeNull();

    act(() => {
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 2,
          proposalEnvelopeId: PROPOSAL_P,
          participant: PARTICIPANT_A,
          choice: 'agree',
        }),
      );
    });

    const indicatorRow = screen.getByTestId('proposal-facet-vote-indicator-row');
    const indicators = indicatorRow.querySelectorAll('[data-vote-indicator]');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(indicators[0]?.getAttribute('data-choice')).toBe('agree');
  });

  it('two participants voting on the same facet render two indicators in arrival order', () => {
    const PARTICIPANT_B = '00000000-0000-4000-8000-0000000000c2';
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 2,
          proposalEnvelopeId: PROPOSAL_P,
          participant: PARTICIPANT_A,
          choice: 'agree',
        }),
      );
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 3,
          proposalEnvelopeId: PROPOSAL_P,
          participant: PARTICIPANT_B,
          choice: 'dispute',
        }),
      );
    });
    renderPane();
    const indicators = screen
      .getByTestId('proposal-facet-vote-indicator-row')
      .querySelectorAll('[data-vote-indicator]');
    expect(indicators).toHaveLength(2);
    expect(Array.from(indicators).map((el) => el.getAttribute('data-participant-id'))).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
    ]);
    expect(Array.from(indicators).map((el) => el.getAttribute('data-choice'))).toEqual([
      'agree',
      'dispute',
    ]);
  });

  it("the chip's data-facet-status stays in sync alongside the indicator row (no regression)", () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 2,
          proposalEnvelopeId: PROPOSAL_P,
          participant: PARTICIPANT_A,
          choice: 'agree',
        }),
      );
      // Server `proposal-status` envelope says `disputed` — the chip's
      // status reflects the server frame; the indicator row still
      // surfaces the per-participant detail.
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION,
        proposalId: PROPOSAL_P,
        sequence: 2,
        perFacetStatus: { classification: 'disputed' },
      });
    });
    renderPane();
    const chip = screen.getByTestId('proposal-facet-row');
    expect(chip.getAttribute('data-facet-status')).toBe('disputed');
    // Indicator row still resolves and carries the agree dot.
    const indicators = chip.querySelectorAll('[data-vote-indicator]');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]?.getAttribute('data-choice')).toBe('agree');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_proposal_filter_search.md
//
// The pane grew a pinned filter strip above the conditional empty-state
// vs list branch (Decision §2 — always visible). These cases pin:
//   (a) the strip renders with a free-text input and three state chips;
//       the empty input has no × clear button;
//   (b) typing in the text input narrows the list to matching rows
//       (case-insensitive substring against the same `summaryText` the
//       row renders — Decision §3);
//   (c) the × clear button appears when the input is non-empty and
//       clicking it restores the full list;
//   (d) clicking the "Ready" chip narrows the list to rows whose
//       `deriveAllAgree` returns `{ ok: true }`;
//   (e) clicking the "Disputed" chip narrows the list to rows with at
//       least one disputed facet entry;
//   (f) when the filter excludes every row, the
//       `pending-proposals-filtered-empty` paragraph renders AND the
//       original `pending-proposals-pane-empty` does NOT;
//   (g) the strip stays visible even when the list is empty
//       (default-empty AND filtered-empty);
//   (h) the existing row test-id contract is unaffected.
describe('PendingProposalsPane — filter strip', () => {
  function setProposal(
    seq: number,
    envelopeId: string,
    proposal: ProposalPayload,
    overrides?: { actor?: string | null; createdAt?: string; sessionId?: string },
  ): void {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(seq, envelopeId, proposal, overrides));
    });
  }

  const editWordingProposal: ProposalPayload = {
    kind: 'edit-wording',
    edit_kind: 'reword',
    node_id: NODE_X,
    new_wording: 'The proposed minimum wage helps workers.',
  };

  const editWordingOther: ProposalPayload = {
    kind: 'edit-wording',
    edit_kind: 'reword',
    node_id: NODE_Y,
    new_wording: 'Public transit funding should increase.',
  };

  it('(a) strip renders with three state chips + a text input; empty input has no × clear button', () => {
    renderPane();
    const strip = screen.getByTestId('pending-proposals-filter-strip');
    expect(strip).toBeTruthy();
    const input = screen.getByTestId('pending-proposals-filter-text');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('pending-proposals-filter-text-clear')).toBeNull();
    const chips = screen.getAllByTestId('pending-proposals-filter-state');
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.getAttribute('data-filter-state'))).toEqual([
      'all',
      'ready',
      'disputed',
    ]);
    // The All chip is pressed by default.
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(chips[2]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('(b) typing in the text input narrows the list to matching rows (case-insensitive substring)', () => {
    setProposal(1, PROPOSAL_P, editWordingProposal);
    setProposal(2, PROPOSAL_Q, editWordingOther);
    renderPane();
    // Both rows visible by default.
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(2);

    const input = screen.getByTestId('pending-proposals-filter-text');
    act(() => {
      fireEvent.change(input, { target: { value: 'MINIMUM' } });
    });
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });

  it('(c) the × clear button appears when the input is non-empty; clicking restores the full list', () => {
    setProposal(1, PROPOSAL_P, editWordingProposal);
    setProposal(2, PROPOSAL_Q, editWordingOther);
    renderPane();

    const input = screen.getByTestId('pending-proposals-filter-text');
    act(() => {
      fireEvent.change(input, { target: { value: 'minimum' } });
    });
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(1);

    const clearBtn = screen.getByTestId('pending-proposals-filter-text-clear');
    expect(clearBtn).toBeTruthy();
    act(() => {
      clearBtn.click();
    });
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(2);
    // The button disappears once the input is empty again.
    expect(screen.queryByTestId('pending-proposals-filter-text-clear')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('(d) clicking the "Ready" chip narrows the list to rows whose deriveAllAgree returns ok', () => {
    // Two participants joined; row P has both agreed; row Q has only A.
    const DEBATER_A_LOCAL = '00000000-0000-4000-8000-0000000000d1';
    const DEBATER_B_LOCAL = '00000000-0000-4000-8000-0000000000d2';
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent({
        id: envId('j', 1),
        sessionId: SESSION,
        sequence: 1,
        kind: 'participant-joined',
        actor: DEBATER_A_LOCAL,
        payload: {
          user_id: DEBATER_A_LOCAL,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: '2026-05-16T00:00:00.000Z',
        },
        createdAt: '2026-05-16T00:00:00.000Z',
      });
      useWsStore.getState().applyEvent({
        id: envId('j', 2),
        sessionId: SESSION,
        sequence: 2,
        kind: 'participant-joined',
        actor: DEBATER_B_LOCAL,
        payload: {
          user_id: DEBATER_B_LOCAL,
          role: 'debater-B',
          screen_name: 'B',
          joined_at: '2026-05-16T00:00:00.000Z',
        },
        createdAt: '2026-05-16T00:00:00.000Z',
      });
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(proposalEvent(4, PROPOSAL_Q, classifyNodeValue));
      // Both agree on P's classification.
      useWsStore.getState().applyEvent({
        id: envId('v', 5),
        sessionId: SESSION,
        sequence: 5,
        kind: 'vote',
        actor: DEBATER_A_LOCAL,
        payload: {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_P,
          participant: DEBATER_A_LOCAL,
          choice: 'agree',
          voted_at: '2026-05-16T00:01:05.000Z',
        },
        createdAt: '2026-05-16T00:01:05.000Z',
      });
      useWsStore.getState().applyEvent({
        id: envId('v', 6),
        sessionId: SESSION,
        sequence: 6,
        kind: 'vote',
        actor: DEBATER_B_LOCAL,
        payload: {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_P,
          participant: DEBATER_B_LOCAL,
          choice: 'agree',
          voted_at: '2026-05-16T00:01:05.000Z',
        },
        createdAt: '2026-05-16T00:01:05.000Z',
      });
    });
    renderPane();
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(2);

    const readyChip = screen
      .getAllByTestId('pending-proposals-filter-state')
      .find((c) => c.getAttribute('data-filter-state') === 'ready')!;
    act(() => {
      readyChip.click();
    });
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
    expect(readyChip.getAttribute('aria-pressed')).toBe('true');
  });

  it('(e) clicking the "Disputed" chip narrows to rows with at least one disputed facet', () => {
    act(() => {
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(proposalEvent(2, PROPOSAL_Q, classifyNodeValue));
      // Push a server proposal-status frame that marks P's classification
      // as disputed.
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION,
        proposalId: PROPOSAL_P,
        sequence: 3,
        perFacetStatus: { classification: 'disputed' },
      });
    });
    renderPane();
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(2);

    const disputedChip = screen
      .getAllByTestId('pending-proposals-filter-state')
      .find((c) => c.getAttribute('data-filter-state') === 'disputed')!;
    act(() => {
      disputedChip.click();
    });
    const rows = screen.getAllByTestId('pending-proposal-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });

  it('(f) the filtered-empty paragraph appears when the filter excludes every row; original empty is hidden', () => {
    setProposal(1, PROPOSAL_P, editWordingProposal);
    renderPane();
    expect(screen.getAllByTestId('pending-proposal-row')).toHaveLength(1);

    const input = screen.getByTestId('pending-proposals-filter-text');
    act(() => {
      fireEvent.change(input, { target: { value: 'no-such-text-anywhere' } });
    });
    expect(screen.queryByTestId('pending-proposal-row')).toBeNull();
    expect(screen.getByTestId('pending-proposals-filtered-empty')).toBeTruthy();
    expect(screen.queryByTestId('pending-proposals-pane-empty')).toBeNull();
  });

  it('(g) strip stays visible in default-empty AND filtered-empty states', () => {
    // Default-empty — no proposals at all.
    renderPane();
    expect(screen.getByTestId('pending-proposals-filter-strip')).toBeTruthy();
    expect(screen.getByTestId('pending-proposals-pane-empty')).toBeTruthy();

    // Add a proposal; then filter it out.
    setProposal(1, PROPOSAL_P, editWordingProposal);
    const input = screen.getByTestId('pending-proposals-filter-text');
    act(() => {
      fireEvent.change(input, { target: { value: 'no-such-text-anywhere' } });
    });
    // The strip is still present in the filtered-empty state.
    expect(screen.getByTestId('pending-proposals-filter-strip')).toBeTruthy();
    expect(screen.getByTestId('pending-proposals-filtered-empty')).toBeTruthy();
  });

  it('(h) the existing row test-id contract is unaffected by the strip', () => {
    setProposal(1, PROPOSAL_P, classifyNodeFact);
    renderPane();
    expect(screen.getByTestId('pending-proposal-row')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-kind')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-summary')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-author')).toBeTruthy();
    expect(screen.getByTestId('pending-proposal-row-timestamp')).toBeTruthy();
  });

  it('chip labels resolve via the ICU-select stateChipLabel key', () => {
    renderPane();
    const chips = screen.getAllByTestId('pending-proposals-filter-state');
    // The en-US ICU select arms are All / Ready to commit / Disputed.
    const labels = chips.map((c) => c.textContent);
    expect(labels).toEqual(['All', 'Ready to commit', 'Disputed']);
  });

  it('text-input placeholder + aria-label + clear-button aria-label resolve from the catalog', () => {
    renderPane();
    const input = screen.getByTestId('pending-proposals-filter-text');
    expect(input.getAttribute('placeholder')).toBe('Filter proposals…');
    expect(input.getAttribute('aria-label')).toBe('Filter pending proposals by text');
    act(() => {
      fireEvent.change(input, { target: { value: 'x' } });
    });
    const clearBtn = screen.getByTestId('pending-proposals-filter-text-clear');
    expect(clearBtn.getAttribute('aria-label')).toBe('Clear filter text');
  });
});

describe('PendingProposalsPane — i18n catalog parity', () => {
  const KEYS = [
    'moderator.proposalList.emptyState',
    'moderator.proposalList.paneAriaLabel',
    'moderator.proposalList.rowAriaLabel',
    'moderator.proposalList.systemAuthor',
    'moderator.proposalFilter.textPlaceholder',
    'moderator.proposalFilter.textAriaLabel',
    'moderator.proposalFilter.clearTextAriaLabel',
    'moderator.proposalFilter.stateChipLabel',
    'moderator.proposalFilter.noMatches',
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

// Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
//
// The pane now mounts a per-row commit button inside each
// `<PendingProposalRow>`'s header. These cases pin:
//   (a) disabled baseline — a freshly-proposed row's button is disabled
//       with the right `data-commit-gate-reason` (no votes yet AND no
//       debaters joined → `no-current-participants`);
//   (b) enables when every current debater has voted agree on every
//       facet — pushes `participant-joined` events + a `proposal` event
//       + two `vote` events into the store; asserts the row's button
//       flips to `data-commit-state="enabled"`;
//   (c) click sends the canonical `commit` envelope shape — uses a
//       spied client so the test can inspect the payload;
//   (d) meta-disagreement-marked row's button is disabled with the
//       right reason regardless of vote state.
describe('PendingProposalsPane — commit button per row', () => {
  function joinedEvent(
    seq: number,
    userId: string,
    role: 'moderator' | 'debater-A' | 'debater-B',
  ): Event {
    return {
      id: envId('j', seq),
      sessionId: SESSION,
      sequence: seq,
      kind: 'participant-joined',
      actor: userId,
      payload: {
        user_id: userId,
        role,
        screen_name: `User-${role}`,
        joined_at: '2026-05-16T00:00:00.000Z',
      },
      createdAt: '2026-05-16T00:00:00.000Z',
    };
  }

  function voteEvent(opts: {
    seq: number;
    proposalEnvelopeId: string;
    participant: string;
    choice: 'agree' | 'dispute' | 'withdraw';
  }): Event {
    return {
      id: envId('v', opts.seq),
      sessionId: SESSION,
      sequence: opts.seq,
      kind: 'vote',
      actor: opts.participant,
      payload: {
        target: 'proposal' as const,
        proposal_id: opts.proposalEnvelopeId,
        participant: opts.participant,
        choice: opts.choice as 'agree' | 'dispute',
        voted_at: '2026-05-16T00:01:05.000Z',
      },
      createdAt: '2026-05-16T00:01:05.000Z',
    };
  }

  const DEBATER_A = '00000000-0000-4000-8000-0000000000d1';
  const DEBATER_B = '00000000-0000-4000-8000-0000000000d2';

  it('disabled baseline — a freshly-proposed row has a disabled commit button', () => {
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(proposalEvent(1, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
    const button = screen.getByTestId('commit-button');
    // Disabled because no debaters joined yet → `no-current-participants`
    // wins over `participants-not-voted`.
    expect(button.getAttribute('data-commit-state')).toBe('disabled');
    expect(button.getAttribute('data-commit-gate-reason')).toBe('no-current-participants');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Tooltip is set.
    expect(button.getAttribute('title')).toBeTruthy();
    expect(button.getAttribute('data-proposal-id')).toBe(PROPOSAL_P);
  });

  it('disabled with participants-not-voted reason when debaters have joined but not voted', () => {
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
    });
    renderPane();
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('disabled');
    expect(button.getAttribute('data-commit-gate-reason')).toBe('participants-not-voted');
  });

  it('enables when every current debater has voted agree on every facet', () => {
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 4,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_A,
          choice: 'agree',
        }),
      );
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 5,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_B,
          choice: 'agree',
        }),
      );
    });
    renderPane();
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('enabled');
    expect(button.getAttribute('data-commit-gate-reason')).toBeNull();
    expect(button.getAttribute('aria-disabled')).toBe('false');
    // No tooltip in the enabled state (Decision §3).
    expect(button.getAttribute('title')).toBeNull();
  });

  it('disabled with participants-disagree reason when one debater voted dispute', () => {
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 4,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_A,
          choice: 'agree',
        }),
      );
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 5,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_B,
          choice: 'dispute',
        }),
      );
    });
    renderPane();
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('disabled');
    expect(button.getAttribute('data-commit-gate-reason')).toBe('participants-disagree');
  });

  it('session-not-connected wins as the outer gate regardless of vote state', () => {
    act(() => {
      // Connection is `'idle'` (the default after reset) — anything
      // other than `'open'` triggers the outer gate.
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 4,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_A,
          choice: 'agree',
        }),
      );
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 5,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_B,
          choice: 'agree',
        }),
      );
    });
    renderPane();
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('disabled');
    expect(button.getAttribute('data-commit-gate-reason')).toBe('session-not-connected');
  });

  it('click on a facet-valued row sends the canonical facet-arm commit envelope shape', () => {
    // Per `pf_mod_pending_proposals_pane_facet_keyed` + ADR 0030 §2:
    // a `classify-node` proposal is facet-valued, so its commit button
    // dispatches a `target: 'facet'` payload keyed by
    // `(entity_kind, entity_id, facet)` — the (node, NODE_X, classification)
    // triple here. The proposal id does NOT appear on the wire; the
    // server resolves the candidate via the facet's current proposal slot.
    const sendCalls: Array<{ type: WsMessageType; payload: unknown }> = [];
    const spyClient: WsClient = {
      status: () => 'open',
      connect: () => undefined,
      close: () => undefined,
      killWebSocket: () => undefined,
      send: <T extends WsMessageType>(
        type: T,
        payload: WsMessagePayloadMap[T],
      ): Promise<WsEnvelopeUnion> => {
        sendCalls.push({ type, payload });
        return new Promise<WsEnvelopeUnion>(() => {
          /* never resolves — we only assert the send was made */
        });
      },
      trackSession: () => Promise.resolve(),
      untrackSession: () => Promise.resolve(),
      onEnvelope: () => () => undefined,
      url: '/api/ws',
    };
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 4,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_A,
          choice: 'agree',
        }),
      );
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 5,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_B,
          choice: 'agree',
        }),
      );
    });
    renderPane({ client: spyClient });
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('enabled');
    act(() => {
      button.click();
    });
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0]?.type).toBe('commit');
    const payload = sendCalls[0]?.payload as {
      sessionId: string;
      expectedSequence: number;
      target: 'facet';
      entity_kind: 'node' | 'edge';
      entity_id: string;
      facet: string;
    };
    expect(payload.sessionId).toBe(SESSION);
    expect(payload.target).toBe('facet');
    expect(payload.entity_kind).toBe('node');
    expect(payload.entity_id).toBe(NODE_X);
    expect(payload.facet).toBe('classification');
    // No proposalId on the facet arm — the server resolves the
    // candidate via the facet's current-proposal slot.
    expect((payload as Record<string, unknown>).proposalId).toBeUndefined();
    // After 5 events the high-water mark is sequence 5.
    expect(payload.expectedSequence).toBe(5);
    // Module-scoped in-flight set tracks the facet-arm slot, NOT the
    // proposal id.
    expect(useCommitStore.getState().committing.has(`facet:node:${NODE_X}:classification`)).toBe(
      true,
    );
    expect(useCommitStore.getState().committing.has(PROPOSAL_P)).toBe(false);
    // Button is in the in-flight visual state.
    expect(button.getAttribute('data-commit-state')).toBe('in-flight');
    expect(button.textContent).toBe('Committing…');
  });

  it('click on a structural row sends the canonical proposal-arm commit envelope shape', () => {
    // Per `pf_mod_pending_proposals_pane_facet_keyed` + ADR 0030 §9:
    // structural sub-kinds (decompose / interpretive-split / axiom-mark
    // / annotate / meta-move / break-edge) keep the proposal-keyed
    // commit shape. An `axiom-mark` is a representative structural
    // sub-kind whose unanimity gate excludes the declared participant —
    // exactly the path the pane's commit-gate predicate already covers.
    const sendCalls: Array<{ type: WsMessageType; payload: unknown }> = [];
    const spyClient: WsClient = {
      status: () => 'open',
      connect: () => undefined,
      close: () => undefined,
      killWebSocket: () => undefined,
      send: <T extends WsMessageType>(
        type: T,
        payload: WsMessagePayloadMap[T],
      ): Promise<WsEnvelopeUnion> => {
        sendCalls.push({ type, payload });
        return new Promise<WsEnvelopeUnion>(() => {
          /* never resolves — we only assert the send was made */
        });
      },
      trackSession: () => Promise.resolve(),
      untrackSession: () => Promise.resolve(),
      onEnvelope: () => () => undefined,
      url: '/api/ws',
    };
    const axiomMark: ProposalPayload = {
      kind: 'axiom-mark',
      node_id: NODE_X,
      participant: DEBATER_A,
    };
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      // Proposer is DEBATER_A (matches the axiom-mark `participant`).
      useWsStore
        .getState()
        .applyEvent(proposalEvent(3, PROPOSAL_P, axiomMark, { actor: DEBATER_A }));
      // The declared participant (DEBATER_A) doesn't vote on their own
      // bedrock declaration; DEBATER_B's agreement is sufficient.
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 4,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_B,
          choice: 'agree',
        }),
      );
    });
    renderPane({ client: spyClient, authUserId: DEBATER_A });
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('enabled');
    act(() => {
      button.click();
    });
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0]?.type).toBe('commit');
    const payload = sendCalls[0]?.payload as {
      sessionId: string;
      expectedSequence: number;
      target: 'proposal';
      proposalId: string;
    };
    expect(payload.sessionId).toBe(SESSION);
    expect(payload.target).toBe('proposal');
    expect(payload.proposalId).toBe(PROPOSAL_P);
    // No facet triple on the proposal arm.
    expect((payload as Record<string, unknown>).entity_kind).toBeUndefined();
    expect((payload as Record<string, unknown>).facet).toBeUndefined();
    // After 4 events the high-water mark is sequence 4.
    expect(payload.expectedSequence).toBe(4);
    // Module-scoped in-flight set tracks the proposal-arm slot, NOT
    // any facet slot.
    expect(useCommitStore.getState().committing.has(`proposal:${PROPOSAL_P}`)).toBe(true);
    expect(button.getAttribute('data-commit-state')).toBe('in-flight');
  });

  it('meta-disagreement-marked proposal renders a disabled button with the proposal-meta-disagreement reason', () => {
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      // Push a server `proposal-status` frame with the
      // `meta-disagreement` facet status — the chip + commit gate both
      // read this.
      useWsStore.getState().applyProposalStatus({
        sessionId: SESSION,
        proposalId: PROPOSAL_P,
        sequence: 4,
        perFacetStatus: { classification: 'meta-disagreement' },
      });
    });
    renderPane();
    const button = screen.getByTestId('commit-button');
    expect(button.getAttribute('data-commit-state')).toBe('disabled');
    expect(button.getAttribute('data-commit-gate-reason')).toBe('proposal-meta-disagreement');
  });
});
