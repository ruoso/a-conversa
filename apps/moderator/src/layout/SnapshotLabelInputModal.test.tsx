// Tests for `<SnapshotLabelInputModal>` — the F10 snapshot-label overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_label_input.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   (a) Renders with `data-testid="snapshot-label-input-modal"` /
//       `role="dialog"` / `aria-modal="true"`.
//   (b) Input is focused on mount.
//   (c) Typing updates the controlled state + helper count.
//   (d) Submit disabled when input is empty / whitespace-only.
//   (e) Submit disabled while `inFlight`.
//   (f) Enter in the input triggers submit when enabled.
//   (g) Escape calls `useSnapshotFlowStore.close()` when not in-flight.
//   (h) Escape is a no-op when `inFlight`.
//   (i) Backdrop click calls `close()` (no-op when clicking inside the card).
//   (j) Backdrop click is a no-op when `inFlight`.
//   (k) Cancel button calls `close()`.
//   (l) Cancel button disabled when `inFlight`.
//   (m) Error region renders with `role="alert"` + `data-error-code`.
//   (n) Error message is localized per code.
//   (o) Per-locale parity (en-US / pt-BR / es-419) resolves the eight modal keys.
//   (p) Input enforces `maxLength=128`.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { act } from 'react';
import i18next from 'i18next';

import {
  SnapshotLabelInputModal,
  resolveSnapshotLabelInputErrorMessage,
} from './SnapshotLabelInputModal';
import {
  resetLabelSnapshotStore,
  useLabelSnapshotStore,
  type UseLabelSnapshotActionResult,
  type WireError,
} from './useLabelSnapshotAction';
import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';
import { createI18nInstance, WsClientProvider } from '@a-conversa/shell';
import type { WsClient, WsClientStatus } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function makeStubClient(): WsClient {
  return {
    status: (): WsClientStatus => 'open',
    connect: (): void => undefined,
    close: (): void => undefined,
    killWebSocket: (): void => undefined,
    send: () => new Promise(() => undefined),
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
}

function wrap(children: ReactNode): ReactElement {
  return (
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={makeStubClient()}>
        <Routes>
          <Route path="/sessions/:id/operate" element={children} />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>
  );
}

function makeHookOverride(opts?: {
  submit?: (label: string) => Promise<void>;
  inFlight?: boolean;
  lastError?: WireError | undefined;
}): UseLabelSnapshotActionResult {
  return {
    submit: opts?.submit ?? (() => Promise.resolve()),
    inFlight: opts?.inFlight ?? false,
    lastError: opts?.lastError,
  };
}

beforeAll(async () => {
  await createI18nInstance('en-US');
});

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
  resetLabelSnapshotStore();
  resetSnapshotFlowStore();
  // The modal mounts via the parent subscription, but tests render it
  // directly. Pre-open the flag so close-path assertions can observe
  // the flip back to false.
  useSnapshotFlowStore.getState().open();
});

afterEach(() => {
  cleanup();
});

describe('resolveSnapshotLabelInputErrorMessage — error-code mapping', () => {
  const t = (key: string): string => `T:${key}`;

  it('maps moderator-only → catalog moderatorOnly message', () => {
    expect(
      resolveSnapshotLabelInputErrorMessage({ code: 'moderator-only', message: 'raw' }, t),
    ).toBe('T:moderator.snapshotLabelInput.errors.moderatorOnly');
  });

  it('maps sequence-mismatch → catalog sequenceMismatch message', () => {
    expect(
      resolveSnapshotLabelInputErrorMessage({ code: 'sequence-mismatch', message: 'raw' }, t),
    ).toBe('T:moderator.snapshotLabelInput.errors.sequenceMismatch');
  });

  it('maps timeout → catalog timeout message', () => {
    expect(resolveSnapshotLabelInputErrorMessage({ code: 'timeout', message: 'whatever' }, t)).toBe(
      'T:moderator.snapshotLabelInput.errors.timeout',
    );
  });

  it('unmapped code with a non-empty message → message verbatim', () => {
    expect(
      resolveSnapshotLabelInputErrorMessage(
        { code: 'invalid-label', message: 'label too long' },
        t,
      ),
    ).toBe('label too long');
  });

  it('unmapped code with an empty message → catalog unknown message', () => {
    expect(resolveSnapshotLabelInputErrorMessage({ code: 'weird', message: '' }, t)).toBe(
      'T:moderator.snapshotLabelInput.errors.unknown',
    );
  });
});

describe('SnapshotLabelInputModal — render shape', () => {
  it('(a) renders with role="dialog", aria-modal="true", aria-labelledby', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const root = screen.getByTestId('snapshot-label-input-modal');
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('aria-labelledby')).toBe('snapshot-label-input-title');
  });

  it('(b) input is focused on mount', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const input = screen.getByTestId('snapshot-label-input-field');
    expect(document.activeElement).toBe(input);
  });

  it('(c) typing updates the controlled state and the helper count', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const input = screen.getByTestId<HTMLInputElement>('snapshot-label-input-field');
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(input.value).toBe('Hello');
    const helper = screen.getByTestId('snapshot-label-input-helper');
    expect(helper.textContent).toContain('5');
    expect(helper.textContent).toContain('128');
  });

  it('(p) input has maxLength=128', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const input = screen.getByTestId<HTMLInputElement>('snapshot-label-input-field');
    expect(input.maxLength).toBe(128);
  });
});

describe('SnapshotLabelInputModal — submit button gating', () => {
  it('(d) submit disabled when input is empty', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const submit = screen.getByTestId<HTMLButtonElement>('snapshot-label-input-submit');
    expect(submit.disabled).toBe(true);
  });

  it('(d) submit disabled when input is whitespace-only', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const input = screen.getByTestId<HTMLInputElement>('snapshot-label-input-field');
    fireEvent.change(input, { target: { value: '    ' } });
    const submit = screen.getByTestId<HTMLButtonElement>('snapshot-label-input-submit');
    expect(submit.disabled).toBe(true);
  });

  it('(e) submit disabled while inFlight=true', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride({ inFlight: true })} />));
    const submit = screen.getByTestId<HTMLButtonElement>('snapshot-label-input-submit');
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('data-snapshot-label-state')).toBe('in-flight');
  });

  it('(f) Enter in the input triggers submit when enabled', () => {
    const submit = vi.fn(() => Promise.resolve());
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride({ submit })} />));
    const input = screen.getByTestId<HTMLInputElement>('snapshot-label-input-field');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('hello');
  });

  it('clicking submit fires hook.submit with the trimmed label', () => {
    const submit = vi.fn(() => Promise.resolve());
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride({ submit })} />));
    const input = screen.getByTestId<HTMLInputElement>('snapshot-label-input-field');
    fireEvent.change(input, { target: { value: '  padded  ' } });
    fireEvent.click(screen.getByTestId('snapshot-label-input-submit'));
    expect(submit).toHaveBeenCalledWith('padded');
  });
});

describe('SnapshotLabelInputModal — close-paths', () => {
  it('(g) Escape calls useSnapshotFlowStore.close() when not in-flight', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('(h) Escape is a no-op when inFlight=true', () => {
    // Reflect inFlight in the LIVE store so the Escape handler observes
    // it via `useLabelSnapshotStore.getState().inFlight`.
    useLabelSnapshotStore.getState().setInFlight(true);
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride({ inFlight: true })} />));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('(i) backdrop click calls close() when not in-flight', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const root = screen.getByTestId('snapshot-label-input-modal');
    fireEvent.mouseDown(root, { target: root });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('(i) clicking INSIDE the card does NOT close', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    const input = screen.getByTestId('snapshot-label-input-field');
    fireEvent.mouseDown(input);
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('(j) backdrop click is a no-op when inFlight=true', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride({ inFlight: true })} />));
    const root = screen.getByTestId('snapshot-label-input-modal');
    fireEvent.mouseDown(root, { target: root });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('(k) cancel button calls close() when not in-flight', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    fireEvent.click(screen.getByTestId('snapshot-label-input-cancel'));
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });

  it('(k) cancel button clears the in-hook lastError', () => {
    useLabelSnapshotStore.getState().setError({ code: 'moderator-only', message: 'raw' });
    render(
      wrap(
        <SnapshotLabelInputModal
          hookOverride={makeHookOverride({
            lastError: { code: 'moderator-only', message: 'raw' },
          })}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId('snapshot-label-input-cancel'));
    expect(useLabelSnapshotStore.getState().lastError).toBeUndefined();
  });

  it('(l) cancel button disabled when inFlight=true', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride({ inFlight: true })} />));
    const cancel = screen.getByTestId<HTMLButtonElement>('snapshot-label-input-cancel');
    expect(cancel.disabled).toBe(true);
  });
});

describe('SnapshotLabelInputModal — inline error region', () => {
  it('(m) error region renders with role="alert" and data-error-code', () => {
    render(
      wrap(
        <SnapshotLabelInputModal
          hookOverride={makeHookOverride({
            lastError: { code: 'sequence-mismatch', message: 'raw' },
          })}
        />,
      ),
    );
    const region = screen.getByTestId('snapshot-label-input-error');
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('sequence-mismatch');
  });

  it('(n) error message is the localized sequenceMismatch message', () => {
    render(
      wrap(
        <SnapshotLabelInputModal
          hookOverride={makeHookOverride({
            lastError: { code: 'sequence-mismatch', message: 'raw' },
          })}
        />,
      ),
    );
    const region = screen.getByTestId('snapshot-label-input-error');
    expect(region.textContent).toBe('The session has moved on — please try again.');
  });

  it('does NOT render the error region when lastError is undefined', () => {
    render(wrap(<SnapshotLabelInputModal hookOverride={makeHookOverride()} />));
    expect(screen.queryByTestId('snapshot-label-input-error')).toBeNull();
  });

  it('input carries aria-invalid="true" when an error is set', () => {
    render(
      wrap(
        <SnapshotLabelInputModal
          hookOverride={makeHookOverride({
            lastError: { code: 'moderator-only', message: 'raw' },
          })}
        />,
      ),
    );
    const input = screen.getByTestId<HTMLInputElement>('snapshot-label-input-field');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('SnapshotLabelInputModal — i18n catalog parity', () => {
  const KEYS = [
    'moderator.snapshotLabelInput.title',
    'moderator.snapshotLabelInput.fieldLabel',
    'moderator.snapshotLabelInput.placeholder',
    'moderator.snapshotLabelInput.helper',
    'moderator.snapshotLabelInput.submitLabel',
    'moderator.snapshotLabelInput.inFlightLabel',
    'moderator.snapshotLabelInput.cancelLabel',
    'moderator.snapshotLabelInput.errors.moderatorOnly',
    'moderator.snapshotLabelInput.errors.sequenceMismatch',
    'moderator.snapshotLabelInput.errors.timeout',
    'moderator.snapshotLabelInput.errors.unknown',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`(o) resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        expect(value).not.toContain('[t-missing]');
        await i18next.changeLanguage('en-US');
      });
    }
  }
});
