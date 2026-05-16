// Tests for `<VoteIndicator>` — the small per-participant vote dot
// rendered inside facet pills.
//
// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The seam attributes the test surfaces target
//      (`data-vote-indicator`, `data-participant-id`, `data-choice`).
//   2. The per-choice inner-fill classes (emerald = agree, rose =
//      dispute, slate = withdraw).
//   3. The per-participant outer-ring class is deterministic — same
//      participant id always yields the same ring class, distinct
//      participants typically yield distinct classes.
//   4. The localized aria-label / title resolve through
//      `methodology.voteIndicator.label` with ICU substitution of the
//      choice fragment from `methodology.voteIndicatorChoice.<arm>`,
//      across the three v1 locales.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';

import { VoteIndicator } from './VoteIndicator';
import { axiomMarkColorFor } from './selectors';
import { createI18nInstance } from '@a-conversa/shell';

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

// Same `getPill`-style helper — the indicator is a single element under
// test in each case.
function getIndicator(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-vote-indicator]');
  if (el === null) throw new Error('expected one [data-vote-indicator] element in the DOM');
  return el;
}

// Distinct hash buckets for deterministic per-participant ring tests.
// Trailing hex digit varies; the hash sums hex digit values mod 6.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

describe('VoteIndicator — seam attributes', () => {
  it('stamps data-vote-indicator + data-participant-id + data-choice="agree"', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    const indicator = getIndicator();
    expect(indicator.getAttribute('data-vote-indicator')).toBe('');
    expect(indicator.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(indicator.getAttribute('data-choice')).toBe('agree');
  });

  it('stamps data-choice="dispute" for a dispute vote', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="dispute" />);
    expect(getIndicator().getAttribute('data-choice')).toBe('dispute');
  });

  it('stamps data-choice="withdraw" for a withdraw vote', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="withdraw" />);
    expect(getIndicator().getAttribute('data-choice')).toBe('withdraw');
  });
});

describe('VoteIndicator — per-choice inner-fill classes', () => {
  it('agree applies bg-emerald-500', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    const indicator = getIndicator();
    expect(indicator.className).toContain('bg-emerald-500');
    expect(indicator.className).not.toContain('bg-rose-500');
    expect(indicator.className).not.toContain('bg-slate-400');
  });

  it('dispute applies bg-rose-500', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="dispute" />);
    const indicator = getIndicator();
    expect(indicator.className).toContain('bg-rose-500');
    expect(indicator.className).not.toContain('bg-emerald-500');
    expect(indicator.className).not.toContain('bg-slate-400');
  });

  it('withdraw applies bg-slate-400 (the methodology "agreed-then-retracted" gray)', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="withdraw" />);
    const indicator = getIndicator();
    expect(indicator.className).toContain('bg-slate-400');
    expect(indicator.className).not.toContain('bg-emerald-500');
    expect(indicator.className).not.toContain('bg-rose-500');
  });
});

describe('VoteIndicator — per-participant outer-ring color (deterministic)', () => {
  // The outer ring reuses `axiomMarkColorFor(participantId)` — the same
  // six-bucket deterministic palette `mod_axiom_mark_decoration` pinned.
  // Same participant → same ring color; distinct participants → typically
  // distinct (six buckets means a 7+ participant session aliases).

  it('reuses axiomMarkColorFor — the ring class matches the participant color helper', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    const indicator = getIndicator();
    const expected = axiomMarkColorFor(PARTICIPANT_A);
    expect(indicator.className).toContain(expected.ring);
  });

  it('different participant ids produce different ring classes (chosen so buckets differ)', () => {
    // PARTICIPANT_A trailing "1" and PARTICIPANT_B trailing "2": hash sum
    // differs by 1, mod 6 → different palette buckets.
    const colorA = axiomMarkColorFor(PARTICIPANT_A);
    const colorB = axiomMarkColorFor(PARTICIPANT_B);
    expect(colorA.ring).not.toBe(colorB.ring);

    const { container, rerender } = render(
      <VoteIndicator participantId={PARTICIPANT_A} choice="agree" />,
    );
    const indicatorA = container.querySelector<HTMLElement>('[data-vote-indicator]');
    expect(indicatorA?.className).toContain(colorA.ring);

    rerender(<VoteIndicator participantId={PARTICIPANT_B} choice="agree" />);
    const indicatorB = container.querySelector<HTMLElement>('[data-vote-indicator]');
    expect(indicatorB?.className).toContain(colorB.ring);
    expect(indicatorB?.className).not.toContain(colorA.ring);
  });
});

describe('VoteIndicator — base structural classes', () => {
  it('applies the baseline rounded-full + ring-1 + small-dot classes', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    const indicator = getIndicator();
    expect(indicator.className).toContain('inline-block');
    expect(indicator.className).toContain('rounded-full');
    expect(indicator.className).toContain('ring-1');
    expect(indicator.className).toContain('h-2');
    expect(indicator.className).toContain('w-2');
  });

  it('sets role="img" and a non-empty aria-label + title', () => {
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    const indicator = getIndicator();
    expect(indicator.getAttribute('role')).toBe('img');
    const ariaLabel = indicator.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel?.length).toBeGreaterThan(0);
    expect(indicator.getAttribute('title')).toBe(ariaLabel);
  });
});

describe('VoteIndicator — localized aria-label (cross-locale)', () => {
  it('en-US: "Participant <uuid> voted agree"', async () => {
    await i18next.changeLanguage('en-US');
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    expect(getIndicator().getAttribute('aria-label')).toBe(
      `Participant ${PARTICIPANT_A} voted agree`,
    );
  });

  it('pt-BR: "Participante <uuid> votou concordou"', async () => {
    await i18next.changeLanguage('pt-BR');
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    expect(getIndicator().getAttribute('aria-label')).toBe(
      `Participante ${PARTICIPANT_A} votou concordou`,
    );
    await i18next.changeLanguage('en-US');
  });

  it('es-419: "Participante <uuid> votó concordó"', async () => {
    await i18next.changeLanguage('es-419');
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="agree" />);
    expect(getIndicator().getAttribute('aria-label')).toBe(
      `Participante ${PARTICIPANT_A} votó concordó`,
    );
    await i18next.changeLanguage('en-US');
  });

  it('en-US dispute reads "Participant <uuid> voted dispute"', async () => {
    await i18next.changeLanguage('en-US');
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="dispute" />);
    expect(getIndicator().getAttribute('aria-label')).toBe(
      `Participant ${PARTICIPANT_A} voted dispute`,
    );
  });

  it('pt-BR withdraw reads "Participante <uuid> votou retirou"', async () => {
    await i18next.changeLanguage('pt-BR');
    render(<VoteIndicator participantId={PARTICIPANT_A} choice="withdraw" />);
    expect(getIndicator().getAttribute('aria-label')).toBe(
      `Participante ${PARTICIPANT_A} votou retirou`,
    );
    await i18next.changeLanguage('en-US');
  });
});
