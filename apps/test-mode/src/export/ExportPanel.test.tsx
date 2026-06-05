// Vitest + RTL cases for the test-mode export panel.
//
// Refinement: tasks/refinements/replay_test/test_mode_export_position.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications — the
//   `data-testid` seams are the pinned regression surface); 0024
//   (react-i18next); 0043 (the read position obeys the `0..head` sequence
//   space).
//
// Drives the real hook through a mocked `fetch` (the shell's established
// hook-test idiom — see `DiagnosticInspector.test.tsx`): the idle state shows
// only the Export affordance with no readout and issues no fetch; clicking
// Export loads then renders the pretty-printed envelope (its `sequence` + a
// known `projection` field, `data-position`) and reveals the download
// affordance; activating the download builds a `Blob` and triggers an anchor
// click with the `session-<id>-position-<seq>.json` filename (a stubbed
// `URL.createObjectURL` + anchor-click spy); the error state renders a
// recovering retry; and a `position` change after a successful export clears
// the readout back to idle. Plain DOM assertions (`textContent` /
// `queryByTestId`) — jest-dom matchers are not wired into this workspace's
// Vitest setup.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { createI18nInstance } from '@a-conversa/shell';

import { ExportPanel } from './ExportPanel';

const SESSION = '00000000-0000-4000-8000-000000000099';

function envelope(sequence: number): Record<string, unknown> {
  return {
    sessionId: SESSION,
    sequence,
    projection: { lastAppliedSequence: sequence, nodes: [], edges: [] },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ORIGINAL_FETCH = global.fetch;

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('ExportPanel — idle', () => {
  it('shows only the Export affordance and issues no fetch until clicked', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    global.fetch = fetchMock;

    render(<ExportPanel sessionId={SESSION} position={5} />);

    expect(screen.getByTestId('test-mode-export-button')).not.toBeNull();
    expect(screen.queryByTestId('test-mode-export-readout')).toBeNull();
    expect(screen.queryByTestId('test-mode-export-download')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ExportPanel — export round-trip', () => {
  it('clicking Export loads then renders the readout + download affordance', async () => {
    let resolve!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolve = r;
    });
    global.fetch = vi.fn(() => pending);

    render(<ExportPanel sessionId={SESSION} position={264} />);
    fireEvent.click(screen.getByTestId('test-mode-export-button'));

    expect(screen.getByTestId('test-mode-export-loading')).not.toBeNull();

    resolve(jsonResponse(envelope(264)));
    const readout = await screen.findByTestId('test-mode-export-readout');

    // The pretty-printed envelope carries its sequence and a known opaque
    // projection field, rendered verbatim.
    expect(readout.textContent).toContain('"sequence": 264');
    expect(readout.textContent).toContain('lastAppliedSequence');
    expect(readout.getAttribute('data-position')).toBe('264');
    expect(screen.getByTestId('test-mode-export-download')).not.toBeNull();
  });

  it('the download affordance builds a Blob and triggers a named anchor click', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(envelope(12))));

    // Captured to restore the real globals in `finally`; not invoked here.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const origCreate = URL.createObjectURL;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const origRevoke = URL.revokeObjectURL;
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    let clickedDownload = '';
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedDownload = this.download;
    });

    try {
      render(<ExportPanel sessionId={SESSION} position={12} />);
      fireEvent.click(screen.getByTestId('test-mode-export-button'));

      const download = await screen.findByTestId('test-mode-export-download');
      fireEvent.click(download);

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const firstCall = createObjectURL.mock.calls[0];
      expect(firstCall?.[0]).toBeInstanceOf(Blob);
      expect(clickedDownload).toBe(`session-${SESSION}-position-12.json`);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      clickSpy.mockRestore();
    }
  });
});

describe('ExportPanel — error + retry', () => {
  it('renders the error state with a retry that recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'out of range' }, 400))
      .mockResolvedValueOnce(jsonResponse(envelope(9)));
    global.fetch = fetchMock;

    render(<ExportPanel sessionId={SESSION} position={9} />);
    fireEvent.click(screen.getByTestId('test-mode-export-button'));

    const retry = await screen.findByTestId('test-mode-export-retry');
    expect(screen.getByTestId('test-mode-export-error')).not.toBeNull();
    fireEvent.click(retry);

    const readout = await screen.findByTestId('test-mode-export-readout');
    expect(readout.getAttribute('data-position')).toBe('9');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ExportPanel — position-change reset', () => {
  it('clears the readout back to idle when the position prop changes after a successful export', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(envelope(8))));

    const { rerender } = render(<ExportPanel sessionId={SESSION} position={8} />);
    fireEvent.click(screen.getByTestId('test-mode-export-button'));
    await screen.findByTestId('test-mode-export-readout');

    rerender(<ExportPanel sessionId={SESSION} position={7} />);

    expect(screen.queryByTestId('test-mode-export-readout')).toBeNull();
    expect(screen.getByTestId('test-mode-export-button')).not.toBeNull();
  });
});
