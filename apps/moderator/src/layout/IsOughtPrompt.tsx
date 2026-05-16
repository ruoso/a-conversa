// `<IsOughtPrompt>` — diagnostic is-ought check prompt surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_is_ought_prompt.md
//
// This is intentionally a prompt-only UI surface: it asks the moderator
// to check whether disputed wording carries normative load, then previews
// two possible next paths (decompose normatively vs elicit warrant).
// The actions are placeholders in this leaf and are explicitly inert.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCaptureStore } from '../stores/captureStore';

function isDiagnosticPromptMode(mode: string): boolean {
  return mode === 'operationalization' || mode === 'warrant-elicitation';
}

export function IsOughtPrompt(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);

  if (!isDiagnosticPromptMode(mode)) {
    return null;
  }

  return (
    <section
      data-testid="is-ought-prompt"
      data-mode={mode}
      role="note"
      aria-label={t('moderator.diagnostic.isOughtPrompt.ariaLabel')}
      className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
    >
      <p data-testid="is-ought-prompt-question" className="font-medium">
        {t('moderator.diagnostic.isOughtPrompt.question')}
      </p>
      <p data-testid="is-ought-prompt-guidance" className="mt-1 text-amber-800">
        {t('moderator.diagnostic.isOughtPrompt.guidance')}
      </p>
      <div data-testid="is-ought-prompt-actions" className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="is-ought-prompt-action-decompose"
          disabled
          aria-disabled="true"
          className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs text-amber-900 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {t('moderator.diagnostic.isOughtPrompt.action.decompose')}
        </button>
        <button
          type="button"
          data-testid="is-ought-prompt-action-warrant"
          disabled
          aria-disabled="true"
          className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs text-amber-900 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {t('moderator.diagnostic.isOughtPrompt.action.warrant')}
        </button>
      </div>
    </section>
  );
}
