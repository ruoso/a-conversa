// Tests for `<StatementNode>` — the moderator's custom ReactFlow node.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_rendering.md
// (prior:     tasks/refinements/moderator-ui/mod_node_rendering.md)
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The wording prop is rendered verbatim.
//   2. The kind label resolves via `useTranslation` against the
//      `methodology.kind.<id>` namespace for every `StatementKind`
//      value (fact / predictive / value / normative / definitional).
//   3. The cross-locale wiring works — each kind label resolves to the
//      catalog-correct string for en-US / pt-BR / es-419.
//   4. A null kind renders the em-dash placeholder (not the literal
//      "null", not a missing-key string).
//   5. The three `statement-node-*-<id>` test ids are present on the
//      rendered tree so downstream rendering tasks can target them.
//   6. The annotation badge row renders only when annotations are
//      present, and preserves arrival order across multiple badges.
//
// `<StatementNode>` is a plain React component (no ReactFlow runtime
// hook is read from it — it consumes the `NodeProps` shape but doesn't
// call into the ReactFlow store), so it renders cleanly under
// `@testing-library/react` without a `<ReactFlowProvider>` wrapper.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type { NodeProps } from 'reactflow';
import type { StatementKind } from '@a-conversa/shared-types';

import { STATEMENT_NODE_TYPE, StatementNode, type StatementNodeData } from './StatementNode';
import type { FacetName, FacetStatus } from './facetStatus';
import type { Annotation } from './selectors';
import { initI18n } from '../i18n';

// Build a minimum `NodeProps<StatementNodeData>` value for tests.
// ReactFlow hands the renderer many fields (dragging, selected, xPos,
// yPos, etc.) the component doesn't consume; we synthesize a shape
// that satisfies the type without spinning up the ReactFlow store.
// The `data` overrides may omit `annotations` / `facetStatuses` — we
// default both to empty here so the bulk of the cases stay terse.
function makeNodeProps(overrides: {
  id?: string;
  data: Omit<StatementNodeData, 'annotations' | 'facetStatuses'> & {
    annotations?: readonly Annotation[];
    facetStatuses?: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  };
}): NodeProps<StatementNodeData> {
  const id = overrides.id ?? 'node-test-1';
  const { annotations = [], facetStatuses = {}, ...rest } = overrides.data;
  return {
    id,
    type: STATEMENT_NODE_TYPE,
    data: { ...rest, annotations, facetStatuses },
    selected: false,
    isConnectable: true,
    dragging: false,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
  };
}

function makeAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'note',
    content: overrides.content ?? 'an annotation body',
    targetNodeId: overrides.targetNodeId ?? null,
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

describe('StatementNode — rendering', () => {
  it('renders the wording verbatim', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-001',
          data: { wording: 'The minimum wage should be raised.', kind: 'normative' },
        })}
      />,
    );
    expect(screen.getByTestId('statement-node-wording-n-001').textContent).toBe(
      'The minimum wage should be raised.',
    );
  });

  it('renders all three statement-node-* test ids keyed by the node id', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-002',
          data: { wording: 'hello', kind: 'fact' },
        })}
      />,
    );
    expect(screen.getByTestId('statement-node-n-002')).toBeTruthy();
    expect(screen.getByTestId('statement-node-wording-n-002')).toBeTruthy();
    expect(screen.getByTestId('statement-node-kind-n-002')).toBeTruthy();
  });

  it('renders an em-dash placeholder when kind is null', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-003',
          data: { wording: 'Unclassified statement', kind: null },
        })}
      />,
    );
    expect(screen.getByTestId('statement-node-kind-n-003').textContent).toBe('—');
  });
});

describe('StatementNode — localized kind label', () => {
  // The canonical catalog values per
  // tasks/refinements/frontend-i18n/i18n_methodology_glossary.md. Owning
  // them here (rather than importing from `@a-conversa/i18n-catalogs`)
  // is the regression assertion — if a catalog entry drifts, this test
  // is what fails.
  const EXPECTED: Record<StatementKind, { 'en-US': string; 'pt-BR': string; 'es-419': string }> = {
    fact: { 'en-US': 'Fact', 'pt-BR': 'Fato', 'es-419': 'Hecho' },
    predictive: { 'en-US': 'Predictive', 'pt-BR': 'Preditiva', 'es-419': 'Predictiva' },
    value: { 'en-US': 'Value', 'pt-BR': 'Valor', 'es-419': 'Valor' },
    normative: { 'en-US': 'Normative', 'pt-BR': 'Normativa', 'es-419': 'Normativa' },
    definitional: {
      'en-US': 'Definitional',
      'pt-BR': 'Definicional',
      'es-419': 'Definicional',
    },
  };

  const KINDS: StatementKind[] = ['fact', 'predictive', 'value', 'normative', 'definitional'];
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const kind of KINDS) {
      it(`renders ${kind} as "${EXPECTED[kind][locale]}" in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const id = `n-${locale}-${kind}`;
        render(<StatementNode {...makeNodeProps({ id, data: { wording: 'w', kind } })} />);
        expect(screen.getByTestId(`statement-node-kind-${id}`).textContent).toBe(
          EXPECTED[kind][locale],
        );
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('non-en-US kind labels differ from en-US (translation, not copy) where a real translation exists', async () => {
    // pt-BR translates every kind; es-419 translates `fact` (Hecho).
    // Other es-419 entries legitimately share their en-US cognates (e.g.
    // `Valor`, `Normativa`, `Definicional` — the same Latin roots),
    // mirroring the structural-only sanity check in
    // `packages/i18n-catalogs/src/methodology.test.ts`.
    await i18next.changeLanguage('pt-BR');
    render(
      <StatementNode {...makeNodeProps({ id: 'pt-fact', data: { wording: 'w', kind: 'fact' } })} />,
    );
    expect(screen.getByTestId('statement-node-kind-pt-fact').textContent).toBe('Fato');
    // Sanity: differs from en-US "Fact".
    expect(screen.getByTestId('statement-node-kind-pt-fact').textContent).not.toBe('Fact');
    await i18next.changeLanguage('en-US');
  });
});

describe('StatementNode — annotation badge decoration row', () => {
  it('does not render the badge list container when the node has no annotations', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-annotations',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    // The container is only rendered when at least one badge is attached.
    expect(screen.queryByTestId('annotation-badge-list-node-n-no-annotations')).toBeNull();
  });

  it('renders one annotation badge with the matching test id when the node has one annotation', () => {
    const annotation = makeAnnotation({
      id: 'anno-1',
      kind: 'note',
      content: 'see footnote 3',
      targetNodeId: 'n-with-annotation',
    });
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-with-annotation',
          data: {
            wording: 'annotated',
            kind: 'fact',
            annotations: [annotation],
          },
        })}
      />,
    );
    expect(screen.getByTestId('annotation-badge-list-node-n-with-annotation')).toBeTruthy();
    expect(screen.getByTestId('annotation-badge-anno-1')).toBeTruthy();
    expect(screen.getByTestId('annotation-badge-anno-1').textContent).toBe('Note');
    expect(screen.getByTestId('annotation-badge-anno-1').getAttribute('data-annotation-kind')).toBe(
      'note',
    );
    expect(screen.getByTestId('annotation-badge-anno-1').getAttribute('title')).toBe(
      'see footnote 3',
    );
  });

  it('renders multiple annotation badges in arrival order', () => {
    const annotations: Annotation[] = [
      makeAnnotation({
        id: 'anno-a',
        kind: 'note',
        targetNodeId: 'n-many',
        content: 'first',
      }),
      makeAnnotation({
        id: 'anno-b',
        kind: 'reframe',
        targetNodeId: 'n-many',
        content: 'second',
      }),
      makeAnnotation({
        id: 'anno-c',
        kind: 'scope-change',
        targetNodeId: 'n-many',
        content: 'third',
      }),
    ];
    const { container } = render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-many',
          data: { wording: 'with several annotations', kind: 'value', annotations },
        })}
      />,
    );
    // Pull badges in DOM order from the container — verifies arrival
    // order is preserved.
    const ids = Array.from(
      container.querySelectorAll('[data-testid^="annotation-badge-anno-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'annotation-badge-anno-a',
      'annotation-badge-anno-b',
      'annotation-badge-anno-c',
    ]);
  });
});

describe('StatementNode — proposed-state styling (mod_proposed_state_styling)', () => {
  // Cross-locale assertion that the styling is locale-independent. The
  // wording / kind label resolves through i18n; the dashed border +
  // opacity-60 + data-facet-status are styling-only and should apply
  // regardless of the active locale.
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  it('applies border-dashed + opacity-60 + data-facet-status="proposed" when classification facet is proposed', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-proposed-1',
          data: {
            wording: 'in-flight statement',
            kind: 'fact',
            facetStatuses: { classification: 'proposed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-proposed-1');
    expect(card.className).toContain('border-dashed');
    expect(card.className).toContain('opacity-60');
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
  });

  it('omits the proposed-state styling when facetStatuses is empty', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-baseline',
          data: {
            wording: 'committed statement',
            kind: 'fact',
            // facetStatuses defaults to {}
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-baseline');
    expect(card.className).not.toContain('border-dashed');
    expect(card.className).not.toContain('opacity-60');
    expect(card.getAttribute('data-facet-status')).toBeNull();
  });

  it('treats "any facet proposed" as proposed even if another facet is agreed (card-level rollup)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-mixed',
          data: {
            wording: 'mixed-status statement',
            kind: 'fact',
            facetStatuses: { classification: 'agreed', substance: 'proposed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-mixed');
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
    expect(card.className).toContain('border-dashed');
  });

  it('does not apply proposed styling when only agreed / disputed / committed facets are present', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-all-resolved',
          data: {
            wording: 'fully resolved statement',
            kind: 'fact',
            facetStatuses: {
              classification: 'agreed',
              substance: 'committed',
              wording: 'disputed',
            },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-all-resolved');
    expect(card.getAttribute('data-facet-status')).toBeNull();
    expect(card.className).not.toContain('border-dashed');
  });

  for (const locale of LOCALES) {
    it(`applies the proposed-state styling regardless of active locale (${locale})`, async () => {
      await i18next.changeLanguage(locale);
      render(
        <StatementNode
          {...makeNodeProps({
            id: `n-locale-${locale}`,
            data: {
              wording: 'in-flight',
              kind: 'fact',
              facetStatuses: { classification: 'proposed' },
            },
          })}
        />,
      );
      const card = screen.getByTestId(`statement-node-n-locale-${locale}`);
      expect(card.getAttribute('data-facet-status')).toBe('proposed');
      expect(card.className).toContain('border-dashed');
      await i18next.changeLanguage('en-US');
    });
  }
});
