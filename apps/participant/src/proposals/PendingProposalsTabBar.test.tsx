// Vitest cases for `<PendingProposalsTabBar>`.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Test layers per ADR 0022 — 6 cases pinning labels, active-tab
//    attribute round-trip, click → setCurrentTab dispatch, badge
//    count + text content.)

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Event } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { PendingProposalsTabBar } from './PendingProposalsTabBar';
import { useUiStore } from '../stores/uiStore';
import { useWsStore } from '../ws/wsStore';

const SESSION_A = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_B = '00000000-0000-4000-8000-0000000000a2';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const NODE_Y = '00000000-0000-4000-8000-00000000000b';
const ACTOR = '11112222-3333-4444-5555-666677778888';

function classifyProposalEvent(seq: number, envelopeId: string, nodeId: string): Event {
  return {
    id: envelopeId,
    sessionId: SESSION_A,
    sequence: seq,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: { kind: 'classify-node', node_id: nodeId, classification: 'fact' },
    },
    createdAt: '2026-05-25T00:00:00.000Z',
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
  it('(a) renders three role="tab" buttons with the en-US labels', () => {
    renderBar();
    const buttons = screen.getAllByRole('tab');
    expect(buttons).toHaveLength(3);
    expect(screen.getByTestId('participant-proposals-tabbar-graph').textContent).toBe('Graph');
    expect(screen.getByTestId('participant-proposals-tabbar-my-agreements').textContent).toBe(
      'My agreements',
    );
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

  it('(e) badge data-count reflects the surviving-proposals count after seeding `proposal` events', () => {
    useWsStore.getState().applyEvent(classifyProposalEvent(1, PROPOSAL_A, NODE_X));
    useWsStore.getState().applyEvent(classifyProposalEvent(2, PROPOSAL_B, NODE_Y));
    renderBar();
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-count')).toBe('2');
  });

  it('(f) badge text content matches data-count', () => {
    useWsStore.getState().applyEvent(classifyProposalEvent(1, PROPOSAL_A, NODE_X));
    renderBar();
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('data-count')).toBe('1');
  });

  // -----------------------------------------------------------------
  // New-proposal-arrival flash — added by
  // `participant_ui.part_voting.part_proposal_notification`.
  // Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
  // -----------------------------------------------------------------

  it('(g) badge data-flashing defaults to "false" when no isFlashing prop is passed', () => {
    renderBar();
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-flashing')).toBe('false');
    expect(badge.className.includes('animate-pulse')).toBe(false);
  });

  it('(h) badge data-flashing="true" + motion-safe:animate-pulse class when isFlashing prop is true', () => {
    render(
      <I18nProvider i18n={i18n}>
        <PendingProposalsTabBar sessionId={SESSION_A} isFlashing />
      </I18nProvider>,
    );
    const badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-flashing')).toBe('true');
    expect(badge.className).toContain('motion-safe:animate-pulse');
    expect(badge.className).toContain('ring-2');
    expect(badge.className).toContain('ring-amber-500/80');
  });

  // -----------------------------------------------------------------
  // Third tab — added by `participant_ui.part_withdraw.part_my_agreements_view`.
  // Refinement: tasks/refinements/participant-ui/part_my_agreements_view.md
  // -----------------------------------------------------------------

  it('(j) the my-agreements tab is visible with the en-US label and inactive by default', () => {
    renderBar();
    const tab = screen.getByTestId('participant-proposals-tabbar-my-agreements');
    expect(tab.textContent).toBe('My agreements');
    expect(tab.getAttribute('data-active')).toBe('false');
    expect(tab.getAttribute('aria-selected')).toBe('false');
  });

  it('(k) clicking the my-agreements tab dispatches setCurrentTab("my-agreements")', () => {
    renderBar();
    expect(useUiStore.getState().currentTab).toBe('graph');
    act(() => {
      fireEvent.click(screen.getByTestId('participant-proposals-tabbar-my-agreements'));
    });
    expect(useUiStore.getState().currentTab).toBe('my-agreements');
    const tab = screen.getByTestId('participant-proposals-tabbar-my-agreements');
    expect(tab.getAttribute('data-active')).toBe('true');
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('(i) badge data-flashing flips back to "false" when isFlashing prop drops back to false', () => {
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <PendingProposalsTabBar sessionId={SESSION_A} isFlashing />
      </I18nProvider>,
    );
    let badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-flashing')).toBe('true');
    rerender(
      <I18nProvider i18n={i18n}>
        <PendingProposalsTabBar sessionId={SESSION_A} isFlashing={false} />
      </I18nProvider>,
    );
    badge = screen.getByTestId('participant-proposals-tabbar-badge');
    expect(badge.getAttribute('data-flashing')).toBe('false');
    expect(badge.className.includes('animate-pulse')).toBe(false);
  });
});
