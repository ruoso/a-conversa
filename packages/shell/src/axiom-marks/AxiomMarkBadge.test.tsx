// Vitest cases for the canonical `<AxiomMarkBadge>` shell primitive.
//
// Refinement: tasks/refinements/shell-package/shell_axiom_marks_extraction.md
//   (Consolidates the moderator's `apps/moderator/src/graph/
//   AxiomMarkBadge.test.tsx` (9 localized tooltip + 2 data-attribute +
//   2 deterministic-color cases) + the audience's `apps/audience/src/
//   graph/AxiomMarkBadge.test.tsx` (en-US smoke). The full cross-locale
//   matrix subsumes the audience smoke; the data-attribute + chromatic
//   determinism cases land once at the canonical home.)
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

import { axiomMarkColorFor } from '../facet-pill/participant-color.js';
import { createI18nInstance } from '../i18n/index.js';

import { AxiomMarkBadge } from './AxiomMarkBadge.js';
import type { AxiomMark } from './axiom-marks.js';

// Local `render(...)` shadow that wraps the synchronous testing-library
// render in `await act(async () => { ... })`. `useTranslation()`
// schedules a microtask-deferred setState when its internal i18next
// subscription registers on mount; flushing pending microtasks inside
// the async act block absorbs the deferred update so React doesn't
// emit "An update to <Component> was not wrapped in act(...)".
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const NODE_ID = '00000000-0000-4000-8000-000000000a01';
// PARTICIPANT_A and PARTICIPANT_B hash to two distinct palette buckets
// (sum-of-hex-digits mod 6 = 1 / 2) so the cross-participant distinct-
// color test pins the per-participant differentiation without
// depending on the 1-in-6 collision case.
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

describe('AxiomMarkBadge — localized tooltip per locale', () => {
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
      await render(<AxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('title')).toBe(EXPECTED[locale].tooltip);
    });

    it(`renders the localized aria-label for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      await render(<AxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('aria-label')).toBe(EXPECTED[locale].srLabel);
    });

    it(`renders the visible "A" glyph for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      await render(<AxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.textContent).toBe('A');
    });
  }
});

describe('AxiomMarkBadge — data attributes', () => {
  it('exposes `data-participant-id` matching the participantId prop', async () => {
    await render(<AxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_B })} />);
    const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_B);
  });

  it('exposes a testid of the form `axiom-mark-badge-{nodeId}-{participantId}`', async () => {
    const mark = makeMark({ nodeId: NODE_ID, participantId: PARTICIPANT_A });
    await render(<AxiomMarkBadge mark={mark} />);
    expect(screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`)).toBeTruthy();
  });
});

describe('AxiomMarkBadge — per-participant deterministic color', () => {
  it('applies the same Tailwind background class for the same participantId across two renders', async () => {
    const expectedColor = axiomMarkColorFor(PARTICIPANT_A);
    const { unmount } = await render(<AxiomMarkBadge mark={makeMark()} />);
    const first = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const firstClassName = first.className;
    expect(firstClassName).toContain(expectedColor.bg);
    expect(firstClassName).toContain(expectedColor.text);
    expect(firstClassName).toContain(expectedColor.ring);
    unmount();
    await render(<AxiomMarkBadge mark={makeMark()} />);
    const second = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(second.className).toBe(firstClassName);
  });

  it('applies a different background class for a different participantId (when palette buckets differ)', async () => {
    // PARTICIPANT_A and PARTICIPANT_B hash to different palette buckets
    // (sum-of-hex-digits: A→13%6=1, B→14%6=2). Pin the distinctness so
    // a future palette / hash refactor doesn't silently collapse them.
    await render(<AxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_A })} />);
    await render(<AxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_B })} />);
    const a = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const b = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    const aColor = axiomMarkColorFor(PARTICIPANT_A);
    const bColor = axiomMarkColorFor(PARTICIPANT_B);
    expect(aColor.bg).not.toBe(bColor.bg);
    expect(a.className).toContain(aColor.bg);
    expect(b.className).toContain(bColor.bg);
  });
});

// `screenName`-branch cases per
// `tasks/refinements/shell-package/shell_axiom_mark_panel_badge_consolidation.md`.
// When the optional `screenName` prop is provided the badge resolves
// `title` + `aria-label` via the `methodology.axiomMarkBadge.*` cluster
// (screen-name surface) instead of the default
// `methodology.axiomMark.*` cluster (UUID surface). The testid +
// `data-participant-id` + chromatic class triple are branch-independent.
describe('AxiomMarkBadge — screenName branch', () => {
  it('sets the title attribute to the resolved methodology.axiomMarkBadge.tooltip (screen-name literal in en-US)', async () => {
    await render(<AxiomMarkBadge mark={makeMark()} screenName="alice" />);
    const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(badge.getAttribute('title')).toBe('alice');
  });

  it('resolves the aria-label through methodology.axiomMarkBadge.srLabel (containing the screen name)', async () => {
    await render(<AxiomMarkBadge mark={makeMark()} screenName="alice" />);
    const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(badge.getAttribute('aria-label')).toBe('Bedrock by alice');
  });

  it('keeps the canonical testid + data-participant-id + chromatic class triple invariant across the branch toggle', async () => {
    const expectedColor = axiomMarkColorFor(PARTICIPANT_A);
    const { unmount } = await render(<AxiomMarkBadge mark={makeMark()} />);
    const withoutScreenName = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const baselineClassName = withoutScreenName.className;
    expect(withoutScreenName.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    unmount();
    await render(<AxiomMarkBadge mark={makeMark()} screenName="alice" />);
    const withScreenName = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(withScreenName.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(withScreenName.className).toBe(baselineClassName);
    expect(withScreenName.className).toContain(expectedColor.bg);
    expect(withScreenName.className).toContain(expectedColor.text);
    expect(withScreenName.className).toContain(expectedColor.ring);
  });

  const SR_LABEL_BY_LOCALE = {
    'en-US': 'Bedrock by alice',
    'pt-BR': 'Pedra fundamental de alice',
    'es-419': 'Fundamento de alice',
  } as const;

  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    it(`resolves the screen-name aria-label for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      await render(<AxiomMarkBadge mark={makeMark()} screenName="alice" />);
      const badge = screen.getByTestId(`axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('aria-label')).toBe(SR_LABEL_BY_LOCALE[locale]);
    });
  }
});
