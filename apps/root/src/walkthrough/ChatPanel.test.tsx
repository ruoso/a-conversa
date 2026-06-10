// Component suite for the walkthrough chat panel (ADR 0022 — durable,
// committed test artifact). Pins the visibility contract (turns with
// anchor ≤ position render, in script order), the per-speaker seams
// (`data-speaker` / `data-slug`), the catalog-resolved copy, and the
// empty state below the first anchor.
//
// Refinement: tasks/refinements/landing_page/walkthrough_dialogue_chat.md

import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { ChatPanel } from './ChatPanel';
import { WALKTHROUGH_DIALOGUE } from './dialogue';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
});

describe('ChatPanel — visibility contract', () => {
  it('renders the labelled chat region with no messages below the first anchor', () => {
    renderWithProviders(<ChatPanel position={0} />);
    expect(screen.getByTestId('walkthrough-chat')).toBeTruthy();
    expect(screen.queryAllByTestId('walkthrough-chat-message')).toHaveLength(0);
  });

  it('renders exactly the turns anchored at or before the position, in script order', () => {
    const third = WALKTHROUGH_DIALOGUE[2]!;
    renderWithProviders(<ChatPanel position={third.position} />);
    const expected = WALKTHROUGH_DIALOGUE.filter((turn) => turn.position <= third.position);
    const messages = screen.getAllByTestId('walkthrough-chat-message');
    expect(messages.map((m) => m.getAttribute('data-slug'))).toEqual(
      expected.map((turn) => turn.slug),
    );
  });

  it('renders the full script at the last position', () => {
    const last = WALKTHROUGH_DIALOGUE[WALKTHROUGH_DIALOGUE.length - 1]!;
    renderWithProviders(<ChatPanel position={last.position} />);
    expect(screen.getAllByTestId('walkthrough-chat-message')).toHaveLength(
      WALKTHROUGH_DIALOGUE.length,
    );
  });
});

describe('ChatPanel — speaker + copy seams', () => {
  it('stamps data-speaker per turn and resolves the speaker name + text from the catalog', async () => {
    const i18n = await getTestI18n();
    const first = WALKTHROUGH_DIALOGUE[0]!;
    renderWithProviders(<ChatPanel position={first.position} />);

    const message = screen.getAllByTestId('walkthrough-chat-message')[0]!;
    expect(message.getAttribute('data-speaker')).toBe(first.speaker);
    expect(message.textContent).toContain(i18n.t(`landing.demo.dialogue.speaker.${first.speaker}`));
    expect(message.textContent).toContain(i18n.t(`landing.demo.dialogue.${first.slug}.text`));
  });

  it('tints debater bubbles differently from the moderator', () => {
    // Find one moderator turn and one debater turn within a prefix.
    const debaterTurn = WALKTHROUGH_DIALOGUE.find((turn) => turn.speaker !== 'maria')!;
    renderWithProviders(<ChatPanel position={debaterTurn.position} />);
    const messages = screen.getAllByTestId('walkthrough-chat-message');
    const moderator = messages.find((m) => m.getAttribute('data-speaker') === 'maria')!;
    const debater = messages.find((m) => m.getAttribute('data-speaker') === debaterTurn.speaker)!;
    const bubbleClass = (el: HTMLElement): string => el.querySelector('p:last-child')!.className;
    expect(bubbleClass(moderator)).not.toBe(bubbleClass(debater));
  });
});
