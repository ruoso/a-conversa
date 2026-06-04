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

// The script's verified anchor positions (`§ The script`).
const SCRIPT_ANCHORS = [6, 27, 42, 56, 86, 100, 147, 196, 266] as const;
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

describe('WALKTHROUGH_BEATS — anchor/script integrity', () => {
  it('has the nine beats in order, slugs matching the script', () => {
    expect(WALKTHROUGH_BEATS.map((b) => b.slug)).toEqual([...SCRIPT_SLUGS]);
  });

  it('anchors equal the script values and are strictly increasing', () => {
    expect(WALKTHROUGH_BEATS.map((b) => b.position)).toEqual([...SCRIPT_ANCHORS]);
    for (let i = 1; i < WALKTHROUGH_BEATS.length; i += 1) {
      expect(WALKTHROUGH_BEATS[i]!.position).toBeGreaterThan(WALKTHROUGH_BEATS[i - 1]!.position);
    }
  });
});

describe('activeBeatFor — the activation rule (last beat with anchor ≤ position)', () => {
  it('returns undefined below the first anchor (pos < 6)', () => {
    expect(activeBeatFor(0)).toBeUndefined();
    expect(activeBeatFor(5)).toBeUndefined();
    expect(activeBeatFor(-1)).toBeUndefined();
  });

  it('activates beat 1 on load (pos = 6) and holds it through pos 26', () => {
    expect(activeBeatFor(6)?.slug).toBe('opening');
    expect(activeBeatFor(20)?.slug).toBe('opening');
    expect(activeBeatFor(26)?.slug).toBe('opening');
  });

  it('switches to decompose exactly at pos 27', () => {
    expect(activeBeatFor(26)?.slug).toBe('opening');
    expect(activeBeatFor(27)?.slug).toBe('decompose');
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

  it('stays on finale at and past the last anchor (pos = 266 and beyond)', () => {
    expect(activeBeatFor(266)?.slug).toBe('finale');
    expect(activeBeatFor(500)?.slug).toBe('finale');
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
