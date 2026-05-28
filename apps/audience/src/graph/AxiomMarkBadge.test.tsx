// Vitest cases for `<AudienceAxiomMarkBadge>`.
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//              (Constraints — minimum 5 cases: glyph, testid shape,
//              data-participant-id, deterministic chromatic class, and
//              en-US localized aria-label smoke. The full cross-locale
//              matrix is the moderator's `AxiomMarkBadge.test.tsx`
//              job — the audience pins en-US smoke so the i18n
//              bootstrap is wired through.)
// ADRs:        0022 (no throwaway verifications); 0024 (react-i18next).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';

import { AudienceAxiomMarkBadge } from './AxiomMarkBadge';
import type { AxiomMark } from './axiomMarks';
import { axiomMarkColorFor, createI18nInstance } from '@a-conversa/shell';

async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const NODE_ID = '00000000-0000-4000-8000-000000000a01';
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

function makeMark(overrides: Partial<AxiomMark> = {}): AxiomMark {
  return {
    nodeId: overrides.nodeId ?? NODE_ID,
    participantId: overrides.participantId ?? PARTICIPANT_A,
    committedAt: overrides.committedAt ?? '2026-05-28T00:00:00.000Z',
  };
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AudienceAxiomMarkBadge', () => {
  it('renders the literal "A" glyph as text content', async () => {
    await render(<AudienceAxiomMarkBadge mark={makeMark()} />);
    const badge = screen.getByTestId(`audience-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(badge.textContent).toBe('A');
  });

  it('exposes a testid of the form `audience-axiom-mark-badge-{nodeId}-{participantId}`', async () => {
    await render(<AudienceAxiomMarkBadge mark={makeMark()} />);
    expect(
      screen.getByTestId(`audience-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`),
    ).toBeTruthy();
  });

  it('exposes `data-participant-id` matching the participantId prop', async () => {
    await render(<AudienceAxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_B })} />);
    const badge = screen.getByTestId(`audience-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_B);
  });

  it('applies the same Tailwind background class for the same participantId across two renders (deterministic color)', async () => {
    const expectedColor = axiomMarkColorFor(PARTICIPANT_A);
    const { unmount } = await render(<AudienceAxiomMarkBadge mark={makeMark()} />);
    const first = screen.getByTestId(`audience-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const firstClassName = first.className;
    expect(firstClassName).toContain(expectedColor.bg);
    expect(firstClassName).toContain(expectedColor.text);
    expect(firstClassName).toContain(expectedColor.ring);
    unmount();
    await render(<AudienceAxiomMarkBadge mark={makeMark()} />);
    const second = screen.getByTestId(`audience-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(second.className).toBe(firstClassName);
  });

  it('renders the en-US localized aria-label including the participant UUID via the methodology.axiomMark.srLabel ICU key', async () => {
    await render(<AudienceAxiomMarkBadge mark={makeMark()} />);
    const badge = screen.getByTestId(`audience-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const ariaLabel = badge.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain(PARTICIPANT_A);
    // en-US catalog: "Axiom mark from participant {participantId}"
    expect(ariaLabel.toLowerCase()).toContain('axiom mark');
  });
});
