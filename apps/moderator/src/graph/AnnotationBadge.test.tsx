// Tests for `<AnnotationBadge>` — the small pill rendering an annotation
// on a statement node or edge.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_disputed_visibility.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md)
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. Every `AnnotationKind` × locale combination resolves the right
//      catalog string for `methodology.annotationKind.<kind>` (4 kinds
//      × 3 locales = 12 cases).
//   2. The `data-annotation-kind` attribute mirrors the wire-format
//      kind discriminator (the seam through which `packages/ui-tokens`
//      will eventually layer per-kind colour theming without touching
//      this component).
//   3. The `title` attribute carries the annotation's `content` —
//      the cheap baseline hover surface until the dedicated
//      `mod_hover_details` task ships a richer card.
//   4. The disputed-rollup styling branch — every kind × disputed
//      rollup stamps `data-facet-status="disputed"`, applies the rose
//      ring, and appends the localized `(disputed)` aria-label suffix.
//   5. The meta-disagreement rollup branch — every kind × meta-
//      disagreement rollup applies the same rose ring + aria-suffix
//      but stamps `data-facet-status="meta-disagreement"` so tests can
//      discriminate (Decision §5).
//   6. Non-disputed rollups (`'agreed'`, `'committed'`) preserve the
//      baseline amber styling and omit `data-facet-status`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';
import type { AnnotationKind } from '@a-conversa/shared-types';

import { AnnotationBadge } from './AnnotationBadge';
import {
  createI18nInstance,
  type Annotation,
  type FacetName,
  type FacetStatus,
} from '@a-conversa/shell';

// `useTranslation()` schedules a microtask-deferred setState when its
// internal i18next subscription registers on mount. The deferred update
// fires AFTER the synchronous render's act() wrapper closes, so React
// emits "An update to <Component> was not wrapped in act(...)". Wrapping
// the render in `await act(async () => { ... })` flushes pending
// microtasks before the act block resolves, absorbing the deferred
// update inside the wrapper.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  // `act` takes the async (microtask-flushing) path when the callback
  // returns a thenable — `return Promise.resolve()` is enough; no
  // `async` keyword (which would trip `require-await` since the body
  // does not await anything).
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const ALL_KINDS: readonly AnnotationKind[] = ['note', 'reframe', 'scope-change', 'stance'];

const EN_LABELS: Record<AnnotationKind, string> = {
  note: 'Note',
  reframe: 'Reframe',
  'scope-change': 'Scope change',
  stance: 'Stance',
};
const PT_LABELS: Record<AnnotationKind, string> = {
  note: 'Nota',
  reframe: 'Reenquadramento',
  'scope-change': 'Mudança de escopo',
  stance: 'Posição',
};
const ES_LABELS: Record<AnnotationKind, string> = {
  note: 'Nota',
  reframe: 'Reencuadre',
  'scope-change': 'Cambio de alcance',
  stance: 'Postura',
};
const LABELS_BY_LOCALE = {
  'en-US': EN_LABELS,
  'pt-BR': PT_LABELS,
  'es-419': ES_LABELS,
} as const;

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'an annotation body',
    targetNodeId: overrides.targetNodeId ?? 'node-x',
    targetEdgeId: overrides.targetEdgeId ?? null,
    createdBy: overrides.createdBy ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: overrides.createdAt ?? '2026-05-11T00:00:00.000Z',
  };
}

const ROSE_MARKER_CLASS = 'border-solid border-rose-600 ring-2 ring-rose-500 opacity-100';

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AnnotationBadge — localized kind label per kind × locale', () => {
  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    for (const kind of ALL_KINDS) {
      it(`renders the ${kind} label as "${LABELS_BY_LOCALE[locale][kind]}" in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const annotation = makeAnnotation({
          id: `anno-${locale}-${kind}`,
          kind,
          content: 'body text',
        });
        await render(<AnnotationBadge annotation={annotation} />);
        const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
        expect(badge.textContent).toBe(LABELS_BY_LOCALE[locale][kind]);
        expect(badge.getAttribute('data-annotation-kind')).toBe(kind);
        expect(badge.getAttribute('title')).toBe('body text');
        // Baseline (no `facetStatuses`): no rose marker, no
        // `data-facet-status`, no `aria-label` suffix.
        expect(badge.className).not.toContain('ring-rose-500');
        expect(badge.getAttribute('data-facet-status')).toBeNull();
        expect(badge.getAttribute('aria-label')).toBeNull();
      });
    }
  }
});

describe('AnnotationBadge — disputed rollup branch (per kind)', () => {
  for (const kind of ALL_KINDS) {
    it(`stamps disputed marker + suffix for kind="${kind}"`, async () => {
      const annotation = makeAnnotation({
        id: `anno-disputed-${kind}`,
        kind,
        content: 'contested annotation',
      });
      const facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>> = {
        wording: 'disputed',
      };
      await render(<AnnotationBadge annotation={annotation} facetStatuses={facetStatuses} />);
      const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
      expect(badge.getAttribute('data-facet-status')).toBe('disputed');
      expect(badge.getAttribute('data-annotation-kind')).toBe(kind);
      for (const cls of ROSE_MARKER_CLASS.split(' ')) {
        expect(badge.className).toContain(cls);
      }
      expect(badge.getAttribute('aria-label')).toBe(`${EN_LABELS[kind]} (disputed)`);
    });
  }
});

describe('AnnotationBadge — meta-disagreement rollup branch (per kind)', () => {
  for (const kind of ALL_KINDS) {
    it(`stamps meta-disagreement marker + suffix for kind="${kind}"`, async () => {
      const annotation = makeAnnotation({
        id: `anno-meta-${kind}`,
        kind,
        content: 'meta-disagreement annotation',
      });
      const facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>> = {
        wording: 'meta-disagreement',
      };
      await render(<AnnotationBadge annotation={annotation} facetStatuses={facetStatuses} />);
      const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
      expect(badge.getAttribute('data-facet-status')).toBe('meta-disagreement');
      expect(badge.getAttribute('data-annotation-kind')).toBe(kind);
      for (const cls of ROSE_MARKER_CLASS.split(' ')) {
        expect(badge.className).toContain(cls);
      }
      // Meta-disagreement shares the rose marker visual class with
      // disputed (Decision §5); the aria-suffix is also shared.
      expect(badge.getAttribute('aria-label')).toBe(`${EN_LABELS[kind]} (disputed)`);
    });
  }
});

describe('AnnotationBadge — non-disputed rollups preserve baseline', () => {
  it('agreed rollup keeps baseline amber styling and omits data-facet-status', async () => {
    const annotation = makeAnnotation({ id: 'anno-agreed', kind: 'note' });
    const facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>> = {
      wording: 'agreed',
    };
    await render(<AnnotationBadge annotation={annotation} facetStatuses={facetStatuses} />);
    const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
    expect(badge.getAttribute('data-facet-status')).toBeNull();
    expect(badge.className).not.toContain('ring-rose-500');
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.getAttribute('aria-label')).toBeNull();
  });

  it('committed rollup keeps baseline amber styling and omits data-facet-status', async () => {
    const annotation = makeAnnotation({ id: 'anno-committed', kind: 'reframe' });
    const facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>> = {
      wording: 'committed',
    };
    await render(<AnnotationBadge annotation={annotation} facetStatuses={facetStatuses} />);
    const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
    expect(badge.getAttribute('data-facet-status')).toBeNull();
    expect(badge.className).not.toContain('ring-rose-500');
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.getAttribute('aria-label')).toBeNull();
  });
});

describe('AnnotationBadge — facetStatuses on the render carrier', () => {
  it('reads facetStatuses off the annotation carrier when no explicit prop is passed', async () => {
    const annotation: Annotation = makeAnnotation({ id: 'anno-carrier', kind: 'stance' });
    const carrier = {
      ...annotation,
      facetStatuses: { wording: 'disputed' } as Readonly<Partial<Record<FacetName, FacetStatus>>>,
    };
    await render(<AnnotationBadge annotation={carrier} />);
    const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
    expect(badge.getAttribute('data-facet-status')).toBe('disputed');
    expect(badge.getAttribute('aria-label')).toBe(`${EN_LABELS.stance} (disputed)`);
  });
});
