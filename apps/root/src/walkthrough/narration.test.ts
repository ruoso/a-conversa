// Pins the narration beat table + activation rule (ADR 0022 — durable,
// committed test artifact). Covers the script's activation contract
// (constraint 2 / Decision §D3) and the table↔catalog integrity guard
// (the slugs in the typed table must each have matching en-US caption keys).
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_narration.md

import { beforeAll, describe, expect, it } from 'vitest';
import type { i18n as I18nInstance } from 'i18next';

import { WALKTHROUGH_BEATS, activeBeatFor } from './narration';
import { getTestI18n } from '../testing/renderWithProviders';

// The script's ordered slugs (`§ The script`). Positions are NO LONGER
// hardcoded here — they resolve from each beat's anchor event id against
// the live `walkthroughEvents` stream, so this suite derives every
// boundary from `WALKTHROUGH_BEATS` and stays correct across fixture edits.
const SCRIPT_SLUGS = [
  'opening',
  'decompose',
  'consensus',
  'counter',
  'contradiction',
  'classification',
  'axiom',
  'interpretive_split',
  'finale',
] as const;

const FIRST_BEAT = WALKTHROUGH_BEATS[0]!;
const LAST_BEAT = WALKTHROUGH_BEATS[WALKTHROUGH_BEATS.length - 1]!;

describe('WALKTHROUGH_BEATS — anchor/script integrity', () => {
  it('has the nine beats in order, slugs matching the script', () => {
    expect(WALKTHROUGH_BEATS.map((b) => b.slug)).toEqual([...SCRIPT_SLUGS]);
  });

  it('every anchor resolved to a real (1-based, in-stream) position, strictly increasing', () => {
    for (const beat of WALKTHROUGH_BEATS) {
      expect(Number.isInteger(beat.position)).toBe(true);
      expect(beat.position).toBeGreaterThanOrEqual(1);
    }
    for (let i = 1; i < WALKTHROUGH_BEATS.length; i += 1) {
      expect(WALKTHROUGH_BEATS[i]!.position).toBeGreaterThan(WALKTHROUGH_BEATS[i - 1]!.position);
    }
  });
});

describe('activeBeatFor — the activation rule (last beat with anchor ≤ position)', () => {
  it('returns undefined below the first anchor', () => {
    expect(activeBeatFor(FIRST_BEAT.position - 1)).toBeUndefined();
    expect(activeBeatFor(0)).toBeUndefined();
    expect(activeBeatFor(-1)).toBeUndefined();
  });

  it('activates the first beat on its anchor and holds it until the second beat', () => {
    const second = WALKTHROUGH_BEATS[1]!;
    expect(activeBeatFor(FIRST_BEAT.position)?.slug).toBe(FIRST_BEAT.slug);
    expect(activeBeatFor(second.position - 1)?.slug).toBe(FIRST_BEAT.slug);
  });

  it('switches to the second beat exactly at its anchor', () => {
    const second = WALKTHROUGH_BEATS[1]!;
    expect(activeBeatFor(second.position - 1)?.slug).toBe(FIRST_BEAT.slug);
    expect(activeBeatFor(second.position)?.slug).toBe(second.slug);
  });

  it('resolves every anchor to its own beat', () => {
    for (let i = 0; i < WALKTHROUGH_BEATS.length; i += 1) {
      const beat = WALKTHROUGH_BEATS[i]!;
      expect(activeBeatFor(beat.position)?.slug).toBe(beat.slug);
    }
  });

  it('resolves a position just below an anchor to the PREVIOUS beat (proves "last ≤", not "nearest")', () => {
    for (let i = 1; i < WALKTHROUGH_BEATS.length; i += 1) {
      const beat = WALKTHROUGH_BEATS[i]!;
      const previous = WALKTHROUGH_BEATS[i - 1]!;
      expect(activeBeatFor(beat.position - 1)?.slug).toBe(previous.slug);
    }
  });

  it('stays on finale at and past the last anchor', () => {
    expect(activeBeatFor(LAST_BEAT.position)?.slug).toBe('finale');
    expect(activeBeatFor(LAST_BEAT.position + 234)?.slug).toBe('finale');
  });
});

describe('table ↔ catalog integrity', () => {
  let i18n: I18nInstance;

  beforeAll(async () => {
    i18n = await getTestI18n();
  });

  it('every beat slug has eyebrow/title/body keys present in the en-US catalog', () => {
    for (const beat of WALKTHROUGH_BEATS) {
      for (const field of ['eyebrow', 'title', 'body'] as const) {
        const key = `landing.demo.caption.${beat.slug}.${field}`;
        expect(i18n.exists(key)).toBe(true);
      }
    }
  });
});
