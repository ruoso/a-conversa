// Tests for `<AnnotationNode>` — the promoted-annotation ReactFlow
// node that surfaces an annotation as a graph node.
//
// Refinement: tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. Every `AnnotationKind` × locale combination resolves the right
//      catalog string for `methodology.annotationKind.<kind>` (4 kinds
//      × 3 locales = 12 cases). The annotation node and annotation
//      badge consume the SAME catalog key (Decision §6 — DRY).
//   2. The `data-annotation-kind` attribute mirrors the wire-format
//      kind discriminator (the seam through which `packages/ui-tokens`
//      will eventually layer per-kind colour theming uniformly with
//      the badge surface).
//   3. The `title` attribute carries the annotation's `content` —
//      the cheap baseline hover surface until the dedicated
//      `mod_hover_details` task ships a richer card.
//   4. The `data-host-missing` attribute is stamped only when the
//      `hostMissing` data field is `true` (Decision §4 defensive case).

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
import { ReactFlowProvider, type NodeProps } from 'reactflow';

import { ANNOTATION_NODE_TYPE, AnnotationNode, type AnnotationNodeData } from './AnnotationNode';
import { createI18nInstance, type Annotation } from '@a-conversa/shell';

async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
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

/**
 * Build a `NodeProps<AnnotationNodeData>` shape suitable for direct
 * render. ReactFlow normally constructs these from its internal store;
 * for a unit test we supply the minimal subset `<AnnotationNode>`
 * reads (`id`, `data`).
 */
function makeProps(id: string, data: AnnotationNodeData): NodeProps<AnnotationNodeData> {
  return {
    id,
    data,
    type: ANNOTATION_NODE_TYPE,
    selected: false,
    isConnectable: false,
    xPos: 0,
    yPos: 0,
    dragging: false,
    zIndex: 0,
    targetPosition: undefined as never,
    sourcePosition: undefined as never,
  };
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AnnotationNode — localized kind label per kind × locale', () => {
  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    for (const kind of ALL_KINDS) {
      it(`renders the ${kind} label as "${LABELS_BY_LOCALE[locale][kind]}" in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const id = `anno-${locale}-${kind}`;
        const props = makeProps(id, { kind, content: 'body text', annotations: [] });
        await render(
          <ReactFlowProvider>
            <AnnotationNode {...props} />
          </ReactFlowProvider>,
        );
        const root = screen.getByTestId(`annotation-node-${id}`);
        const kindEl = screen.getByTestId(`annotation-node-kind-${id}`);
        expect(kindEl.textContent).toBe(LABELS_BY_LOCALE[locale][kind]);
        expect(root.getAttribute('data-annotation-kind')).toBe(kind);
        expect(root.getAttribute('title')).toBe('body text');
        expect(root.getAttribute('data-host-missing')).toBeNull();
      });
    }
  }
});

describe('AnnotationNode — host-missing seam', () => {
  it('stamps data-host-missing="true" when data.hostMissing is true', async () => {
    const id = 'anno-orphan';
    const props = makeProps(id, {
      kind: 'note',
      content: 'orphan body',
      annotations: [],
      hostMissing: true,
    });
    await render(
      <ReactFlowProvider>
        <AnnotationNode {...props} />
      </ReactFlowProvider>,
    );
    const root = screen.getByTestId(`annotation-node-${id}`);
    expect(root.getAttribute('data-host-missing')).toBe('true');
  });

  it('omits data-host-missing when data.hostMissing is undefined', async () => {
    const id = 'anno-with-host';
    const props = makeProps(id, { kind: 'note', content: 'body', annotations: [] });
    await render(
      <ReactFlowProvider>
        <AnnotationNode {...props} />
      </ReactFlowProvider>,
    );
    const root = screen.getByTestId(`annotation-node-${id}`);
    expect(root.getAttribute('data-host-missing')).toBeNull();
  });

  it('renders the annotation content body verbatim', async () => {
    const id = 'anno-content-pin';
    const props = makeProps(id, {
      kind: 'reframe',
      content: 'a specific body string',
      annotations: [],
    });
    await render(
      <ReactFlowProvider>
        <AnnotationNode {...props} />
      </ReactFlowProvider>,
    );
    const contentEl = screen.getByTestId(`annotation-node-content-${id}`);
    expect(contentEl.textContent).toBe('a specific body string');
  });
});

// -- annotation-of-annotation badge-list row -----------------------
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_of_annotation_overlay_chain.md
//
// When `data.annotations` is non-empty, `<AnnotationNode>` renders a
// flex-wrap badge row beneath the content row — one `<AnnotationBadge>`
// per propagated annotation. When empty, the badge-row `<div>` is
// absent entirely (no allocated DOM space for the no-meta-annotation
// baseline).

function makeMetaAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'meta-annotation body',
    targetNodeId: overrides.targetNodeId ?? null,
    targetEdgeId: overrides.targetEdgeId ?? null,
    createdBy: overrides.createdBy ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: overrides.createdAt ?? '2026-05-30T00:00:00.000Z',
  };
}

describe('AnnotationNode — annotation-of-annotation badge row', () => {
  it('renders one <AnnotationBadge> per entry when data.annotations is non-empty', async () => {
    const id = 'anno-meta-host';
    const a2 = makeMetaAnnotation({
      id: '00000000-0000-4000-8000-000000000b02',
      kind: 'reframe',
      content: 'A2 reframes A1',
    });
    const a3 = makeMetaAnnotation({
      id: '00000000-0000-4000-8000-000000000b03',
      kind: 'stance',
      content: 'A3 stance on A1',
    });
    const props = makeProps(id, {
      kind: 'note',
      content: 'A1 (the host annotation)',
      annotations: [a2, a3],
    });
    await render(
      <ReactFlowProvider>
        <AnnotationNode {...props} />
      </ReactFlowProvider>,
    );
    const list = screen.getByTestId(`annotation-node-badge-list-${id}`);
    const badges = list.querySelectorAll('[data-testid^="annotation-badge-"]');
    expect(badges).toHaveLength(2);
    expect(badges[0]?.getAttribute('data-annotation-kind')).toBe('reframe');
    expect(badges[1]?.getAttribute('data-annotation-kind')).toBe('stance');
  });

  it('renders no badge-list row when data.annotations is empty', async () => {
    const id = 'anno-no-meta';
    const props = makeProps(id, {
      kind: 'note',
      content: 'a bare annotation',
      annotations: [],
    });
    await render(
      <ReactFlowProvider>
        <AnnotationNode {...props} />
      </ReactFlowProvider>,
    );
    expect(screen.queryByTestId(`annotation-node-badge-list-${id}`)).toBeNull();
  });
});
