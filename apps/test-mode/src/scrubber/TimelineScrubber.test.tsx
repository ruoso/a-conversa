// Vitest + RTL cases for the test-mode timeline scrubber surface.
//
// Refinement: tasks/refinements/replay_test/test_mode_timeline_scrubber.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications — the
//   `data-testid` seams are the pinned regression surface); 0024
//   (react-i18next); 0043 (the client position-navigation contract).
//
// Drives `SessionScrubberContainer` (the real lifted-position owner) with a
// stubbed `GraphView` (asserts the projected prefix via its event count) and
// a stubbed `SnapshotJumpList` (the live snapshot fetch + jump is pinned by
// the Playwright e2e). Pins: the range bounds, the initial head position,
// next/prev stepping + the prefix it feeds the graph, the boundary `disabled`
// affordances, range-drag clamping, and the empty-log baseline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act } from 'react';

import { createI18nInstance } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

// Stub the heavy Cytoscape renderer: expose the projected prefix length so a
// test can assert the graph re-renders at `events.filter(e => e.sequence <= p)`.
vi.mock('@a-conversa/graph-view', () => ({
  GraphView: ({ events }: { events: readonly Event[]; instanceKey: string }) => (
    <div data-testid="graph-view-stub" data-event-count={events.length} />
  ),
  // The changes-panel sibling projects both prefixes through `projectGraph`;
  // its readout is pinned by `changes/ChangeHighlights.test.tsx`, so here the
  // stub returns an empty projection — the scrubber tests assert only the
  // graph prefix and the navigation controls.
  projectGraph: () => ({ nodes: [], edges: [] }),
}));

// Stub the connected snapshot list (it fetches on mount); the list-render →
// click row → jump flow is the Playwright e2e's job (Acceptance §5).
vi.mock('@a-conversa/shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@a-conversa/shell')>();
  return {
    ...actual,
    SnapshotJumpList: ({ sessionId }: { sessionId: string; onJump: (p: number) => void }) => (
      <div data-testid="snapshot-jump-stub" data-session-id={sessionId} />
    ),
  };
});

// Imported after the mocks are registered so it binds the stubs.
const { SessionScrubberContainer } = await import('./SessionScrubberContainer');

const SESSION = '00000000-0000-4000-8000-000000000099';

function makeEvent(sequence: number, kind: string): Event {
  return {
    id: `00000000-0000-4000-8000-0000000${String(100 + sequence)}`,
    sessionId: SESSION,
    sequence,
    kind,
    actor: '00000000-0000-4000-8000-000000000001',
    payload: {},
    createdAt: `2026-06-01T10:00:0${String(sequence)}.000Z`,
  } as unknown as Event;
}

// Six contiguous events (sequences 1..6); head sequence is 6.
const SIX_EVENTS: Event[] = [
  makeEvent(1, 'session-created'),
  makeEvent(2, 'participant-joined'),
  makeEvent(3, 'node-created'),
  makeEvent(4, 'snapshot-created'),
  makeEvent(5, 'node-created'),
  makeEvent(6, 'edge-created'),
];
const HEAD = 6;

async function renderScrubber(events: readonly Event[]): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(<SessionScrubberContainer sessionId={SESSION} events={events} />);
    return Promise.resolve();
  });
  return result;
}

function range(): HTMLInputElement {
  return screen.getByTestId<HTMLInputElement>('test-mode-scrubber-range');
}
function status(): HTMLElement {
  return screen.getByTestId('test-mode-scrubber-status');
}
function graphCount(): number {
  return Number(screen.getByTestId('graph-view-stub').getAttribute('data-event-count'));
}
function disabled(testId: string): boolean {
  return screen.getByTestId<HTMLButtonElement>(testId).disabled;
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('TimelineScrubber — initial render', () => {
  it('renders the range bounds and opens at the head position', async () => {
    await renderScrubber(SIX_EVENTS);

    const input = range();
    expect(input.min).toBe('0');
    expect(input.max).toBe(String(HEAD));
    expect(input.step).toBe('1');

    expect(status().getAttribute('data-position')).toBe(String(HEAD));
    expect(status().getAttribute('data-head')).toBe(String(HEAD));
    // Opening at the head projects the whole log.
    expect(graphCount()).toBe(HEAD);
  });
});

describe('TimelineScrubber — stepping', () => {
  it('next advances the position by one and grows the projected prefix', async () => {
    await renderScrubber(SIX_EVENTS);

    // Scrub back to a mid position first (the surface opens at the head).
    fireEvent.change(range(), { target: { value: '3' } });
    expect(status().getAttribute('data-position')).toBe('3');
    expect(graphCount()).toBe(3); // events with sequence <= 3

    fireEvent.click(screen.getByTestId('test-mode-scrubber-next'));
    expect(status().getAttribute('data-position')).toBe('4');
    expect(graphCount()).toBe(4);
  });

  it('prev decrements the position and shrinks the projected prefix', async () => {
    await renderScrubber(SIX_EVENTS);

    fireEvent.change(range(), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('test-mode-scrubber-prev'));
    expect(status().getAttribute('data-position')).toBe('2');
    expect(graphCount()).toBe(2);
  });
});

describe('TimelineScrubber — boundary affordances', () => {
  it('disables prev at the baseline and next at the head', async () => {
    await renderScrubber(SIX_EVENTS);

    // Opens at the head: next is disabled, prev is enabled.
    expect(disabled('test-mode-scrubber-next')).toBe(true);
    expect(disabled('test-mode-scrubber-prev')).toBe(false);

    // Drag to the baseline: prev is disabled, next is enabled.
    fireEvent.change(range(), { target: { value: '0' } });
    expect(disabled('test-mode-scrubber-prev')).toBe(true);
    expect(disabled('test-mode-scrubber-next')).toBe(false);
  });
});

describe('TimelineScrubber — range drag', () => {
  it('clamps an out-of-range drag value and re-projects the graph', async () => {
    await renderScrubber(SIX_EVENTS);

    // A value beyond the head clamps to the head.
    fireEvent.change(range(), { target: { value: '99' } });
    expect(status().getAttribute('data-position')).toBe(String(HEAD));
    expect(graphCount()).toBe(HEAD);

    // A negative value clamps to the baseline.
    fireEvent.change(range(), { target: { value: '-4' } });
    expect(status().getAttribute('data-position')).toBe('0');
    expect(graphCount()).toBe(0);

    // An in-range value lands verbatim and projects its prefix.
    fireEvent.change(range(), { target: { value: '2' } });
    expect(status().getAttribute('data-position')).toBe('2');
    expect(graphCount()).toBe(2);
  });
});

describe('TimelineScrubber — empty log', () => {
  it('renders the baseline scrubber with no traversable stops and an empty graph', async () => {
    await renderScrubber([]);

    const input = range();
    expect(input.max).toBe('0');
    expect(status().getAttribute('data-position')).toBe('0');
    expect(status().getAttribute('data-head')).toBe('0');
    // On an empty log 0 is both start and end → both controls disabled.
    expect(disabled('test-mode-scrubber-prev')).toBe(true);
    expect(disabled('test-mode-scrubber-next')).toBe(true);
    expect(graphCount()).toBe(0);
  });
});
