// `<RightSidebar>` — stacked sub-pane scaffold for the moderator's
// right sidebar slot.
//
// Refinement: tasks/refinements/moderator-ui/mod_right_sidebar.md
// Design doc: docs/moderator-ui.md (Layout (sketch))
//
// The sidebar holds three named sub-panes that downstream tasks fill:
//
//   - pending-proposals -> mod_pending_proposals_pane
//   - diagnostic-flags  -> mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane
//   - change-history    -> mod_change_history_pane
//
// Each pane is a `<section role="region">` with a header `<button>` that
// toggles `aria-expanded`. Multiple panes may be expanded at once — the
// "stacked" name in the design doc means they live as a stack inside the
// sidebar, not that they accordion. `uiStore.activeSidebarPane` tracks
// the currently-foregrounded pane (clicked-most-recently); the matching
// header gets a `bg-slate-200` highlight. Independence between expand /
// collapse and active-foreground lets downstream tasks decide their own
// foreground semantics (scroll-to, banner, etc.) without forcing the
// other panes to disappear.
//
// The component itself is content-free — each pane body renders either
// its slot prop or a localized "coming soon" placeholder. Downstream
// tasks set the slot prop to mount real content.

import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore, type SidebarPane } from '../stores/index.js';

export interface RightSidebarProps {
  /** Slot for the pending-proposals pane (filled by mod_pending_proposals_pane). */
  pendingProposalsSlot?: ReactNode;
  /** Slot for the diagnostic-flags pane (filled by mod_diagnostic_flag_pane). */
  diagnosticFlagsSlot?: ReactNode;
  /** Slot for the change-history pane (filled by mod_change_history_pane). */
  changeHistorySlot?: ReactNode;
}

interface PaneDef {
  /** Stable `SidebarPane` key, also used for the `data-testid` suffix. */
  key: SidebarPane;
  /** Catalog key for the pane's header title. */
  titleKey: string;
  /** The slot's content for this pane (or `undefined` if not filled yet). */
  slot: ReactNode | undefined;
}

export function RightSidebar(props: RightSidebarProps): ReactElement {
  const { t } = useTranslation();
  const activeSidebarPane = useUiStore((state) => state.activeSidebarPane);
  const setActiveSidebarPane = useUiStore((state) => state.setActiveSidebarPane);

  // Stable id prefix per mounted instance so `aria-labelledby` /
  // `aria-controls` references are unique across the document even if
  // the sidebar is ever rendered twice (e.g. snapshot side-by-side view
  // someday). `useId` ships with React 18+.
  const idPrefix = useId();

  // Each pane has its own expand/collapse state with default-expanded
  // (downstream content visible the moment it lands). The state is
  // local to the component; nothing persists across navigation.
  const [expanded, setExpanded] = useState<Record<SidebarPane, boolean>>({
    'pending-proposals': true,
    'diagnostic-flags': true,
    'change-history': true,
  });

  const panes: ReadonlyArray<PaneDef> = [
    {
      key: 'pending-proposals',
      titleKey: 'moderator.rightSidebar.panes.pendingProposals.title',
      slot: props.pendingProposalsSlot,
    },
    {
      key: 'diagnostic-flags',
      titleKey: 'moderator.rightSidebar.panes.diagnosticFlags.title',
      slot: props.diagnosticFlagsSlot,
    },
    {
      key: 'change-history',
      titleKey: 'moderator.rightSidebar.panes.changeHistory.title',
      slot: props.changeHistorySlot,
    },
  ];

  function togglePane(key: SidebarPane): void {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    // Clicking a header also foregrounds the pane via the ui store so
    // downstream tasks (banner / scroll-to / shortcut) can react. This
    // is independent from expand/collapse — collapsing the active pane
    // keeps it active until another pane's header is clicked.
    setActiveSidebarPane(key);
  }

  return (
    <div data-testid="operate-right-sidebar-stack" className="flex h-full flex-col">
      {panes.map((pane) => {
        const isExpanded = expanded[pane.key];
        const isActive = activeSidebarPane === pane.key;
        const headerId = `${idPrefix}-header-${pane.key}`;
        const bodyId = `${idPrefix}-body-${pane.key}`;
        const headerBg = isActive ? 'bg-slate-200' : 'bg-slate-100';
        return (
          <section
            key={pane.key}
            role="region"
            aria-labelledby={headerId}
            data-testid={`right-sidebar-pane-${pane.key}`}
            data-active={isActive ? 'true' : 'false'}
            className="border-b border-slate-200 last:border-b-0"
          >
            <h2 className="m-0">
              <button
                id={headerId}
                type="button"
                data-testid={`right-sidebar-pane-header-${pane.key}`}
                aria-expanded={isExpanded}
                aria-controls={bodyId}
                aria-label={t('moderator.rightSidebar.toggleAria', { expanded: isExpanded })}
                onClick={() => {
                  togglePane(pane.key);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-900 ${headerBg} hover:bg-slate-200`}
              >
                <span data-testid={`right-sidebar-pane-title-${pane.key}`}>{t(pane.titleKey)}</span>
                <span aria-hidden="true" className="ml-2 text-slate-500">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </button>
            </h2>
            {isExpanded ? (
              <div
                id={bodyId}
                data-testid={`right-sidebar-pane-body-${pane.key}`}
                className="px-3 py-2 text-sm text-slate-700"
              >
                {pane.slot ?? (
                  <p
                    data-testid={`right-sidebar-pane-placeholder-${pane.key}`}
                    className="italic text-slate-500"
                  >
                    {t('moderator.rightSidebar.emptyPanePlaceholder')}
                  </p>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
