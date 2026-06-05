// Read-only "what changed at this step" panel — the fourth scrubber sibling.
//
// Refinement: tasks/refinements/replay_test/test_mode_changed_highlights.md
// TaskJuggler: replay_test.test_mode.test_mode_changed_highlights
// ADRs:        0039 (graph-view package — the canonical `projectGraph` whose
//                    output this diffs; the panel never re-interprets
//                    `event.kind`, Decision §2),
//              0043 (the lifted-position seam this reads, never writes),
//              0024 (react-i18next — only the section chrome is localized;
//                    element ids and changed-field names are data, verbatim),
//              0022 (the `data-testid` seams are the pinned regression
//                    surface for the Vitest component test + the e2e),
//              0040 (axe — the section carries an `aria-label` and the
//                    scrollable body stays keyboard-reachable).
//
// Mirrors `EventInspector` (Decision §1): `{ events, position }` props, a
// `<section>` with a localized heading and stable `data-testid` seams, a
// baseline branch for `position 0`, and no `setPosition`. At position `p` it
// projects the prefixes `[0..p-1]` and `[0..p]` through `projectGraph` and
// renders the structural diff (Constraint §2/§6) — two full re-walks per
// stop, memoized on `[events, position]`, which §6 accepts for design-
// iteration session sizes.

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Event } from '@a-conversa/shared-types';
import {
  projectGraph,
  type AudienceEdgeElement,
  type AudienceNodeElement,
} from '@a-conversa/graph-view';

import { diffProjection, isEmptyDiff, type ChangedElement } from './diffProjection';

export interface ChangeHighlightsProps {
  /** The full ascending event log (from `useSessionEventLog`). */
  readonly events: readonly Event[];
  /** The current scrubber position in event-sequence space (`0..head`). */
  readonly position: number;
}

type AnyElement = AudienceNodeElement | AudienceEdgeElement;

/** A non-empty added/removed bucket: a labelled list of element ids. */
function ElementBucket({
  testId,
  label,
  elements,
}: {
  readonly testId: string;
  readonly label: string;
  readonly elements: readonly AnyElement[];
}): ReactElement | null {
  if (elements.length === 0) {
    return null;
  }
  return (
    <div data-testid={testId} className="px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {elements.map((element) => (
          <li
            key={element.data.id}
            data-testid={`${testId}-item`}
            className="font-mono text-xs text-slate-800"
          >
            {element.data.id}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A non-empty changed bucket: each id with its touched `data` field names. */
function ChangedBucket({
  testId,
  label,
  changes,
}: {
  readonly testId: string;
  readonly label: string;
  readonly changes: readonly ChangedElement<AnyElement>[];
}): ReactElement | null {
  if (changes.length === 0) {
    return null;
  }
  return (
    <div data-testid={testId} className="px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ul className="mt-1 space-y-1">
        {changes.map((change) => (
          <li key={change.id} data-testid={`${testId}-item`} className="text-xs text-slate-800">
            <span className="font-mono text-slate-900">{change.id}</span>{' '}
            {/* Changed-field names are data (Constraint §7) — rendered verbatim. */}
            <span data-testid={`${testId}-fields`} className="font-mono text-slate-500">
              {change.changedFields.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChangeHighlights({ events, position }: ChangeHighlightsProps): ReactElement {
  const { t } = useTranslation();

  // Constraint §6: re-project both prefixes off the same `events` prop,
  // memoized on `[events, position]`. The after-prefix is `sequence <=
  // position`; the before-prefix is `sequence <= position - 1` (empty at
  // `position 1`, so the first event's whole projection reads as added —
  // Constraint §5). At `position 0` there is no before, so we short-circuit
  // to the baseline branch and never project.
  const diff = useMemo(() => {
    if (position <= 0) {
      return null;
    }
    const beforeEvents = events.filter((event) => event.sequence <= position - 1);
    const afterEvents = events.filter((event) => event.sequence <= position);
    return diffProjection(projectGraph(beforeEvents), projectGraph(afterEvents));
  }, [events, position]);

  return (
    <section
      data-testid="test-mode-changes"
      aria-label={t('testMode.changes.regionAriaLabel')}
      className="rounded-2xl border border-slate-200 bg-white"
    >
      <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('testMode.changes.heading')}
      </h2>

      {diff === null ? (
        // Baseline (`position 0`): no before-state exists (Constraint §5).
        <div data-testid="test-mode-changes-baseline" className="px-3 py-4 text-slate-600">
          <p className="font-medium text-slate-700">{t('testMode.changes.baselineTitle')}</p>
          <p className="mt-1">{t('testMode.changes.baselineBody')}</p>
        </div>
      ) : isEmptyDiff(diff) ? (
        // A step the projector treats as a graph no-op (e.g. a participant
        // join). Honest empty readout — no buckets, no false "changed" claim.
        <div data-testid="test-mode-changes-empty" className="px-3 py-4 text-slate-600">
          <p className="font-medium text-slate-700">{t('testMode.changes.emptyTitle')}</p>
          <p className="mt-1">{t('testMode.changes.emptyBody')}</p>
        </div>
      ) : (
        <div
          tabIndex={0}
          aria-label={t('testMode.changes.heading')}
          className="max-h-80 divide-y divide-slate-100 overflow-auto"
        >
          <ElementBucket
            testId="test-mode-changes-nodes-added"
            label={t('testMode.changes.nodesAddedLabel')}
            elements={diff.nodesAdded}
          />
          <ChangedBucket
            testId="test-mode-changes-nodes-changed"
            label={t('testMode.changes.nodesChangedLabel')}
            changes={diff.nodesChanged}
          />
          <ElementBucket
            testId="test-mode-changes-nodes-removed"
            label={t('testMode.changes.nodesRemovedLabel')}
            elements={diff.nodesRemoved}
          />
          <ElementBucket
            testId="test-mode-changes-edges-added"
            label={t('testMode.changes.edgesAddedLabel')}
            elements={diff.edgesAdded}
          />
          <ChangedBucket
            testId="test-mode-changes-edges-changed"
            label={t('testMode.changes.edgesChangedLabel')}
            changes={diff.edgesChanged}
          />
          <ElementBucket
            testId="test-mode-changes-edges-removed"
            label={t('testMode.changes.edgesRemovedLabel')}
            elements={diff.edgesRemoved}
          />
        </div>
      )}
    </section>
  );
}

export default ChangeHighlights;
