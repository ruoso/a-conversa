// Vitest component cases for `<ChapterMarker>`.
//
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Acceptance criteria §3 — renders nothing when the hook returns
//   null; renders the verbatim label inside
//   `data-testid="audience-chapter-marker"` when present; the rendered
//   subtree carries no `<dialog>` / `[aria-modal]` / `<audio>` /
//   `<video>` / `[data-requires-input]` and is `pointer-events-none`
//   (OBS-safety, mirroring `aud_obs_no_input_required.md`); chrome
//   resolves through `t('audience.segmentMarker.*')`.)
//
// The hook's null/present states are driven through the real
// `audienceWsStore` via `applyEvent`, matching the hook test's seam;
// chrome strings resolve against the real en-US catalog via
// `<I18nProvider>` so the assertion proves `t()` resolution (a missing
// key would surface the raw key string instead of "Current segment").

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Event } from '@a-conversa/shared-types';

import { I18nProvider, createI18nInstance, type I18nInstance } from '@a-conversa/shell';

import { audienceWsStore } from '../ws/wsStore.js';
import { ChapterMarker } from './ChapterMarker.js';

const SESSION_A = '00000000-0000-4000-8000-000000000001';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000a1';
const SNAP_1 = '00000000-0000-4000-8000-0000000000c1';
const SNAP_2 = '00000000-0000-4000-8000-0000000000c2';
const SNAP_3 = '00000000-0000-4000-8000-0000000000c3';

function snapshotEvent(opts: {
  sequence: number;
  snapshotId: string;
  label: string;
  logPosition: number;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xe00 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_A,
    sequence: opts.sequence,
    kind: 'snapshot-created',
    actor: ACTOR_ID,
    payload: {
      snapshot_id: opts.snapshotId,
      label: opts.label,
      log_position: opts.logPosition,
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

// A non-snapshot event (roster join) used to drive an UNRELATED re-render
// that changes the events slice without changing the latest snapshot —
// the gate must NOT re-fire on it (segment-break Constraint §1). The
// store's `applyEvent` appends any higher-sequence event; `latestSnapshotFrom`
// ignores everything but `snapshot-created`.
function rosterEvent(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xf00 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_A,
    sequence,
    kind: 'participant-joined',
    actor: ACTOR_ID,
    payload: {
      user_id: ACTOR_ID,
      role: 'debater-A',
      screen_name: 'Alice',
      joined_at: '2026-05-18T00:00:00.000Z',
    },
    createdAt: '2026-05-18T00:00:00.000Z',
  };
}

let i18nInstance: I18nInstance;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
});

beforeEach(() => {
  audienceWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  audienceWsStore.getState().reset();
});

afterAll(() => {
  audienceWsStore.getState().reset();
});

function renderMarker(): void {
  render(
    <I18nProvider i18n={i18nInstance}>
      <ChapterMarker sessionId={SESSION_A} />
    </I18nProvider>,
  );
}

function seedSnapshot(): void {
  act(() => {
    audienceWsStore.getState().applyEvent(
      snapshotEvent({
        sequence: 1,
        snapshotId: SNAP_1,
        label: 'Segment 1 close',
        logPosition: 1,
      }),
    );
  });
}

function applySnapshot(opts: { sequence: number; snapshotId: string; label: string }): void {
  act(() => {
    audienceWsStore.getState().applyEvent(
      snapshotEvent({
        sequence: opts.sequence,
        snapshotId: opts.snapshotId,
        label: opts.label,
        logPosition: opts.sequence,
      }),
    );
  });
}

describe('ChapterMarker', () => {
  it('(a) renders nothing until a snapshot is present', () => {
    renderMarker();
    expect(screen.queryByTestId('audience-chapter-marker')).toBeNull();
  });

  it('(b) renders the verbatim snapshot label inside the audience-chapter-marker testid', () => {
    renderMarker();
    seedSnapshot();
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.textContent).toContain('Segment 1 close');
  });

  it('(c) the rendered subtree is OBS-inert — no input-gating affordances, pointer-events-none', () => {
    renderMarker();
    seedSnapshot();
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.className).toContain('pointer-events-none');
    expect(
      marker.querySelectorAll(
        'dialog, [aria-modal="true"], audio, video, [data-requires-input="true"]',
      ).length,
    ).toBe(0);
    // The marker root itself is none of the forbidden elements/attrs.
    expect(
      marker.matches('dialog, [aria-modal="true"], audio, video, [data-requires-input="true"]'),
    ).toBe(false);
  });

  it('(d) the visually-hidden chrome prefix resolves through t(audience.segmentMarker.prefix)', () => {
    renderMarker();
    seedSnapshot();
    const marker = screen.getByTestId('audience-chapter-marker');
    // Resolved en-US chrome, not the raw i18n key — proves t() resolution.
    expect(marker.textContent).toContain('Current segment');
    expect(marker.textContent).not.toContain('audience.segmentMarker.prefix');
  });
});

// Segment-break entrance cue — React-side class gating.
// Refinement: tasks/refinements/audience/aud_segment_break_animation.md
//   (Acceptance §1–§5. jsdom does not run keyframes, so this layer pins
//   that the `aud-segment-break` class LANDS on a live new snapshot and
//   only then; the keyframe + reduced-motion suppression are pinned in
//   `index.test.ts`. The `data-segment-break-anim` presence marker is the
//   stable e2e/test handle, testid-convention parity with the overlays.)
describe('ChapterMarker — segment-break cue', () => {
  it('(e) does not animate the seeding (load-time) snapshot', () => {
    renderMarker();
    // First non-empty render seeds the gate — the snapshot already current
    // at page load must NOT carry the cue (Decision §6).
    seedSnapshot();
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.hasAttribute('data-segment-break-anim')).toBe(true);
    expect(marker.className).not.toContain('aud-segment-break');
  });

  it('(f) animates on a live new snapshot arriving post-mount', () => {
    renderMarker();
    seedSnapshot(); // seeds the gate (SNAP_1) — no cue
    applySnapshot({ sequence: 2, snapshotId: SNAP_2, label: 'Commercial' });
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.textContent).toContain('Commercial');
    expect(marker.className).toContain('aud-segment-break');
  });

  it('(g) re-fires the cue on a further supersession (not a once-per-mount artifact)', () => {
    renderMarker();
    seedSnapshot(); // SNAP_1 seeds
    applySnapshot({ sequence: 2, snapshotId: SNAP_2, label: 'Commercial' }); // cue
    applySnapshot({ sequence: 3, snapshotId: SNAP_3, label: 'Segment 2 open' }); // cue again
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.textContent).toContain('Segment 2 open');
    expect(marker.className).toContain('aud-segment-break');
  });

  it('(h) does not re-fire on an unrelated re-render carrying the same snapshotId', () => {
    renderMarker();
    seedSnapshot(); // SNAP_1 seeds
    applySnapshot({ sequence: 2, snapshotId: SNAP_2, label: 'Commercial' }); // cue lands
    // A roster-only event re-renders the marker but leaves SNAP_2 current.
    act(() => {
      audienceWsStore.getState().applyEvent(rosterEvent(3));
    });
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.textContent).toContain('Commercial');
    // Same snapshotId → the gate returns false → the freshly-reconciled
    // (same-key, reused) root no longer carries the cue class.
    expect(marker.className).not.toContain('aud-segment-break');
  });

  it('(i) the animated subtree stays OBS-inert (pointer-events-none, no input affordances)', () => {
    renderMarker();
    seedSnapshot();
    applySnapshot({ sequence: 2, snapshotId: SNAP_2, label: 'Commercial' });
    const marker = screen.getByTestId('audience-chapter-marker');
    expect(marker.className).toContain('aud-segment-break');
    expect(marker.className).toContain('pointer-events-none');
    expect(
      marker.querySelectorAll(
        'dialog, [aria-modal="true"], audio, video, [data-requires-input="true"]',
      ).length,
    ).toBe(0);
    expect(
      marker.matches('dialog, [aria-modal="true"], audio, video, [data-requires-input="true"]'),
    ).toBe(false);
  });
});
