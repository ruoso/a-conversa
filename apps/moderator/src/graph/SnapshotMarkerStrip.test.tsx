// Tests for `<SnapshotMarkerStrip>` — the top-left overlay listing
// snapshot labels in reverse-chronological order.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_visual_marker.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) returns null when no snapshots
//   (b) renders the strip with data-testid + localized aria-label when ≥1 snapshot
//   (c) one <li data-testid="snapshot-marker-{snapshotId}"> per snapshot up to the cap
//   (d) cards are in reverse-chronological order (newest first)
//   (e) each card carries data-log-position + data-snapshot-label
//   (f) cards display the label as visible text
//   (g) cap of 5 enforced (six snapshots → 5 visible + 1 overflow row)
//   (h) overflow row uses ICU plural one-branch (1 hidden) and other-branch (≥2 hidden)
//   (i) overflow row carries data-hidden-count
//   (j) per-locale parity (en-US / pt-BR / es-419) covering both ICU plural branches
//   (k) header shows the total snapshot count (not the visible-cap count)

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { SnapshotMarkerStrip, MAX_VISIBLE_SNAPSHOTS } from './SnapshotMarkerStrip';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function snapshotId(n: number): string {
  return `00000000-0000-4000-8000-${(0xa00 + n).toString(16).padStart(12, '0')}`;
}

function envelopeId(n: number): string {
  return `00000000-0000-4000-8000-${(0xe00 + n).toString(16).padStart(12, '0')}`;
}

function makeSnapshotCreated(opts: {
  sequence: number;
  snapshotId: string;
  label: string;
  logPosition: number;
}): Event {
  return {
    id: envelopeId(opts.sequence),
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'snapshot-created',
    actor: ACTOR,
    payload: {
      snapshot_id: opts.snapshotId,
      label: opts.label,
      log_position: opts.logPosition,
    },
    createdAt: '2026-05-31T00:00:00.000Z',
  };
}

function seedSnapshots(
  count: number,
  labelFor: (i: number) => string = (i) => `snap-${i + 1}`,
): void {
  const store = useWsStore.getState();
  for (let i = 0; i < count; i++) {
    store.applyEvent(
      makeSnapshotCreated({
        sequence: i + 1,
        snapshotId: snapshotId(i + 1),
        label: labelFor(i),
        logPosition: 10 + i,
      }),
    );
  }
}

beforeAll(async () => {
  await createI18nInstance('en-US');
});

beforeEach(async () => {
  useWsStore.getState().reset();
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

describe('SnapshotMarkerStrip — empty state', () => {
  it('(a) returns null when no snapshots exist', () => {
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    expect(screen.queryByTestId('snapshot-marker-strip')).toBeNull();
  });
});

describe('SnapshotMarkerStrip — render shape with snapshots', () => {
  it('(b) renders the strip container with the localized aria-label when ≥1 snapshot', () => {
    seedSnapshots(1);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const strip = screen.getByTestId('snapshot-marker-strip');
    expect(strip.getAttribute('role')).toBe('region');
    expect(strip.getAttribute('aria-label')).toBe('Snapshot markers');
  });

  it('(c) renders one card per snapshot up to the cap', () => {
    seedSnapshots(3);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const cards = screen
      .getAllByRole('listitem')
      .filter((el) => el.getAttribute('data-testid')?.startsWith('snapshot-marker-'));
    // 3 snapshot cards; no overflow row (3 ≤ cap).
    const snapshotCards = cards.filter(
      (el) => el.getAttribute('data-testid') !== 'snapshot-marker-overflow',
    );
    expect(snapshotCards).toHaveLength(3);
  });

  it('(d) renders the cards in reverse-chronological order (newest first)', () => {
    seedSnapshots(3, (i) => `snap-${i + 1}`);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const cards = screen
      .getAllByRole('listitem')
      .filter(
        (el) =>
          el.getAttribute('data-testid')?.startsWith('snapshot-marker-') &&
          el.getAttribute('data-testid') !== 'snapshot-marker-overflow',
      );
    // Seeded snap-1, snap-2, snap-3 (chronological); displayed newest-first
    // means snap-3, snap-2, snap-1.
    expect(cards.map((el) => el.getAttribute('data-snapshot-label'))).toEqual([
      'snap-3',
      'snap-2',
      'snap-1',
    ]);
  });

  it('(e) each card carries data-log-position and data-snapshot-label mirroring the payload', () => {
    seedSnapshots(1, () => 'my label');
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`snapshot-marker-${snapshotId(1)}`);
    expect(card.getAttribute('data-snapshot-label')).toBe('my label');
    expect(card.getAttribute('data-log-position')).toBe('10');
  });

  it('(f) cards display the label as visible text', () => {
    seedSnapshots(1, () => 'visible label text');
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const card = screen.getByTestId(`snapshot-marker-${snapshotId(1)}`);
    expect(card.textContent).toContain('visible label text');
  });

  it('(k) header shows the TOTAL snapshot count, not the visible-cap count', () => {
    // 7 snapshots; cap is 5; header should still read "Snapshots (7)".
    seedSnapshots(7);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const strip = screen.getByTestId('snapshot-marker-strip');
    const header = strip.querySelector('h3');
    expect(header).not.toBeNull();
    expect(header?.textContent).toBe('Snapshots (7)');
  });
});

describe('SnapshotMarkerStrip — overflow handling', () => {
  it('exposes MAX_VISIBLE_SNAPSHOTS = 5 (regression-proof the cap constant)', () => {
    expect(MAX_VISIBLE_SNAPSHOTS).toBe(5);
  });

  it('(g) caps the visible list at MAX_VISIBLE_SNAPSHOTS and renders an overflow row', () => {
    seedSnapshots(6);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const cards = screen
      .getAllByRole('listitem')
      .filter(
        (el) =>
          el.getAttribute('data-testid')?.startsWith('snapshot-marker-') &&
          el.getAttribute('data-testid') !== 'snapshot-marker-overflow',
      );
    expect(cards).toHaveLength(MAX_VISIBLE_SNAPSHOTS);
    expect(screen.getByTestId('snapshot-marker-overflow')).toBeTruthy();
  });

  it('(h) overflow row uses ICU plural one-branch when exactly one hidden', () => {
    seedSnapshots(6);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const overflow = screen.getByTestId('snapshot-marker-overflow');
    expect(overflow.textContent).toBe('1 more snapshot');
  });

  it('(h) overflow row uses ICU plural other-branch when ≥2 hidden', () => {
    seedSnapshots(8);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const overflow = screen.getByTestId('snapshot-marker-overflow');
    expect(overflow.textContent).toBe('3 more snapshots');
  });

  it('(h) overflow row is absent when none hidden', () => {
    seedSnapshots(MAX_VISIBLE_SNAPSHOTS);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    expect(screen.queryByTestId('snapshot-marker-overflow')).toBeNull();
  });

  it('(i) overflow row carries data-hidden-count reflecting the count', () => {
    seedSnapshots(9);
    render(<SnapshotMarkerStrip sessionId={SESSION_ID} />);
    const overflow = screen.getByTestId('snapshot-marker-overflow');
    expect(overflow.getAttribute('data-hidden-count')).toBe('4');
  });
});

describe('SnapshotMarkerStrip — i18n catalog parity (per-locale resolution)', () => {
  const KEYS = [
    'moderator.snapshotMarker.stripAriaLabel',
    'moderator.snapshotMarker.header',
    'moderator.snapshotMarker.overflowLabel',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`(j) resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        // Pass plausible ICU context for keys that need it.
        const value = i18next.t(key, { n: 3 });
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        expect(value).not.toContain('[t-missing]');
        await i18next.changeLanguage('en-US');
      });
    }

    it(`(j) overflowLabel resolves both ICU plural branches in ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      const one = i18next.t('moderator.snapshotMarker.overflowLabel', { n: 1 });
      const many = i18next.t('moderator.snapshotMarker.overflowLabel', { n: 3 });
      expect(one).toBeTruthy();
      expect(many).toBeTruthy();
      // The plural branches must produce distinct strings — otherwise
      // ICU formatting isn't actually being applied.
      expect(one).not.toBe(many);
      await i18next.changeLanguage('en-US');
    });
  }
});
