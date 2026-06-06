// `<ParticipantTopTabBar>` — top-of-main two-button tab strip for the
// participant operate route.
//
// Refinement: tasks/refinements/participant-ui/part_proposals_tab.md
//   (Decision §1 — strip lives at top of `<participant-main>`, not in
//   the chrome; Decision §2 — badge always renders even at count 0;
//   Decision §3 — count semantic is *total* pending proposals.)
//
// The buttons are real `<button type="button">` so keyboard focus +
// space/enter activation work without extra handlers. `role="tablist"`
// + `role="tab"` + `aria-selected` is the WAI-ARIA tab pattern.

import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore, type ParticipantTab } from '../stores/uiStore';

import { usePendingProposalsCount } from './usePendingProposalsCount';

export interface ParticipantTopTabBarProps {
  sessionId: string;
  /**
   * Transient new-proposal-arrival flag threaded down from
   * `<OperateRoute>`'s `useNewProposalArrival(sessionId)` call (per
   * Decision §1 of `part_proposal_notification`: a single hook lives
   * at the route, the badge + the graph both read from its output).
   * `data-flashing` is emitted as the explicit `"true"` / `"false"`
   * sentinel pair (Constraints — Playwright + Vitest probes match
   * `[data-flashing="true"]` without absence-of-attribute ambiguity).
   * Optional so existing test-mounts that do not exercise the arrival
   * flash stay diff-stable.
   */
  isFlashing?: boolean;
}

export function ParticipantTopTabBar({
  sessionId,
  isFlashing = false,
}: ParticipantTopTabBarProps): ReactElement {
  const { t } = useTranslation();
  const currentTab = useUiStore((s) => s.currentTab);
  const setCurrentTab = useUiStore((s) => s.setCurrentTab);
  const count = usePendingProposalsCount(sessionId);
  return (
    <div
      data-testid="participant-proposals-tabbar"
      role="tablist"
      className="flex h-10 items-center gap-1 border-b border-slate-200 bg-white px-4"
    >
      <TabButton tab="graph" active={currentTab === 'graph'} onSelect={setCurrentTab}>
        {t('participant.proposalsTab.graphLabel')}
      </TabButton>
      <TabButton
        tab="my-agreements"
        active={currentTab === 'my-agreements'}
        onSelect={setCurrentTab}
      >
        {t('participant.proposalsTab.myAgreementsLabel')}
      </TabButton>
      <TabButton tab="proposals" active={currentTab === 'proposals'} onSelect={setCurrentTab}>
        {t('participant.proposalsTab.proposalsLabel')}
        <span
          data-testid="participant-proposals-tabbar-badge"
          data-count={count}
          data-flashing={isFlashing ? 'true' : 'false'}
          className={`ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-200 px-1.5 text-xs font-medium text-slate-700${
            isFlashing ? ' motion-safe:animate-pulse ring-2 ring-amber-500/80' : ''
          }`}
        >
          {count}
        </span>
      </TabButton>
      <TabButton tab="history" active={currentTab === 'history'} onSelect={setCurrentTab}>
        {t('participant.proposalsTab.historyLabel')}
      </TabButton>
    </div>
  );
}

interface TabButtonProps {
  tab: ParticipantTab;
  active: boolean;
  onSelect: (tab: ParticipantTab) => void;
  children: ReactNode;
}

function TabButton({ tab, active, onSelect, children }: TabButtonProps): ReactElement {
  return (
    <button
      type="button"
      data-testid={`participant-proposals-tabbar-${tab}`}
      data-active={active}
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab)}
      className={`flex h-8 items-center rounded-md px-3 text-sm font-medium ${
        active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
