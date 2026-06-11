// Tests for the review-sheet markdown round-trip.
//
// Parking lot: tasks/parking-lot.md (2026-05-30 — Native-speaker review
//              of pt-BR + es-419 translations)
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// The review sheets are edited by hand by non-technical reviewers and
// then machine-parsed, so the empirical questions worth pinning are:
//
//   - render → parse is lossless for every value shape the catalogs
//     actually contain (ICU placeholders, markdown-ish characters,
//     diacritics) — no escaping layer to get wrong;
//   - the edits reviewers are told to make (Status, Translation,
//     Comment, Reviewer) parse back as intended;
//   - the mistakes reviewers plausibly make (typo'd status, deleted
//     lines, duplicated blocks) fail loudly with the key named, rather
//     than being silently dropped;
//   - the placeholder extractor used by the import gate agrees between
//     simple and complex ICU arguments.

import { describe, expect, it } from 'vitest';

import {
  extractPlaceholders,
  parseReviewMarkdown,
  renderReviewMarkdown,
  SECTION_DEFS,
  sectionIdForKey,
  type ReviewEntry,
} from './review-md.js';

const ENTRIES: ReviewEntry[] = [
  { key: 'methodology.kind.fact', english: 'Fact', translation: 'Fato' },
  {
    key: 'landing.demo.stepStatus',
    english: 'Step {step} of {total}',
    translation: 'Passo {step} de {total}',
  },
  {
    key: 'moderator.toolbar.bold',
    english: 'Use **bold** _sparingly_ — `code` stays',
    translation: 'Use **negrito** _com parcimônia_ — `código` permanece',
  },
  {
    key: 'walkthrough.ee000000-0000-4000-8000-000000000005.wording',
    english: 'Zoos do more good than harm.',
    translation: 'Zoológicos fazem mais bem do que mal.',
    context: 'Demo event 6: statement wording',
  },
];

function render(entries: ReviewEntry[] = ENTRIES): string {
  return renderReviewMarkdown({
    locale: 'pt-BR',
    localeTitle: 'Português (Brasil)',
    entries,
  });
}

describe('renderReviewMarkdown → parseReviewMarkdown round-trip', () => {
  it('preserves key, english, and translation verbatim, all PENDING', () => {
    const parsed = parseReviewMarkdown(render());
    expect(parsed.locale).toBe('pt-BR');
    expect(parsed.reviewer).toBeNull();
    // Render groups by section, so compare per key, not by input order.
    expect([...parsed.entries.map((e) => e.key)].sort()).toEqual(ENTRIES.map((e) => e.key).sort());
    for (const original of ENTRIES) {
      const entry = parsed.entries.find((e) => e.key === original.key);
      expect(entry?.english).toBe(original.english);
      expect(entry?.translation).toBe(original.translation);
      expect(entry?.status).toBe('pending');
    }
  });

  it('groups known prefixes into SECTION_DEFS order and unknown prefixes into trailing sections', () => {
    const markdown = render([
      { key: 'novelPrefix.thing', english: 'A', translation: 'B' },
      ...ENTRIES,
    ]);
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const methodologyIdx = headings.indexOf('Methodology vocabulary');
    const walkthroughIdx = headings.indexOf('Landing-page walkthrough (demo debate content)');
    const otherIdx = headings.indexOf('Other: novelPrefix');
    expect(methodologyIdx).toBeGreaterThan(-1);
    expect(walkthroughIdx).toBeGreaterThan(methodologyIdx);
    expect(otherIdx).toBeGreaterThan(walkthroughIdx);
    // The unknown-prefix entry still round-trips.
    const parsed = parseReviewMarkdown(markdown);
    expect(parsed.entries.map((e) => e.key)).toContain('novelPrefix.thing');
  });
});

describe('parseReviewMarkdown on reviewer edits', () => {
  it('reads filled-in reviewer, OK / FLAG statuses, edited translations, and comments', () => {
    const edited = render()
      .replace('**Reviewer:** _(replace this with your name)_', '**Reviewer:** Maria da Silva')
      .replace(
        '- **Translation:** Fato\n- **Status:** PENDING',
        '- **Translation:** Fato concreto\n- **Status:** ok',
      )
      .replace(
        '- **Translation:** Passo {step} de {total}\n- **Status:** PENDING',
        '- **Translation:** Passo {step} de {total}\n- **Status:** FLAG\n- **Comment:** soa burocrático',
      );
    const parsed = parseReviewMarkdown(edited);
    expect(parsed.reviewer).toBe('Maria da Silva');

    const fact = parsed.entries.find((e) => e.key === 'methodology.kind.fact');
    expect(fact?.status).toBe('ok');
    expect(fact?.translation).toBe('Fato concreto');

    const step = parsed.entries.find((e) => e.key === 'landing.demo.stepStatus');
    expect(step?.status).toBe('flag');
    expect(step?.comment).toBe('soa burocrático');

    const untouched = parsed.entries.find((e) => e.key === 'moderator.toolbar.bold');
    expect(untouched?.status).toBe('pending');
  });

  it('treats an unfilled or emptied Reviewer line as no reviewer', () => {
    expect(parseReviewMarkdown(render()).reviewer).toBeNull();
    const emptied = render().replace(
      '**Reviewer:** _(replace this with your name)_',
      '**Reviewer:**',
    );
    expect(parseReviewMarkdown(emptied).reviewer).toBeNull();
  });

  it('rejects an unknown status, naming the key', () => {
    const typo = render().replace('- **Status:** PENDING', '- **Status:** OKAY');
    expect(() => parseReviewMarkdown(typo)).toThrow(/methodology\.kind\.fact.*OKAY/s);
  });

  it('rejects an entry whose Translation line was deleted, naming the key', () => {
    const deleted = render().replace('- **Translation:** Fato\n', '');
    expect(() => parseReviewMarkdown(deleted)).toThrow(/methodology\.kind\.fact.*Translation/s);
  });

  it('rejects duplicated entry blocks', () => {
    const block =
      '### `methodology.kind.fact`\n\n- **English:** Fact\n- **Translation:** Fato\n- **Status:** PENDING\n';
    const duplicated = `${render()}\n${block}`;
    expect(() => parseReviewMarkdown(duplicated)).toThrow(/duplicate.*methodology\.kind\.fact/s);
  });

  it('rejects a sheet whose Locale header was removed', () => {
    const stripped = render().replace(/^\*\*Locale:\*\*.*$/m, '');
    expect(() => parseReviewMarkdown(stripped)).toThrow(/Locale/);
  });
});

describe('extractPlaceholders', () => {
  it('finds simple ICU arguments', () => {
    expect(extractPlaceholders('Step {step} of {total}')).toEqual(['step', 'total']);
  });

  it('finds the argument name of complex ICU arguments', () => {
    expect(extractPlaceholders('{count, plural, one {# vote} other {# votes}}')).toEqual(['count']);
  });

  it('returns an empty list for placeholder-free strings', () => {
    expect(extractPlaceholders('No placeholders here')).toEqual([]);
  });

  it('is order- and duplicate-insensitive (sorted unique)', () => {
    expect(extractPlaceholders('{b} {a} {b}')).toEqual(['a', 'b']);
  });
});

describe('sectionIdForKey', () => {
  it('takes the first dotted segment', () => {
    expect(sectionIdForKey('methodology.kind.fact')).toBe('methodology');
    expect(sectionIdForKey('walkthrough.ee0.wording')).toBe('walkthrough');
  });

  it('every SECTION_DEF id is unique', () => {
    const ids = SECTION_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
