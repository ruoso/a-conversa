// Read-only event inspector — the single event at the current scrubber stop.
//
// Refinement: tasks/refinements/replay_test/test_mode_event_inspector.md
// TaskJuggler: replay_test.test_mode.test_mode_event_inspector
// ADRs:        0021 (event envelope — the fields rendered here),
//              0043 (apps are leaf bundles — the moderator semantic-summary
//                    helper is deliberately NOT reused; Decision §2),
//              0024 (react-i18next — only the panel chrome is localized; the
//                    raw `kind` discriminant + payload field names are data,
//                    rendered verbatim),
//              0022 (the `data-testid` seams are the pinned regression
//                    surface for the Vitest component test + the e2e).
//
// First of the four inspector/overlay leaves hanging off the scrubber's
// lifted-position seam (Decision §1). A reader, never a writer: it consumes
// the lifted `position` + `events` the scrubber already holds and resolves
// the one event at the stop with `events.find((e) => e.sequence === position)`
// — `undefined` at the pre-history baseline (`position 0`), exactly one event
// for `1..head`. No `setPosition`; navigation stays single-sourced in the
// container (Decision §1, §3).

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { Event } from '@a-conversa/shared-types';

export interface EventInspectorProps {
  /** The full ascending event log (from `useSessionEventLog`). */
  readonly events: readonly Event[];
  /** The current scrubber position in event-sequence space (`0..head`). */
  readonly position: number;
}

export function EventInspector({ events, position }: EventInspectorProps): ReactElement {
  const { t } = useTranslation();

  // Resolve the single event at this stop by sequence equality (Constraint
  // §2). `undefined` at the pre-history baseline (`position 0`), where no
  // event has sequence 0.
  const event = events.find((candidate) => candidate.sequence === position);

  return (
    <section
      data-testid="test-mode-inspector"
      aria-label={t('testMode.inspector.regionAriaLabel')}
      className="rounded-2xl border border-slate-200 bg-white"
    >
      <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('testMode.inspector.heading')}
      </h2>

      {event === undefined ? (
        <div data-testid="test-mode-inspector-baseline" className="px-3 py-4 text-slate-600">
          <p className="font-medium text-slate-700">{t('testMode.inspector.baselineTitle')}</p>
          <p className="mt-1">{t('testMode.inspector.baselineBody')}</p>
        </div>
      ) : (
        <div className="px-3 py-3">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 tabular-nums">
            <dt className="font-medium text-slate-500">{t('testMode.inspector.sequenceLabel')}</dt>
            <dd data-testid="test-mode-inspector-sequence" className="text-slate-900">
              {event.sequence}
            </dd>

            <dt className="font-medium text-slate-500">{t('testMode.inspector.kindLabel')}</dt>
            {/* Raw discriminant, rendered verbatim — data, not UI prose. */}
            <dd data-testid="test-mode-inspector-kind" className="font-mono text-slate-900">
              {event.kind}
            </dd>

            <dt className="font-medium text-slate-500">{t('testMode.inspector.actorLabel')}</dt>
            <dd data-testid="test-mode-inspector-actor" className="font-mono text-slate-900">
              {event.actor === null ? t('testMode.inspector.systemActor') : event.actor}
            </dd>

            <dt className="font-medium text-slate-500">{t('testMode.inspector.createdAtLabel')}</dt>
            <dd data-testid="test-mode-inspector-createdAt" className="font-mono text-slate-900">
              {event.createdAt}
            </dd>

            <dt className="font-medium text-slate-500">{t('testMode.inspector.idLabel')}</dt>
            <dd data-testid="test-mode-inspector-id" className="font-mono text-slate-900">
              {event.id}
            </dd>

            <dt className="font-medium text-slate-500">{t('testMode.inspector.sessionIdLabel')}</dt>
            <dd data-testid="test-mode-inspector-sessionId" className="font-mono text-slate-900">
              {event.sessionId}
            </dd>
          </dl>

          <p className="mt-3 font-medium text-slate-500">{t('testMode.inspector.payloadLabel')}</p>
          {/* The honest full view for a debugging tool (Decision §2): the raw
              payload verbatim. `tabIndex={0}` keeps the scrollable block
              keyboard-reachable (Constraint §7). */}
          <pre
            data-testid="test-mode-inspector-payload"
            tabIndex={0}
            aria-label={t('testMode.inspector.payloadLabel')}
            className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-800"
          >
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}

export default EventInspector;
