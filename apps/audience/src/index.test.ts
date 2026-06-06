// Smoke pin for `apps/audience/src/index.css` — asserts the
// `@keyframes aud-segment-break` definition and its
// `prefers-reduced-motion: reduce` override exist in the audience-side
// stylesheet.
//
// The six graph-OVERLAY animation families (axiom-mark / node-appear /
// pill-agreed / withdrawal / diagnostic-fire / decomposition) and the
// `--aud-anim-*` cadence tokens moved out of this file into
// `@a-conversa/graph-view`'s `overlays.css` (ADR 0039 — the CSS now
// travels with the overlay components so the landing page styles them
// too). Their CSS pins relocated to
// `packages/graph-view/src/overlays.css.test.ts`. Only `aud-segment-break`
// — an audience-surface caption animation, NOT a graph overlay — stays
// here, so its pin stays here too.
//
// Refinement: tasks/refinements/audience/aud_segment_break_animation.md
//              (Decision §1/§7 — Vitest pins the CSS file's keyframe +
//              reduced-motion override presence).
// ADRs:        0022 (no throwaway verifications), 0005 (Tailwind v4),
//              0039 (graph-view package boundary).
//
// jsdom / happy-dom does not run CSS keyframes; the React-side toggle
// logic is pinned by the audience segment-break component tests, and
// this string-grep smoke pin guards against accidental deletion of the
// keyframe definition. The `aud-segment-break` `animation:` shorthand
// still references `var(--aud-anim-commit-ms)` / `var(--aud-anim-easing)`,
// which are defined in the imported `overlays.css`; that consumption is
// pinned below (the token *definitions* are pinned in the package test).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_CSS_PATH = resolve(__dirname, './index.css');

describe('apps/audience/src/index.css — aud-segment-break', () => {
  it('contains the @keyframes aud-segment-break definition', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('@keyframes aud-segment-break');
  });

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-segment-break', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toContain('prefers-reduced-motion: reduce');
    expect(contents).toMatch(/\.aud-segment-break\s*\{\s*animation\s*:\s*none/);
  });

  // Per tasks/refinements/audience/aud_segment_break_animation.md
  // Decision §3 + Constraint §4 — the segment-break cue is commit-tier
  // (350 ms) and MUST consume the shared dial, not a hard-coded duration.
  // The tokens themselves are defined in `overlays.css` (package test);
  // here we pin that the audience caption still references them.
  it('.aud-segment-break consumes var(--aud-anim-commit-ms) and var(--aud-anim-easing)', async () => {
    const contents = await readFile(INDEX_CSS_PATH, 'utf-8');
    expect(contents).toMatch(
      /\.aud-segment-break\s*\{\s*animation\s*:\s*aud-segment-break\s+var\(--aud-anim-commit-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });
});
