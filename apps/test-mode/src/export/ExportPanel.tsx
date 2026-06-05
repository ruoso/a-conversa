// Export panel — pulls the server-authoritative projected state at the
// current scrubber position out of the browser as a readable + downloadable
// JSON envelope.
//
// Refinement: tasks/refinements/replay_test/test_mode_export_position.md
// TaskJuggler: replay_test.test_mode.test_mode_export_position
// ADRs:        0043 (the read position speaks the same `0..head` sequence
//                    space the endpoint accepts),
//              0024 (react-i18next — only the panel chrome is localized; the
//                    projection JSON is data, rendered verbatim; Constraint
//                    §6),
//              0022 (the `data-testid` seams are the pinned regression
//                    surface for the Vitest component test + the e2e).
//
// The fourth and last reader-only sibling hanging off the scrubber's lifted
// position seam, beside the three shipped inspector panels (Decision §4). A
// reader, never a writer: it consumes the lifted `position` + `sessionId`,
// never `setPosition`; navigation stays single-sourced in the container.
//
// Where the scrubber *renders* its graph client-side from the in-memory
// event prefix (no per-step round-trip), the export is the one place that
// wants the canonical projection the server would compute, so it fetches
// `get_at_position` rather than re-serializing the client view-model
// (Decision §1). The envelope is serialized verbatim — the readout is the
// always-present, selectable preview; the download is the load-bearing
// "get the data out" affordance (Decision §3).

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { type StateAtPosition, useStateAtPosition } from './useStateAtPosition';

export interface ExportPanelProps {
  /** The session whose state to export — the fetch key. */
  readonly sessionId: string;
  /** The current scrubber position in event-sequence space (`0..head`). */
  readonly position: number;
}

/** Serialize the envelope to a file and trigger a browser download via the
 *  standard `Blob` → object-URL → anchor-`download` → revoke idiom (the
 *  one "get-data-out" mechanism; Decision §3). */
function downloadEnvelope(state: StateAtPosition): void {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `session-${state.sessionId}-position-${String(state.sequence)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function ExportPanel({ sessionId, position }: ExportPanelProps): ReactElement {
  const { t } = useTranslation();
  const { status, state, requestExport, retry } = useStateAtPosition(sessionId, position);

  return (
    <section
      data-testid="test-mode-export"
      aria-label={t('testMode.export.regionAriaLabel')}
      className="rounded-2xl border border-slate-200 bg-white"
    >
      <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('testMode.export.heading')}
      </h2>

      {status === 'idle' ? (
        <div className="px-3 py-4 text-slate-600">
          <p>{t('testMode.export.intro')}</p>
          <button
            type="button"
            data-testid="test-mode-export-button"
            onClick={requestExport}
            className="mt-2 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            {t('testMode.export.exportButton')}
          </button>
        </div>
      ) : null}

      {status === 'loading' ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="test-mode-export-loading"
          className="px-3 py-4 text-slate-600"
        >
          {t('testMode.export.loading')}
        </p>
      ) : null}

      {status === 'error' ? (
        <div data-testid="test-mode-export-error" className="px-3 py-4 text-slate-600">
          <p>{t('testMode.export.error')}</p>
          <button
            type="button"
            data-testid="test-mode-export-retry"
            onClick={retry}
            className="mt-2 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            {t('testMode.export.retry')}
          </button>
        </div>
      ) : null}

      {status === 'ready' && state !== null ? (
        <div className="px-3 py-4">
          <button
            type="button"
            data-testid="test-mode-export-download"
            onClick={() => downloadEnvelope(state)}
            className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            {t('testMode.export.download')}
          </button>
          {/* The fetched envelope, pretty-printed and rendered verbatim —
              data, not UI prose. `data-position` equals the live position
              while present (Constraint §4). */}
          <pre
            data-testid="test-mode-export-readout"
            data-position={state.sequence}
            className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-800"
          >
            {JSON.stringify(state, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

export default ExportPanel;
