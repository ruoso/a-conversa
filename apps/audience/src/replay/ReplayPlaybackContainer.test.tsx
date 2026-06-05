// Vitest + RTL cases for the audience replay playback controls.
//
// Refinement: tasks/refinements/replay_test/replay_playback_controls.md
//   (Acceptance §1 — controls + stepping: the `ready` render shows
//    play/pause + step-back + step-forward + a head-seeded position readout;
//    step-back decrements + step-forward increments the position / prefix;
//    step-back is disabled at `0`, step-forward at the head. Acceptance §2 —
//    the play loop under fake timers: play auto-advances one event per tick,
//    self-pauses at the head with its timer cleared, restarts from `0` when
//    play is pressed at the head, stops on pause mid-run, and clears its
//    timer on unmount with no post-unmount tick.)
// ADRs:        0006 (Vitest), 0022 (the `data-testid` seams are the pinned
//   regression surface), 0024 (react-i18next), 0043 (the client
//   position-navigation contract this consumes).
//
// Drives the real `ReplayPlaybackContainer` (the lifted-position owner +
// the `useReplayPlayback` loop) with a stubbed `GraphView` that exposes the
// projected prefix length, so a test can assert the graph re-renders at
// `events.filter(e => e.sequence <= position)`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import { act } from 'react';
import i18next from 'i18next';

import { createI18nInstance } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

// Stub the heavy Cytoscape renderer: expose the projected prefix length so a
// test can assert the graph re-renders at `events.filter(e => e.sequence <= p)`.
vi.mock('@a-conversa/graph-view', () => ({
  GraphView: ({ events }: { events: readonly Event[]; instanceKey: string }) => (
    <div data-testid="audience-graph-root" data-event-count={events.length} />
  ),
}));

// Imported after the mock is registered so it binds the stub.
const { ReplayPlaybackContainer } = await import('./ReplayPlaybackContainer');
const { DEFAULT_PLAYBACK_INTERVAL_MS } = await import('./useReplayPlayback');

const INTERVAL = DEFAULT_PLAYBACK_INTERVAL_MS;
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

function renderContainer(events: readonly Event[]): RenderResult {
  return render(<ReplayPlaybackContainer sessionId={SESSION} events={events} />);
}

function status(): HTMLElement {
  return screen.getByTestId('audience-replay-position');
}
function position(): string | null {
  return status().getAttribute('data-position');
}
function graphCount(): number {
  return Number(screen.getByTestId('audience-graph-root').getAttribute('data-event-count'));
}
function disabled(testId: string): boolean {
  return screen.getByTestId<HTMLButtonElement>(testId).disabled;
}
function play(): HTMLButtonElement {
  return screen.getByTestId<HTMLButtonElement>('audience-replay-play');
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReplayPlaybackContainer — controls + stepping', () => {
  it('renders the play/step controls and opens the readout at the head', () => {
    renderContainer(SIX_EVENTS);

    expect(play()).toBeTruthy();
    expect(screen.getByTestId('audience-replay-step-back')).toBeTruthy();
    expect(screen.getByTestId('audience-replay-step-forward')).toBeTruthy();

    expect(position()).toBe(String(HEAD));
    expect(status().getAttribute('data-head')).toBe(String(HEAD));
    // Opening at the head projects the whole log.
    expect(graphCount()).toBe(HEAD);
  });

  it('step-back decrements the position and shrinks the projected prefix', () => {
    renderContainer(SIX_EVENTS);

    fireEvent.click(screen.getByTestId('audience-replay-step-back'));
    expect(position()).toBe(String(HEAD - 1));
    expect(graphCount()).toBe(HEAD - 1);
  });

  it('step-forward re-advances the position and grows the projected prefix', () => {
    renderContainer(SIX_EVENTS);

    // Move off the head first (the surface opens at the head, where forward
    // is disabled), then step forward.
    fireEvent.click(screen.getByTestId('audience-replay-step-back'));
    fireEvent.click(screen.getByTestId('audience-replay-step-back'));
    expect(position()).toBe(String(HEAD - 2));
    expect(graphCount()).toBe(HEAD - 2);

    fireEvent.click(screen.getByTestId('audience-replay-step-forward'));
    expect(position()).toBe(String(HEAD - 1));
    expect(graphCount()).toBe(HEAD - 1);
  });

  it('disables step-forward at the head and step-back at the baseline', () => {
    renderContainer(SIX_EVENTS);

    // Opens at the head: forward disabled, back enabled.
    expect(disabled('audience-replay-step-forward')).toBe(true);
    expect(disabled('audience-replay-step-back')).toBe(false);

    // Step back to the baseline: back disabled, forward enabled.
    for (let i = 0; i < HEAD; i += 1) {
      fireEvent.click(screen.getByTestId('audience-replay-step-back'));
    }
    expect(position()).toBe('0');
    expect(disabled('audience-replay-step-back')).toBe(true);
    expect(disabled('audience-replay-step-forward')).toBe(false);
    expect(graphCount()).toBe(0);
  });
});

describe('ReplayPlaybackContainer — play loop (fake timers)', () => {
  it('auto-advances one event per interval tick and self-pauses at the head', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    // Pressing play at the head restarts from the baseline (Decision §5).
    fireEvent.click(play());
    expect(position()).toBe('0');
    // While playing the toggle announces "pause".
    expect(play().getAttribute('aria-pressed')).toBe('true');

    // One event per tick.
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('1');
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('2');

    // Advance to the head: the loop self-pauses there.
    act(() => {
      vi.advanceTimersByTime(INTERVAL * (HEAD - 2));
    });
    expect(position()).toBe(String(HEAD));
    expect(play().getAttribute('aria-pressed')).toBe('false');
    // The timer was cleared — no live interval remains.
    expect(vi.getTimerCount()).toBe(0);

    // Further ticks do not advance past the head.
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3);
    });
    expect(position()).toBe(String(HEAD));
  });

  it('pressing pause mid-run stops advancement', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    fireEvent.click(play()); // restart from 0
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 2);
    });
    expect(position()).toBe('2');

    fireEvent.click(play()); // toggle → pause
    expect(play().getAttribute('aria-pressed')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3);
    });
    expect(position()).toBe('2');
  });

  it('clears the timer on unmount (no post-unmount tick)', () => {
    vi.useFakeTimers();
    const { unmount } = renderContainer(SIX_EVENTS);

    fireEvent.click(play()); // restart from 0, start the loop
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('1');

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    // Advancing after unmount must not throw or warn (the timer is gone).
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(INTERVAL * 3);
      });
    }).not.toThrow();
  });
});
