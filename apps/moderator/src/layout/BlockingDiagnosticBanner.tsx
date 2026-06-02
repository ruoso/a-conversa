// `<BlockingDiagnosticBanner>` — the global, always-visible blocked-session
// status indicator for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_blocking_diagnostic_banner.md
// Design doc:  docs/moderator-ui.md § F7
//
// The flag pane (`<DiagnosticFlagPane>`) lists every active diagnostic inside a
// collapsible right-sidebar pane. A blocking diagnostic gates the session
// (commit is refused until it resolves), so the blocked state needs a surface
// the moderator cannot lose track of — one that survives collapsing the
// sidebar or going heads-down in a capture flow. This banner is that surface:
// it mounts at the TOP of the operate console (a sibling of `<OperateLayout>`,
// Decision §D1), is present ONLY while ≥1 `blocking`-severity diagnostic is
// active, and is absent otherwise — advisory-only never raises it (Constraint
// §2, Decision §D2).
//
// It REUSES the shipped seams rather than re-deriving (Constraint §3):
//   - blocking detection + the head diagnostic come from the shared
//     `orderActiveDiagnostics(...)` total order (blocking-first), so the
//     banner's head can never drift from the flag pane's focused row;
//   - the head's affected entities come from `affectedEntities(...)` + the
//     same order-preserving `dedupe`;
//   - the review button dispatches the very `requestCanvasFocus(...)` command
//     the flag rows use (consumed by `useCanvasFocusEffect` inside the
//     `<ReactFlowProvider>`), plus `setActiveSidebarPane('diagnostic-flags')`
//     to foreground the inventory pane (a best-effort cue — the pane's
//     expand/collapse is local component state the banner cannot reach,
//     Decision §D4).
//
// ARIA: a polite live region (`role="status"` / `aria-live="polite"`,
// Decision §D3) — it is a steady-state, count-updating indicator, not a
// one-shot alert, so it announces without hijacking the screen reader.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagnosticPayload } from '@a-conversa/shared-types';

import { affectedEntities } from '@a-conversa/shell';

import { useUiStore } from '../stores/uiStore.js';
import { useWsStore } from '../ws/wsStore.js';
import { BLOCKING_PANEL_CLASSES, orderActiveDiagnostics } from './orderActiveDiagnostics.js';

export interface BlockingDiagnosticBannerProps {
  readonly sessionId: string;
}

// Stable empty-map reference for the no-active-diagnostic baseline. Same guard
// the flag pane keeps — without it the selector returns a fresh `Map` per read
// and trips an infinite re-render loop (Zustand strict-equality default).
const EMPTY_ACTIVE_DIAGNOSTICS: ReadonlyMap<string, DiagnosticPayload> = new Map();

/** Stable, order-preserving de-dup. `affectedEntities` may repeat ids (it
 * documents that it does not deduplicate); the focus target wants each once. */
function dedupe(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

export function BlockingDiagnosticBanner(
  props: BlockingDiagnosticBannerProps,
): ReactElement | null {
  const { sessionId } = props;
  const { t } = useTranslation();
  const requestCanvasFocus = useUiStore((state) => state.requestCanvasFocus);
  const setActiveSidebarPane = useUiStore((state) => state.setActiveSidebarPane);
  const activeDiagnostics = useWsStore(
    (state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS,
  );

  // The shared comparator sorts blocking-first, so the blocking diagnostics are
  // the leading prefix: `ordered[0]?.severity === 'blocking'` is the
  // is-blocked predicate, and the blocking count is the leading run's length
  // (Decision §D2). Memoized on the map reference, mirroring the flag pane.
  const ordered = useMemo(() => orderActiveDiagnostics(activeDiagnostics), [activeDiagnostics]);
  const head = ordered[0];

  // Render only when blocked (Constraint §2). Advisory-only — where the head is
  // advisory — returns `null`; the flag pane owns the no-diagnostics empty
  // state, this surface exists only to announce a blocked session.
  if (head === undefined || head.severity !== 'blocking') {
    return null;
  }

  const blockingCount = ordered.filter((d) => d.severity === 'blocking').length;
  const headKindTitle = t(`diagnostics.${head.kind}.title`);

  const affected = affectedEntities(head);
  const affectedNodeIds = dedupe(affected.nodes);
  const affectedEdgeIds = dedupe(affected.edges);

  return (
    <section
      data-testid="blocking-diagnostic-banner"
      role="status"
      aria-live="polite"
      data-blocking-count={blockingCount}
      data-diagnostic-kind={head.kind}
      className={`flex items-center justify-between gap-3 ${BLOCKING_PANEL_CLASSES}`}
    >
      <p data-testid="blocking-diagnostic-banner-message" className="text-sm font-semibold">
        {t('moderator.diagnostic.banner.message', { count: blockingCount })}
      </p>
      {/*
       * The review button doubles as the head-diagnostic display: its visible
       * label is the head's localized kind title (Constraint §4 (b)), and
       * clicking it re-frames the canvas + foregrounds the flags pane
       * (Constraint §5, Decision §D4). No separate button-label catalog key —
       * only `message` and `reviewAria` are scoped under banner.* (Constraint
       * §8); the kind title reuses the existing per-kind `diagnostics.<kind>.title`.
       */}
      <button
        type="button"
        data-testid="blocking-diagnostic-banner-review"
        data-diagnostic-kind-title={headKindTitle}
        aria-label={t('moderator.diagnostic.banner.reviewAria', { title: headKindTitle })}
        onClick={() => {
          requestCanvasFocus({ nodeIds: affectedNodeIds, edgeIds: affectedEdgeIds });
          setActiveSidebarPane('diagnostic-flags');
        }}
        className="shrink-0 rounded border border-rose-400 bg-rose-200 px-2 py-1 text-xs font-semibold text-rose-900"
      >
        {headKindTitle}
      </button>
    </section>
  );
}
