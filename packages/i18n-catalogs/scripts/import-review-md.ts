// Import edited native-speaker review sheets.
//
// Parking lot: tasks/parking-lot.md (2026-05-30 — Native-speaker review
//              of pt-BR + es-419 translations)
// ADR:         docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Reads the reviewer-edited sheets produced by `export-review-md.ts` and
// applies them:
//
//   pnpm --filter @a-conversa/i18n-catalogs run review:import [sheet.md ...]
//
// (default: both `review/*.review.md` sheets). For every entry the
// reviewer set to OK, the (possibly edited) translation is written to the
// locale catalog — or, for `walkthrough.<event-id>.<field>` keys, to the
// walkthrough overlay file — and the key moves into the locale's
// `*.review.json` `signed_off` list with reviewer + date. FLAG entries
// are printed for human follow-up and stay pending; PENDING entries are
// ignored. Entries whose English changed since the export are skipped
// with a warning and stay pending. Re-run the export afterwards to
// regenerate the sheets without the signed-off entries (`make
// sync-reviews` chains the two).
//
// Validation is all-or-nothing per sheet — see `applyReviewSheet` in
// `../src/review-sync.ts`, which holds all the logic (unit-tested per
// ADR 0022); this script is the file IO around it.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

import { parseReviewMarkdown } from '../src/review-md.js';
import {
  applyReviewSheet,
  type ApplyResult,
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function importSheet(path: string, today: string): ApplyResult {
  const parsed = parseReviewMarkdown(readFileSync(path, 'utf8'));
  const locale = parsed.locale as Locale;
  if (!LOCALES.includes(locale)) {
    throw new Error(`${path}: unknown locale ${JSON.stringify(parsed.locale)}`);
  }

  const catalogPath = resolve(catalogsDir, `${locale}.json`);
  const trackerPath = resolve(catalogsDir, `${locale}.review.json`);
  const overlayPath = resolve(walkthroughDir, 'overlays', `${locale}.json`);
  const sources = {
    english: readJson<CatalogNode>(resolve(catalogsDir, 'en-US.json')),
    catalog: readJson<CatalogNode>(catalogPath),
    tracker: readJson<ReviewTracker>(trackerPath),
    events: readJson<WalkthroughEvent[]>(resolve(walkthroughDir, 'walkthrough-events.json')),
    overlay: readJson<Overlay>(overlayPath),
    locale,
  };

  let result: ApplyResult;
  try {
    result = applyReviewSheet(parsed, sources, today);
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  if (result.signedOff > 0) {
    writeJson(catalogPath, sources.catalog);
    writeJson(overlayPath, sources.overlay);
    writeJson(trackerPath, sources.tracker);
  }
  return result;
}

function main(): void {
  const args = process.argv.slice(2);
  const sheets =
    args.length > 0 ? args : LOCALES.map((locale) => resolve(reviewDir, `${locale}.review.md`));
  const today = new Date().toISOString().slice(0, 10);

  let failed = false;
  for (const sheet of sheets) {
    const label = relative(process.cwd(), sheet);
    let result: ApplyResult;
    try {
      result = importSheet(sheet, today);
    } catch (error) {
      failed = true;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }
    process.stdout.write(
      `${label}: signed off ${String(result.signedOff)} (${String(result.reworded)} with edited wording)\n`,
    );
    if (result.stale.length > 0) {
      process.stdout.write(
        `${label}: SKIPPED ${String(result.stale.length)} stale entries whose English changed since export — re-run review:export:\n  ${result.stale.join('\n  ')}\n`,
      );
    }
    for (const entry of result.flagged) {
      process.stdout.write(
        `${label}: FLAGGED \`${entry.key}\`${entry.comment !== undefined ? ` — ${entry.comment}` : ''}\n`,
      );
    }
  }
  if (failed) {
    process.exit(1);
  }
  process.stdout.write('done — re-run review:export to regenerate the sheets\n');
}

main();
