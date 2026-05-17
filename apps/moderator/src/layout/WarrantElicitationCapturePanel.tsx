// `<WarrantElicitationCapturePanel>` — warrant-elicitation-mode capture
// surface mounted in the bottom-strip's `textInput` slot when
// `mode === 'warrant-elicitation'`.
//
// Refinement: tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md
// Design doc: docs/moderator-ui.md (F3 § "Warrant elicitation" L77)
// Methodology: docs/methodology.md § "Warrant elicitation" L136–141
//
// The panel asks the moderator the warrant-elicitation question
// ("What's the unstated bridge from X to your conclusion?") grounded
// in the target node's wording (ICU `{nodeWording}` interpolation,
// with a generic-prompt fallback when the resolver returns null per
// Decision §D5) and provides a transcription textarea for the
// participant's articulated bridge plus three placeholder warrant-shape
// route chips (create-warrant-node / decompose-claim / defer). The
// chips are inert in this leaf — they pin the stable seams the F2 /
// F4 / F7 wirings will switch on.
//
// Self-gates on `mode === 'warrant-elicitation'` so direct unit-test
// invocations are deterministic regardless of the harness's mounted
// route (mirrors `<OperationalizationCapturePanel>`'s render-gate
// pattern).

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { MAX_METHODOLOGY_TEXT_LENGTH, type Event } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { resolveProposalTargetWording } from './ProposalModeExitAffordance';

/**
 * The three warrant-shape route chip identifiers. Stable contract for
 * the downstream F2 / F4 / F7 wirings: each route maps to a specific
 * methodology response per `docs/methodology.md` § "Warrant elicitation"
 * L136–141.
 *
 *  - `route-create-warrant-node` — the canonical path: the articulated
 *    bridge becomes a new node with `bridges-from` + `bridges-to` edges
 *    to the data and the claim (L80, L140). Downstream wired by
 *    `mod_draw_edge_flow` (F4).
 *  - `route-decompose-claim` — the claim was a compound carrying an
 *    implicit warrant; route into `mod_decompose_mode` against the
 *    original claim (L149). Downstream re-routes into F2.
 *  - `route-defer` — no clear bridge surfaced; soft mode-exit without
 *    proposing anything. Downstream owned by `mod_resolution_path_picker`
 *    (F7).
 *
 * Order is canonical (matches the methodology document's narrative
 * order) and pinned by the panel's render-order test.
 */
export const WARRANT_ELICITATION_ROUTES = [
  'route-create-warrant-node',
  'route-decompose-claim',
  'route-defer',
] as const;

export type WarrantElicitationRoute = (typeof WARRANT_ELICITATION_ROUTES)[number];

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export function WarrantElicitationCapturePanel(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const targetNodeId = useCaptureStore((s) => s.warrantElicitationTargetNodeId);
  const { id: sessionId = '' } = useParams<{ id: string }>();
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const [answerText, setAnswerText] = useState<string>('');

  if (mode !== 'warrant-elicitation') {
    return null;
  }

  const wording = resolveProposalTargetWording(events, targetNodeId);
  // ICU-templated prompt with `{nodeWording}` interpolation + a
  // generic-prompt fallback when the resolver returns `null` (the
  // transient inconsistency window the events log has not caught up
  // with). Decision §D5 records the two-key rationale: an empty prompt
  // would leave the moderator without a load-bearing question.
  const promptText =
    wording === null
      ? t('moderator.warrantElicitation.prompt.questionGeneric')
      : t('moderator.warrantElicitation.prompt.question', { nodeWording: wording });

  return (
    <section
      data-testid="warrant-elicitation-capture-panel"
      data-warrant-elicitation-target-node-id={targetNodeId ?? ''}
      role="region"
      aria-label={t('moderator.warrantElicitation.prompt.questionGeneric')}
      className="flex w-full flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p data-testid="warrant-elicitation-prompt-question" className="font-medium">
          {promptText}
        </p>
        {wording === null ? null : (
          <span
            data-testid="warrant-elicitation-target-wording"
            className="text-[10px] text-amber-800"
          >
            {t('moderator.warrantElicitation.banner.targetWording', { nodeWording: wording })}
          </span>
        )}
      </div>
      <p data-testid="warrant-elicitation-prompt-guidance" className="text-amber-800">
        {t('moderator.warrantElicitation.prompt.guidance')}
      </p>
      <textarea
        data-testid="warrant-elicitation-answer-textarea"
        aria-label={t('moderator.warrantElicitation.answer.placeholder')}
        placeholder={t('moderator.warrantElicitation.answer.placeholder')}
        value={answerText}
        onChange={(event) => {
          const next = event.target.value;
          // Defensive paste-bypass clamp mirroring `<CaptureTextInput>` /
          // the per-row decompose / interpretive-split mutators /
          // `<OperationalizationCapturePanel>`.
          setAnswerText(
            next.length > MAX_METHODOLOGY_TEXT_LENGTH
              ? next.slice(0, MAX_METHODOLOGY_TEXT_LENGTH)
              : next,
          );
        }}
        rows={2}
        className="w-full resize-y rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      />
      <div data-testid="warrant-elicitation-actions" className="flex flex-wrap gap-1.5">
        {WARRANT_ELICITATION_ROUTES.map((route) => (
          <button
            key={route}
            type="button"
            data-testid={`warrant-elicitation-action-${route}`}
            data-warrant-elicitation-route={route}
            disabled
            aria-disabled="true"
            className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs text-amber-900 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {t(`moderator.warrantElicitation.action.${route}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
