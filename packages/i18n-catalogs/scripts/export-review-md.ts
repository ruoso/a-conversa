// Export the native-speaker review sheets.
//
// Parking lot: tasks/parking-lot.md (2026-05-30 — Native-speaker review
//              of pt-BR + es-419 translations)
// ADR:         docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Renders one markdown review sheet per locale into `review/`:
//
//   pnpm --filter @a-conversa/i18n-catalogs run review:export
//
// Each sheet contains every string a reviewer still has to look at —
// every `en-US.json` leaf key not yet recorded in the locale's
// `*.review.json` `signed_off` list, plus the walkthrough demo-content
// overlays at `apps/root/src/walkthrough/overlays/<locale>.json`, which
// the trackers do not cover. The reviewer edits the sheet in a PR;
// `import-review-md.ts` applies it. Re-running the export after an
// import regenerates the sheets with the signed-off entries removed.
// `make sync-reviews` chains the two.
//
// All assembly logic lives in `../src/review-sync.ts` (unit-tested per
// ADR 0022); this script is the file IO around it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

import { renderReviewMarkdown } from '../src/review-md.js';
import {
  buildReviewEntries,
  type CatalogNode,
  type Overlay,
  type ReviewTracker,
  type WalkthroughEvent,
} from '../src/review-sync.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const catalogsDir = resolve(pkgRoot, 'src', 'catalogs');
const reviewDir = resolve(pkgRoot, 'review');
const walkthroughDir = resolve(pkgRoot, '..', '..', 'apps', 'root', 'src', 'walkthrough');

const LOCALES = ['pt-BR', 'es-419'] as const;
type Locale = (typeof LOCALES)[number];

const LOCALE_TITLES: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  'es-419': 'Español (Latinoamérica)',
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function main(): void {
  mkdirSync(reviewDir, { recursive: true });
  const english = readJson<CatalogNode>(resolve(catalogsDir, 'en-US.json'));
  const events = readJson<WalkthroughEvent[]>(resolve(walkthroughDir, 'walkthrough-events.json'));

  for (const locale of LOCALES) {
    const entries = buildReviewEntries({
      english,
      catalog: readJson<CatalogNode>(resolve(catalogsDir, `${locale}.json`)),
      tracker: readJson<ReviewTracker>(resolve(catalogsDir, `${locale}.review.json`)),
      events,
      overlay: readJson<Overlay>(resolve(walkthroughDir, 'overlays', `${locale}.json`)),
      locale,
    });
    const markdown = renderReviewMarkdown({
      locale,
      localeTitle: LOCALE_TITLES[locale],
      entries,
    });
    const outPath = resolve(reviewDir, `${locale}.review.md`);
    writeFileSync(outPath, markdown, 'utf8');
    process.stdout.write(
      `${relative(process.cwd(), outPath)}: ${String(entries.length)} entries awaiting review\n`,
    );
  }
}

main();
