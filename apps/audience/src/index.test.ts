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

  // Per tasks/refinements/audience/aud_node_appear_animation.md
  // Decision §6 — the same CSS smoke-pin posture applies to the
  // node-arrival halo keyframe.
  it('contains the @keyframes aud-node-appear definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-node-appear');
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-node-appear', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(/\.aud-node-appear\s*\{\s*animation\s*:\s*none/);
  });

  // Per tasks/refinements/audience/aud_proposed_to_agreed_animation.md
  // Decision §6 — same CSS smoke-pin posture for the per-facet pill
  // proposed→agreed transition pulse.
  it('contains the @keyframes aud-pill-agreed definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-pill-agreed');
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-pill-agreed', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(/\.aud-pill-agreed\s*\{\s*animation\s*:\s*none/);
  });

  // Per tasks/refinements/audience/aud_withdrawal_animation.md
  // Decision §6 — same CSS smoke-pin posture for the rose-tinted
  // halo on the rollupStatus first reaching 'disputed'.
  it('contains the @keyframes aud-withdrawal definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-withdrawal');
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-withdrawal', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(/\.aud-withdrawal\s*\{\s*animation\s*:\s*none/);
  });

  // Per tasks/refinements/audience/aud_diagnostic_fire_animation.md
  // Decision §6 — same CSS smoke-pin posture for the two amber halos
  // (blocking + advisory) on a structural-diagnostic fire.
  it('contains the @keyframes aud-diagnostic-fire-blocking definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-diagnostic-fire-blocking');
  });

  it('contains the @keyframes aud-diagnostic-fire-advisory definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-diagnostic-fire-advisory');
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-diagnostic-fire-blocking', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    // The two halo classes share a media-query block; the override is
    // a comma-separated selector list ending with `{ animation: none }`.
    expect(contents).toMatch(
      /\.aud-diagnostic-fire-blocking[\s\S]*?\.aud-diagnostic-fire-advisory\s*\{\s*animation\s*:\s*none/,
    );
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-diagnostic-fire-advisory', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-diagnostic-fire-blocking[\s\S]*?\.aud-diagnostic-fire-advisory\s*\{\s*animation\s*:\s*none/,
    );
  });
});

// Per tasks/refinements/audience/aud_animation_pacing.md Decision §6 —
// the cadence variables (--aud-anim-easing / --aud-anim-commit-ms /
// --aud-anim-halo-ms) are the audience animation family's single
// pacing dial. Two smoke-pin layers guard the contract end-to-end:
//   1. Property-definition pins — each variable is declared in :root
//      with its tuned value.
//   2. Utility-consumption pins — each .aud-* utility's `animation:`
//      shorthand references the correct variable (a future refactor
//      that hardcodes a duration breaks this).
// jsdom does not run CSS animations; the runtime behaviour is
// unchanged by the lift (the var(...) values resolve to the same
// durations they shipped before). String-grep against the disk-read
// CSS file is the right seam.
describe('aud_animation_pacing — cadence variables', () => {
  it(':root defines --aud-anim-easing as cubic-bezier(0.16, 1, 0.3, 1)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /--aud-anim-easing\s*:\s*cubic-bezier\(\s*0\.16\s*,\s*1\s*,\s*0\.3\s*,\s*1\s*\)/,
    );
  });

  it(':root defines --aud-anim-commit-ms as 350ms', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(/--aud-anim-commit-ms\s*:\s*350ms/);
  });

  it(':root defines --aud-anim-halo-ms as 450ms', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(/--aud-anim-halo-ms\s*:\s*450ms/);
  });

  it('.aud-axiom-mark-land consumes var(--aud-anim-commit-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-axiom-mark-land\s*\{\s*animation\s*:\s*aud-axiom-mark-land\s+var\(--aud-anim-commit-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-pill-agreed consumes var(--aud-anim-commit-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /animation\s*:\s*aud-pill-agreed\s+var\(--aud-anim-commit-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-node-appear consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-node-appear\s*\{\s*animation\s*:\s*aud-node-appear\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-withdrawal consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-withdrawal\s*\{\s*animation\s*:\s*aud-withdrawal\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-diagnostic-fire-blocking consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-diagnostic-fire-blocking\s*\{\s*animation\s*:\s*aud-diagnostic-fire-blocking\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-diagnostic-fire-advisory consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-diagnostic-fire-advisory\s*\{\s*animation\s*:\s*aud-diagnostic-fire-advisory\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });
});
