// Tests for `<StatementNode>` — the moderator's custom ReactFlow node.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md)
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

import {
  STATEMENT_NODE_TYPE,
  StatementNode,
  cardRollupStatus,
  type StatementNodeData,
} from './StatementNode';
import type { DiagnosticHighlight } from './diagnosticHighlights';
import type { FacetName, FacetStatus } from './facetStatus';
import type { Annotation, AxiomMark, Vote } from './selectors';
import { initI18n } from '../i18n';
import { useSelectionStore } from '../stores';

// Build a minimum `NodeProps<StatementNodeData>` value for tests.
// ReactFlow hands the renderer many fields (dragging, selected, xPos,
// yPos, etc.) the component doesn't consume; we synthesize a shape
// that satisfies the type without spinning up the ReactFlow store.
// The `data` overrides may omit `annotations` / `facetStatuses` — we
// default both to empty here so the bulk of the cases stay terse.
function makeNodeProps(overrides: {
  id?: string;
  data: Omit<
    StatementNodeData,
    'annotations' | 'facetStatuses' | 'axiomMarks' | 'votesByFacet' | 'diagnosticHighlight'
  > & {
    annotations?: readonly Annotation[];
    facetStatuses?: Readonly<Partial<Record<FacetName, FacetStatus>>>;
    axiomMarks?: readonly AxiomMark[];
    votesByFacet?: Readonly<Partial<Record<FacetName, readonly Vote[]>>>;
    diagnosticHighlight?: DiagnosticHighlight;
  };
}): NodeProps<StatementNodeData> {
  const id = overrides.id ?? 'node-test-1';
  const {
    annotations = [],
    facetStatuses = {},
    axiomMarks = [],
    votesByFacet = {},
    diagnosticHighlight,
    ...rest
  } = overrides.data;
  // Only include `diagnosticHighlight` on the data object when it's
  // defined — exactOptionalPropertyTypes rejects `undefined` on an
  // optional property.
  const data: StatementNodeData =
    diagnosticHighlight === undefined
      ? { ...rest, annotations, facetStatuses, axiomMarks, votesByFacet }
      : { ...rest, annotations, facetStatuses, axiomMarks, votesByFacet, diagnosticHighlight };
  return {
    id,
    type: STATEMENT_NODE_TYPE,
    data,
    selected: false,
    isConnectable: true,
    dragging: false,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
  };
}

function makeAxiomMark(overrides: Partial<AxiomMark> & { participantId: string }): AxiomMark {
  return {
    nodeId: overrides.nodeId ?? 'node-test-1',
    participantId: overrides.participantId,
    committedAt: overrides.committedAt ?? '2026-05-11T00:00:00.000Z',
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
  // Reset the selection store between cases so the per-card `isSelected`
  // selector returns `false` by default — the bulk of these tests assume
  // nothing is selected (the `mod_selection` cases at the bottom of the
  // file explicitly opt into selection by calling `select(...)` first).
  useSelectionStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useSelectionStore.getState().clear();
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

  it('picks the highest-priority status when multiple non-proposed facets are present (rollup order: proposed > meta-disagreement > disputed > agreed > committed > withdrawn)', () => {
    // Updated under refinement `mod_agreed_state_styling`. The earlier
    // assertion ("no `data-facet-status` when nothing is proposed") was
    // written before the rollup priority order was decided; with the
    // landed order (`proposed > meta-disagreement > disputed > agreed >
    // committed > withdrawn`), a mix of `agreed` / `committed` /
    // `disputed` now resolves to `disputed`. The component stamps the
    // attribute (the stable seam for `mod_disputed_state_styling` to
    // extend) but does not apply proposed-state classes — that branch
    // requires an actually-proposed facet.
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
    expect(card.getAttribute('data-facet-status')).toBe('disputed');
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

describe('StatementNode — agreed-state styling (mod_agreed_state_styling)', () => {
  // The agreed-state visual is the methodology's "fully aligned" signal:
  // every current participant has voted `agree` on the facet and no
  // commit / dispute / meta-disagreement event has landed yet. The card
  // reads as solid-bordered + full-opacity (the unstyled baseline is
  // also solid + full-opacity; the agreed variant darkens the border
  // from `border-slate-300` to `border-slate-700` so the "this has been
  // agreed" signal is visually distinct from the "nothing has happened
  // here yet" baseline). The `data-facet-status="agreed"` attribute is
  // the stable seam for downstream tests / styling tasks.
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  it('applies border-solid + border-slate-700 + opacity-100 + data-facet-status="agreed" when classification facet is agreed', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-agreed-1',
          data: {
            wording: 'unanimously agreed statement',
            kind: 'fact',
            facetStatuses: { classification: 'agreed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-agreed-1');
    expect(card.className).toContain('border-solid');
    expect(card.className).toContain('border-slate-700');
    expect(card.className).toContain('opacity-100');
    expect(card.className).not.toContain('border-dashed');
    expect(card.getAttribute('data-facet-status')).toBe('agreed');
  });

  it('applies agreed styling when every facet is agreed (rollup pick from a uniform set)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-agreed-all',
          data: {
            wording: 'fully agreed across all facets',
            kind: 'value',
            facetStatuses: {
              classification: 'agreed',
              substance: 'agreed',
              wording: 'agreed',
            },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-agreed-all');
    expect(card.getAttribute('data-facet-status')).toBe('agreed');
    expect(card.className).toContain('border-slate-700');
  });

  it('proposed wins over agreed in the card-level rollup (proposed has higher priority than agreed)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-proposed-over-agreed',
          data: {
            wording: 'mixed: still in flight',
            kind: 'fact',
            facetStatuses: { classification: 'agreed', substance: 'proposed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-proposed-over-agreed');
    // Proposed has higher priority than agreed → the data attribute and
    // the dashed-border styling reflect the proposed state.
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
    expect(card.className).toContain('border-dashed');
  });

  it('agreed beats committed in the card-level rollup (closed facets sort last)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-agreed-over-committed',
          data: {
            wording: 'mixed: agreed and committed',
            kind: 'fact',
            facetStatuses: { classification: 'agreed', substance: 'committed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-agreed-over-committed');
    expect(card.getAttribute('data-facet-status')).toBe('agreed');
    expect(card.className).toContain('border-slate-700');
  });

  for (const locale of LOCALES) {
    it(`applies the agreed-state styling regardless of active locale (${locale})`, async () => {
      await i18next.changeLanguage(locale);
      render(
        <StatementNode
          {...makeNodeProps({
            id: `n-agreed-locale-${locale}`,
            data: {
              wording: 'agreed across locales',
              kind: 'fact',
              facetStatuses: { classification: 'agreed' },
            },
          })}
        />,
      );
      const card = screen.getByTestId(`statement-node-n-agreed-locale-${locale}`);
      expect(card.getAttribute('data-facet-status')).toBe('agreed');
      expect(card.className).toContain('border-slate-700');
      await i18next.changeLanguage('en-US');
    });
  }
});

describe('StatementNode — disputed-state styling (mod_disputed_state_styling)', () => {
  // The disputed-state visual is the methodology's "requires resolution"
  // signal: at least one current participant has voted `dispute` (or
  // withdrawn against an uncommitted facet) and the moderator must
  // surface and resolve the disagreement before the entity can be
  // committed. The card reads as solid red border + a 2-px ring halo
  // — the unambiguous "this needs attention" marker. `opacity-100` is
  // explicit defense against any inherited dim opacity.
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  it('applies border-solid + border-rose-600 + ring-2 + ring-rose-500 + data-facet-status="disputed" when classification facet is disputed', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-disputed-1',
          data: {
            wording: 'a disputed statement',
            kind: 'fact',
            facetStatuses: { classification: 'disputed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-disputed-1');
    expect(card.className).toContain('border-solid');
    expect(card.className).toContain('border-rose-600');
    expect(card.className).toContain('ring-2');
    expect(card.className).toContain('ring-rose-500');
    expect(card.className).toContain('opacity-100');
    expect(card.className).not.toContain('border-dashed');
    expect(card.getAttribute('data-facet-status')).toBe('disputed');
  });

  it('disputed beats agreed in the card-level rollup (priority chain wired through to the className branch)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-disputed-over-agreed',
          data: {
            wording: 'mixed: disputed wins over agreed',
            kind: 'fact',
            facetStatuses: { classification: 'agreed', substance: 'disputed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-disputed-over-agreed');
    // Disputed has higher priority than agreed → the data attribute and
    // the red-marker styling reflect the disputed state.
    expect(card.getAttribute('data-facet-status')).toBe('disputed');
    expect(card.className).toContain('border-rose-600');
    expect(card.className).toContain('ring-rose-500');
    // Not styled as agreed (the agreed branch uses `border-slate-700`).
    expect(card.className).not.toContain('border-slate-700');
  });

  it('proposed wins over disputed (the rollup priority is unchanged by this task)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-proposed-over-disputed',
          data: {
            wording: 'mixed: still in flight on another facet',
            kind: 'fact',
            facetStatuses: { classification: 'disputed', substance: 'proposed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-proposed-over-disputed');
    // Proposed has higher priority than disputed → the proposed visual
    // wins. The disputed red marker does NOT apply.
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
    expect(card.className).toContain('border-dashed');
    expect(card.className).not.toContain('border-rose-600');
    expect(card.className).not.toContain('ring-rose-500');
  });

  for (const locale of LOCALES) {
    it(`applies the disputed-state styling regardless of active locale (${locale})`, async () => {
      await i18next.changeLanguage(locale);
      render(
        <StatementNode
          {...makeNodeProps({
            id: `n-disputed-locale-${locale}`,
            data: {
              wording: 'disputed across locales',
              kind: 'fact',
              facetStatuses: { classification: 'disputed' },
            },
          })}
        />,
      );
      const card = screen.getByTestId(`statement-node-n-disputed-locale-${locale}`);
      expect(card.getAttribute('data-facet-status')).toBe('disputed');
      expect(card.className).toContain('border-rose-600');
      expect(card.className).toContain('ring-rose-500');
      await i18next.changeLanguage('en-US');
    });
  }
});

describe('StatementNode — meta-disagreement-state styling (mod_meta_disagreement_split_render)', () => {
  // The meta-disagreement-state visual is the methodology's "agreed to
  // disagree" disposition signal: the dispute is irreducible, both
  // proposed values are carried side by side, and the moderator has
  // recorded the disagreement itself as the facet's status. The card
  // reads as a double-border (CSS's two parallel lines — the literal
  // "split decision" visual) in violet, with a 2-px ring halo for the
  // attention-grabbing escalation signal. The violet palette is the
  // methodology-escalation color family, distinct from slate (baseline
  // / agreed) and rose (disputed). `opacity-100` is explicit defense
  // against any inherited dim opacity.
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  it('applies border-double + border-violet-600 + ring-2 + ring-violet-400 + data-facet-status="meta-disagreement" when classification facet is meta-disagreement', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-meta-1',
          data: {
            wording: 'an irreducibly-disputed statement',
            kind: 'fact',
            facetStatuses: { classification: 'meta-disagreement' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-meta-1');
    expect(card.className).toContain('border-double');
    expect(card.className).toContain('border-violet-600');
    expect(card.className).toContain('ring-2');
    expect(card.className).toContain('ring-violet-400');
    expect(card.className).toContain('opacity-100');
    // Not styled as any of the other three branches.
    expect(card.className).not.toContain('border-dashed');
    expect(card.className).not.toContain('border-rose-600');
    expect(card.className).not.toContain('ring-rose-500');
    expect(card.getAttribute('data-facet-status')).toBe('meta-disagreement');
  });

  it('meta-disagreement beats disputed in the card-level rollup (priority chain wired through to the className branch)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-meta-over-disputed',
          data: {
            wording: 'mixed: meta-disagreement wins over disputed',
            kind: 'fact',
            facetStatuses: { classification: 'disputed', substance: 'meta-disagreement' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-meta-over-disputed');
    // Meta-disagreement has higher priority than disputed → the data
    // attribute and the violet split-visual styling reflect the meta-
    // disagreement state.
    expect(card.getAttribute('data-facet-status')).toBe('meta-disagreement');
    expect(card.className).toContain('border-double');
    expect(card.className).toContain('border-violet-600');
    expect(card.className).toContain('ring-violet-400');
    // Not styled as disputed (the disputed branch uses red + ring-rose-500).
    expect(card.className).not.toContain('border-rose-600');
    expect(card.className).not.toContain('ring-rose-500');
  });

  it('proposed wins over meta-disagreement (the rollup priority is unchanged by this task)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-proposed-over-meta',
          data: {
            wording: 'mixed: still in flight on another facet',
            kind: 'fact',
            facetStatuses: { classification: 'meta-disagreement', substance: 'proposed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-proposed-over-meta');
    // Proposed has higher priority than meta-disagreement → the
    // proposed visual wins. The meta-disagreement violet marker does
    // NOT apply.
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
    expect(card.className).toContain('border-dashed');
    expect(card.className).not.toContain('border-double');
    expect(card.className).not.toContain('border-violet-600');
    expect(card.className).not.toContain('ring-violet-400');
  });

  for (const locale of LOCALES) {
    it(`applies the meta-disagreement-state styling regardless of active locale (${locale})`, async () => {
      await i18next.changeLanguage(locale);
      render(
        <StatementNode
          {...makeNodeProps({
            id: `n-meta-locale-${locale}`,
            data: {
              wording: 'meta-disagreement across locales',
              kind: 'fact',
              facetStatuses: { classification: 'meta-disagreement' },
            },
          })}
        />,
      );
      const card = screen.getByTestId(`statement-node-n-meta-locale-${locale}`);
      expect(card.getAttribute('data-facet-status')).toBe('meta-disagreement');
      expect(card.className).toContain('border-double');
      expect(card.className).toContain('border-violet-600');
      expect(card.className).toContain('ring-violet-400');
      await i18next.changeLanguage('en-US');
    });
  }
});

describe('cardRollupStatus — rollup priority order (mod_agreed_state_styling)', () => {
  // Direct unit tests on the rollup function — pin the priority order
  // without relying on a React render. The order is
  // `proposed > meta-disagreement > disputed > agreed > committed > withdrawn`.
  it('returns undefined for an empty facet record', () => {
    expect(cardRollupStatus({})).toBeUndefined();
  });

  it('returns the single status when only one facet is present', () => {
    expect(cardRollupStatus({ classification: 'agreed' })).toBe('agreed');
    expect(cardRollupStatus({ classification: 'proposed' })).toBe('proposed');
    expect(cardRollupStatus({ classification: 'committed' })).toBe('committed');
  });

  it('proposed beats every other status', () => {
    expect(
      cardRollupStatus({
        classification: 'proposed',
        substance: 'agreed',
        wording: 'committed',
      }),
    ).toBe('proposed');
    expect(cardRollupStatus({ classification: 'meta-disagreement', substance: 'proposed' })).toBe(
      'proposed',
    );
  });

  it('meta-disagreement beats disputed / agreed / committed / withdrawn', () => {
    expect(
      cardRollupStatus({
        classification: 'meta-disagreement',
        substance: 'disputed',
        wording: 'agreed',
      }),
    ).toBe('meta-disagreement');
  });

  it('disputed beats agreed / committed / withdrawn', () => {
    expect(cardRollupStatus({ classification: 'disputed', substance: 'agreed' })).toBe('disputed');
    expect(cardRollupStatus({ classification: 'committed', substance: 'disputed' })).toBe(
      'disputed',
    );
  });

  it('agreed beats committed and withdrawn', () => {
    expect(cardRollupStatus({ classification: 'agreed', substance: 'committed' })).toBe('agreed');
    expect(cardRollupStatus({ classification: 'withdrawn', substance: 'agreed' })).toBe('agreed');
  });

  it('committed beats withdrawn', () => {
    expect(cardRollupStatus({ classification: 'committed', substance: 'withdrawn' })).toBe(
      'committed',
    );
  });
});

describe('StatementNode — axiom-mark decoration row (mod_axiom_mark_decoration)', () => {
  // The axiom-mark badge row surfaces per-participant bedrock-disposition
  // marks on the node card. Per-participant means multiple marks can land
  // on a single node — one per participant who marked it. The row is
  // omitted from the DOM when no axiom-marks exist, mirroring the
  // annotation-row pattern. The row renders ABOVE the annotation row
  // (axiom-marks are methodology-load-bearing; annotations are commentary).

  // Distinct hash buckets — see the same constants in `selectors.test.ts`.
  const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
  const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

  it('does not render the axiom-mark list container when the node has no axiom-marks', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-axioms',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    expect(screen.queryByTestId('axiom-mark-list-node-n-no-axioms')).toBeNull();
  });

  it('renders one axiom-mark badge with the right testid when the node has one axiom-mark', () => {
    const mark = makeAxiomMark({ nodeId: 'n-one-axiom', participantId: PARTICIPANT_A });
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-one-axiom',
          data: {
            wording: 'a bedrock statement',
            kind: 'value',
            axiomMarks: [mark],
          },
        })}
      />,
    );
    expect(screen.getByTestId('axiom-mark-list-node-n-one-axiom')).toBeTruthy();
    expect(screen.getByTestId(`axiom-mark-badge-n-one-axiom-${PARTICIPANT_A}`)).toBeTruthy();
  });

  it('renders multiple axiom-mark badges in arrival order (per-participant uniqueness — both participants surface)', () => {
    const marks: AxiomMark[] = [
      makeAxiomMark({ nodeId: 'n-multi', participantId: PARTICIPANT_A }),
      makeAxiomMark({ nodeId: 'n-multi', participantId: PARTICIPANT_B }),
    ];
    const { container } = render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-multi',
          data: { wording: 'shared bedrock', kind: 'value', axiomMarks: marks },
        })}
      />,
    );
    const ids = Array.from(
      container.querySelectorAll('[data-testid^="axiom-mark-badge-n-multi-"]'),
    ).map((el) => el.getAttribute('data-participant-id'));
    expect(ids).toEqual([PARTICIPANT_A, PARTICIPANT_B]);
  });

  it('renders the axiom-mark row above the annotation row when both are present', () => {
    // Visual hierarchy: axiom-marks (methodology-disposition) above
    // annotations (commentary). Pin the DOM order so a future refactor
    // doesn't silently invert it.
    const mark = makeAxiomMark({ nodeId: 'n-both', participantId: PARTICIPANT_A });
    const annotation: Annotation = {
      id: 'anno-x',
      kind: 'note',
      content: 'commentary',
      targetNodeId: 'n-both',
      targetEdgeId: null,
      createdBy: PARTICIPANT_A,
      createdAt: '2026-05-11T00:00:00.000Z',
    };
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-both',
          data: {
            wording: 'both decorations',
            kind: 'fact',
            axiomMarks: [mark],
            annotations: [annotation],
          },
        })}
      />,
    );
    const axiomRow = screen.getByTestId('axiom-mark-list-node-n-both');
    const annotationRow = screen.getByTestId('annotation-badge-list-node-n-both');
    // The axiom row's compareDocumentPosition vs. the annotation row:
    // `Node.DOCUMENT_POSITION_FOLLOWING` (4) means "other follows this"
    // — i.e. axiom-row comes BEFORE annotation-row in the DOM.
    const axiomIsBeforeAnnotation =
      (axiomRow.compareDocumentPosition(annotationRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(axiomIsBeforeAnnotation).toBe(true);
  });
});

describe('StatementNode — per-facet state visualization (mod_per_facet_state_visualization)', () => {
  // The facet-pill row surfaces ALL per-facet statuses simultaneously on
  // the card — the detail layer underneath the whole-card frame rollup.
  // Pills iterate in canonical reading order (`wording` → `classification`
  // → `substance`, per `FACET_RENDER_ORDER` in `StatementNode.tsx`); only
  // facets present in `data.facetStatuses` produce a pill. The row is
  // omitted entirely when `facetStatuses` is empty (mirrors the
  // annotation / axiom-mark row pattern).

  it('does not render the facet-pill row when facetStatuses is empty', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-facets',
          data: { wording: 'fresh node', kind: 'fact' },
        })}
      />,
    );
    // The container is only rendered when at least one pill exists.
    expect(screen.queryByTestId('facet-pill-row-node-n-no-facets')).toBeNull();
  });

  it('renders a single wording pill when only wording is proposed', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-wording-only',
          data: {
            wording: 'in-flight wording',
            kind: 'fact',
            facetStatuses: { wording: 'proposed' },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-wording-only');
    expect(row).toBeTruthy();
    const pills = row.querySelectorAll('[data-facet-pill]');
    expect(pills.length).toBe(1);
    const pill = pills[0] as HTMLElement;
    expect(pill.getAttribute('data-facet-name')).toBe('wording');
    expect(pill.getAttribute('data-facet-status')).toBe('proposed');
  });

  it('renders three pills in canonical order (wording → classification → substance)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-three-facets',
          data: {
            wording: 'all three facets touched',
            kind: 'fact',
            facetStatuses: {
              classification: 'disputed',
              substance: 'proposed',
              wording: 'agreed',
            },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-three-facets');
    const pills = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]'));
    expect(pills.length).toBe(3);
    // Pin the DOM order — wording first, then classification, then substance.
    expect(pills.map((p) => p.getAttribute('data-facet-name'))).toEqual([
      'wording',
      'classification',
      'substance',
    ]);
    // Each pill carries its own independent status.
    expect(pills[0]?.getAttribute('data-facet-status')).toBe('agreed');
    expect(pills[1]?.getAttribute('data-facet-status')).toBe('disputed');
    expect(pills[2]?.getAttribute('data-facet-status')).toBe('proposed');
  });

  it('renders independent per-facet statuses when statuses are mixed (one disputed + two committed)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-mixed-closed',
          data: {
            wording: 'one disputed, two committed',
            kind: 'value',
            facetStatuses: {
              wording: 'committed',
              classification: 'committed',
              substance: 'disputed',
            },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-mixed-closed');
    const pills = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]'));
    expect(pills.length).toBe(3);
    const byFacet: Record<string, string | null> = {};
    for (const p of pills) {
      const name = p.getAttribute('data-facet-name');
      if (name !== null) byFacet[name] = p.getAttribute('data-facet-status');
    }
    expect(byFacet.wording).toBe('committed');
    expect(byFacet.classification).toBe('committed');
    expect(byFacet.substance).toBe('disputed');
    // The committed-state pill should carry the committed-state classes
    // (closed-state styling — the pill renders distinctly even though
    // the whole-card frame falls back to baseline for `committed`).
    const committedPill = pills.find((p) => p.getAttribute('data-facet-name') === 'wording');
    expect(committedPill?.className).toContain('opacity-90');
    // The disputed pill should carry the rose ring even though the
    // whole-card rollup is `disputed` (frame uses ring-2; pill uses ring-1).
    const disputedPill = pills.find((p) => p.getAttribute('data-facet-name') === 'substance');
    expect(disputedPill?.className).toContain('border-rose-600');
    expect(disputedPill?.className).toContain('ring-1');
  });

  it('coexists with the whole-card frame styling (rollup + per-pill render independently)', () => {
    // When one facet is proposed and another is disputed, the whole-card
    // frame rolls up to PROPOSED (the highest-priority status), so the
    // card frame paints dashed-slate. Independently, the disputed pill
    // still carries the red-marker classes — the rollup and the per-pill
    // detail are TWO separate signals and must coexist.
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-frame-and-pills',
          data: {
            wording: 'proposed wins the rollup; disputed pill still shows red',
            kind: 'fact',
            facetStatuses: { wording: 'proposed', substance: 'disputed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-frame-and-pills');
    // Frame: the rollup picks `proposed` → dashed-slate border on the
    // whole card. The `data-facet-status` attribute on the root reflects
    // the rollup (not the per-pill statuses).
    expect(card.getAttribute('data-facet-status')).toBe('proposed');
    expect(card.className).toContain('border-dashed');
    expect(card.className).not.toContain('border-rose-600');

    // Per-pill row: the disputed pill carries its own red marker.
    const row = screen.getByTestId('facet-pill-row-node-n-frame-and-pills');
    const pills = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]'));
    expect(pills.length).toBe(2);
    const disputedPill = pills.find((p) => p.getAttribute('data-facet-name') === 'substance');
    expect(disputedPill?.getAttribute('data-facet-status')).toBe('disputed');
    expect(disputedPill?.className).toContain('border-rose-600');
    expect(disputedPill?.className).toContain('ring-rose-500');
  });

  it('renders the facet-pill row ABOVE the wording paragraph', () => {
    // Visual hierarchy: per-facet detail leads (the methodology's
    // structural axis), then the wording paragraph (the content). Pin
    // the DOM order so a future refactor doesn't silently invert it.
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-order-check',
          data: {
            wording: 'ordering check',
            kind: 'fact',
            facetStatuses: { wording: 'proposed' },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-order-check');
    const wording = screen.getByTestId('statement-node-wording-n-order-check');
    // `DOCUMENT_POSITION_FOLLOWING` (4): "other follows this" — i.e. row
    // comes BEFORE wording in the DOM.
    const rowIsBeforeWording =
      (row.compareDocumentPosition(wording) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(rowIsBeforeWording).toBe(true);
  });
});

describe('StatementNode — per-participant vote indicators (mod_vote_indicators_on_graph)', () => {
  // The in-pill vote-indicator row surfaces WHO voted WHAT on each
  // facet's pending proposal. Per-participant outer ring color (from
  // `axiomMarkColorFor`) + choice-keyed inner fill (emerald = agree,
  // rose = dispute, slate = withdraw). The row is omitted from a pill
  // when the facet has no votes — the existing border / opacity rules
  // are unaffected.

  // Distinct hash buckets — same constants used in
  // `AxiomMarkBadge.test.tsx` / `selectors.test.ts`.
  const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
  const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

  it('renders no vote-indicator rows when votesByFacet is empty', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-votes',
          data: {
            wording: 'facet pills but no votes',
            kind: 'fact',
            facetStatuses: { wording: 'proposed' },
          },
        })}
      />,
    );
    // Pill renders but the vote-indicator row inside the pill does not.
    const row = screen.getByTestId('facet-pill-row-node-n-no-votes');
    expect(row.querySelector('[data-vote-indicator]')).toBeNull();
    expect(row.querySelector('[data-vote-indicator-row]')).toBeNull();
  });

  it('renders one indicator inside the wording pill when a single participant agrees on wording', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-one-vote',
          data: {
            wording: 'one agree on wording',
            kind: 'fact',
            facetStatuses: { wording: 'proposed' },
            votesByFacet: {
              wording: [{ participantId: PARTICIPANT_A, choice: 'agree' }],
            },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-one-vote');
    const wordingPill = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]')).find(
      (p) => p.getAttribute('data-facet-name') === 'wording',
    );
    expect(wordingPill).toBeTruthy();
    const indicators = wordingPill!.querySelectorAll('[data-vote-indicator]');
    expect(indicators.length).toBe(1);
    const indicator = indicators[0] as HTMLElement;
    expect(indicator.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
    expect(indicator.getAttribute('data-choice')).toBe('agree');
  });

  it('renders one indicator row per pill when votes land on two different facets', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-two-facets',
          data: {
            wording: 'votes across two facets',
            kind: 'fact',
            facetStatuses: { wording: 'proposed', substance: 'disputed' },
            votesByFacet: {
              wording: [{ participantId: PARTICIPANT_A, choice: 'agree' }],
              substance: [{ participantId: PARTICIPANT_B, choice: 'dispute' }],
            },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-two-facets');
    const pills = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]'));
    const wordingPill = pills.find((p) => p.getAttribute('data-facet-name') === 'wording')!;
    const substancePill = pills.find((p) => p.getAttribute('data-facet-name') === 'substance')!;
    const wordingIndicators = wordingPill.querySelectorAll<HTMLElement>('[data-vote-indicator]');
    const substanceIndicators =
      substancePill.querySelectorAll<HTMLElement>('[data-vote-indicator]');
    expect(wordingIndicators.length).toBe(1);
    expect(substanceIndicators.length).toBe(1);
    expect(wordingIndicators[0]?.getAttribute('data-choice')).toBe('agree');
    expect(substanceIndicators[0]?.getAttribute('data-choice')).toBe('dispute');
  });

  it('renders mixed votes (agree + dispute) with distinct data-choice values on the same pill', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-mixed-votes',
          data: {
            wording: 'agree and dispute on substance',
            kind: 'fact',
            facetStatuses: { substance: 'disputed' },
            votesByFacet: {
              substance: [
                { participantId: PARTICIPANT_A, choice: 'agree' },
                { participantId: PARTICIPANT_B, choice: 'dispute' },
              ],
            },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-mixed-votes');
    const indicators = Array.from(row.querySelectorAll<HTMLElement>('[data-vote-indicator]'));
    expect(indicators.length).toBe(2);
    const choices = indicators.map((i) => i.getAttribute('data-choice'));
    expect(choices).toEqual(['agree', 'dispute']);
  });

  it('renders a withdrawn vote with the gray choice color and data-choice="withdraw"', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-withdrawn',
          data: {
            wording: 'one withdrew on classification',
            kind: 'fact',
            facetStatuses: { classification: 'withdrawn' },
            votesByFacet: {
              classification: [{ participantId: PARTICIPANT_A, choice: 'withdraw' }],
            },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-withdrawn');
    const indicator = row.querySelector<HTMLElement>('[data-vote-indicator]');
    expect(indicator).toBeTruthy();
    expect(indicator!.getAttribute('data-choice')).toBe('withdraw');
    expect(indicator!.className).toContain('bg-slate-400');
    // Not styled as agree (emerald) or dispute (rose).
    expect(indicator!.className).not.toContain('bg-emerald-500');
    expect(indicator!.className).not.toContain('bg-rose-500');
  });
});

// -- Click-to-select visual state (mod_selection) ---------------------
//
// `<StatementNode>` subscribes to `useSelectionStore` and stamps a
// `data-selected` attribute + a Tailwind `ring-4 ring-sky-500` outline
// when the store's `selected` matches this node. The store-write side
// (the actual `onNodeClick` handler) is exercised in
// `GraphCanvasPane.test.tsx`; these cases lock in the per-card READ
// path — the visual layer the moderator sees when a node is selected.

describe('StatementNode — click-to-select visual state (mod_selection)', () => {
  it('stamps data-selected="false" on a node when nothing is selected', () => {
    render(
      <StatementNode {...makeNodeProps({ id: 'n-unsel', data: { wording: 'w', kind: 'fact' } })} />,
    );
    const card = screen.getByTestId('statement-node-n-unsel');
    expect(card.getAttribute('data-selected')).toBe('false');
    // The selection ring is NOT applied when not selected.
    expect(card.className).not.toContain('ring-sky-500');
  });

  it('stamps data-selected="true" and the sky-500 ring on the node when its id is selected', () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'n-sel' });
    render(
      <StatementNode {...makeNodeProps({ id: 'n-sel', data: { wording: 'w', kind: 'fact' } })} />,
    );
    const card = screen.getByTestId('statement-node-n-sel');
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.className).toContain('ring-4');
    expect(card.className).toContain('ring-sky-500');
  });

  it('does not select a node when a DIFFERENT node is the current selection', () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'some-other-node' });
    render(
      <StatementNode {...makeNodeProps({ id: 'n-other', data: { wording: 'w', kind: 'fact' } })} />,
    );
    const card = screen.getByTestId('statement-node-n-other');
    expect(card.getAttribute('data-selected')).toBe('false');
    expect(card.className).not.toContain('ring-sky-500');
  });

  it('does not select a node when an EDGE with the same id is selected', () => {
    // Edge-kind selection must not bleed into node selection — the
    // `kind` discriminator on `Selection` is load-bearing.
    useSelectionStore.getState().select({ kind: 'edge', id: 'n-shared-id' });
    render(
      <StatementNode
        {...makeNodeProps({ id: 'n-shared-id', data: { wording: 'w', kind: 'fact' } })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-shared-id');
    expect(card.getAttribute('data-selected')).toBe('false');
    expect(card.className).not.toContain('ring-sky-500');
  });

  it('preserves the existing status-styling classes when also selected (additive layer)', () => {
    // The selection ring composes ON TOP of the status ring (e.g.
    // `ring-2 ring-rose-500` for disputed) — both classnames must
    // remain present so Tailwind's last-wins precedence picks up the
    // sky-500 ring color + ring-4 width without dropping the underlying
    // status border.
    useSelectionStore.getState().select({ kind: 'node', id: 'n-disputed-sel' });
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-disputed-sel',
          data: {
            wording: 'disputed and selected',
            kind: 'fact',
            facetStatuses: { substance: 'disputed' },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-disputed-sel');
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.getAttribute('data-facet-status')).toBe('disputed');
    // Disputed status classes still present.
    expect(card.className).toContain('border-rose-600');
    expect(card.className).toContain('ring-rose-500');
    // Selection-ring classes also present.
    expect(card.className).toContain('ring-4');
    expect(card.className).toContain('ring-sky-500');
  });
});

// -- Diagnostic highlight (mod_diagnostic_highlighting) --------------
//
// The amber halo composes on the card root when
// `data.diagnosticHighlight !== undefined`. The `data-diagnostic-severity`
// attribute stamps the severity (`blocking` / `advisory`) as the stable
// DOM seam (mirrors the `data-facet-status` decision: omit on baseline,
// stamp only when relevant). The `title` attribute carries the
// localized diagnostic kind title(s) — single title for one active
// diagnostic, `", "`-joined for several.

describe('StatementNode — diagnostic highlight (mod_diagnostic_highlighting)', () => {
  it('has no data-diagnostic-severity attribute and no amber ring when diagnosticHighlight is undefined', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-diag',
          data: { wording: 'no diagnostic', kind: 'fact' },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-no-diag');
    expect(card.getAttribute('data-diagnostic-severity')).toBeNull();
    expect(card.className).not.toContain('ring-amber-500');
    expect(card.className).not.toContain('ring-amber-300');
    // No title attribute on the baseline card.
    expect(card.getAttribute('title')).toBeNull();
  });

  it('stamps data-diagnostic-severity="blocking" + the amber blocking ring classes', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-block',
          data: {
            wording: 'blocking-highlighted',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-block');
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(card.className).toContain('ring-4');
    expect(card.className).toContain('ring-amber-500/80');
    expect(card.className).toContain('ring-offset-2');
    expect(card.className).toContain('ring-offset-white');
    expect(card.className).toContain('motion-safe:animate-pulse');
  });

  it('stamps data-diagnostic-severity="advisory" + the amber advisory ring classes (no pulse)', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-adv',
          data: {
            wording: 'advisory-highlighted',
            kind: 'fact',
            diagnosticHighlight: { severity: 'advisory', kinds: ['multi-warrant'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-adv');
    expect(card.getAttribute('data-diagnostic-severity')).toBe('advisory');
    expect(card.className).toContain('ring-2');
    expect(card.className).toContain('ring-amber-300/70');
    expect(card.className).toContain('ring-offset-1');
    expect(card.className).toContain('ring-offset-white');
    // No pulse on advisory.
    expect(card.className).not.toContain('animate-pulse');
  });

  it('composes with the disputed status ring (both rings present, neither overwrites)', () => {
    // A node with substance disputed (rose ring) AND a blocking
    // diagnostic (amber ring) MUST keep both classnames in the
    // composed className — they read as separate visual layers per
    // the refinement's "layer ordering" decision.
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-dispute-diag',
          data: {
            wording: 'disputed + diagnostic',
            kind: 'fact',
            facetStatuses: { substance: 'disputed' },
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-dispute-diag');
    // Disputed classes present.
    expect(card.className).toContain('border-rose-600');
    expect(card.className).toContain('ring-rose-500');
    // Diagnostic classes also present.
    expect(card.className).toContain('ring-amber-500/80');
    // Stable seams both stamped.
    expect(card.getAttribute('data-facet-status')).toBe('disputed');
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });

  it('composes with the sky-500 selection ring (both selection + diagnostic rings present)', () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'n-sel-diag' });
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-sel-diag',
          data: {
            wording: 'selected + diagnostic',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['contradiction'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-sel-diag');
    // Selection-ring classes present.
    expect(card.className).toContain('ring-sky-500');
    // Diagnostic-ring classes also present.
    expect(card.className).toContain('ring-amber-500/80');
    // Both seams stamped.
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });

  it('sets title="Cycle in supports" (en-US) for a single-kind highlight', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-cycle-title',
          data: {
            wording: 'cycle-only',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-cycle-title');
    // The diagnostics.cycle.title key resolves to "Cycle in supports"
    // in the en-US catalog (per packages/i18n-catalogs/src/catalogs/en-US.json).
    expect(card.getAttribute('title')).toBe('Cycle in supports');
  });

  it('joins multi-kind highlight titles with ", "', () => {
    render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-multi-title',
          data: {
            wording: 'multi-kind',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle', 'contradiction'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-multi-title');
    expect(card.getAttribute('title')).toBe('Cycle in supports, Contradiction');
  });

  // Cross-locale: the cycle title resolves to its catalog-correct
  // string in every v1 locale. Pins that the tooltip flows through
  // i18n (not a hard-coded en-US string).
  const CYCLE_TITLE_BY_LOCALE = {
    'en-US': 'Cycle in supports',
    'pt-BR': 'Ciclo em apoios',
    'es-419': 'Ciclo en apoyos',
  } as const;
  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    it(`resolves the cycle title in ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      render(
        <StatementNode
          {...makeNodeProps({
            id: `n-cycle-${locale}`,
            data: {
              wording: 'locale check',
              kind: 'fact',
              diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
            },
          })}
        />,
      );
      const card = screen.getByTestId(`statement-node-n-cycle-${locale}`);
      expect(card.getAttribute('title')).toBe(CYCLE_TITLE_BY_LOCALE[locale]);
      await i18next.changeLanguage('en-US');
    });
  }
});
