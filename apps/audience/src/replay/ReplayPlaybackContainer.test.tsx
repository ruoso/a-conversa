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
const { ReplayPlaybackContainer, SPEED_OPTIONS } = await import('./ReplayPlaybackContainer');
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

function renderContainer(events: readonly Event[], initialPosition?: number | null): RenderResult {
  return render(
    <ReplayPlaybackContainer
      sessionId={SESSION}
      events={events}
      initialPosition={initialPosition}
    />,
  );
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
function seek(): HTMLInputElement {
  return screen.getByTestId<HTMLInputElement>('audience-replay-seek');
}
function speedSelect(): HTMLSelectElement {
  return screen.getByTestId<HTMLSelectElement>('audience-replay-speed');
}
function speedSeam(): string | null {
  return status().getAttribute('data-speed');
}
function setSpeed(multiplier: number): void {
  fireEvent.change(speedSelect(), { target: { value: String(multiplier) } });
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

describe('ReplayPlaybackContainer — initialPosition seeding', () => {
  // replay_url_position_loading (Acceptance §1): the URL-supplied opening
  // cursor seeds the initial `position`/prefix/seek thumb, clamped against the
  // loaded log, with `0` distinct from absent.
  it('seeds a mid-log initialPosition (readout, seek value, and prefix follow)', () => {
    renderContainer(SIX_EVENTS, 3);

    expect(position()).toBe('3');
    expect(seek().value).toBe('3');
    // The graph opens at the prefix `<= 3`, not the head.
    expect(graphCount()).toBe(3);
    // The head readout is still the full log; only the cursor moved.
    expect(status().getAttribute('data-head')).toBe(String(HEAD));
  });

  it('seeds initialPosition={0} at the baseline (proves the `!= null` branch, not a falsy check)', () => {
    renderContainer(SIX_EVENTS, 0);

    expect(position()).toBe('0');
    expect(seek().value).toBe('0');
    // The pre-history baseline projects no events.
    expect(graphCount()).toBe(0);
    // At the baseline step-back is disabled; the seed is a real navigable stop.
    expect(disabled('audience-replay-step-back')).toBe(true);
  });

  it('clamps an out-of-range initialPosition to the head (clampPosition is in the seeder path)', () => {
    renderContainer(SIX_EVENTS, 999999);

    expect(position()).toBe(String(HEAD));
    expect(seek().value).toBe(String(HEAD));
    expect(graphCount()).toBe(HEAD);
  });

  it('falls back to the head when initialPosition is null', () => {
    renderContainer(SIX_EVENTS, null);
    expect(position()).toBe(String(HEAD));
    expect(graphCount()).toBe(HEAD);
  });

  it('falls back to the head when initialPosition is undefined', () => {
    renderContainer(SIX_EVENTS, undefined);
    expect(position()).toBe(String(HEAD));
    expect(graphCount()).toBe(HEAD);
  });
});

describe('ReplayPlaybackContainer — seek bar', () => {
  it('exposes a head-seeded range input with the log bounds', () => {
    renderContainer(SIX_EVENTS);

    const input = seek();
    expect(input.min).toBe('0');
    expect(input.max).toBe(String(HEAD));
    expect(input.step).toBe('1');
    // Controlled by `position` — opens at the head (ADR 0045 default).
    expect(input.value).toBe(String(HEAD));
  });

  it('seeking to a mid value relocates the position and re-projects the graph', () => {
    renderContainer(SIX_EVENTS);

    fireEvent.change(seek(), { target: { value: '3' } });
    expect(position()).toBe('3');
    expect(seek().value).toBe('3');
    // The graph re-renders from the position prefix (sequence <= 3).
    expect(graphCount()).toBe(3);
  });

  it('clamps a value past the head or below the baseline', () => {
    renderContainer(SIX_EVENTS);

    // Beyond the head clamps to the head.
    fireEvent.change(seek(), { target: { value: '99' } });
    expect(position()).toBe(String(HEAD));
    expect(graphCount()).toBe(HEAD);

    // Below the baseline clamps to 0.
    fireEvent.change(seek(), { target: { value: '-4' } });
    expect(position()).toBe('0');
    expect(graphCount()).toBe(0);
  });

  it('disables step-forward once the bar is dragged to the head', () => {
    renderContainer(SIX_EVENTS);

    // Move off the head, then drag the bar back to it.
    fireEvent.change(seek(), { target: { value: '2' } });
    expect(disabled('audience-replay-step-forward')).toBe(false);

    fireEvent.change(seek(), { target: { value: String(HEAD) } });
    expect(position()).toBe(String(HEAD));
    expect(disabled('audience-replay-step-forward')).toBe(true);
  });
});

describe('ReplayPlaybackContainer — seek bar tracks playback', () => {
  it('the thumb advances by one event per play-loop tick', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    // Play restarts from the baseline (Decision §5), so the thumb resets to 0.
    fireEvent.click(play());
    expect(seek().value).toBe('0');

    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    // The bar is a live progress indicator — its value tracks the cursor.
    expect(seek().value).toBe('1');
    expect(position()).toBe('1');
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

describe('ReplayPlaybackContainer — speed controls', () => {
  // replay_speed_controls (Acceptance §1 — selector presence + default). The
  // ready render shows a speed selector listing the fixed multiplier ladder
  // with `1×` selected by default; selecting an option updates the reflected
  // value and the `data-speed` seam.
  it('renders a speed selector listing the multiplier ladder, defaulting to 1×', () => {
    renderContainer(SIX_EVENTS);

    const select = speedSelect();
    // One option per multiplier — the option list and the fixture share the
    // single `SPEED_OPTIONS` source (Decision §3).
    expect(select.options).toHaveLength(SPEED_OPTIONS.length);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      SPEED_OPTIONS.map((m) => String(m)),
    );
    // Default is the shipped 1× behavior.
    expect(select.value).toBe('1');
    expect(speedSeam()).toBe('1');
  });

  it('selecting a different multiplier updates the reflected value and the seam', () => {
    renderContainer(SIX_EVENTS);

    setSpeed(2);
    expect(speedSelect().value).toBe('2');
    expect(speedSeam()).toBe('2');

    setSpeed(0.5);
    expect(speedSelect().value).toBe('0.5');
    expect(speedSeam()).toBe('0.5');
  });
});

describe('ReplayPlaybackContainer — speed scales the cadence (fake timers)', () => {
  // replay_speed_controls (Acceptance §2). The multiplier scales the
  // auto-advance cadence: 2× steps once per `INTERVAL / 2`, 0.5× once per
  // `2 × INTERVAL`. Asserted by advancing the fake clock a known amount and
  // checking the resulting `data-position`.
  it('advances twice as fast at 2× (one step per INTERVAL / 2)', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    setSpeed(2);
    fireEvent.click(play()); // restart from 0 (Decision §5)
    expect(position()).toBe('0');

    // Half the base interval is one full step at 2×.
    act(() => {
      vi.advanceTimersByTime(INTERVAL / 2);
    });
    expect(position()).toBe('1');
    act(() => {
      vi.advanceTimersByTime(INTERVAL / 2);
    });
    expect(position()).toBe('2');

    // A full base interval is two steps at 2× — no stalling.
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('4');
  });

  it('advances half as fast at 0.5× (one step per 2 × INTERVAL)', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    setSpeed(0.5);
    fireEvent.click(play()); // restart from 0
    expect(position()).toBe('0');

    // A full base interval is not yet a step at 0.5×.
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('0');
    // Two base intervals make one step.
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('1');
  });
});

describe('ReplayPlaybackContainer — mid-play speed change (fake timers)', () => {
  // replay_speed_controls (Acceptance §3). Changing speed mid-play continues
  // the run at the new cadence — no stop, no leaked/double timer, no lost
  // position — and the self-terminate-at-head behavior still holds.
  it('switching to 2× mid-play continues at the faster cadence with a single live timer', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    fireEvent.click(play()); // restart from 0 at 1×
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    expect(position()).toBe('1');
    expect(vi.getTimerCount()).toBe(1);

    // Speed up mid-run: the run does not stop, and exactly one interval is live
    // (the old one was cleared on re-subscribe — no leak, Constraint §4).
    setSpeed(2);
    expect(play().getAttribute('aria-pressed')).toBe('true');
    expect(vi.getTimerCount()).toBe(1);

    // Now stepping at INTERVAL / 2; no double-advance per base interval.
    act(() => {
      vi.advanceTimersByTime(INTERVAL / 2);
    });
    expect(position()).toBe('2');
    act(() => {
      vi.advanceTimersByTime(INTERVAL / 2);
    });
    expect(position()).toBe('3');
  });

  it('self-terminates at the head at 2× with its timer cleared', () => {
    vi.useFakeTimers();
    renderContainer(SIX_EVENTS);

    setSpeed(2);
    fireEvent.click(play()); // restart from 0
    // Six steps at INTERVAL / 2 reach the head, then the loop self-pauses.
    act(() => {
      vi.advanceTimersByTime((INTERVAL / 2) * HEAD);
    });
    expect(position()).toBe(String(HEAD));
    expect(play().getAttribute('aria-pressed')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);

    // Further ticks do not advance past the head.
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3);
    });
    expect(position()).toBe(String(HEAD));
  });
});
