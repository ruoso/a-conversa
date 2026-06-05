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

// Two chapter markers inside the six-event log: positions 2 and 4. Their
// `logPosition`s deliberately differ from their `snapshotId`s so a row click
// can prove it jumps to the position, not the id.
const SNAP_EARLY = {
  snapshotId: '00000000-0000-4000-8000-0000000000a1',
  label: 'Chapter A',
  logPosition: 2,
  createdAt: '2026-06-01T10:00:02.000Z',
};
const SNAP_LATE = {
  snapshotId: '00000000-0000-4000-8000-0000000000a2',
  label: 'Chapter B',
  logPosition: 4,
  createdAt: '2026-06-01T10:00:04.000Z',
};
const SNAPSHOTS = [SNAP_EARLY, SNAP_LATE];

// Stub `GET /api/sessions/:id/snapshots` (consumed by the lifted
// `useSessionSnapshots`) with a resolving 200 carrying the given records.
function stubSnapshotFetch(records: readonly unknown[]): void {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      status: 200,
      json: () => Promise.resolve({ snapshots: records }),
    }),
  ) as unknown as typeof fetch;
}

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
// The chapter index is ready once the snapshot rows have rendered.
async function chapterIndexReady(): Promise<HTMLElement> {
  return screen.findByTestId('snapshot-list');
}
function tickValues(): string[] {
  return Array.from(
    screen.getByTestId('audience-replay-chapter-ticks').querySelectorAll('option'),
  ).map((option) => option.value);
}

const originalFetch = global.fetch;

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
  // Default: the lifted `useSessionSnapshots` fetch never resolves, so the
  // chapter affordances stay in their inert loading state and the
  // position-only suites below see no post-mount snapshot state change (no
  // stray act warning). The chapter suite overrides this with a resolving
  // stub before rendering.
  global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  global.fetch = originalFetch;
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

describe('ReplayPlaybackContainer — chapter (snapshot) navigation', () => {
  // replay_chapter_jumping (Acceptance §2). One lifted `useSessionSnapshots`
  // read feeds three affordances — prev/next chapter buttons, seek-bar
  // `<datalist>` ticks, and a clickable chapter index — all funnelled through
  // the same `updatePosition`/`clampPosition` guard as a step, a seek, or a
  // play-loop tick. Markers at positions 2 and 4 inside the six-event log.
  it('next/prev chapter jump to the adjacent marker through updatePosition', async () => {
    stubSnapshotFetch(SNAPSHOTS);
    renderContainer(SIX_EVENTS);
    await chapterIndexReady();

    // Opens at the head (6): no marker is strictly greater, so next-chapter is
    // disabled and prev-chapter steps back to the last marker (4).
    expect(position()).toBe(String(HEAD));
    expect(disabled('audience-replay-next-chapter')).toBe(true);
    expect(disabled('audience-replay-prev-chapter')).toBe(false);

    fireEvent.click(screen.getByTestId('audience-replay-prev-chapter'));
    expect(position()).toBe('4');
    // The prefix re-projects from the jumped position (sequence <= 4).
    expect(graphCount()).toBe(4);

    fireEvent.click(screen.getByTestId('audience-replay-prev-chapter'));
    expect(position()).toBe('2');

    // From the first marker, forward jumps to the next marker.
    fireEvent.click(screen.getByTestId('audience-replay-next-chapter'));
    expect(position()).toBe('4');
  });

  it('disables prev/next chapter at the ends, and a disabled button fires no jump', async () => {
    stubSnapshotFetch(SNAPSHOTS);
    renderContainer(SIX_EVENTS);
    await chapterIndexReady();

    // At the head no marker is strictly greater: next-chapter is disabled and
    // clicking it does not move the position.
    expect(disabled('audience-replay-next-chapter')).toBe(true);
    fireEvent.click(screen.getByTestId('audience-replay-next-chapter'));
    expect(position()).toBe(String(HEAD));

    // Seek to the baseline: no marker is strictly less, so prev-chapter is
    // disabled and clicking it fires no jump.
    fireEvent.change(seek(), { target: { value: '0' } });
    expect(position()).toBe('0');
    expect(disabled('audience-replay-prev-chapter')).toBe(true);
    fireEvent.click(screen.getByTestId('audience-replay-prev-chapter'));
    expect(position()).toBe('0');
  });

  it('renders a seek-bar <datalist> whose options are the deduped ascending marker positions', async () => {
    stubSnapshotFetch(SNAPSHOTS);
    renderContainer(SIX_EVENTS);
    await chapterIndexReady();

    // The range input is decorated by the chapter ticks.
    expect(seek().getAttribute('list')).toBe('audience-replay-chapter-ticks');
    expect(tickValues()).toEqual(['2', '4']);
  });

  it('a chapter-row click sets position to the snapshot logPosition, not its snapshotId', async () => {
    stubSnapshotFetch(SNAPSHOTS);
    renderContainer(SIX_EVENTS);
    await chapterIndexReady();

    fireEvent.click(screen.getByTestId(`snapshot-list-row-${SNAP_LATE.snapshotId}`));
    // SNAP_LATE.logPosition is 4 — the position, not the id.
    expect(position()).toBe('4');
    expect(graphCount()).toBe(4);
  });

  it('with no snapshots: no ticks, chapter buttons disabled, the viewer is unaffected', async () => {
    stubSnapshotFetch([]);
    renderContainer(SIX_EVENTS);
    await screen.findByTestId('snapshot-list-empty');

    expect(tickValues()).toHaveLength(0);
    expect(disabled('audience-replay-prev-chapter')).toBe(true);
    expect(disabled('audience-replay-next-chapter')).toBe(true);
    // The rest of the viewer still opens at the head and seeks normally.
    expect(position()).toBe(String(HEAD));
    fireEvent.change(seek(), { target: { value: '3' } });
    expect(position()).toBe('3');
  });

  it('while the snapshot fetch is loading the chapter affordances are inert', () => {
    // The default beforeEach stub never resolves — the hook stays in loading.
    renderContainer(SIX_EVENTS);

    expect(screen.getByTestId('snapshot-list-loading')).toBeTruthy();
    expect(tickValues()).toHaveLength(0);
    expect(disabled('audience-replay-prev-chapter')).toBe(true);
    expect(disabled('audience-replay-next-chapter')).toBe(true);
    // The position controls are unaffected by the pending snapshot load.
    expect(position()).toBe(String(HEAD));
  });
});
