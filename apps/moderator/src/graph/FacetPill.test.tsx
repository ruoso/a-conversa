// Tests for `<FacetPill>` — the small bordered chip that surfaces ONE
// facet's status on a node card.
//
// Refinement: tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The pill carries the seam attributes (`data-facet-pill`,
//      `data-facet-name`, `data-facet-status`) — the stable selectors
//      downstream Playwright + unit tests target.
//   2. Each per-status branch applies the right Tailwind classes
//      (mirroring the whole-card frame rules from the predecessor
//      state-styling refinements, scoped to the pill surface). Six
//      status branches × per-facet labels.
//   3. The localized facet-name label resolves through
//      `methodology.facet.<name>` against the active locale, across
//      the three v1 locales (en-US / pt-BR / es-419).
//
// `<FacetPill>` reads `useTranslation` but nothing else from React's
// runtime, so it renders cleanly under `@testing-library/react` without
// a ReactFlow wrapper.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';

import { FacetPill } from './FacetPill';
import { initI18n } from '../i18n';

beforeEach(async () => {
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

// Single render helper — every test case constructs a `<FacetPill>` and
// grabs the pill via the `[data-facet-pill]` selector. `data-facet-pill`
// is a sentinel attribute (empty value) — the presence of the attribute
// IS the assertion. `getByTestId` doesn't fit because the pill carries
// no `data-testid` of its own; the row container does.
function getPill(): HTMLElement {
  // `@testing-library/react`'s `screen` doesn't expose an
  // attribute-presence selector directly; we use the underlying
  // `document.querySelector` because the pill is the single element
  // under test in each case (a single render → a single pill in the
  // DOM).
  const el = document.querySelector<HTMLElement>('[data-facet-pill]');
  if (el === null) throw new Error('expected one [data-facet-pill] element in the DOM');
  return el;
}

describe('FacetPill — seam attributes', () => {
  it('stamps data-facet-pill + data-facet-name="wording" + data-facet-status="proposed"', () => {
    render(<FacetPill facet="wording" status="proposed" />);
    const pill = getPill();
    expect(pill.getAttribute('data-facet-pill')).toBe('');
    expect(pill.getAttribute('data-facet-name')).toBe('wording');
    expect(pill.getAttribute('data-facet-status')).toBe('proposed');
  });

  it('stamps data-facet-name="classification" + data-facet-status="agreed"', () => {
    render(<FacetPill facet="classification" status="agreed" />);
    const pill = getPill();
    expect(pill.getAttribute('data-facet-name')).toBe('classification');
    expect(pill.getAttribute('data-facet-status')).toBe('agreed');
  });

  it('stamps data-facet-name="substance" + data-facet-status="disputed"', () => {
    render(<FacetPill facet="substance" status="disputed" />);
    const pill = getPill();
    expect(pill.getAttribute('data-facet-name')).toBe('substance');
    expect(pill.getAttribute('data-facet-status')).toBe('disputed');
  });
});

describe('FacetPill — per-status styling branches', () => {
  // The pill's per-status classes mirror the whole-card frame rules
  // from the predecessor state-styling refinements (`mod_proposed_*`,
  // `mod_agreed_*`, `mod_disputed_*`, `mod_meta_disagreement_*`),
  // scoped to the smaller pill surface (ring-1 instead of ring-2).
  // Closed-state pills (`committed`, `withdrawn`) ARE styled — the
  // pill is the per-facet record, unlike the whole-card frame which
  // falls back to baseline for closed statuses.

  it('proposed branch applies border-dashed + border-slate-400 + text-slate-500 + opacity-60', () => {
    render(<FacetPill facet="wording" status="proposed" />);
    const pill = getPill();
    expect(pill.className).toContain('border-dashed');
    expect(pill.className).toContain('border-slate-400');
    expect(pill.className).toContain('text-slate-500');
    expect(pill.className).toContain('opacity-60');
  });

  it('agreed branch applies border-solid + border-slate-700 + text-slate-700 + opacity-100', () => {
    render(<FacetPill facet="wording" status="agreed" />);
    const pill = getPill();
    expect(pill.className).toContain('border-solid');
    expect(pill.className).toContain('border-slate-700');
    expect(pill.className).toContain('text-slate-700');
    expect(pill.className).toContain('opacity-100');
    expect(pill.className).not.toContain('border-dashed');
  });

  it('disputed branch applies border-solid + border-rose-600 + text-rose-700 + ring-1 + ring-rose-500 + opacity-100', () => {
    render(<FacetPill facet="classification" status="disputed" />);
    const pill = getPill();
    expect(pill.className).toContain('border-solid');
    expect(pill.className).toContain('border-rose-600');
    expect(pill.className).toContain('text-rose-700');
    expect(pill.className).toContain('ring-1');
    expect(pill.className).toContain('ring-rose-500');
    expect(pill.className).toContain('opacity-100');
    expect(pill.className).not.toContain('border-dashed');
  });

  it('meta-disagreement branch applies border-double + border-violet-600 + text-violet-700 + ring-1 + ring-violet-400 + opacity-100', () => {
    render(<FacetPill facet="substance" status="meta-disagreement" />);
    const pill = getPill();
    expect(pill.className).toContain('border-double');
    expect(pill.className).toContain('border-violet-600');
    expect(pill.className).toContain('text-violet-700');
    expect(pill.className).toContain('ring-1');
    expect(pill.className).toContain('ring-violet-400');
    expect(pill.className).toContain('opacity-100');
    // Not styled as any of the other branches.
    expect(pill.className).not.toContain('border-dashed');
    expect(pill.className).not.toContain('border-rose-600');
  });

  it('committed branch applies border-solid + border-slate-400 + text-slate-600 + opacity-90 (closed; slightly faded)', () => {
    render(<FacetPill facet="wording" status="committed" />);
    const pill = getPill();
    expect(pill.className).toContain('border-solid');
    expect(pill.className).toContain('border-slate-400');
    expect(pill.className).toContain('text-slate-600');
    expect(pill.className).toContain('opacity-90');
    expect(pill.className).not.toContain('border-dashed');
  });

  it('withdrawn branch applies border-dashed + border-slate-400 + text-slate-500 + opacity-50 (closed; retracted)', () => {
    render(<FacetPill facet="wording" status="withdrawn" />);
    const pill = getPill();
    expect(pill.className).toContain('border-dashed');
    expect(pill.className).toContain('border-slate-400');
    expect(pill.className).toContain('text-slate-500');
    expect(pill.className).toContain('opacity-50');
    expect(pill.className).not.toContain('opacity-60');
  });
});

describe('FacetPill — localized facet-name label', () => {
  // Canonical mapping from the refinement Decisions: en-US "Wording" /
  // pt-BR "Redação" / es-419 "Redacción"; en-US "Classification" /
  // pt-BR "Classificação" / es-419 "Clasificación"; en-US "Substance" /
  // pt-BR "Substância" / es-419 "Sustancia". The cross-locale catalog
  // round-trip is owned by `packages/i18n-catalogs/src/methodology.test.ts`;
  // here we pin the rendered pill text per facet × locale.
  const EXPECTED: Record<
    'wording' | 'classification' | 'substance',
    { 'en-US': string; 'pt-BR': string; 'es-419': string }
  > = {
    wording: { 'en-US': 'Wording', 'pt-BR': 'Redação', 'es-419': 'Redacción' },
    classification: {
      'en-US': 'Classification',
      'pt-BR': 'Classificação',
      'es-419': 'Clasificación',
    },
    substance: { 'en-US': 'Substance', 'pt-BR': 'Substância', 'es-419': 'Sustancia' },
  };

  const FACETS = ['wording', 'classification', 'substance'] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const facet of FACETS) {
      it(`renders ${facet} as "${EXPECTED[facet][locale]}" in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        render(<FacetPill facet={facet} status="proposed" />);
        const pill = getPill();
        expect(pill.textContent).toBe(EXPECTED[facet][locale]);
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('non-en-US facet labels differ from en-US (translation, not copy)', async () => {
    // All three facet labels translate non-trivially across the three
    // v1 locales — no cognate collisions for `wording` / `classification`
    // / `substance`.
    await i18next.changeLanguage('pt-BR');
    render(<FacetPill facet="wording" status="agreed" />);
    const pill = getPill();
    expect(pill.textContent).toBe('Redação');
    expect(pill.textContent).not.toBe('Wording');
    await i18next.changeLanguage('en-US');
  });
});

describe('FacetPill — base structural classes', () => {
  // Pin the structural baseline (inline-flex pill shape) so a refactor
  // doesn't accidentally drop the pill's chip appearance.
  it('applies the baseline rounded-full + border + uppercase pill classes', () => {
    render(<FacetPill facet="wording" status="proposed" />);
    const pill = getPill();
    expect(pill.className).toContain('inline-flex');
    expect(pill.className).toContain('rounded-full');
    expect(pill.className).toContain('border');
    expect(pill.className).toContain('uppercase');
    expect(pill.className).toContain('whitespace-nowrap');
  });
});

describe('FacetPill — in-pill vote-indicator row (mod_vote_indicators_on_graph)', () => {
  // The vote-indicator row sits inside the pill, to the right of the
  // facet-name label. Omitted when there are no votes; present
  // otherwise. Pill border / opacity / status classes are unchanged.
  const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
  const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';
  const PARTICIPANT_C = '00000000-0000-4000-8000-000000000003';

  it('does not render the vote-indicator row when votes is empty / undefined', () => {
    render(<FacetPill facet="wording" status="proposed" />);
    const pill = getPill();
    expect(pill.querySelector('[data-vote-indicator-row]')).toBeNull();
    expect(pill.querySelector('[data-vote-indicator]')).toBeNull();
  });

  it('renders one indicator inside the pill when one vote is passed', () => {
    render(
      <FacetPill
        facet="wording"
        status="proposed"
        votes={[{ participantId: PARTICIPANT_A, choice: 'agree' }]}
      />,
    );
    const pill = getPill();
    const row = pill.querySelector('[data-vote-indicator-row]');
    expect(row).toBeTruthy();
    const indicators = pill.querySelectorAll('[data-vote-indicator]');
    expect(indicators.length).toBe(1);
    expect(indicators[0]?.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(indicators[0]?.getAttribute('data-choice')).toBe('agree');
  });

  it('renders three indicators with distinct data-choice values for mixed agree + dispute + withdraw votes', () => {
    render(
      <FacetPill
        facet="substance"
        status="disputed"
        votes={[
          { participantId: PARTICIPANT_A, choice: 'agree' },
          { participantId: PARTICIPANT_B, choice: 'dispute' },
          { participantId: PARTICIPANT_C, choice: 'withdraw' },
        ]}
      />,
    );
    const pill = getPill();
    const indicators = Array.from(pill.querySelectorAll<HTMLElement>('[data-vote-indicator]'));
    expect(indicators.length).toBe(3);
    expect(indicators.map((i) => i.getAttribute('data-choice'))).toEqual([
      'agree',
      'dispute',
      'withdraw',
    ]);
    expect(indicators.map((i) => i.getAttribute('data-participant-id'))).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
      PARTICIPANT_C,
    ]);
  });

  it('preserves the per-status pill className branches when votes are present (no styling regression)', () => {
    // Sanity: adding a vote-indicator row inside the pill must NOT
    // disturb the pill's per-status border / ring / opacity branch.
    render(
      <FacetPill
        facet="classification"
        status="disputed"
        votes={[{ participantId: PARTICIPANT_A, choice: 'dispute' }]}
      />,
    );
    const pill = getPill();
    expect(pill.className).toContain('border-rose-600');
    expect(pill.className).toContain('ring-1');
    expect(pill.className).toContain('ring-rose-500');
    expect(pill.getAttribute('data-facet-status')).toBe('disputed');
  });
});
