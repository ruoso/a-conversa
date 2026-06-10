// The walkthrough chat panel — the demo's "speech" layer. Renders the
// dialogue turns visible at the current position as a chat log between
// the moderator and the two debaters, simulating what a video of the
// debate would carry. Pure props-in (`{ position }`): the script and its
// event-id anchoring live in `dialogue.ts`; the copy resolves from the
// i18n catalogs.
//
// Refinement: tasks/refinements/landing_page/walkthrough_dialogue_chat.md
// ADRs:        0024 (react-i18next + ICU), 0040 (axe — labelled log
//              region, no aria-live spam during autoplay).

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor } from '@a-conversa/shell';

import {
  DEBATER_PARTICIPANT_IDS,
  dialogueVisibleAt,
  type DialogueSpeaker,
  type DialogueTurn,
} from './dialogue';

export interface ChatPanelProps {
  /** The demo's current 1-based position (the existing position seam). */
  readonly position: number;
}

/**
 * Bubble styling per speaker. The debaters reuse the SAME per-participant
 * palette the graph's axiom-mark badges derive (`axiomMarkColorFor` over
 * the fixture's participant ids), so a debater's chat color matches their
 * marks on the board. Maria takes the neutral moderator tone.
 */
function bubbleClassFor(speaker: DialogueSpeaker): string {
  const participantId = DEBATER_PARTICIPANT_IDS[speaker];
  if (participantId === undefined) {
    return 'bg-slate-100 text-slate-800';
  }
  const color = axiomMarkColorFor(participantId);
  return `${color.bg} ${color.text}`;
}

function ChatMessage({ turn }: { readonly turn: DialogueTurn }): ReactElement {
  const { t } = useTranslation();
  const isModerator = turn.speaker === 'maria';
  return (
    <li
      data-testid="walkthrough-chat-message"
      data-speaker={turn.speaker}
      data-slug={turn.slug}
      className={isModerator ? 'pr-6' : 'pl-6'}
    >
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t(`landing.demo.dialogue.speaker.${turn.speaker}`)}
      </p>
      <p className={`rounded-2xl px-3 py-2 text-sm leading-snug ${bubbleClassFor(turn.speaker)}`}>
        {t(`landing.demo.dialogue.${turn.slug}.text`)}
      </p>
    </li>
  );
}

export function ChatPanel({ position }: ChatPanelProps): ReactElement {
  const { t } = useTranslation();
  const turns = dialogueVisibleAt(position);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest turn in view as the position advances. `aria-live` is
  // deliberately "off": during autoplay a live region would announce every
  // bubble over the step-status announcer; the log role already conveys
  // the chat semantics to AT users navigating into it.
  useEffect(() => {
    const el = scrollRef.current;
    // `scrollTo` is feature-checked for the happy-dom test environment.
    if (el === null || typeof el.scrollTo !== 'function') return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [turns.length]);

  return (
    <section
      data-testid="walkthrough-chat"
      aria-label={t('landing.demo.chatLabel')}
      className="flex h-full max-h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white"
    >
      <h3 className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t('landing.demo.chatLabel')}
      </h3>
      {/* `role="log"` lives on the scroll container, NOT the <ul> — an
          explicit role on the list would strip its implicit `list` role
          and orphan the <li> children (axe `listitem`). */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        tabIndex={0}
      >
        <ul className="flex flex-col gap-3">
          {turns.map((turn) => (
            <ChatMessage key={turn.slug} turn={turn} />
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ChatPanel;
