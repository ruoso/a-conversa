// Catalog parity check.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_catalog_workflow.md
// ADR:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
// TaskJuggler: frontend_i18n.i18n_catalog_workflow
//
// Walks `en-US.json` and verifies every leaf key exists in `pt-BR.json`
// and `es-419.json`. Used as a CI gate so a contributor cannot land an
// English string without its Portuguese and Spanish counterparts — the
// catalog-drift detection ADR 0024 names. Run via:
//
//   pnpm --filter @a-conversa/i18n-catalogs run check
//
// Exits 0 on parity, non-zero on missing keys (with a per-locale list).
// The reverse direction (a key in `pt-BR` but not `en-US`) is also
// reported — it signals a typo or a stale translation that no consumer
// reads, both worth flagging.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalogsDir = resolve(here, '..', 'src', 'catalogs');

const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;
type Locale = (typeof LOCALES)[number];

type LeafValue = string;
type CatalogNode = { [key: string]: CatalogNode | LeafValue };

function loadCatalog(locale: Locale): CatalogNode {
  const path = resolve(catalogsDir, `${locale}.json`);
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text) as CatalogNode;
}

/**
 * Collect every leaf-key path in a catalog. A leaf is a string value;
 * nested objects recurse. Result keys are dotted-paths
 * (`chrome.hello`).
 */
function collectKeys(node: CatalogNode, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      out.push(path);
    } else if (value !== null && typeof value === 'object') {
      out.push(...collectKeys(value, path));
    }
  }
  return out;
}

function main(): void {
  const catalogs: Record<Locale, CatalogNode> = {
    'en-US': loadCatalog('en-US'),
    'pt-BR': loadCatalog('pt-BR'),
    'es-419': loadCatalog('es-419'),
  };

  const keys: Record<Locale, Set<string>> = {
    'en-US': new Set(collectKeys(catalogs['en-US'])),
    'pt-BR': new Set(collectKeys(catalogs['pt-BR'])),
    'es-419': new Set(collectKeys(catalogs['es-419'])),
  };

  const errors: string[] = [];

  // Missing-in-translation: every en-US key must exist in every other
  // locale. This is the primary direction — a new English string lands
  // with its counterparts.
  for (const locale of LOCALES) {
    if (locale === 'en-US') continue;
    const missing: string[] = [];
    for (const k of keys['en-US']) {
      if (!keys[locale].has(k)) missing.push(k);
    }
    if (missing.length > 0) {
      errors.push(
        `[${locale}] missing ${missing.length.toString()} key(s) present in en-US:\n  ${missing.join('\n  ')}`,
      );
    }
  }

  // Extra-in-translation: a key in pt-BR / es-419 with no en-US
  // counterpart signals either a typo or a stale translation no
  // consumer reads. Flag both as errors so the parity check is
  // bidirectional.
  for (const locale of LOCALES) {
    if (locale === 'en-US') continue;
    const extra: string[] = [];
    for (const k of keys[locale]) {
      if (!keys['en-US'].has(k)) extra.push(k);
    }
    if (extra.length > 0) {
      errors.push(
        `[${locale}] has ${extra.length.toString()} key(s) NOT in en-US (typo or stale?):\n  ${extra.join('\n  ')}`,
      );
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`catalog parity check FAILED:\n\n${errors.join('\n\n')}\n`);
    process.exit(1);
  }

  const total = keys['en-US'].size;
  process.stdout.write(
    `catalog parity check passed: ${total.toString()} key(s) present in all ${LOCALES.length.toString()} locales\n`,
  );
}

main();
