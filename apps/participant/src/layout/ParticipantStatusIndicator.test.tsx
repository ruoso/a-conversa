// Tests for `<ParticipantStatusIndicator>` — the persistent connection-
// state chip rendered into the participant tablet footer.
//
// Refinement: tasks/refinements/participant-ui/part_status_indicator.md
//   (Test layers per ADR 0022 — Vitest component-shape suite,
//   Decision §7 — stub the source hook via `vi.mock`, not via a
//   test-only prop on the chip)
//
// Cases (7 total):
//   (a) Per-state attribute + label round-trip — 5 cases, one per
//       `WsConnectionStatus` arm. Asserts `data-status`, `data-status-tone`
//       and the rendered label text match the en-US catalog value.
//   (b) The container carries `role="status"` + `aria-live="polite"` —
//       1 case (sufficient to pin the ARIA contract; attributes do not
//       vary across states).
//   (c) The dot child carries `aria-hidden="true"` — 1 case (the colored
//       dot is decorative; the label is the announced text).
//
// The source hook is stubbed via `vi.mock('./useParticipantConnectionStatus')`
// so the chip's render-only contract is exercised end-to-end with no
// test-only prop API on the component itself.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import {
  createI18nInstance,
  I18nProvider,
  type I18nInstance,
  type WsConnectionStatus,
} from '@a-conversa/shell';

import { ParticipantStatusIndicator } from './ParticipantStatusIndicator';
import { useParticipantConnectionStatus } from './useParticipantConnectionStatus';

vi.mock('./useParticipantConnectionStatus', () => ({
  useParticipantConnectionStatus: vi.fn((): WsConnectionStatus => 'connecting'),
}));

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

beforeEach(() => {
  vi.mocked(useParticipantConnectionStatus).mockReturnValue('connecting');
});

afterEach(() => {
  cleanup();
});

function renderChip(): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <ParticipantStatusIndicator />
    </I18nProvider>,
  );
}

// Mirror of the catalog values for `participant.statusIndicator.*` —
// duplicated here as the per-state oracle so a catalog regression
// surfaces at the chip's test layer (not just the catalog parity check).
const EXPECTED: Record<
  WsConnectionStatus,
  { tone: 'neutral' | 'transient' | 'healthy' | 'error'; label: string }
> = {
  idle: { tone: 'neutral', label: 'Not connected' },
  connecting: { tone: 'transient', label: 'Connecting…' },
  open: { tone: 'healthy', label: 'Live' },
  reconnecting: { tone: 'transient', label: 'Reconnecting…' },
  closed: { tone: 'error', label: 'Disconnected' },
};

describe('<ParticipantStatusIndicator> — per-state attributes + label', () => {
  for (const status of ['idle', 'connecting', 'open', 'reconnecting', 'closed'] as const) {
    it(`renders data-status="${status}" with the expected tone + en-US label`, () => {
      vi.mocked(useParticipantConnectionStatus).mockReturnValue(status);
      renderChip();
      const container = screen.getByTestId('participant-status-indicator');
      expect(container.getAttribute('data-status')).toBe(status);
      expect(container.getAttribute('data-status-tone')).toBe(EXPECTED[status].tone);
      const label = screen.getByTestId('participant-status-indicator-label');
      expect(label.textContent).toBe(EXPECTED[status].label);
    });
  }
});

describe('<ParticipantStatusIndicator> — ARIA contract', () => {
  it('exposes role="status" + aria-live="polite" on the container', () => {
    vi.mocked(useParticipantConnectionStatus).mockReturnValue('open');
    renderChip();
    const container = screen.getByTestId('participant-status-indicator');
    expect(container.getAttribute('role')).toBe('status');
    expect(container.getAttribute('aria-live')).toBe('polite');
  });

  it('marks the colored dot as aria-hidden so only the label is announced', () => {
    vi.mocked(useParticipantConnectionStatus).mockReturnValue('open');
    renderChip();
    const dot = screen.getByTestId('participant-status-indicator-dot');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
  });
});
