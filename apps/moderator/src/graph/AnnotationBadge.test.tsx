// Tests for `<AnnotationBadge>` — the small pill rendering an annotation
// on a statement node or edge.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_rendering.md
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { AnnotationKind } from '@a-conversa/shared-types';

import { AnnotationBadge } from './AnnotationBadge';
import type { Annotation } from './selectors';
import { initI18n } from '../i18n';

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

beforeEach(async () => {
  await initI18n('en-US');
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
        render(<AnnotationBadge annotation={annotation} />);
        const badge = screen.getByTestId(`annotation-badge-${annotation.id}`);
        expect(badge.textContent).toBe(LABELS_BY_LOCALE[locale][kind]);
        expect(badge.getAttribute('data-annotation-kind')).toBe(kind);
        expect(badge.getAttribute('title')).toBe('body text');
        await i18next.changeLanguage('en-US');
      });
    }
  }
});
