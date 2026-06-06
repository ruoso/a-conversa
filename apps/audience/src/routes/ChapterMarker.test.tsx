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
