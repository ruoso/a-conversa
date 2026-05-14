// Tests for `<AxiomMarkBadge>` — the small per-participant pill rendering
// one committed axiom-mark on a statement node.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. The localized tooltip (`title`) resolves through `useTranslation`
//      against `methodology.axiomMark.tooltip` for each of the three v1
//      locales (3 locales × 1 base case = 3 cases plus the screen-reader
//      label variant per locale, 9 cases total at this layer).
//   2. `data-participant-id` mirrors the prop — the stable seam through
//      which downstream per-participant assertions / styling layer
//      without having to parse the testid.
//   3. `data-testid` follows the `axiom-mark-badge-{nodeId}-{participantId}`
//      shape — the moderator's tests can target a specific (node, participant)
//      pair without walking the DOM.
//   4. Per-participant color determinism — rendering the same
//      participantId twice produces the same Tailwind background class.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { AxiomMarkBadge } from './AxiomMarkBadge';
import { axiomMarkColorFor, type AxiomMark } from './selectors';
import { initI18n } from '../i18n';

const NODE_ID = '00000000-0000-4000-8000-000000000a01';
// PARTICIPANT_A and PARTICIPANT_B hash to two distinct palette buckets
// (sum-of-hex-digits mod 6 = 1 / 2) so the cross-participant distinct-
// color test below pins the per-participant differentiation. See the
// same constants in `selectors.test.ts` for the all-same-digit
// collision case these UUIDs were chosen to avoid.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

function makeMark(overrides: Partial<AxiomMark> = {}): AxiomMark {
  return {
    nodeId: overrides.nodeId ?? NODE_ID,
    participantId: overrides.participantId ?? PARTICIPANT_A,
    committedAt: overrides.committedAt ?? '2026-05-11T00:00:00.000Z',
  };
}

beforeEach(async () => {
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AxiomMarkBadge — localized tooltip per locale', () => {
  // The locale × expected tuple. Each `tooltip` is the canonical resolved
  // ICU MessageFormat for the participant UUID substitution. The
  // `srLabel` (aria-label) is the longer screen-reader form.
  const EXPECTED = {
    'en-US': {
      tooltip: `Axiom marked by ${PARTICIPANT_A}`,
      srLabel: `Axiom mark from participant ${PARTICIPANT_A}`,
    },
    'pt-BR': {
      tooltip: `Axioma marcado por ${PARTICIPANT_A}`,
      srLabel: `Marca de axioma do participante ${PARTICIPANT_A}`,
    },
    'es-419': {
      tooltip: `Axioma marcado por ${PARTICIPANT_A}`,
      srLabel: `Marca de axioma del participante ${PARTICIPANT_A}`,
    },
  } as const;

  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    it(`renders the localized tooltip for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      render(<AxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('title')).toBe(EXPECTED[locale].tooltip);
      await i18next.changeLanguage('en-US');
    });

    it(`renders the localized aria-label for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      render(<AxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('aria-label')).toBe(EXPECTED[locale].srLabel);
      await i18next.changeLanguage('en-US');
    });

    it(`renders the visible "A" glyph for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      render(<AxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.textContent).toBe('A');
      await i18next.changeLanguage('en-US');
    });
  }
});

describe('AxiomMarkBadge — data attributes', () => {
  it('exposes `data-participant-id` matching the participantId prop', () => {
    render(<AxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_B })} />);
    const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_B);
  });

  it('exposes a testid of the form `axiom-mark-badge-{nodeId}-{participantId}`', () => {
    const mark = makeMark({ nodeId: NODE_ID, participantId: PARTICIPANT_A });
    render(<AxiomMarkBadge mark={mark} />);
    expect(screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`)).toBeTruthy();
  });
});

describe('AxiomMarkBadge — per-participant deterministic color', () => {
  it('applies the same Tailwind background class for the same participantId across two renders', () => {
    const expectedColor = axiomMarkColorFor(PARTICIPANT_A);
    // First render — capture the className.
    const { unmount } = render(<AxiomMarkBadge mark={makeMark()} />);
    const first = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const firstClassName = first.className;
    expect(firstClassName).toContain(expectedColor.bg);
    expect(firstClassName).toContain(expectedColor.text);
    expect(firstClassName).toContain(expectedColor.ring);
    unmount();
    // Second render — same participantId → same className.
    render(<AxiomMarkBadge mark={makeMark()} />);
    const second = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(second.className).toBe(firstClassName);
  });

  it('applies a different background class for a different participantId (when palette buckets differ)', () => {
    // PARTICIPANT_A and PARTICIPANT_B hash to different palette buckets
    // (sum-of-hex-digits: A→13%6=1 amber, B→14%6=2 emerald). Pin the
    // distinctness so a future palette / hash refactor doesn't silently
    // collapse them.
    render(<AxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_A })} />);
    render(<AxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_B })} />);
    const a = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const b = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    const aColor = axiomMarkColorFor(PARTICIPANT_A);
    const bColor = axiomMarkColorFor(PARTICIPANT_B);
    expect(aColor.bg).not.toBe(bColor.bg);
    expect(a.className).toContain(aColor.bg);
    expect(b.className).toContain(bColor.bg);
  });
});
