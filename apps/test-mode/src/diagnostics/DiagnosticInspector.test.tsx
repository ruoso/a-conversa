// Vitest + RTL cases for the test-mode diagnostic inspector panel.
//
// Refinement: tasks/refinements/replay_test/test_mode_diagnostic_inspector.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications — the
//   `data-testid` seams are the pinned regression surface); 0024
//   (react-i18next); 0044 (the panel fetches a backend endpoint — the
//   diagnostics computation is server-only, so `fetch` is stubbed here, the
//   shell's established hook-test idiom).
//
// Drives mocked-`fetch` responses through the panel: a mix of blocking +
// advisory diagnostics renders each entry under its severity group with the
// affected ids verbatim; the loading and error states render (error with a
// recovering retry); a zero-diagnostics response is the clean empty state
// (the `position 0` baseline shares this path); a position change refetches
// and a late stale response is ignored; an unrecognized kind renders a
// generic fallback row without throwing. Plain DOM assertions
// (`textContent` / `queryByTestId`) — jest-dom matchers are not wired into
// this workspace's Vitest setup.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { createI18nInstance } from '@a-conversa/shell';

import { DiagnosticInspector } from './DiagnosticInspector';

const SESSION = '00000000-0000-4000-8000-000000000099';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const NODE_C = '00000000-0000-4000-8000-00000000000c';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';

const CYCLE = { kind: 'cycle', nodes: [NODE_A, NODE_B] };
const CONTRADICTION = { kind: 'contradiction', nodeA: NODE_A, nodeB: NODE_B, edges: [EDGE_A] };
const DANGLING = { kind: 'dangling-claim', nodeId: NODE_C };

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

describe('DiagnosticInspector — blocking + advisory rendering', () => {
  it('renders each entry under its severity group with affected ids verbatim', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ diagnostics: [CYCLE, DANGLING] })));

    render(<DiagnosticInspector sessionId={SESSION} position={5} />);

    const blocking = await screen.findByTestId('test-mode-diagnostics-blocking');
    // the cycle's nodes render verbatim under blocking
    expect(blocking.textContent).toContain(NODE_A);
    expect(blocking.textContent).toContain(NODE_B);

    const advisory = screen.getByTestId('test-mode-diagnostics-advisory');
    // the dangling-claim's nodeId renders verbatim under advisory
    expect(advisory.textContent).toContain(NODE_C);

    expect(screen.queryByTestId('test-mode-diagnostics-empty')).toBeNull();
    expect(screen.queryByTestId('test-mode-diagnostics-error')).toBeNull();
  });

  it('sends the position to the diagnostics endpoint with credentials + Accept', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ diagnostics: [] })));
    global.fetch = fetchMock;

    render(<DiagnosticInspector sessionId={SESSION} position={7} />);
    await screen.findByTestId('test-mode-diagnostics-empty');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sessions/${SESSION}/diagnostics?position=7`);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });
});

describe('DiagnosticInspector — loading and error', () => {
  it('shows the loading state while the request is in flight', () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    render(<DiagnosticInspector sessionId={SESSION} position={4} />);

    expect(screen.getByTestId('test-mode-diagnostics-loading')).not.toBeNull();
  });

  it('shows the error state with a retry that recovers on a non-OK response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ diagnostics: [CYCLE] }));
    global.fetch = fetchMock;

    render(<DiagnosticInspector sessionId={SESSION} position={3} />);

    const retry = await screen.findByTestId('test-mode-diagnostics-retry');
    fireEvent.click(retry);

    const blocking = await screen.findByTestId('test-mode-diagnostics-blocking');
    expect(blocking.textContent).toContain(NODE_A);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a network throw to the error state', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    render(<DiagnosticInspector sessionId={SESSION} position={3} />);

    expect(await screen.findByTestId('test-mode-diagnostics-error')).not.toBeNull();
  });
});

describe('DiagnosticInspector — empty / baseline', () => {
  it('renders the clean empty state when the endpoint returns zero diagnostics', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ diagnostics: [] })));

    render(<DiagnosticInspector sessionId={SESSION} position={42} />);

    expect(await screen.findByTestId('test-mode-diagnostics-empty')).not.toBeNull();
    expect(screen.queryByTestId('test-mode-diagnostics-blocking')).toBeNull();
    expect(screen.queryByTestId('test-mode-diagnostics-advisory')).toBeNull();
  });

  it('treats position 0 (empty baseline) as the clean empty state, not an error', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ diagnostics: [] })));

    render(<DiagnosticInspector sessionId={SESSION} position={0} />);

    expect(await screen.findByTestId('test-mode-diagnostics-empty')).not.toBeNull();
    expect(screen.queryByTestId('test-mode-diagnostics-error')).toBeNull();
  });
});

describe('DiagnosticInspector — position change + stale guard', () => {
  it('refetches on position change and ignores a late stale response', async () => {
    let resolveFirst!: (r: Response) => void;
    let resolveSecond!: (r: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    global.fetch = fetchMock;

    const { rerender } = render(<DiagnosticInspector sessionId={SESSION} position={5} />);
    // Step to a new position before the position-5 request resolves.
    rerender(<DiagnosticInspector sessionId={SESSION} position={6} />);

    // Resolve the newer (position 6) request first — its diagnostics paint.
    await act(async () => {
      resolveSecond(jsonResponse({ diagnostics: [CONTRADICTION] }));
      await second;
    });
    const blocking = await screen.findByTestId('test-mode-diagnostics-blocking');
    expect(blocking.textContent).toContain(NODE_A);

    // Now resolve the stale (position 5) request — it must be ignored, leaving
    // the panel on the position-6 diagnostics with no advisory leak.
    await act(async () => {
      resolveFirst(jsonResponse({ diagnostics: [DANGLING] }));
      await first;
    });
    expect(screen.getByTestId('test-mode-diagnostics-blocking').textContent).toContain(NODE_A);
    expect(screen.queryByTestId('test-mode-diagnostics-advisory')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('DiagnosticInspector — unknown kind', () => {
  it('renders a generic fallback row without throwing', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ diagnostics: [{ kind: 'future-kind', nodeId: NODE_A }] })),
    );

    render(<DiagnosticInspector sessionId={SESSION} position={9} />);

    const fallback = await screen.findByTestId('test-mode-diagnostics-fallback');
    // the raw discriminant renders verbatim
    expect(fallback.textContent).toContain('future-kind');
    expect(screen.queryByTestId('test-mode-diagnostics-blocking')).toBeNull();
  });
});
