// Tests for `<DisputationTestChip>` — the small inline chip that surfaces
// the methodology's disputation-test outcome on a node card.
//
// Refinement: tasks/refinements/moderator-ui/mod_disputation_test_display.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. The chip carries the seam attributes (`data-disputation-chip`,
//      `data-disputation-outcome`) — the stable selectors downstream
//      Playwright + unit tests target.
//   2. Each per-outcome branch applies the right Tailwind palette
//      (sky for data, rose for claim, slate-dashed for unsettled — see
//      refinement Decision §4).
//   3. The localized outcome label resolves through
//      `moderator.diagnostic.disputationTest.outcome.<outcome>` against
//      the active locale, across the three v1 locales.
//   4. The ICU `chipAriaLabel` template substitutes the LOCALIZED
//      outcome string (not the wire identifier) so the aria label reads
//      naturally in each locale.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';

import { DisputationTestChip } from './DisputationTestChip';
import { createI18nInstance } from '@a-conversa/shell';

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

// Single render helper — every test case constructs one chip and grabs
// it via the `[data-disputation-chip]` selector. `data-disputation-chip`
// is a sentinel attribute (empty value) — the presence of the attribute
// IS the assertion. Mirrors the `<FacetPill>` test pattern.
function getChip(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-disputation-chip]');
  if (el === null) throw new Error('expected one [data-disputation-chip] element in the DOM');
  return el;
}

describe('DisputationTestChip — seam attributes', () => {
  it('stamps data-disputation-chip + data-disputation-outcome="data"', () => {
    render(<DisputationTestChip outcome="data" />);
    const chip = getChip();
    expect(chip.getAttribute('data-disputation-chip')).toBe('');
    expect(chip.getAttribute('data-disputation-outcome')).toBe('data');
  });

  it('stamps data-disputation-outcome="claim"', () => {
    render(<DisputationTestChip outcome="claim" />);
    const chip = getChip();
    expect(chip.getAttribute('data-disputation-outcome')).toBe('claim');
  });

  it('stamps data-disputation-outcome="unsettled"', () => {
    render(<DisputationTestChip outcome="unsettled" />);
    const chip = getChip();
    expect(chip.getAttribute('data-disputation-outcome')).toBe('unsettled');
  });
});

describe('DisputationTestChip — per-outcome styling branches', () => {
  // The chip's per-outcome palette mirrors the refinement Decision §4
  // rationale (sky / rose / slate). Pin the load-bearing class fragments
  // so a refactor doesn't accidentally drop one.

  it('data branch applies sky palette (border-sky-600 + bg-sky-50 + text-sky-800 + border-solid)', () => {
    render(<DisputationTestChip outcome="data" />);
    const chip = getChip();
    expect(chip.className).toContain('border-solid');
    expect(chip.className).toContain('border-sky-600');
    expect(chip.className).toContain('bg-sky-50');
    expect(chip.className).toContain('text-sky-800');
  });

  it('claim branch applies rose palette (border-rose-600 + bg-rose-50 + text-rose-800 + border-solid)', () => {
    render(<DisputationTestChip outcome="claim" />);
    const chip = getChip();
    expect(chip.className).toContain('border-solid');
    expect(chip.className).toContain('border-rose-600');
    expect(chip.className).toContain('bg-rose-50');
    expect(chip.className).toContain('text-rose-800');
  });

  it('unsettled branch applies slate palette (border-slate-400 + bg-slate-50 + text-slate-600 + border-dashed)', () => {
    render(<DisputationTestChip outcome="unsettled" />);
    const chip = getChip();
    expect(chip.className).toContain('border-dashed');
    expect(chip.className).toContain('border-slate-400');
    expect(chip.className).toContain('bg-slate-50');
    expect(chip.className).toContain('text-slate-600');
    // Not styled as data (sky) or claim (rose).
    expect(chip.className).not.toContain('border-sky-600');
    expect(chip.className).not.toContain('border-rose-600');
  });

  it('shares the structural pill baseline across all outcomes (inline-flex + rounded-full + uppercase)', () => {
    render(<DisputationTestChip outcome="data" />);
    const chip = getChip();
    expect(chip.className).toContain('inline-flex');
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).toContain('uppercase');
  });
});

describe('DisputationTestChip — localized outcome label', () => {
  // Canonical mapping from the refinement Constraints / requirements:
  // en-US "Data" / pt-BR "Dado" / es-419 "Dato";
  // en-US "Claim" / pt-BR "Afirmação" / es-419 "Afirmación";
  // en-US "Unsettled" / pt-BR "Em disputa" / es-419 "En disputa".

  const EXPECTED: Record<
    'data' | 'claim' | 'unsettled',
    { 'en-US': string; 'pt-BR': string; 'es-419': string }
  > = {
    data: { 'en-US': 'Data', 'pt-BR': 'Dado', 'es-419': 'Dato' },
    claim: { 'en-US': 'Claim', 'pt-BR': 'Afirmação', 'es-419': 'Afirmación' },
    unsettled: { 'en-US': 'Unsettled', 'pt-BR': 'Em disputa', 'es-419': 'En disputa' },
  };

  it('renders the data label as "Data" in en-US', () => {
    render(<DisputationTestChip outcome="data" />);
    expect(getChip().textContent).toBe(EXPECTED.data['en-US']);
  });

  it('renders the claim label as "Claim" in en-US', () => {
    render(<DisputationTestChip outcome="claim" />);
    expect(getChip().textContent).toBe(EXPECTED.claim['en-US']);
  });

  it('renders the unsettled label as "Unsettled" in en-US', () => {
    render(<DisputationTestChip outcome="unsettled" />);
    expect(getChip().textContent).toBe(EXPECTED.unsettled['en-US']);
  });

  // Three cross-locale label cases for the data outcome (refinement
  // Constraints / requirements explicitly lists this triplet).
  it('renders the data label as "Dado" in pt-BR', async () => {
    await i18next.changeLanguage('pt-BR');
    render(<DisputationTestChip outcome="data" />);
    expect(getChip().textContent).toBe(EXPECTED.data['pt-BR']);
    await i18next.changeLanguage('en-US');
  });

  it('renders the data label as "Dato" in es-419', async () => {
    await i18next.changeLanguage('es-419');
    render(<DisputationTestChip outcome="data" />);
    expect(getChip().textContent).toBe(EXPECTED.data['es-419']);
    await i18next.changeLanguage('en-US');
  });
});

describe('DisputationTestChip — aria-label (ICU template)', () => {
  it('resolves the chipAriaLabel template with the localized outcome substituted (en-US)', () => {
    render(<DisputationTestChip outcome="data" />);
    const chip = getChip();
    const ariaLabel = chip.getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
    // The localized outcome string must appear in the aria label
    // (the call site substitutes the resolved label, not the wire id).
    expect(ariaLabel!).toContain('Data');
    // The aria label must NOT just be the literal i18n key (sanity:
    // the lookup resolved).
    expect(ariaLabel).not.toBe('moderator.diagnostic.disputationTest.chipAriaLabel');
  });

  it('resolves the aria label with the localized outcome in pt-BR', async () => {
    await i18next.changeLanguage('pt-BR');
    render(<DisputationTestChip outcome="claim" />);
    const ariaLabel = getChip().getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!).toContain('Afirmação');
    // Negative pin: no wire identifier leaked into the aria label.
    expect(ariaLabel!).not.toContain('claim');
    await i18next.changeLanguage('en-US');
  });

  it('resolves the aria label with the localized outcome in es-419', async () => {
    await i18next.changeLanguage('es-419');
    render(<DisputationTestChip outcome="unsettled" />);
    const ariaLabel = getChip().getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!).toContain('En disputa');
    expect(ariaLabel!).not.toContain('unsettled');
    await i18next.changeLanguage('en-US');
  });
});
