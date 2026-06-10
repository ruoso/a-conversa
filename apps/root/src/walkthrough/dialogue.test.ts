// Pins the dialogue script table + its visibility rule (ADR 0022 —
// durable, committed test artifact). Mirrors the narration suite's
// posture: every boundary derives from the resolved table (anchors are
// EVENT IDS resolved against the live stream), so fixture edits never
// redden this file; the table↔catalog integrity guard keeps each slug's
// copy present in the en-US catalog (the cross-locale parity sweep
// covers pt-BR / es-419).
//
// Refinement: tasks/refinements/landing_page/walkthrough_dialogue_chat.md

import { beforeAll, describe, expect, it } from 'vitest';
import type { i18n as I18nInstance } from 'i18next';

import { WALKTHROUGH_DIALOGUE, dialogueVisibleAt } from './dialogue';
import { walkthroughEvents } from './index';
import { getTestI18n } from '../testing/renderWithProviders';

const FIRST = WALKTHROUGH_DIALOGUE[0]!;
const LAST = WALKTHROUGH_DIALOGUE[WALKTHROUGH_DIALOGUE.length - 1]!;

describe('WALKTHROUGH_DIALOGUE — anchor/script integrity', () => {
  it('has unique slugs and a known speaker on every turn', () => {
    const slugs = WALKTHROUGH_DIALOGUE.map((turn) => turn.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const turn of WALKTHROUGH_DIALOGUE) {
      expect(['maria', 'anna', 'ben']).toContain(turn.speaker);
    }
  });

  it('every anchor resolved to a real in-stream position, non-decreasing in script order', () => {
    for (const turn of WALKTHROUGH_DIALOGUE) {
      expect(Number.isInteger(turn.position)).toBe(true);
      expect(turn.position).toBeGreaterThanOrEqual(1);
      expect(turn.position).toBeLessThanOrEqual(walkthroughEvents.length);
    }
    for (let i = 1; i < WALKTHROUGH_DIALOGUE.length; i += 1) {
      expect(WALKTHROUGH_DIALOGUE[i]!.position).toBeGreaterThanOrEqual(
        WALKTHROUGH_DIALOGUE[i - 1]!.position,
      );
    }
  });

  it('opens on the session-created event and closes on the last event', () => {
    // The intro line lands with the very first event; the wrap-up with
    // the last — the chat spans the whole walkthrough.
    expect(FIRST.position).toBe(1);
    expect(LAST.position).toBe(walkthroughEvents.length);
  });
});

describe('dialogueVisibleAt — the visibility rule (anchor ≤ position)', () => {
  it('shows nothing before the first anchor', () => {
    expect(dialogueVisibleAt(FIRST.position - 1)).toHaveLength(0);
    expect(dialogueVisibleAt(0)).toHaveLength(0);
  });

  it('reveals turns monotonically and completely', () => {
    let previousCount = 0;
    for (let position = 0; position <= walkthroughEvents.length; position += 1) {
      const visible = dialogueVisibleAt(position);
      expect(visible.length).toBeGreaterThanOrEqual(previousCount);
      previousCount = visible.length;
    }
    expect(previousCount).toBe(WALKTHROUGH_DIALOGUE.length);
  });

  it('each turn becomes visible exactly at its anchor', () => {
    for (const turn of WALKTHROUGH_DIALOGUE) {
      const atAnchor = dialogueVisibleAt(turn.position);
      expect(atAnchor.some((t) => t.slug === turn.slug)).toBe(true);
      const justBefore = dialogueVisibleAt(turn.position - 1);
      // Turns sharing an anchor position appear together; a turn must
      // never be visible BEFORE its anchor.
      expect(justBefore.some((t) => t.slug === turn.slug)).toBe(false);
    }
  });
});

describe('table ↔ catalog integrity', () => {
  let i18n: I18nInstance;

  beforeAll(async () => {
    i18n = await getTestI18n();
  });

  it('every turn slug has a text key and every speaker a name key in the en-US catalog', () => {
    for (const turn of WALKTHROUGH_DIALOGUE) {
      expect(i18n.exists(`landing.demo.dialogue.${turn.slug}.text`)).toBe(true);
      expect(i18n.exists(`landing.demo.dialogue.speaker.${turn.speaker}`)).toBe(true);
    }
    expect(i18n.exists('landing.demo.chatLabel')).toBe(true);
  });
});
