// Tests for the review-sheet sync cycle (build + apply).
//
// Parking lot: tasks/parking-lot.md (2026-05-30 — Native-speaker review
//              of pt-BR + es-419 translations)
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// `buildReviewEntries` / `applyReviewSheet` are the logic the export /
// import CLIs wrap, so these tests pin the whole reviewer round-trip
// without touching the filesystem:
//
//   build entries → render sheet → reviewer edits → parse → apply →
//   catalog/overlay/tracker mutated → rebuild excludes signed-off keys.
//
// The hard-error paths (unknown key, double sign-off, empty or
// placeholder-breaking translation, missing reviewer) are pinned to
// THROW BEFORE MUTATING — a reviewer's mistake must never half-apply.

import { describe, expect, it } from 'vitest';

import { parseReviewMarkdown, renderReviewMarkdown } from './review-md.js';
import {
  applyReviewSheet,
  buildReviewEntries,
  type CatalogNode,
  type Overlay,
  type ReviewSources,
  type ReviewTracker,
  type WalkthroughEvent,
} from './review-sync.js';

const EVENT_ID = 'ee000000-0000-4000-8000-000000000005';
const REWORD_ID = 'ee000000-0000-4000-8000-000000000090';

function makeSources(): ReviewSources {
  const english: CatalogNode = {
    methodology: { kind: { fact: 'Fact', value: 'Value' } },
    landing: { demo: { stepStatus: 'Step {step} of {total}' } },
  };
  const catalog: CatalogNode = {
    methodology: { kind: { fact: 'Fato', value: 'Valor' } },
    landing: { demo: { stepStatus: 'Passo {step} de {total}' } },
  };
  const tracker: ReviewTracker = {
    _comment: 'kept verbatim',
    pending: ['methodology.kind.fact', 'methodology.kind.value'],
    signed_off: [],
  };
  const events: WalkthroughEvent[] = [
    {
      id: EVENT_ID,
      sequence: 6,
      payload: { wording: 'Zoos do more good than harm.' },
    },
    {
      id: REWORD_ID,
      sequence: 90,
      payload: { proposal: { new_wording: 'Accredited zoos do more good than harm.' } },
    },
  ];
  const overlay: Overlay = {
    [EVENT_ID]: { wording: 'Zoológicos fazem mais bem do que mal.' },
    [REWORD_ID]: { new_wording: 'Zoológicos credenciados fazem mais bem do que mal.' },
  };
  return { english, catalog, tracker, events, overlay, locale: 'pt-BR' };
}

function renderSheet(sources: ReviewSources): string {
  return renderReviewMarkdown({
    locale: 'pt-BR',
    localeTitle: 'Português (Brasil)',
    entries: buildReviewEntries(sources),
  });
}

describe('buildReviewEntries', () => {
  it('lists every catalog leaf plus every overlay field, with context on overlay entries', () => {
    const entries = buildReviewEntries(makeSources());
    expect(entries.map((e) => e.key)).toEqual([
      'methodology.kind.fact',
      'methodology.kind.value',
      'landing.demo.stepStatus',
      `walkthrough.${EVENT_ID}.wording`,
      `walkthrough.${REWORD_ID}.new_wording`,
    ]);
    const reword = entries.find((e) => e.key === `walkthrough.${REWORD_ID}.new_wording`);
    expect(reword?.english).toBe('Accredited zoos do more good than harm.');
    expect(reword?.context).toBe('Demo event 90: reworded statement wording');
  });

  it('excludes signed-off keys — catalog and walkthrough alike', () => {
    const sources = makeSources();
    sources.tracker.signed_off.push(
      { key: 'methodology.kind.fact', reviewer: 'Maria', date: '2026-06-11' },
      { key: `walkthrough.${EVENT_ID}.wording`, reviewer: 'Maria', date: '2026-06-11' },
    );
    const keys = buildReviewEntries(sources).map((e) => e.key);
    expect(keys).not.toContain('methodology.kind.fact');
    expect(keys).not.toContain(`walkthrough.${EVENT_ID}.wording`);
    expect(keys).toHaveLength(3);
  });

  it('throws when a catalog key has no locale value (parity hole)', () => {
    const sources = makeSources();
    (sources.english['methodology'] as CatalogNode)['untranslated'] = 'New';
    expect(() => buildReviewEntries(sources)).toThrow(/methodology\.untranslated.*pt-BR/s);
  });
});

describe('applyReviewSheet', () => {
  function reviewedSheet(sources: ReviewSources): string {
    return (
      renderSheet(sources)
        .replace('**Reviewer:** _(replace this with your name)_', '**Reviewer:** Maria da Silva')
        // Catalog entry approved with an edited wording.
        .replace(
          '- **Translation:** Fato\n- **Status:** PENDING',
          '- **Translation:** Fato verificável\n- **Status:** OK',
        )
        // Walkthrough entry approved as-is.
        .replace(
          '- **Translation:** Zoológicos fazem mais bem do que mal.\n- **Status:** PENDING',
          '- **Translation:** Zoológicos fazem mais bem do que mal.\n- **Status:** OK',
        )
        // Placeholder-bearing entry flagged with a comment.
        .replace(
          '- **Translation:** Passo {step} de {total}\n- **Status:** PENDING',
          '- **Translation:** Passo {step} de {total}\n- **Status:** FLAG\n- **Comment:** soa burocrático',
        )
    );
  }

  it('applies OK entries to catalog and overlay, records sign-offs, prunes pending', () => {
    const sources = makeSources();
    const result = applyReviewSheet(
      parseReviewMarkdown(reviewedSheet(sources)),
      sources,
      '2026-06-11',
    );

    expect(result.signedOff).toBe(2);
    expect(result.reworded).toBe(1);
    expect((sources.catalog['methodology'] as CatalogNode)['kind']).toEqual({
      fact: 'Fato verificável',
      value: 'Valor',
    });
    expect(sources.overlay[EVENT_ID]?.wording).toBe('Zoológicos fazem mais bem do que mal.');
    expect(sources.tracker.signed_off).toEqual([
      { key: 'methodology.kind.fact', reviewer: 'Maria da Silva', date: '2026-06-11' },
      { key: `walkthrough.${EVENT_ID}.wording`, reviewer: 'Maria da Silva', date: '2026-06-11' },
    ]);
    expect(sources.tracker.pending).toEqual(['methodology.kind.value']);
    expect(sources.tracker['_comment']).toBe('kept verbatim');

    expect(result.flagged.map((e) => e.key)).toEqual(['landing.demo.stepStatus']);
    expect(result.flagged[0]?.comment).toBe('soa burocrático');
    // Flagged keys are NOT signed off and stay pending for the next export.
    expect(buildReviewEntries(sources).map((e) => e.key)).toContain('landing.demo.stepStatus');
  });

  it('rebuild after apply offers only the not-yet-reviewed entries', () => {
    const sources = makeSources();
    applyReviewSheet(parseReviewMarkdown(reviewedSheet(sources)), sources, '2026-06-11');
    expect(buildReviewEntries(sources).map((e) => e.key)).toEqual([
      'methodology.kind.value',
      'landing.demo.stepStatus',
      `walkthrough.${REWORD_ID}.new_wording`,
    ]);
  });

  it('skips entries whose English changed since export, leaving them pending', () => {
    const sources = makeSources();
    const sheet = reviewedSheet(sources);
    (sources.english['methodology'] as CatalogNode)['kind'] = {
      fact: 'Established fact',
      value: 'Value',
    };
    const result = applyReviewSheet(parseReviewMarkdown(sheet), sources, '2026-06-11');
    expect(result.stale).toEqual(['methodology.kind.fact']);
    expect(result.signedOff).toBe(1); // the walkthrough entry still lands
    expect((sources.catalog['methodology'] as CatalogNode)['kind']).toEqual({
      fact: 'Fato',
      value: 'Valor',
    });
  });

  it('ignores PENDING entries entirely', () => {
    const sources = makeSources();
    const result = applyReviewSheet(
      parseReviewMarkdown(renderSheet(sources)),
      sources,
      '2026-06-11',
    );
    expect(result.signedOff).toBe(0);
    expect(sources.tracker.signed_off).toEqual([]);
    expect(sources.tracker.pending).toEqual(['methodology.kind.fact', 'methodology.kind.value']);
  });

  function expectThrowWithoutMutating(
    mutateSheet: (sheet: string) => string,
    pattern: RegExp,
  ): void {
    const sources = makeSources();
    const before = JSON.stringify([sources.catalog, sources.overlay, sources.tracker]);
    const sheet = mutateSheet(reviewedSheet(sources));
    expect(() => applyReviewSheet(parseReviewMarkdown(sheet), sources, '2026-06-11')).toThrow(
      pattern,
    );
    expect(JSON.stringify([sources.catalog, sources.overlay, sources.tracker])).toBe(before);
  }

  it('rejects the whole sheet when the Reviewer line is unfilled, without mutating', () => {
    expectThrowWithoutMutating(
      (sheet) =>
        sheet.replace(
          '**Reviewer:** Maria da Silva',
          '**Reviewer:** _(replace this with your name)_',
        ),
      /Reviewer line was not filled in/,
    );
  });

  it('rejects an OK entry whose edited translation drops a placeholder, without mutating', () => {
    expectThrowWithoutMutating(
      (sheet) =>
        sheet.replace(
          '- **Translation:** Passo {step} de {total}\n- **Status:** FLAG\n- **Comment:** soa burocrático',
          '- **Translation:** Passo {step} de muitos\n- **Status:** OK',
        ),
      /landing\.demo\.stepStatus.*placeholders changed.*step, total.*step/s,
    );
  });

  it('rejects an OK entry whose translation was emptied, without mutating', () => {
    expectThrowWithoutMutating(
      (sheet) => sheet.replace('- **Translation:** Fato verificável', '- **Translation:**'),
      /methodology\.kind\.fact.*Translation line is empty/s,
    );
  });

  it('rejects unknown keys, without mutating', () => {
    expectThrowWithoutMutating(
      (sheet) => sheet.replace('### `methodology.kind.fact`', '### `methodology.kind.factt`'),
      /unknown key.*methodology\.kind\.factt/s,
    );
  });

  it('rejects a key that is already signed off, without mutating', () => {
    const sources = makeSources();
    const sheet = reviewedSheet(sources);
    sources.tracker.signed_off.push({
      key: 'methodology.kind.fact',
      reviewer: 'Maria',
      date: '2026-06-10',
    });
    const before = JSON.stringify([sources.catalog, sources.overlay]);
    expect(() => applyReviewSheet(parseReviewMarkdown(sheet), sources, '2026-06-11')).toThrow(
      /already signed off/,
    );
    expect(JSON.stringify([sources.catalog, sources.overlay])).toBe(before);
  });
});
