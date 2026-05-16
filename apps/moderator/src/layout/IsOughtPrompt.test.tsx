import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { BottomStripCapture } from './BottomStripCapture';
import { IsOughtPrompt } from './IsOughtPrompt';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { initI18n } from '../i18n';

const DIAGNOSTIC_MODES: readonly CaptureMode[] = [
  'operationalization',
  'warrant-elicitation',
] as const;
const NON_DIAGNOSTIC_MODES: readonly CaptureMode[] = [
  'idle',
  'capture-statement',
  'decompose',
  'interpretive-split',
  'capture-defeater',
  'meta-move',
  'axiom-mark',
] as const;

beforeEach(async () => {
  useCaptureStore.getState().reset();
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('IsOughtPrompt', () => {
  for (const mode of DIAGNOSTIC_MODES) {
    it(`renders in mode="${mode}"`, () => {
      act(() => {
        useCaptureStore.getState().setMode(mode);
      });
      render(<IsOughtPrompt />);
      expect(screen.getByTestId('is-ought-prompt').getAttribute('data-mode')).toBe(mode);
      expect(screen.getByTestId('is-ought-prompt-question').textContent).toBe(
        'Does this disputed wording carry an ought-claim that needs to be separated from what is?',
      );
    });
  }

  for (const mode of NON_DIAGNOSTIC_MODES) {
    it(`is hidden in mode="${mode}"`, () => {
      act(() => {
        useCaptureStore.getState().setMode(mode);
      });
      render(<IsOughtPrompt />);
      expect(screen.queryByTestId('is-ought-prompt')).toBeNull();
    });
  }

  it('mounts in the bottom-strip mode-banner slot', () => {
    act(() => {
      useCaptureStore.getState().setMode('operationalization');
    });
    render(<BottomStripCapture modeBanner={<IsOughtPrompt />} />);
    const slot = screen.getByTestId('bottom-strip-mode-banner');
    const prompt = screen.getByTestId('is-ought-prompt');
    expect(slot.contains(prompt)).toBe(true);
  });

  it('renders placeholder actions as inert controls in this leaf', () => {
    act(() => {
      useCaptureStore.getState().setMode('operationalization');
    });
    render(<IsOughtPrompt />);
    const decompose = screen.getByTestId('is-ought-prompt-action-decompose');
    const warrant = screen.getByTestId('is-ought-prompt-action-warrant');
    expect(decompose.getAttribute('disabled')).not.toBeNull();
    expect(warrant.getAttribute('disabled')).not.toBeNull();
    expect(decompose.getAttribute('aria-disabled')).toBe('true');
    expect(warrant.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(decompose);
    fireEvent.click(warrant);
    expect(screen.getByTestId('is-ought-prompt').getAttribute('data-mode')).toBe(
      'operationalization',
    );
  });
});

describe('IsOughtPrompt — i18n catalog parity', () => {
  const KEYS = [
    'moderator.diagnostic.isOughtPrompt.ariaLabel',
    'moderator.diagnostic.isOughtPrompt.question',
    'moderator.diagnostic.isOughtPrompt.guidance',
    'moderator.diagnostic.isOughtPrompt.action.decompose',
    'moderator.diagnostic.isOughtPrompt.action.warrant',
  ] as const;

  it('resolves all keys to non-empty strings in each locale', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (const key of KEYS) {
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
      }
    }
    await i18next.changeLanguage('en-US');
  });

  it('non-en-US values differ from en-US for each key', async () => {
    await i18next.changeLanguage('en-US');
    const enValues = KEYS.map((k) => i18next.t(k));
    for (const locale of ['pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i] as (typeof KEYS)[number];
        expect(i18next.t(key), `${locale}::${key} should differ from en-US`).not.toBe(enValues[i]);
      }
    }
    await i18next.changeLanguage('en-US');
  });
});
