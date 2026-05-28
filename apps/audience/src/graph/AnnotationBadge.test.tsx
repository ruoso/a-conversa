// Tests for `<AudienceAnnotationBadge>` — the small amber pill rendering
// one committed annotation on the audience broadcast canvas.
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//              (Constraints — 5 cases pinning the audience-prefixed
//              testid, the `data-annotation-kind` seam, the `title`
//              carrier, and the en-US i18n smoke. The full cross-
//              locale matrix is the moderator's `AnnotationBadge.test.tsx`
//              job; the audience pins en-US smoke only.)
// ADRs:        0022 (no throwaway verifications — committed Vitest
//              cases, not throwaway probes); 0024 (react-i18next + ICU
//              — `useTranslation()` resolves the kind label via the
//              shared `methodology.annotationKind.<kind>` catalog
//              keys).

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

import {
  createI18nInstance,
  I18nProvider,
  type Annotation,
  type I18nInstance,
} from '@a-conversa/shell';

import { AudienceAnnotationBadge } from './AnnotationBadge';

// `useTranslation()` schedules a microtask-deferred setState when its
// internal i18next subscription registers on mount. Mirror the
// moderator's pattern: wrap the synchronous render in an async `act`
// block so the deferred update lands inside the same act window.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const EN_LABELS: Record<AnnotationKind, string> = {
  note: 'Note',
  reframe: 'Reframe',
  'scope-change': 'Scope change',
  stance: 'Stance',
};
const ALL_KINDS: readonly AnnotationKind[] = ['note', 'reframe', 'scope-change', 'stance'];

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'an annotation body',
    targetNodeId: overrides.targetNodeId ?? '00000000-0000-4000-8000-0000000000c1',
    targetEdgeId: overrides.targetEdgeId ?? null,
    createdBy: overrides.createdBy ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: overrides.createdAt ?? '2026-05-28T00:00:00.000Z',
  };
}

let i18nInstance: I18nInstance;

beforeEach(async () => {
  i18nInstance = await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AudienceAnnotationBadge', () => {
  it('(a) renders the localized en-US kind label as the badge text', async () => {
    const annotation = makeAnnotation({ id: 'anno-en-note', kind: 'note' });
    await render(
      <I18nProvider i18n={i18nInstance}>
        <AudienceAnnotationBadge annotation={annotation} />
      </I18nProvider>,
    );
    const badge = screen.getByTestId(`audience-annotation-badge-${annotation.id}`);
    expect(badge.textContent).toBe('Note');
  });

  it('(b) carries the audience-prefixed data-testid', async () => {
    const annotation = makeAnnotation({ id: 'anno-testid' });
    await render(
      <I18nProvider i18n={i18nInstance}>
        <AudienceAnnotationBadge annotation={annotation} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('audience-annotation-badge-anno-testid')).toBeTruthy();
  });

  it('(c) carries data-annotation-kind matching the prop', async () => {
    const annotation = makeAnnotation({ id: 'anno-kind', kind: 'reframe' });
    await render(
      <I18nProvider i18n={i18nInstance}>
        <AudienceAnnotationBadge annotation={annotation} />
      </I18nProvider>,
    );
    const badge = screen.getByTestId(`audience-annotation-badge-${annotation.id}`);
    expect(badge.getAttribute('data-annotation-kind')).toBe('reframe');
  });

  it('(d) carries the annotation content on the title attribute', async () => {
    const annotation = makeAnnotation({
      id: 'anno-title',
      content: 'Ben notes the accredited/unaccredited boundary does argumentative work',
    });
    await render(
      <I18nProvider i18n={i18nInstance}>
        <AudienceAnnotationBadge annotation={annotation} />
      </I18nProvider>,
    );
    const badge = screen.getByTestId(`audience-annotation-badge-${annotation.id}`);
    expect(badge.getAttribute('title')).toBe(
      'Ben notes the accredited/unaccredited boundary does argumentative work',
    );
  });

  it('(e) resolves every AnnotationKind through methodology.annotationKind.<kind> in en-US', async () => {
    for (const kind of ALL_KINDS) {
      const annotation = makeAnnotation({ id: `anno-locale-${kind}`, kind });
      await render(
        <I18nProvider i18n={i18nInstance}>
          <AudienceAnnotationBadge annotation={annotation} />
        </I18nProvider>,
      );
      const badge = screen.getByTestId(`audience-annotation-badge-${annotation.id}`);
      expect(badge.textContent).toBe(EN_LABELS[kind]);
      cleanup();
    }
  });
});
