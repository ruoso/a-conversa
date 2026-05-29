// Smoke pin for `apps/audience/src/index.css` — asserts the
// `@keyframes aud-axiom-mark-land` definition and the
// `prefers-reduced-motion: reduce` override clause exist in the
// audience-side stylesheet.
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_animation.md
//              (Decision §6 — Vitest pins the React-side class logic
//              + the CSS file's keyframe + reduced-motion override
//              presence. The Tailwind v4 + Vite library-mode build
//              pipeline silently dropped a Google Fonts `@import` in
//              the past — see aud_typography_bundle_measurement.md
//              Decision §3(B). Custom `@keyframes` and standard media
//              queries are not subject to that issue (they are not
//              `@import` rules), but this string-grep smoke pin
//              guards against accidental human deletion of the
//              keyframe definition.)
// ADRs:        0022 (no throwaway verifications), 0005 (Tailwind v4).
//
// The check is a string-substring assertion against the CSS file read
// from disk; jsdom / happy-dom does not run CSS keyframes, so a true
// behavioral pin lives in `AxiomMarkOverlay.test.tsx` for the React
// side and here for the CSS file's existence-and-shape.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS_PATH = resolve(__dirname, './index.css');

describe('apps/audience/src/index.css', () => {
  it('contains the @keyframes aud-axiom-mark-land definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-axiom-mark-land');
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-axiom-mark-land', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('prefers-reduced-motion: reduce');
    // Whitespace-tolerant check: any sequence of horizontal whitespace
    // (incl. newlines and indentation) between the selector, the
    // `animation` property name, the colon, and `none` is acceptable.
    expect(contents).toMatch(/\.aud-axiom-mark-land\s*\{\s*animation\s*:\s*none/);
  });
});
