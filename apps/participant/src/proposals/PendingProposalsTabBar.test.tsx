// Vitest cases for `<PendingProposalsTabBar>`.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Test layers per ADR 0022 — 6 cases pinning labels, active-tab
//    attribute round-trip, click → setCurrentTab dispatch, badge
//    count + text content.)

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProposalStatusPayload } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { PendingProposalsTabBar } from './PendingProposalsTabBar';
import { useUiStore } from '../stores/uiStore';
import { useWsStore } from '../ws/wsStore';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';

function makePayload(proposalId: string, sequence: number): ProposalStatusPayload {
  return {
    sessionId: SESSION_A,
    proposalId,
    sequence,
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
  useUiStore.setState({ currentTab: 'graph' });
});

function renderBar(): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <PendingProposalsTabBar sessionId={SESSION_A} />
    </I18nProvider>,
  );
}

describe('<PendingProposalsTabBar>', () => {
  it('(a) renders two role="tab" buttons with the en-US labels', () => {
    renderBar();
    const buttons = screen.getAllByRole('tab');
    expect(buttons).toHaveLength(2);
    expect(screen.getByTestId('participant-proposals-tabbar-graph').textContent).toBe('Graph');
    // The proposals tab carries the label + the badge text in the same
    // button; assert the label substring rather than equality.
    const proposalsButton = screen.getByTestId('participant-proposals-tabbar-proposals');
    expect(proposalsButton.textContent).toContain('Proposals');
  });

  it('(b) marks the Graph tab data-active="true" + aria-selected="true" when currentTab is graph', () => {
    renderBar();
    const graph = screen.getByTestId('participant-proposals-tabbar-graph');
    const proposals = screen.getByTestId('participant-proposals-tabbar-proposals');
    expect(graph.getAttribute('data-active')).toBe('true');
    expect(graph.getAttribute('aria-selected')).toBe('true');
    expect(proposals.getAttribute('data-active')).toBe('false');
    expect(proposals.getAttribute('aria-selected')).toBe('false');
  });

  it('(c) clicking the Proposals tab dispatches setCurrentTab("proposals")', () => {
    renderBar();
    expect(useUiStore.getState().currentTab).toBe('graph');
    act(() => {
      fireEvent.click(screen.getByTestId('participant-proposals-tabbar-proposals'));
    });
    expect(useUiStore.getState().currentTab).toBe('proposals');
    // The DOM also reflects the new active tab without re-renders
    // depending on a store-subscription quirk.
    const proposals = screen.getByTestId('participant-proposals-tabbar-proposals');
    expect(proposals.getAttribute('data-active')).toBe('true');
  });

  it('(d) badge data-count is 0 for an empty session', () => {
    renderBar();
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-count')).toBe('0');
  });

  it('(e) badge data-count reflects pendingProposals size after seed', () => {
    useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_A, 1));
    useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_B, 2));
    renderBar();
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-count')).toBe('2');
  });

  it('(f) badge text content matches data-count', () => {
    useWsStore.getState().applyProposalStatus(makePayload(PROPOSAL_A, 1));
    renderBar();
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('data-count')).toBe('1');
  });
});
