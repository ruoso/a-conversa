// `<MyAgreementsPane>` — participant "My agreements" history tab pane.
//
// Refinement: tasks/refinements/participant-ui/part_my_agreements_view.md
//
// A read-only chronologically-ordered list of `(entity, facet)` pairs
// the current participant has voted `agree` on, with a per-row status
// badge reflecting the facet's *current* status. Each row is a
// `<button>` whose tap navigates the user back to the graph view with
// the underlying entity selected — the canonical withdraw surface
// (per ADR 0030 §10 + `pf_part_withdraw_agreement_action`) is the
// detail panel that mounts on selection; the my-agreements pane is the
// retrospective audit affordance, not a parallel withdraw surface.
//
// Decision §1 mirrors the proposals-pane shape: pure selector +
// co-located row + `useMemo` + barrel export, no shell extraction in v1.
// Decision §3 pins the read-only posture (no inline withdraw button).
// Decision §4 pins the tap-to-navigate via existing selection-store +
// ui-store seams (no router-level state).

import { useCallback, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Event } from '@a-conversa/shared-types';
import { formatRelativeTime } from '@a-conversa/i18n-catalogs';

import { useWsStore } from '../ws/wsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useUiStore } from '../stores/uiStore';
import type { FacetStatusIndex } from '../graph/facetStatus';
import {
  derivePersonalAgreements,
  EMPTY_PERSONAL_AGREEMENTS,
  type PersonalAgreementRow,
} from './derivePersonalAgreements';

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export interface MyAgreementsPaneProps {
  readonly sessionId: string;
  readonly currentParticipantId: string;
  /**
   * The route's already-paid-per-frame per-facet status index. Threaded
   * as a prop so this pane consumes the same memo the graph + detail
   * panel share (no second `computeFacetStatuses` invocation).
   */
  readonly facetStatusIndex: FacetStatusIndex;
  /**
   * Deterministic-time injection seam for the relative-time formatter.
   * Tests pass a fixed value; production callers omit it and the row
   * captures `Date.now()` at render time. Same pattern as the
   * predecessor pane.
   */
  readonly nowMsOverride?: number;
}

export function MyAgreementsPane({
  sessionId,
  currentParticipantId,
  facetStatusIndex,
  nowMsOverride,
}: MyAgreementsPaneProps): ReactElement {
  const { t } = useTranslation();
  const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const rows = useMemo(
    () =>
      events.length === 0
        ? EMPTY_PERSONAL_AGREEMENTS
        : derivePersonalAgreements(events, currentParticipantId, facetStatusIndex),
    [events, currentParticipantId, facetStatusIndex],
  );
  const nowMs = nowMsOverride ?? Date.now();
  const select = useSelectionStore((s) => s.select);
  const setCurrentTab = useUiStore((s) => s.setCurrentTab);
  const onRowTap = useCallback(
    (entityKind: 'node' | 'edge', entityId: string): void => {
      select({ kind: entityKind, id: entityId });
      setCurrentTab('graph');
    },
    [select, setCurrentTab],
  );
  return (
    <section
      data-testid="participant-my-agreements-pane"
      role="tabpanel"
      aria-live="polite"
      aria-label={t('participant.myAgreementsPane.paneAriaLabel')}
      className="flex h-full w-full flex-col overflow-auto bg-white"
    >
      {rows.length === 0 ? (
        <div
          data-testid="participant-my-agreements-pane-empty"
          className="flex h-full w-full items-center justify-center p-6 text-sm text-slate-500"
        >
          {t('participant.myAgreementsPane.emptyState')}
        </div>
      ) : (
        <ul
          data-testid="participant-my-agreements-pane-list"
          role="list"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {rows.map((row) => (
            <MyAgreementsRow key={row.voteEventId} row={row} nowMs={nowMs} onTap={onRowTap} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MyAgreementsRow({
  row,
  nowMs,
  onTap,
}: {
  readonly row: PersonalAgreementRow;
  readonly nowMs: number;
  readonly onTap: (entityKind: 'node' | 'edge', entityId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const statusLabel = t(`methodology.facetState.${row.currentStatus}`);
  const facetLabel = t(`methodology.facet.${row.facet}`);
  const entityLabel = `${row.entityKind} ${row.entityId.slice(0, 8)}`;
  const ago = relativeTimeFor(row.agreedAtCreatedAt, nowMs);
  return (
    <li
      data-testid="participant-my-agreements-row"
      data-vote-event-id={row.voteEventId}
      data-entity-kind={row.entityKind}
      data-entity-id={row.entityId}
      data-facet={row.facet}
      data-facet-status={row.currentStatus}
      className="flex flex-col rounded-md border border-slate-100 bg-white"
    >
      <button
        type="button"
        onClick={() => onTap(row.entityKind, row.entityId)}
        className="flex w-full flex-row items-center gap-2 px-3 py-2 text-left"
      >
        <span
          data-testid="participant-my-agreements-row-status"
          className="inline-flex h-5 items-center rounded-sm bg-slate-100 px-2 text-xs font-medium text-slate-700"
        >
          {statusLabel}
        </span>
        <span
          data-testid="participant-my-agreements-row-entity"
          className="text-xs font-mono text-slate-500"
        >
          {entityLabel}
        </span>
        <span data-testid="participant-my-agreements-row-facet" className="text-xs text-slate-600">
          {facetLabel}
        </span>
        <span
          data-testid="participant-my-agreements-row-value"
          className="flex-1 truncate text-sm text-slate-800"
        >
          {row.candidateValue}
        </span>
        <span
          data-testid="participant-my-agreements-row-timestamp"
          className="text-xs text-slate-500"
        >
          {ago}
        </span>
      </button>
    </li>
  );
}

function relativeTimeFor(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return createdAt;
  const secondsAgo = Math.round((nowMs - createdMs) / 1000);
  return formatRelativeTime(-secondsAgo, 'second');
}
