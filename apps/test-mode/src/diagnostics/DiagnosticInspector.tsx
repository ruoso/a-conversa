// Read-only structural-diagnostics inspector — the diagnostics the
// methodology engine would surface for the projected state at the current
// scrubber stop.
//
// Refinement: tasks/refinements/replay_test/test_mode_diagnostic_inspector.md
// TaskJuggler: replay_test.test_mode.test_mode_diagnostic_inspector
// ADRs:        0044 (diagnostics fetched from a backend endpoint, not
//                    recomputed client-side — this panel is the thin client),
//              0024 (react-i18next — only the panel chrome is localized; the
//                    raw entity ids and the `kind` discriminant strings are
//                    data, rendered verbatim; Decision §2),
//              0022 (the `data-testid` seams are the pinned regression surface
//                    for the Vitest component test + the e2e).
//
// The third of the four inspector/overlay leaves hanging off the scrubber's
// lifted-position seam, and the first that needs server-computed state at a
// position (Decision §1). A reader, never a writer: it consumes the lifted
// `position` + `sessionId` the scrubber already holds and fetches the
// diagnostics for that position via `useDiagnosticsAtPosition`. No
// `setPosition`; navigation stays single-sourced in the container.
//
// Diagnostics are grouped by severity (Constraint §4): `cycle` /
// `contradiction` are blocking, the rest advisory. An unrecognized future
// kind renders as a generic fallback row (the "other" group) rather than
// crashing the panel.

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { WireCoherencyHint, WireDiagnostic } from '@a-conversa/shell';

import { useDiagnosticsAtPosition } from './useDiagnosticsAtPosition';

export interface DiagnosticInspectorProps {
  /** The session whose diagnostics to read — the fetch key. */
  readonly sessionId: string;
  /** The current scrubber position in event-sequence space (`0..head`). */
  readonly position: number;
}

type Severity = 'blocking' | 'advisory' | 'other';

/** The trivial, stable kind→severity map (Constraint §4). Distinct from the
 *  server-only *detection* layer ADR 0044 keeps server-side: this is a
 *  five-case lookup over already-computed entries, not a re-derivation. An
 *  unrecognized kind falls to `'other'` so it still renders. */
function severityForKind(kind: string): Severity {
  switch (kind) {
    case 'cycle':
    case 'contradiction':
      return 'blocking';
    case 'multi-warrant':
    case 'dangling-claim':
    case 'coherency-hint':
      return 'advisory';
    default:
      return 'other';
  }
}

/** The known top-level kinds that carry a localized chrome label (Decision
 *  §2). Anything else renders only its raw discriminant. */
const LABELLED_KINDS = new Set([
  'cycle',
  'contradiction',
  'multi-warrant',
  'dangling-claim',
  'coherency-hint',
]);

function coherencyHintIds(hint: WireCoherencyHint): readonly string[] {
  switch (hint.kind) {
    case 'incomplete-warrant-missing-bridges-to':
      return [hint.warrantNodeId, hint.dataNodeId];
    case 'incomplete-warrant-missing-bridges-from':
      return [hint.warrantNodeId, hint.claimNodeId];
    case 'self-contradicts':
      return [hint.edgeId, hint.nodeId];
    case 'annotation-of-annotation-chain':
      return [hint.edgeId, hint.sourceAnnotationId, hint.targetAnnotationId, hint.incomingEdgeId];
    case 'self-referential-annotation-contradicts':
      return [hint.edgeId, hint.nodeId, hint.annotationId];
    case 'non-self-referential-annotation-contradicts':
      return [hint.edgeId, hint.nodeId, hint.annotationId, hint.anchorNodeId];
    default:
      return [];
  }
}

/** The affected entity ids for a diagnostic, rendered verbatim (Decision §2). */
function affectedIds(entry: WireDiagnostic): readonly string[] {
  switch (entry.kind) {
    case 'cycle':
      return entry.nodes;
    case 'contradiction':
      return [entry.nodeA, entry.nodeB, ...entry.edges];
    case 'multi-warrant':
      return [entry.dataNodeId, entry.claimNodeId, ...entry.warrantNodeIds];
    case 'dangling-claim':
      return [entry.nodeId];
    case 'coherency-hint':
      return coherencyHintIds(entry.hint);
    default:
      return [];
  }
}

function DiagnosticEntryRow({ entry }: { entry: WireDiagnostic }): ReactElement {
  const { t } = useTranslation();
  const ids = affectedIds(entry);
  const labelled = LABELLED_KINDS.has(entry.kind);

  return (
    <li
      data-testid="test-mode-diagnostics-entry"
      data-kind={entry.kind}
      className="rounded-lg border border-slate-100 px-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        {labelled ? (
          <span className="font-medium text-slate-700">
            {t(`testMode.diagnosticInspector.kind.${entry.kind}`)}
          </span>
        ) : null}
        {/* Raw discriminant, rendered verbatim — data, not UI prose. */}
        <span
          data-testid="test-mode-diagnostics-entry-kind"
          className="font-mono text-xs text-slate-500"
        >
          {entry.kind}
        </span>
      </div>
      {ids.length > 0 ? (
        <p className="mt-1 text-slate-600">
          <span className="text-slate-500">
            {t('testMode.diagnosticInspector.affectedLabel')}:{' '}
          </span>
          {/* Raw entity ids, verbatim (Decision §2). */}
          <span
            data-testid="test-mode-diagnostics-entry-ids"
            className="font-mono text-xs text-slate-800"
          >
            {ids.join(', ')}
          </span>
        </p>
      ) : null}
    </li>
  );
}

function SeverityGroup({
  severity,
  heading,
  entries,
  testid,
}: {
  severity: Severity;
  heading: string;
  entries: readonly WireDiagnostic[];
  testid: string;
}): ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <div data-testid={testid} data-severity={severity} className="px-3 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</h3>
      <ul className="mt-1 space-y-1">
        {entries.map((entry, index) => (
          <DiagnosticEntryRow key={`${entry.kind}-${index}`} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

export function DiagnosticInspector({
  sessionId,
  position,
}: DiagnosticInspectorProps): ReactElement {
  const { t } = useTranslation();
  const { status, diagnostics, retry } = useDiagnosticsAtPosition(sessionId, position);

  const blocking = diagnostics.filter((entry) => severityForKind(entry.kind) === 'blocking');
  const advisory = diagnostics.filter((entry) => severityForKind(entry.kind) === 'advisory');
  const other = diagnostics.filter((entry) => severityForKind(entry.kind) === 'other');

  return (
    <section
      data-testid="test-mode-diagnostics"
      aria-label={t('testMode.diagnosticInspector.regionAriaLabel')}
      className="rounded-2xl border border-slate-200 bg-white"
    >
      <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('testMode.diagnosticInspector.heading')}
      </h2>

      {status === 'loading' ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="test-mode-diagnostics-loading"
          className="px-3 py-4 text-slate-600"
        >
          {t('testMode.diagnosticInspector.loading')}
        </p>
      ) : null}

      {status === 'error' ? (
        <div data-testid="test-mode-diagnostics-error" className="px-3 py-4 text-slate-600">
          <p>{t('testMode.diagnosticInspector.error')}</p>
          <button
            type="button"
            data-testid="test-mode-diagnostics-retry"
            onClick={retry}
            className="mt-2 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            {t('testMode.diagnosticInspector.retry')}
          </button>
        </div>
      ) : null}

      {status === 'ready' && diagnostics.length === 0 ? (
        <div data-testid="test-mode-diagnostics-empty" className="px-3 py-4 text-slate-600">
          <p className="font-medium text-slate-700">
            {t('testMode.diagnosticInspector.emptyTitle')}
          </p>
          <p className="mt-1">{t('testMode.diagnosticInspector.emptyBody')}</p>
        </div>
      ) : null}

      {status === 'ready' && diagnostics.length > 0 ? (
        <div className="divide-y divide-slate-100">
          <SeverityGroup
            severity="blocking"
            testid="test-mode-diagnostics-blocking"
            heading={t('testMode.diagnosticInspector.blockingHeading')}
            entries={blocking}
          />
          <SeverityGroup
            severity="advisory"
            testid="test-mode-diagnostics-advisory"
            heading={t('testMode.diagnosticInspector.advisoryHeading')}
            entries={advisory}
          />
          {other.length > 0 ? (
            <div
              data-testid="test-mode-diagnostics-fallback"
              data-severity="other"
              className="px-3 py-2"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('testMode.diagnosticInspector.otherHeading')}
              </h3>
              <ul className="mt-1 space-y-1">
                {other.map((entry, index) => (
                  <DiagnosticEntryRow key={`${entry.kind}-${index}`} entry={entry} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default DiagnosticInspector;
