// Stack-validation smoke test for ADR 0005 (Styling: Tailwind CSS + shared
// design tokens). Proves the chain: a tokens-as-data object → a Tailwind v4
// theme → a utility class → emitted CSS that carries the token value. The
// real workspace realization (`packages/ui-tokens` consumed by every
// `apps/*` frontend) waits on `repo_skeleton.dir_layout`; this sketch only
// proves the concept end-to-end inline. Throwaway — will be removed when
// the real workspaces land.
//
// Run with `npm run smoke:tailwind` after `npm install`.

import { compile } from 'tailwindcss';

// Sketch of what `packages/ui-tokens` will export — a plain data module.
// Frontend workspaces will feed these into Tailwind via @theme and into
// Cytoscape style strings as plain JS values (per ADR 0004).
const tokens = {
  colors: {
    // Per-facet "agreed" state — a load-bearing token across all four
    // surfaces. Distinctive value chosen so we can grep for it in the
    // emitted CSS and prove the token flowed through.
    facetAgreed: '#1f7a3a',
  },
} as const;

// Tailwind v4 reads its theme from CSS, not a JS config. The `@theme`
// block translates token data into CSS custom properties Tailwind treats
// as first-class theme values; `--color-facet-agreed` becomes the
// `bg-facet-agreed` / `text-facet-agreed` / etc. utility set.
const inputCss = `
@theme {
  --color-facet-agreed: ${tokens.colors.facetAgreed};
}
@tailwind utilities;
`;

const compiled = await compile(inputCss);

// In v4, `build(candidates)` is the equivalent of scanning content for
// utility classes — we hand it the candidates directly instead of asking
// it to crawl files.
const css = compiled.build(['bg-facet-agreed']);

console.log(css);

// Verify the token value flowed all the way through to the emitted rule.
if (!css.includes(tokens.colors.facetAgreed)) {
  console.error(
    `smoke test failed: emitted CSS does not contain token value ${tokens.colors.facetAgreed}`,
  );
  process.exit(1);
}
if (!css.includes('.bg-facet-agreed')) {
  console.error('smoke test failed: emitted CSS does not contain .bg-facet-agreed rule');
  process.exit(1);
}

console.log('tailwind ok: bg-facet-agreed compiled with token value');
