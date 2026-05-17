// `<OperationalizationCapturePanel>` — operationalization-mode capture
// surface mounted in the bottom-strip's `textInput` slot when
// `mode === 'operationalization'`.
//
// Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md
// Design doc: docs/moderator-ui.md (F3 § "Operationalization" L68–74)
// Methodology: docs/methodology.md § "Operationalization test" L110–120
//
// The panel asks the moderator the operationalization question
// ("What evidence would change your mind on this?") and provides a
// transcription textarea for the participant's verbal answer plus five
// placeholder answer-route chips (axiom-mark / defeater / re-classify /
// decompose / no-signal). The chips are inert in this leaf — they pin
// the stable seams the F5 / F6 / F7 wirings will switch on.
//
// Self-gates on `mode === 'operationalization'` so direct unit-test
// invocations are deterministic regardless of the harness's mounted
// route (mirrors `<IsOughtPrompt>`'s render-gate pattern).

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { MAX_METHODOLOGY_TEXT_LENGTH, type Event } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { resolveProposalTargetWording } from './ProposalModeExitAffordance';

/**
 * The five answer-route chip identifiers. Stable contract for the
 * downstream F5 / F6 / F7 wirings: each route maps to a specific
 * methodology response per `docs/methodology.md` § "Operationalization
 * test" L110–120.
 *
 * Order is canonical (matches the methodology document's narrative
 * order) and pinned by the panel's render-order test.
 */
export const OPERATIONALIZATION_ROUTES = [
  'route-axiom-mark',
  'route-defeater',
  'route-reclassify',
  'route-decompose',
  'route-no-signal',
] as const;

export type OperationalizationRoute = (typeof OPERATIONALIZATION_ROUTES)[number];

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export function OperationalizationCapturePanel(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const targetNodeId = useCaptureStore((s) => s.operationalizationTargetNodeId);
  const { id: sessionId = '' } = useParams<{ id: string }>();
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
  const [answerText, setAnswerText] = useState<string>('');

  if (mode !== 'operationalization') {
    return null;
  }

  const wording = resolveProposalTargetWording(events, targetNodeId);

  return (
    <section
      data-testid="operationalization-capture-panel"
      data-operationalization-target-node-id={targetNodeId ?? ''}
      role="region"
      aria-label={t('moderator.operationalization.prompt.question')}
      className="flex w-full flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p data-testid="operationalization-prompt-question" className="font-medium">
          {t('moderator.operationalization.prompt.question')}
        </p>
        {wording === null ? null : (
          <span
            data-testid="operationalization-target-wording"
            className="text-[10px] text-amber-800"
          >
            {t('moderator.operationalization.banner.targetWording', { nodeWording: wording })}
          </span>
        )}
      </div>
      <p data-testid="operationalization-prompt-guidance" className="text-amber-800">
        {t('moderator.operationalization.prompt.guidance')}
      </p>
      <textarea
        data-testid="operationalization-answer-textarea"
        aria-label={t('moderator.operationalization.answer.placeholder')}
        placeholder={t('moderator.operationalization.answer.placeholder')}
        value={answerText}
        onChange={(event) => {
          const next = event.target.value;
          // Defensive paste-bypass clamp mirroring `<CaptureTextInput>` /
          // the per-row decompose / interpretive-split mutators.
          setAnswerText(
            next.length > MAX_METHODOLOGY_TEXT_LENGTH
              ? next.slice(0, MAX_METHODOLOGY_TEXT_LENGTH)
              : next,
          );
        }}
        rows={2}
        className="w-full resize-y rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      />
      <div data-testid="operationalization-actions" className="flex flex-wrap gap-1.5">
        {OPERATIONALIZATION_ROUTES.map((route) => (
          <button
            key={route}
            type="button"
            data-testid={`operationalization-action-${route}`}
            data-operationalization-route={route}
            disabled
            aria-disabled="true"
            className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs text-amber-900 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {t(`moderator.operationalization.action.${route}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
