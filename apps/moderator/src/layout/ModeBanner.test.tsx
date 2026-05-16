// Tests for `<ModeBanner>` — the capture-pane mode banner.
//
// Refinement: tasks/refinements/moderator-ui/mod_mode_banner.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The banner mounts with stable testids (`mode-banner`,
//      `mode-banner-label`, `mode-banner-description`) so downstream
//      tests can locate it without scraping store internals.
//   2. The banner is reachable via the labelled `role="status"`
//      accessibility surface with `aria-live="polite"`, so screen
//      readers announce mode changes politely.
//   3. Each of the eight `CaptureMode` values renders its localized
//      label + description from the catalog. This is the regression
//      net for the "banner reflects the store" contract — the
//      downstream mode-entry tasks (F2 / F6 / F8 / etc.) all call
//      `setMode(...)` and expect the banner to update.
//   4. The `data-mode` attribute on the banner root reflects the
//      current store value, giving downstream tests a single-attribute
//      assertion that does not depend on the (translatable) label
//      string.
//   5. The banner mounts inside `<BottomStripCapture>`'s
//      `bottom-strip-mode-banner` slot when composed via the
//      scaffold's `modeBanner` prop, proving the slot wiring the
//      `mod_bottom_strip_capture` task established carries this
//      component end-to-end.
//   6. Per-locale parity round-trip on all sixteen catalog keys
//      (eight modes × two leaves) resolves to non-empty strings in
//      en-US / pt-BR / es-419 and the non-en-US values differ from
//      en-US (translation, not copy).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { ModeBanner } from './ModeBanner';
import { BottomStripCapture } from './BottomStripCapture';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { createI18nInstance } from '@a-conversa/shell';

const MODES: readonly CaptureMode[] = [
  'idle',
  'capture-statement',
  'decompose',
  'interpretive-split',
  'capture-defeater',
  'operationalization',
  'warrant-elicitation',
  'meta-move',
  'axiom-mark',
] as const;

const EN_LABELS: Record<CaptureMode, string> = {
  idle: 'Idle',
  'capture-statement': 'Capture statement',
  decompose: 'Decompose',
  'interpretive-split': 'Interpretive split',
  'capture-defeater': 'Capture defeater',
  operationalization: 'Operationalization',
  'warrant-elicitation': 'Warrant elicitation',
  'meta-move': 'Meta-move',
  'axiom-mark': 'Axiom-mark',
};

const EN_DESCRIPTIONS: Record<CaptureMode, string> = {
  idle: "Waiting for the moderator's next move.",
  'capture-statement': 'Compose a new statement and classify it before proposing.',
  decompose: 'Break the selected statement into its component claims.',
  'interpretive-split':
    'Surface multiple readings of the selected statement when the wording admits more than one.',
  'capture-defeater': 'Record a rebuttal against the selected statement.',
  operationalization: 'Make a disputed statement testable by naming its conditions.',
  'warrant-elicitation': 'Surface the warrant that licenses the inference from data to claim.',
  'meta-move': 'Capture a reframe, scope change, or stance about the discussion itself.',
  'axiom-mark': 'Mark a statement as a bedrock position the participant will not retreat from.',
};

beforeEach(async () => {
  // Reset the capture store to its documented default so each test
  // starts from `idle`. The store does not expose a `reset to defaults`
  // helper that bypasses `text` / `classification` — `reset()` does
  // exactly that and is the closest API.
  useCaptureStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('ModeBanner — capture-pane mode banner', () => {
  it('renders the banner with the stable mode-banner testid', () => {
    render(<ModeBanner />);
    expect(screen.getByTestId('mode-banner')).toBeTruthy();
  });

  it('exposes label + description sub-testids', () => {
    render(<ModeBanner />);
    expect(screen.getByTestId('mode-banner-label')).toBeTruthy();
    expect(screen.getByTestId('mode-banner-description')).toBeTruthy();
  });

  it('is reachable as a polite status region for assistive tech', () => {
    render(<ModeBanner />);
    const banner = screen.getByTestId('mode-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  it('reflects the default `idle` mode on first render', () => {
    render(<ModeBanner />);
    const banner = screen.getByTestId('mode-banner');
    expect(banner.getAttribute('data-mode')).toBe('idle');
    expect(screen.getByTestId('mode-banner-label').textContent).toBe(EN_LABELS.idle);
    expect(screen.getByTestId('mode-banner-description').textContent).toBe(EN_DESCRIPTIONS.idle);
  });

  for (const mode of MODES) {
    it(`renders the localized label + description for mode="${mode}"`, () => {
      act(() => {
        useCaptureStore.getState().setMode(mode);
      });
      render(<ModeBanner />);
      const banner = screen.getByTestId('mode-banner');
      expect(banner.getAttribute('data-mode')).toBe(mode);
      expect(screen.getByTestId('mode-banner-label').textContent).toBe(EN_LABELS[mode]);
      expect(screen.getByTestId('mode-banner-description').textContent).toBe(EN_DESCRIPTIONS[mode]);
    });
  }

  it('updates when `captureStore.mode` changes after mount', () => {
    render(<ModeBanner />);
    expect(screen.getByTestId('mode-banner').getAttribute('data-mode')).toBe('idle');
    act(() => {
      useCaptureStore.getState().setMode('decompose');
    });
    expect(screen.getByTestId('mode-banner').getAttribute('data-mode')).toBe('decompose');
    expect(screen.getByTestId('mode-banner-label').textContent).toBe(EN_LABELS.decompose);
  });

  it('mounts inside the bottom-strip-mode-banner slot when composed through <BottomStripCapture>', () => {
    render(<BottomStripCapture modeBanner={<ModeBanner />} />);
    const slot = screen.getByTestId('bottom-strip-mode-banner');
    const banner = screen.getByTestId('mode-banner');
    expect(slot.contains(banner)).toBe(true);
    // The scaffold's placeholder copy must NOT render alongside the
    // real banner once the slot is filled.
    expect(slot.textContent).not.toContain('[mode banner]');
  });
});

describe('ModeBanner — i18n catalog parity', () => {
  // The acceptance criterion: every new `moderator.modeBanner.*` leaf
  // resolves to a non-empty string in every v1 locale, and the
  // non-en-US values differ from en-US (a sanity check that we
  // actually translated, not just copied).
  const KEYS = MODES.flatMap((mode) => [
    `moderator.modeBanner.${mode}.label`,
    `moderator.modeBanner.${mode}.description`,
  ]);
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('non-en-US locales differ from en-US for every mode-banner leaf', async () => {
    await i18next.changeLanguage('en-US');
    const enValues = KEYS.map((k) => i18next.t(k));
    for (const locale of ['pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (let i = 0; i < KEYS.length; i++) {
        const v = i18next.t(KEYS[i] as string);
        expect(v, `${locale}::${KEYS[i] as string} should differ from en-US`).not.toBe(enValues[i]);
      }
    }
    await i18next.changeLanguage('en-US');
  });
});
