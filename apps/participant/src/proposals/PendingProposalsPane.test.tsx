// Vitest cases for `<PendingProposalsPane>`.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Test layers per ADR 0022 — 4 cases pinning the empty-state /
//    non-empty branches + the ARIA contract sibling leaves consume.)

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProposalStatusPayload } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { PendingProposalsPane } from './PendingProposalsPane';
import { useWsStore } from '../ws/wsStore';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';

function makePayload(): ProposalStatusPayload {
  return {
    sessionId: SESSION_A,
    proposalId: PROPOSAL_A,
    sequence: 1,
    perFacetStatus: { 'facet-a': 'pending' },
  };
}

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

function renderPane(): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <PendingProposalsPane sessionId={SESSION_A} />
    </I18nProvider>,
  );
}

describe('<PendingProposalsPane>', () => {
  it('(a) renders the empty-state when the session is missing', () => {
    renderPane();
    expect(screen.getByTestId('participant-pending-proposals-pane')).toBeTruthy();
    const empty = screen.getByTestId('participant-pending-proposals-pane-empty');
    expect(empty.textContent).toBe('No pending proposals');
    expect(screen.queryByTestId('participant-pending-proposals-pane-list')).toBeNull();
  });

  it('(b) renders the empty-state when pendingProposals is the explicit empty map', () => {
    useWsStore.getState().applyProposalStatus(makePayload());
    useWsStore.setState((state) => ({
      sessionState: {
        ...state.sessionState,
        [SESSION_A]: {
          ...state.sessionState[SESSION_A]!,
          pendingProposals: {},
        },
      },
    }));
    renderPane();
    expect(screen.getByTestId('participant-pending-proposals-pane-empty')).toBeTruthy();
    expect(screen.queryByTestId('participant-pending-proposals-pane-list')).toBeNull();
  });

  it('(c) hides the empty-state and renders the list container when pendingProposals is non-empty', () => {
    useWsStore.getState().applyProposalStatus(makePayload());
    renderPane();
    expect(screen.queryByTestId('participant-pending-proposals-pane-empty')).toBeNull();
    expect(screen.getByTestId('participant-pending-proposals-pane-list')).toBeTruthy();
  });

  it('(d) exposes role="tabpanel" + aria-live="polite" on the container', () => {
    renderPane();
    const pane = screen.getByTestId('participant-pending-proposals-pane');
    expect(pane.getAttribute('role')).toBe('tabpanel');
    expect(pane.getAttribute('aria-live')).toBe('polite');
  });
});
