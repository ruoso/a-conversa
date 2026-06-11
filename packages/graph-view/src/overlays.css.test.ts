// Smoke pin for `packages/graph-view/src/overlays.css` — the shared
// graph-overlay animation stylesheet that ships with the overlay
// components (per ADR 0039) and is imported by both `apps/audience` and
// `apps/root`. Relocated from `apps/audience/src/index.test.ts` when the
// overlay CSS moved out of the audience app into this package.
//
// The check is a string-substring/regex assertion against the CSS file
// read from disk; jsdom / happy-dom does not run CSS keyframes, so the
// true behavioural pins for the React side live in the per-overlay
// `*.test.tsx` files and these pins guard the CSS file's existence and
// shape (keyframe definitions, reduced-motion no-ops, cadence-token
// definitions + consumption, and the per-node `--halo-zoom` sizing).
//
// Refinement chain: aud_axiom_mark_animation / aud_node_appear_animation
//   / aud_proposed_to_agreed_animation / aud_withdrawal_animation /
//   aud_diagnostic_fire_animation / aud_animation_pacing — Decision §6
//   (CSS smoke-pin posture). The aud_decomposition_animation pins were
//   removed with the fade seam by
//   mod_decompose_split_parent_visibility (ADR 0047 — the superseded
//   parent is dropped from the projected graph outright).
// ADRs: 0022 (no throwaway verifications), 0039 (graph-view boundary).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERLAYS_CSS_PATH = resolve(__dirname, './overlays.css');

async function read(): Promise<string> {
  return readFile(OVERLAYS_CSS_PATH, 'utf-8');
}

describe('graph-view overlays.css — keyframes + reduced-motion overrides', () => {
  const families = [
    'aud-axiom-mark-land',
    'aud-node-appear',
    'aud-pill-agreed',
    'aud-withdrawal',
    'aud-diagnostic-fire-blocking',
    'aud-diagnostic-fire-advisory',
  ] as const;

  for (const family of families) {
    it(`contains the @keyframes ${family} definition`, async () => {
      expect(await read()).toContain(`@keyframes ${family}`);
    });
  }

  it('contains a prefers-reduced-motion: reduce override that no-ops .aud-axiom-mark-land', async () => {
    const contents = await read();
    expect(contents).toContain('prefers-reduced-motion: reduce');
    expect(contents).toMatch(/\.aud-axiom-mark-land\s*\{\s*animation\s*:\s*none/);
  });

  it('no-ops .aud-node-appear under prefers-reduced-motion', async () => {
    expect(await read()).toMatch(/\.aud-node-appear\s*\{\s*animation\s*:\s*none/);
  });

  it('no-ops .aud-pill-agreed under prefers-reduced-motion', async () => {
    expect(await read()).toMatch(/\.aud-pill-agreed\s*\{\s*animation\s*:\s*none/);
  });

  it('no-ops .aud-withdrawal under prefers-reduced-motion', async () => {
    expect(await read()).toMatch(/\.aud-withdrawal\s*\{\s*animation\s*:\s*none/);
  });

  it('no-ops both diagnostic-fire halos under prefers-reduced-motion', async () => {
    // The two halo classes share one media-query block — a comma-separated
    // selector list ending with `{ animation: none }`.
    expect(await read()).toMatch(
      /\.aud-diagnostic-fire-blocking[\s\S]*?\.aud-diagnostic-fire-advisory\s*\{\s*animation\s*:\s*none/,
    );
  });
});

describe('graph-view overlays.css — cadence tokens (aud_animation_pacing)', () => {
  it(':root defines --aud-anim-easing as cubic-bezier(0.16, 1, 0.3, 1)', async () => {
    expect(await read()).toMatch(
      /--aud-anim-easing\s*:\s*cubic-bezier\(\s*0\.16\s*,\s*1\s*,\s*0\.3\s*,\s*1\s*\)/,
    );
  });

  it(':root defines --aud-anim-commit-ms as 350ms', async () => {
    expect(await read()).toMatch(/--aud-anim-commit-ms\s*:\s*350ms/);
  });

  it(':root defines --aud-anim-halo-ms as 450ms', async () => {
    expect(await read()).toMatch(/--aud-anim-halo-ms\s*:\s*450ms/);
  });

  it('.aud-axiom-mark-land consumes var(--aud-anim-commit-ms) and var(--aud-anim-easing)', async () => {
    expect(await read()).toMatch(
      /\.aud-axiom-mark-land\s*\{\s*animation\s*:\s*aud-axiom-mark-land\s+var\(--aud-anim-commit-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-pill-agreed consumes var(--aud-anim-commit-ms) and var(--aud-anim-easing)', async () => {
    expect(await read()).toMatch(
      /animation\s*:\s*aud-pill-agreed\s+var\(--aud-anim-commit-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-node-appear consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    expect(await read()).toMatch(
      /\.aud-node-appear\s*\{\s*animation\s*:\s*aud-node-appear\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-withdrawal consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    expect(await read()).toMatch(
      /\.aud-withdrawal\s*\{\s*animation\s*:\s*aud-withdrawal\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-diagnostic-fire-blocking consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    expect(await read()).toMatch(
      /\.aud-diagnostic-fire-blocking\s*\{\s*animation\s*:\s*aud-diagnostic-fire-blocking\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });

  it('.aud-diagnostic-fire-advisory consumes var(--aud-anim-halo-ms) and var(--aud-anim-easing)', async () => {
    expect(await read()).toMatch(
      /\.aud-diagnostic-fire-advisory\s*\{\s*animation\s*:\s*aud-diagnostic-fire-advisory\s+var\(--aud-anim-halo-ms\)\s+var\(--aud-anim-easing\)/,
    );
  });
});

describe('graph-view overlays.css — per-node halo zoom sizing', () => {
  // The four halo geometry selectors size their box as
  // `calc(96px * var(--halo-zoom, 1))` so the halo tracks the
  // zoom-scaled node (the overlay sets `--halo-zoom` to the live
  // `cy.zoom()`). Pins the load-bearing half of the zoom fix that lives
  // in CSS; the inline-var half is pinned by `NodeAppearOverlay.test.tsx`.
  const haloSelectors = [
    'data-node-appear-anim',
    'data-withdrawal-anim',
    'data-diagnostic-fire-anim',
  ] as const;

  for (const selector of haloSelectors) {
    it(`[${selector}] sizes its box with calc(96px * var(--halo-zoom, 1))`, async () => {
      const contents = await read();
      const block = new RegExp(
        `\\[${selector}\\]\\s*\\{[\\s\\S]*?width\\s*:\\s*calc\\(\\s*96px\\s*\\*\\s*var\\(--halo-zoom,\\s*1\\)\\s*\\)`,
      );
      expect(contents).toMatch(block);
    });
  }
});
