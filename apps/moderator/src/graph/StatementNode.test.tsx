// Tests for `<StatementNode>` — the moderator's custom ReactFlow node.
//
// Refinement: tasks/refinements/moderator-ui/mod_node_handle_rendering.md
// (prior:     tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md,
//             tasks/refinements/moderator-ui/mod_annotation_rendering.md,
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
//   7. The two ReactFlow `<Handle>` anchors (target on top, source on
//      bottom) render as the first children of the card root, compose
//      cleanly with the diagnostic halo + the hover popover + every
//      per-status branch (refinement `mod_node_handle_rendering`).
//
// `<StatementNode>` now renders `<Handle>` children (per
// `mod_node_handle_rendering`); `<Handle>` reads from ReactFlow's
// internal Zustand store via `useStore` / `useStoreApi`, which throws
// without a `<ReactFlowProvider>` context. The local `render(...)`
// shadow below wraps every render in a `<ReactFlowProvider>` to provide
// that context — every existing test case keeps its call shape, only
// the wrapper is new.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReactFlowProvider, type NodeProps } from 'reactflow';
import type { StatementKind } from '@a-conversa/shared-types';

import {
  STATEMENT_NODE_TYPE,
  StatementNode,
  cardRollupStatus,
  type StatementNodeData,
} from './StatementNode';
import type { DiagnosticHighlight } from './diagnosticHighlights';
import type { FacetName, FacetStatus } from './facetStatus';
import type { Annotation, AxiomMark, PendingAxiomMark } from './selectors';
import { WsClientProvider, createI18nInstance, type Vote, type WsClient } from '@a-conversa/shell';
import { useSelectionStore } from '../stores';

// Session id used to satisfy `useParams<{ id: string }>()` for the
// palette-mount gate cases below. The visibility tests don't dispatch
// the click, so the actual session id is inert; it only needs to be
// non-empty for the hook's gate.
const SESSION_ID_FOR_TESTS = '00000000-0000-4000-8000-0000000000ff';

// Local `render(...)` shadow that wraps every render in a
// `<ReactFlowProvider>`. The provider is what supplies the Zustand store
// `<Handle>`'s `useStore` / `useStoreApi` read from. Tests keep their
// existing `render(<StatementNode {...} />)` call shape — only the
// wrapper is new (and transparent to assertions: `<ReactFlowProvider>`
// itself renders nothing in the DOM, just a context).
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  // `useTranslation()` schedules a microtask-deferred setState when its
  // internal i18next subscription registers on mount. The deferred
  // update fires AFTER the synchronous render's act() wrapper closes,
  // so React emits "An update to <Component> was not wrapped in
  // act(...)". `await act(async () => { ... })` flushes pending
  // microtasks before the act block resolves, absorbing the deferred
  // update inside the wrapper.
  let result!: RenderResult;
  // `act` takes the async (microtask-flushing) path when the callback
  // returns a thenable — `return Promise.resolve()` is enough; no
  // `async` keyword (which would trip `require-await` since the body
  // does not await anything).
  await act(() => {
    result = rtlRender(ui, { wrapper: ReactFlowProvider, ...options });
    return Promise.resolve();
  });
  return result;
}

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
    | 'annotations'
    | 'facetStatuses'
    | 'axiomMarks'
    | 'pendingAxiomMarks'
    | 'votesByFacet'
    | 'diagnosticHighlight'
  > & {
    annotations?: readonly Annotation[];
    facetStatuses?: Readonly<Partial<Record<FacetName, FacetStatus>>>;
    axiomMarks?: readonly AxiomMark[];
    pendingAxiomMarks?: readonly PendingAxiomMark[];
    votesByFacet?: Readonly<Partial<Record<FacetName, readonly Vote[]>>>;
    diagnosticHighlight?: DiagnosticHighlight;
  };
}): NodeProps<StatementNodeData> {
  const id = overrides.id ?? 'node-test-1';
  const {
    annotations = [],
    facetStatuses = {},
    axiomMarks = [],
    pendingAxiomMarks = [],
    votesByFacet = {},
    diagnosticHighlight,
    ...rest
  } = overrides.data;
  // Only include `diagnosticHighlight` on the data object when it's
  // defined — exactOptionalPropertyTypes rejects `undefined` on an
  // optional property.
  const data: StatementNodeData =
    diagnosticHighlight === undefined
      ? { ...rest, annotations, facetStatuses, axiomMarks, pendingAxiomMarks, votesByFacet }
      : {
          ...rest,
          annotations,
          facetStatuses,
          axiomMarks,
          pendingAxiomMarks,
          votesByFacet,
          diagnosticHighlight,
        };
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
  await createI18nInstance('en-US');
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
  it('renders the wording verbatim', async () => {
    await render(
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

  it('renders all three statement-node-* test ids keyed by the node id', async () => {
    await render(
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

  it('renders an em-dash placeholder when kind is null', async () => {
    await render(
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
        await render(<StatementNode {...makeNodeProps({ id, data: { wording: 'w', kind } })} />);
        expect(screen.getByTestId(`statement-node-kind-${id}`).textContent).toBe(
          EXPECTED[kind][locale],
        );
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
    await render(
      <StatementNode {...makeNodeProps({ id: 'pt-fact', data: { wording: 'w', kind: 'fact' } })} />,
    );
    expect(screen.getByTestId('statement-node-kind-pt-fact').textContent).toBe('Fato');
    // Sanity: differs from en-US "Fact".
    expect(screen.getByTestId('statement-node-kind-pt-fact').textContent).not.toBe('Fact');
  });
});

describe('StatementNode — annotation badge decoration row', () => {
  it('does not render the badge list container when the node has no annotations', async () => {
    await render(
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

  it('renders one annotation badge with the matching test id when the node has one annotation', async () => {
    const annotation = makeAnnotation({
      id: 'anno-1',
      kind: 'note',
      content: 'see footnote 3',
      targetNodeId: 'n-with-annotation',
    });
    await render(
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

  it('renders multiple annotation badges in arrival order', async () => {
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
    const { container } = await render(
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

  it('applies border-dashed + opacity-60 + data-facet-status="proposed" when classification facet is proposed', async () => {
    await render(
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

  it('omits the proposed-state styling when facetStatuses is empty', async () => {
    await render(
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

  it('treats "any facet proposed" as proposed even if another facet is agreed (card-level rollup)', async () => {
    await render(
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

  it('picks the highest-priority status when multiple non-proposed facets are present (rollup order: proposed > meta-disagreement > disputed > agreed > committed > withdrawn)', async () => {
    // Updated under refinement `mod_agreed_state_styling`. The earlier
    // assertion ("no `data-facet-status` when nothing is proposed") was
    // written before the rollup priority order was decided; with the
    // landed order (`proposed > meta-disagreement > disputed > agreed >
    // committed > withdrawn`), a mix of `agreed` / `committed` /
    // `disputed` now resolves to `disputed`. The component stamps the
    // attribute (the stable seam for `mod_disputed_state_styling` to
    // extend) but does not apply proposed-state classes — that branch
    // requires an actually-proposed facet.
    await render(
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
      await render(
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

  it('applies border-solid + border-slate-700 + opacity-100 + data-facet-status="agreed" when classification facet is agreed', async () => {
    await render(
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

  it('applies agreed styling when every facet is agreed (rollup pick from a uniform set)', async () => {
    await render(
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

  it('proposed wins over agreed in the card-level rollup (proposed has higher priority than agreed)', async () => {
    await render(
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

  it('agreed beats committed in the card-level rollup (closed facets sort last)', async () => {
    await render(
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
      await render(
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

  it('applies border-solid + border-rose-600 + ring-2 + ring-rose-500 + data-facet-status="disputed" when classification facet is disputed', async () => {
    await render(
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

  it('disputed beats agreed in the card-level rollup (priority chain wired through to the className branch)', async () => {
    await render(
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

  it('proposed wins over disputed (the rollup priority is unchanged by this task)', async () => {
    await render(
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
      await render(
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

  it('applies border-double + border-violet-600 + ring-2 + ring-violet-400 + data-facet-status="meta-disagreement" when classification facet is meta-disagreement', async () => {
    await render(
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

  it('meta-disagreement beats disputed in the card-level rollup (priority chain wired through to the className branch)', async () => {
    await render(
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

  it('proposed wins over meta-disagreement (the rollup priority is unchanged by this task)', async () => {
    await render(
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
      await render(
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

  it('does not render the axiom-mark list container when the node has no axiom-marks', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-axioms',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    expect(screen.queryByTestId('axiom-mark-list-node-n-no-axioms')).toBeNull();
  });

  it('renders one axiom-mark badge with the right testid when the node has one axiom-mark', async () => {
    const mark = makeAxiomMark({ nodeId: 'n-one-axiom', participantId: PARTICIPANT_A });
    await render(
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

  it('renders multiple axiom-mark badges in arrival order (per-participant uniqueness — both participants surface)', async () => {
    const marks: AxiomMark[] = [
      makeAxiomMark({ nodeId: 'n-multi', participantId: PARTICIPANT_A }),
      makeAxiomMark({ nodeId: 'n-multi', participantId: PARTICIPANT_B }),
    ];
    const { container } = await render(
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

  it('renders the axiom-mark row above the annotation row when both are present', async () => {
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
    await render(
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

describe('StatementNode — pending axiom-mark decoration row (mod_axiom_mark_pending_render)', () => {
  // The pending-axiom-mark badge row surfaces IN-FLIGHT per-participant
  // axiom-mark proposals on the node card. Decision §4 — the row sits
  // IMMEDIATELY ABOVE the committed `axiom-mark-list-node-{id}` row so
  // the eye scans "what is being proposed" before "what is on record".
  // The container is omitted from the DOM when no pending axiom-marks
  // exist, mirroring the committed / annotation / facet-pill row pattern.

  const PENDING_PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
  const PENDING_PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';
  const PENDING_PROPOSAL_X = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
  const PENDING_PROPOSAL_Y = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';

  function makePendingMark(
    overrides: Partial<PendingAxiomMark> & { participantId: string; proposalEventId: string },
  ): PendingAxiomMark {
    return {
      proposalEventId: overrides.proposalEventId,
      nodeId: overrides.nodeId ?? 'node-test-1',
      participantId: overrides.participantId,
      proposedAt: overrides.proposedAt ?? '2026-05-16T00:00:00.000Z',
    };
  }

  it('does not render the pending-axiom-mark list container when the node has no pending axiom-marks', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-pending',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    expect(screen.queryByTestId('pending-axiom-mark-list-node-n-no-pending')).toBeNull();
  });

  it('renders one pending-axiom-mark badge with the right testid + data-pending="true" when the node has one pending mark', async () => {
    const mark = makePendingMark({
      nodeId: 'n-one-pending',
      participantId: PENDING_PARTICIPANT_A,
      proposalEventId: PENDING_PROPOSAL_X,
    });
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-one-pending',
          data: {
            wording: 'a proposed-bedrock statement',
            kind: 'value',
            pendingAxiomMarks: [mark],
          },
        })}
      />,
    );
    expect(screen.getByTestId('pending-axiom-mark-list-node-n-one-pending')).toBeTruthy();
    const badge = screen.getByTestId(
      `pending-axiom-mark-badge-n-one-pending-${PENDING_PARTICIPANT_A}`,
    );
    expect(badge.getAttribute('data-pending')).toBe('true');
  });

  it('renders multiple pending-axiom-mark badges in proposal-arrival order', async () => {
    const marks: PendingAxiomMark[] = [
      makePendingMark({
        nodeId: 'n-multi-pending',
        participantId: PENDING_PARTICIPANT_A,
        proposalEventId: PENDING_PROPOSAL_X,
      }),
      makePendingMark({
        nodeId: 'n-multi-pending',
        participantId: PENDING_PARTICIPANT_B,
        proposalEventId: PENDING_PROPOSAL_Y,
      }),
    ];
    const { container } = await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-multi-pending',
          data: { wording: 'two-in-flight', kind: 'value', pendingAxiomMarks: marks },
        })}
      />,
    );
    const ids = Array.from(
      container.querySelectorAll('[data-testid^="pending-axiom-mark-badge-n-multi-pending-"]'),
    ).map((el) => el.getAttribute('data-participant-id'));
    expect(ids).toEqual([PENDING_PARTICIPANT_A, PENDING_PARTICIPANT_B]);
  });

  it('renders the pending row ABOVE the committed axiom-mark row when both are present (Decision §4)', async () => {
    // Pending (forward-looking) above committed (backward-looking) —
    // the lifecycle-in-motion before the lifecycle-on-record.
    const pendingMark = makePendingMark({
      nodeId: 'n-both-axiom-rows',
      participantId: PENDING_PARTICIPANT_A,
      proposalEventId: PENDING_PROPOSAL_X,
    });
    const committedMark: AxiomMark = {
      nodeId: 'n-both-axiom-rows',
      participantId: PENDING_PARTICIPANT_B,
      committedAt: '2026-05-11T00:00:00.000Z',
    };
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-both-axiom-rows',
          data: {
            wording: 'both lifecycle states',
            kind: 'value',
            pendingAxiomMarks: [pendingMark],
            axiomMarks: [committedMark],
          },
        })}
      />,
    );
    const pendingRow = screen.getByTestId('pending-axiom-mark-list-node-n-both-axiom-rows');
    const committedRow = screen.getByTestId('axiom-mark-list-node-n-both-axiom-rows');
    // DOCUMENT_POSITION_FOLLOWING (4) means "other follows this" —
    // i.e. pendingRow comes BEFORE committedRow in the DOM.
    const pendingIsBeforeCommitted =
      (pendingRow.compareDocumentPosition(committedRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(pendingIsBeforeCommitted).toBe(true);
  });

  it('renders both pending AND committed badges for the same participant on the same node (pre-engine-validation transient)', async () => {
    // Edge case in v1: engine rule 4 rejects a second-from-same-participant
    // once a commit lands, but the rendering must handle the
    // pre-engine-validation transient gracefully — Anna has a committed
    // mark on this node AND has a second proposal still in flight.
    const pendingMark = makePendingMark({
      nodeId: 'n-same-participant-both',
      participantId: PENDING_PARTICIPANT_A,
      proposalEventId: PENDING_PROPOSAL_X,
    });
    const committedMark: AxiomMark = {
      nodeId: 'n-same-participant-both',
      participantId: PENDING_PARTICIPANT_A,
      committedAt: '2026-05-11T00:00:00.000Z',
    };
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-same-participant-both',
          data: {
            wording: 'same-participant transient',
            kind: 'value',
            pendingAxiomMarks: [pendingMark],
            axiomMarks: [committedMark],
          },
        })}
      />,
    );
    // Both badges render — one in the pending row, one in the
    // committed row — under different testid shapes.
    expect(
      screen.getByTestId(
        `pending-axiom-mark-badge-n-same-participant-both-${PENDING_PARTICIPANT_A}`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`axiom-mark-badge-n-same-participant-both-${PENDING_PARTICIPANT_A}`),
    ).toBeTruthy();
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

  it('does not render the facet-pill row when facetStatuses is empty', async () => {
    await render(
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

  it('renders a single wording pill when only wording is proposed', async () => {
    await render(
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

  it('renders three pills in canonical order (wording → classification → substance)', async () => {
    await render(
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

  it('renders independent per-facet statuses when statuses are mixed (one disputed + two committed)', async () => {
    await render(
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

  it('coexists with the whole-card frame styling (rollup + per-pill render independently)', async () => {
    // When one facet is proposed and another is disputed, the whole-card
    // frame rolls up to PROPOSED (the highest-priority status), so the
    // card frame paints dashed-slate. Independently, the disputed pill
    // still carries the red-marker classes — the rollup and the per-pill
    // detail are TWO separate signals and must coexist.
    await render(
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

  it('renders the facet-pill row ABOVE the wording paragraph', async () => {
    // Visual hierarchy: per-facet detail leads (the methodology's
    // structural axis), then the wording paragraph (the content). Pin
    // the DOM order so a future refactor doesn't silently invert it.
    await render(
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

describe('StatementNode — disputation-test chip (mod_disputation_test_display)', () => {
  // The methodology's `data | claim | unsettled` chip sits inside the
  // per-facet pill row, immediately AFTER the substance pill. The chip
  // is the methodology-vocabulary overlay on top of the existing
  // substance facet pill (the pill carries the wire vocab; the chip
  // carries the methodology vocab). The chip is omitted from the DOM
  // when no substance facet activity has touched the node (mirrors the
  // empty-row omission rule).

  it('renders the chip with data-disputation-outcome="data" when substance is agreed (immediately after the substance pill)', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-disp-data',
          data: {
            wording: 'substance agreed',
            kind: 'fact',
            facetStatuses: { substance: 'agreed' },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-disp-data');
    // Chip is present, with the right outcome attribute.
    const slot = row.querySelector('[data-disputation-chip-slot]');
    expect(slot).not.toBeNull();
    const chip = row.querySelector('[data-disputation-chip]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('data-disputation-outcome')).toBe('data');
    // DOM order: the substance pill comes BEFORE the chip-slot wrapper.
    // `DOCUMENT_POSITION_FOLLOWING` (4): "other follows this" — i.e.
    // pill comes BEFORE slot in the DOM.
    const substancePill = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]')).find(
      (p) => p.getAttribute('data-facet-name') === 'substance',
    );
    expect(substancePill).toBeTruthy();
    const pillIsBeforeSlot =
      (substancePill!.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(pillIsBeforeSlot).toBe(true);
  });

  it('renders the chip with data-disputation-outcome="claim" when substance is disputed', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-disp-claim',
          data: {
            wording: 'substance disputed',
            kind: 'fact',
            facetStatuses: { substance: 'disputed' },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-disp-claim');
    const chip = row.querySelector('[data-disputation-chip]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('data-disputation-outcome')).toBe('claim');
  });

  it('renders the chip with data-disputation-outcome="claim" when substance is meta-disagreement AND the substance pill keeps its violet border', async () => {
    // Per refinement: the chip and the per-facet pill layer compose;
    // neither overwrites the other. The meta-disagreement pill keeps its
    // violet double-border palette while the chip surfaces the
    // methodology-vocabulary `Claim` outcome.
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-disp-meta',
          data: {
            wording: 'substance meta-disagreement',
            kind: 'fact',
            facetStatuses: { substance: 'meta-disagreement' },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-disp-meta');
    const chip = row.querySelector('[data-disputation-chip]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('data-disputation-outcome')).toBe('claim');
    // The substance pill retains its violet meta-disagreement border —
    // the chip is a separate layer.
    const substancePill = Array.from(row.querySelectorAll<HTMLElement>('[data-facet-pill]')).find(
      (p) => p.getAttribute('data-facet-name') === 'substance',
    );
    expect(substancePill).toBeTruthy();
    expect(substancePill!.className).toContain('border-violet-600');
    expect(substancePill!.className).toContain('border-double');
  });

  it('does NOT render the chip when facetStatuses is empty / has no substance entry', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-no-chip',
          data: {
            wording: 'no substance facet activity',
            kind: 'fact',
            // No facetStatuses at all → no pill row, no chip.
          },
        })}
      />,
    );
    // The pill row is not rendered at all (empty facetStatuses → no
    // pills); the chip's wrapper is consequently also absent.
    expect(screen.queryByTestId('facet-pill-row-node-n-no-chip')).toBeNull();
    expect(document.querySelector('[data-disputation-chip]')).toBeNull();
    expect(document.querySelector('[data-disputation-chip-slot]')).toBeNull();
  });

  it('does NOT render the chip when facetStatuses has wording/classification only (no substance entry)', async () => {
    // Even when the pill row IS rendered (other facets have status),
    // the chip is still omitted when no substance entry exists — the
    // methodology label is scoped to the substance facet's lifecycle.
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-non-substance',
          data: {
            wording: 'wording proposed, no substance',
            kind: 'fact',
            facetStatuses: { wording: 'proposed', classification: 'agreed' },
          },
        })}
      />,
    );
    const row = screen.getByTestId('facet-pill-row-node-n-non-substance');
    // Pill row renders (wording + classification pills) but no chip.
    expect(row.querySelectorAll('[data-facet-pill]').length).toBe(2);
    expect(row.querySelector('[data-disputation-chip]')).toBeNull();
    expect(row.querySelector('[data-disputation-chip-slot]')).toBeNull();
  });

  it('renders BOTH the chip and the amber diagnostic halo when substance is agreed AND a blocking diagnostic fires (independent layers)', async () => {
    // Per refinement: the disputation-test chip and the diagnostic
    // highlight are independent layers — both compose simultaneously
    // and neither overwrites the other.
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-chip-and-diag',
          data: {
            wording: 'agreed substance with diagnostic',
            kind: 'fact',
            facetStatuses: { substance: 'agreed' },
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    // Chip present.
    const row = screen.getByTestId('facet-pill-row-node-n-chip-and-diag');
    const chip = row.querySelector('[data-disputation-chip]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute('data-disputation-outcome')).toBe('data');
    // Diagnostic halo classes present on the card root.
    const card = screen.getByTestId('statement-node-n-chip-and-diag');
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
    expect(card.className).toContain('ring-amber-500/80');
    expect(card.className).toContain('motion-safe:animate-pulse');
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

  it('renders no vote-indicator rows when votesByFacet is empty', async () => {
    await render(
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

  it('renders one indicator inside the wording pill when a single participant agrees on wording', async () => {
    await render(
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

  it('renders one indicator row per pill when votes land on two different facets', async () => {
    await render(
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

  it('renders mixed votes (agree + dispute) with distinct data-choice values on the same pill', async () => {
    await render(
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

  it('renders a withdrawn vote with the gray choice color and data-choice="withdraw"', async () => {
    await render(
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
  it('stamps data-selected="false" on a node when nothing is selected', async () => {
    await render(
      <StatementNode {...makeNodeProps({ id: 'n-unsel', data: { wording: 'w', kind: 'fact' } })} />,
    );
    const card = screen.getByTestId('statement-node-n-unsel');
    expect(card.getAttribute('data-selected')).toBe('false');
    // The selection ring is NOT applied when not selected.
    expect(card.className).not.toContain('ring-sky-500');
  });

  it('stamps data-selected="true" and the sky-500 ring on the node when its id is selected', async () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'n-sel' });
    await render(
      <StatementNode {...makeNodeProps({ id: 'n-sel', data: { wording: 'w', kind: 'fact' } })} />,
    );
    const card = screen.getByTestId('statement-node-n-sel');
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.className).toContain('ring-4');
    expect(card.className).toContain('ring-sky-500');
  });

  it('does not select a node when a DIFFERENT node is the current selection', async () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'some-other-node' });
    await render(
      <StatementNode {...makeNodeProps({ id: 'n-other', data: { wording: 'w', kind: 'fact' } })} />,
    );
    const card = screen.getByTestId('statement-node-n-other');
    expect(card.getAttribute('data-selected')).toBe('false');
    expect(card.className).not.toContain('ring-sky-500');
  });

  it('does not select a node when an EDGE with the same id is selected', async () => {
    // Edge-kind selection must not bleed into node selection — the
    // `kind` discriminator on `Selection` is load-bearing.
    useSelectionStore.getState().select({ kind: 'edge', id: 'n-shared-id' });
    await render(
      <StatementNode
        {...makeNodeProps({ id: 'n-shared-id', data: { wording: 'w', kind: 'fact' } })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-shared-id');
    expect(card.getAttribute('data-selected')).toBe('false');
    expect(card.className).not.toContain('ring-sky-500');
  });

  it('preserves the existing status-styling classes when also selected (additive layer)', async () => {
    // The selection ring composes ON TOP of the status ring (e.g.
    // `ring-2 ring-rose-500` for disputed) — both classnames must
    // remain present so Tailwind's last-wins precedence picks up the
    // sky-500 ring color + ring-4 width without dropping the underlying
    // status border.
    useSelectionStore.getState().select({ kind: 'node', id: 'n-disputed-sel' });
    await render(
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
  it('has no data-diagnostic-severity attribute and no amber ring when diagnosticHighlight is undefined', async () => {
    await render(
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

  it('stamps data-diagnostic-severity="blocking" + the amber blocking ring classes', async () => {
    await render(
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

  it('stamps data-diagnostic-severity="advisory" + the amber advisory ring classes (no pulse)', async () => {
    await render(
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

  it('composes with the disputed status ring (both rings present, neither overwrites)', async () => {
    // A node with substance disputed (rose ring) AND a blocking
    // diagnostic (amber ring) MUST keep both classnames in the
    // composed className — they read as separate visual layers per
    // the refinement's "layer ordering" decision.
    await render(
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

  it('composes with the sky-500 selection ring (both selection + diagnostic rings present)', async () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'n-sel-diag' });
    await render(
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

  // Note: as of `mod_hover_details`, the native `title` attribute has
  // been REMOVED from the card root — the popover (rendered on hover /
  // focus-visible) carries the localized diagnostic title(s) instead.
  // The migration cases below assert that the diagnostic kind titles
  // surface in the popover content with the same content + same
  // cross-locale wiring as the prior `title`-attribute baseline.

  it('does NOT stamp a native title attribute for a single-kind highlight (superseded by hover popover)', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-cycle-no-title',
          data: {
            wording: 'cycle-only',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-cycle-no-title');
    // The native `title` is gone — the popover supersedes it.
    expect(card.getAttribute('title')).toBeNull();
    // The stable seam (data-diagnostic-severity) is unchanged.
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });

  it('does NOT stamp a native title attribute for a multi-kind highlight (superseded by hover popover)', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-multi-no-title',
          data: {
            wording: 'multi-kind',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle', 'contradiction'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-multi-no-title');
    expect(card.getAttribute('title')).toBeNull();
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });

  it('renders the localized diagnostic title inside the popover on hover (single kind, en-US)', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-cycle-popover',
          data: {
            wording: 'cycle-only',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-cycle-popover');
    // Open popover by firing mouseenter.
    fireEvent.mouseEnter(card);
    const popover = screen.getByTestId('hover-popover-n-cycle-popover');
    expect(popover.textContent).toContain('Cycle in supports');
  });

  it('joins multi-kind diagnostic titles inside the popover with ", "', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-multi-popover',
          data: {
            wording: 'multi-kind',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle', 'contradiction'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-multi-popover');
    fireEvent.mouseEnter(card);
    const popover = screen.getByTestId('hover-popover-n-multi-popover');
    expect(popover.textContent).toContain('Cycle in supports, Contradiction');
  });

  // Cross-locale: the cycle title resolves to its catalog-correct
  // string in every v1 locale inside the popover. Pins that the
  // popover content flows through i18n (not a hard-coded en-US string).
  const CYCLE_TITLE_BY_LOCALE = {
    'en-US': 'Cycle in supports',
    'pt-BR': 'Ciclo em apoios',
    'es-419': 'Ciclo en apoyos',
  } as const;
  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    it(`resolves the cycle title in ${locale} inside the popover`, async () => {
      await i18next.changeLanguage(locale);
      await render(
        <StatementNode
          {...makeNodeProps({
            id: `n-cycle-popover-${locale}`,
            data: {
              wording: 'locale check',
              kind: 'fact',
              diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
            },
          })}
        />,
      );
      const card = screen.getByTestId(`statement-node-n-cycle-popover-${locale}`);
      fireEvent.mouseEnter(card);
      const popover = screen.getByTestId(`hover-popover-n-cycle-popover-${locale}`);
      expect(popover.textContent).toContain(CYCLE_TITLE_BY_LOCALE[locale]);
    });
  }
});

// -- Hover popover wiring (mod_hover_details) -------------------------
//
// The node card root carries `onMouseEnter` / `onMouseLeave` / `onFocus`
// / `onBlur` handlers that flip a `useState<boolean>` hover flag; the
// `<HoverPopover>` renders conditionally on the flag. The
// `aria-describedby` linkage between the card root and the popover is
// stamped only while the popover is open (per the refinement's a11y
// rule: announcing a tooltip linkage that doesn't render would be an
// a11y lie). Refinement: `mod_hover_details`.

describe('StatementNode — hover popover wiring (mod_hover_details)', () => {
  it('does not render the hover popover by default', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-popover-default',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    expect(screen.queryByTestId('hover-popover-n-popover-default')).toBeNull();
    // aria-describedby is absent when the popover is not open.
    const card = screen.getByTestId('statement-node-n-popover-default');
    expect(card.getAttribute('aria-describedby')).toBeNull();
  });

  it('renders the popover on mouseenter and removes it on mouseleave', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-popover-mouse',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-popover-mouse');
    fireEvent.mouseEnter(card);
    expect(screen.getByTestId('hover-popover-n-popover-mouse')).toBeTruthy();
    expect(card.getAttribute('aria-describedby')).toBe('hover-popover-n-popover-mouse');
    fireEvent.mouseLeave(card);
    expect(screen.queryByTestId('hover-popover-n-popover-mouse')).toBeNull();
    expect(card.getAttribute('aria-describedby')).toBeNull();
  });

  it('renders the popover on focus and removes it on blur (keyboard parity)', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-popover-focus',
          data: { wording: 'plain', kind: 'fact' },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-popover-focus');
    fireEvent.focus(card);
    expect(screen.getByTestId('hover-popover-n-popover-focus')).toBeTruthy();
    fireEvent.blur(card);
    expect(screen.queryByTestId('hover-popover-n-popover-focus')).toBeNull();
  });

  it('keeps data-selected / data-facet-status / data-diagnostic-severity stamps while the popover is open', async () => {
    useSelectionStore.getState().select({ kind: 'node', id: 'n-popover-stamps' });
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-popover-stamps',
          data: {
            wording: 'all stamps',
            kind: 'fact',
            facetStatuses: { substance: 'disputed' },
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-popover-stamps');
    fireEvent.mouseEnter(card);
    // Popover is up.
    expect(screen.getByTestId('hover-popover-n-popover-stamps')).toBeTruthy();
    // Every existing seam still on the root.
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(card.getAttribute('data-facet-status')).toBe('disputed');
    expect(card.getAttribute('data-diagnostic-severity')).toBe('blocking');
  });

  it('renders the full wording inside the popover', async () => {
    const longWording =
      'A sufficiently long wording that the card might wrap; the popover renders the full content without truncation so the moderator can read the entire statement at a glance.';
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-popover-wording',
          data: { wording: longWording, kind: 'fact' },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-popover-wording');
    fireEvent.mouseEnter(card);
    const popover = screen.getByTestId('hover-popover-n-popover-wording');
    expect(popover.textContent).toContain(longWording);
  });

  it('stamps role="tooltip" and data-hover-target-kind="node" on the popover', async () => {
    await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-popover-attrs',
          data: { wording: 'attrs check', kind: 'fact' },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-popover-attrs');
    fireEvent.mouseEnter(card);
    const popover = screen.getByTestId('hover-popover-n-popover-attrs');
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.getAttribute('data-hover-target-kind')).toBe('node');
    expect(popover.getAttribute('id')).toBe('hover-popover-n-popover-attrs');
  });
});

describe('StatementNode — ReactFlow Handle anchors (mod_node_handle_rendering)', () => {
  // These cases pin the two `<Handle>` elements added by
  // `mod_node_handle_rendering`. The anchors are what unblocks ReactFlow's
  // edge-renderer: without them `handleBounds` is null on every node and
  // every edge's SVG `<path>` is skipped. The tests assert via the
  // library's documented DOM stamps — `data-handlepos="top" | "bottom"` on
  // the rendered `<div>` — and via the `.react-flow__handle-top` /
  // `.react-flow__handle-bottom` class names ReactFlow puts on the same
  // elements. Both seams are stable across the library's minor versions;
  // the test asserts both so a future library shift in one stamp doesn't
  // silently regress the contract.

  it('renders exactly two handles on a baseline node (one top target + one bottom source)', async () => {
    const { container } = await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-handles-base',
          data: { wording: 'baseline', kind: 'fact' },
        })}
      />,
    );
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(2);
  });

  it('renders a target handle at Position.Top (data-handlepos="top" + react-flow__handle-top class)', async () => {
    const { container } = await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-handles-top',
          data: { wording: 'top', kind: 'fact' },
        })}
      />,
    );
    const topHandle = container.querySelector('[data-handlepos="top"]');
    expect(topHandle).not.toBeNull();
    expect(topHandle?.className).toContain('react-flow__handle-top');
  });

  it('renders a source handle at Position.Bottom (data-handlepos="bottom" + react-flow__handle-bottom class)', async () => {
    const { container } = await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-handles-bottom',
          data: { wording: 'bottom', kind: 'fact' },
        })}
      />,
    );
    const bottomHandle = container.querySelector('[data-handlepos="bottom"]');
    expect(bottomHandle).not.toBeNull();
    expect(bottomHandle?.className).toContain('react-flow__handle-bottom');
  });

  it('composes with the diagnostic-halo ring without losing either handle', async () => {
    // Render a node carrying a blocking diagnostic; both the amber-ring
    // className stack AND the two handles must still render. This pins
    // that the new children don't disrupt the diagnostic-highlighting
    // layer (refinement `mod_diagnostic_highlighting`).
    const { container } = await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-handles-diag',
          data: {
            wording: 'haloed',
            kind: 'fact',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] },
          },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-handles-diag');
    // Blocking-halo classes are still on the root.
    expect(card.className).toContain('ring-amber-500/80');
    expect(card.className).toContain('motion-safe:animate-pulse');
    // Both handles still render.
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
    expect(container.querySelector('[data-handlepos="top"]')).not.toBeNull();
    expect(container.querySelector('[data-handlepos="bottom"]')).not.toBeNull();
  });

  it('composes with the hover popover (both handles render simultaneously with the open popover)', async () => {
    const { container } = await render(
      <StatementNode
        {...makeNodeProps({
          id: 'n-handles-hover',
          data: { wording: 'hovered', kind: 'fact' },
        })}
      />,
    );
    const card = screen.getByTestId('statement-node-n-handles-hover');
    fireEvent.mouseEnter(card);
    // Popover is up.
    expect(screen.getByTestId('hover-popover-n-handles-hover')).toBeTruthy();
    // Both handles still render alongside the popover.
    expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
    expect(container.querySelector('[data-handlepos="top"]')).not.toBeNull();
    expect(container.querySelector('[data-handlepos="bottom"]')).not.toBeNull();
  });

  // Pin that the new children don't break any existing per-status
  // className branch. One parametrized test across the four statuses
  // asserts the two handles always render — proposed / agreed / disputed
  // / meta-disagreement. The meta-disagreement case is the same
  // 2-handle layout as the baseline node (per the refinement's
  // Decisions; multi-handle-per-split-side is deferred indefinitely
  // pending a data-model change).
  const STATUSES_FOR_HANDLE_COMPOSITION: readonly FacetStatus[] = [
    'proposed',
    'agreed',
    'disputed',
    'meta-disagreement',
  ];
  for (const status of STATUSES_FOR_HANDLE_COMPOSITION) {
    it(`renders both handles when the card rollup is "${status}"`, async () => {
      const { container } = await render(
        <StatementNode
          {...makeNodeProps({
            id: `n-handles-status-${status}`,
            data: {
              wording: status,
              kind: 'fact',
              facetStatuses: { substance: status },
            },
          })}
        />,
      );
      expect(container.querySelectorAll('.react-flow__handle').length).toBe(2);
      expect(container.querySelector('[data-handlepos="top"]')).not.toBeNull();
      expect(container.querySelector('[data-handlepos="bottom"]')).not.toBeNull();
    });
  }
});

// -- Inline classification palette mount gate
//    (pf_mod_node_card_classification_affordance) -----------------------
//
// `<StatementNode>` mounts the inline `<NodeCardClassificationPalette>`
// ONLY when `wording ∈ {agreed, committed}` AND `classification ===
// 'awaiting-proposal'`. The gate predicate pins the methodology's
// sequential-capture order (wording must settle before classification
// can be named) on the UI side; the server's
// `pf_sequence_gate_server_enforced` is the integrity boundary.
//
// The palette's internal click-fires-propose contract is covered in
// `NodeCardClassificationPalette.test.tsx`. The cases here pin ONLY
// the visibility gate — the palette mounts when eligible, otherwise
// not.

describe('StatementNode — inline classification palette mount gate (pf_mod_node_card_classification_affordance)', () => {
  // The palette uses `useWsClient()` + `useParams()` so we wrap renders
  // in a `<WsClientProvider>` + `<MemoryRouter>` alongside the existing
  // `<ReactFlowProvider>`. A stub client returns `'open'` and a no-op
  // `send` — visibility tests don't dispatch clicks.
  const renderWithProviders = async (ui: ReactElement): Promise<RenderResult> => {
    // Visibility tests don't dispatch clicks, so `send` never fires.
    // The stub returns a never-resolving promise to satisfy the
    // `SendFn` signature without resolving a fake ack.
    const stubClient: WsClient = {
      status: () => 'open',
      connect: () => undefined,
      close: () => undefined,
      send: () =>
        new Promise(() => {
          /* never resolves; visibility tests don't click */
        }),
      trackSession: () => Promise.resolve(),
      untrackSession: () => Promise.resolve(),
      onEnvelope: () => () => undefined,
      url: '/api/ws',
    };
    let result!: RenderResult;
    await act(() => {
      result = rtlRender(ui, {
        wrapper: ({ children }) => (
          <MemoryRouter initialEntries={[`/sessions/${SESSION_ID_FOR_TESTS}/operate`]}>
            <WsClientProvider auth={{ status: 'authenticated' }} client={stubClient}>
              <Routes>
                <Route
                  path="/sessions/:id/operate"
                  element={<ReactFlowProvider>{children}</ReactFlowProvider>}
                />
              </Routes>
            </WsClientProvider>
          </MemoryRouter>
        ),
      });
      return Promise.resolve();
    });
    return result;
  };

  it('mounts the palette when wording is committed AND classification is awaiting-proposal', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-eligible',
          data: {
            wording: 'wording settled',
            kind: null,
            facetStatuses: { wording: 'committed', classification: 'awaiting-proposal' },
          },
        })}
      />,
    );
    expect(screen.getByTestId('node-card-classification-palette-n-gate-eligible')).toBeTruthy();
  });

  it('mounts the palette when wording is agreed AND classification is awaiting-proposal', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-agreed',
          data: {
            wording: 'wording agreed',
            kind: null,
            facetStatuses: { wording: 'agreed', classification: 'awaiting-proposal' },
          },
        })}
      />,
    );
    expect(screen.getByTestId('node-card-classification-palette-n-gate-agreed')).toBeTruthy();
  });

  it('does NOT mount the palette when wording is proposed (still in flight)', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-wording-proposed',
          data: {
            wording: 'wording still proposed',
            kind: null,
            facetStatuses: { wording: 'proposed', classification: 'awaiting-proposal' },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-classification-palette-n-gate-wording-proposed'),
    ).toBeNull();
  });

  it('does NOT mount the palette when wording is disputed', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-wording-disputed',
          data: {
            wording: 'wording disputed',
            kind: null,
            facetStatuses: { wording: 'disputed', classification: 'awaiting-proposal' },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-classification-palette-n-gate-wording-disputed'),
    ).toBeNull();
  });

  it('does NOT mount the palette when classification facet has already been proposed', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-classification-proposed',
          data: {
            wording: 'wording committed',
            kind: 'fact',
            facetStatuses: { wording: 'committed', classification: 'proposed' },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-classification-palette-n-gate-classification-proposed'),
    ).toBeNull();
  });

  it('does NOT mount the palette when classification facet is already committed', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-classification-committed',
          data: {
            wording: 'wording committed',
            kind: 'fact',
            facetStatuses: { wording: 'committed', classification: 'committed' },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-classification-palette-n-gate-classification-committed'),
    ).toBeNull();
  });

  it('does NOT mount the palette when both facets are absent (e.g. fresh node before any facet state)', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-gate-empty',
          data: {
            wording: 'no facet states at all',
            kind: null,
            // facetStatuses defaults to {}
          },
        })}
      />,
    );
    expect(screen.queryByTestId('node-card-classification-palette-n-gate-empty')).toBeNull();
  });
});

// ── 14. Inline substance-affordance mount gate
//    (pf_mod_node_card_substance_affordance) -----------------------------
//
// `<StatementNode>` mounts the inline `<NodeCardSubstanceAffordance>`
// ONLY when `classification ∈ {agreed, committed}` AND `substance ===
// 'awaiting-proposal'`. The gate predicate pins the methodology's
// sequential-capture order (classification must settle before
// substance can be named) on the UI side; the server's
// `pf_sequence_gate_server_enforced` is the integrity boundary.
//
// The affordance's internal click-fires-propose contract is covered in
// `NodeCardSubstanceAffordance.test.tsx`. The cases here pin ONLY the
// visibility gate — the affordance mounts when eligible, otherwise
// not.

describe('StatementNode — inline substance affordance mount gate (pf_mod_node_card_substance_affordance)', () => {
  // The affordance uses `useWsClient()` + `useParams()` so we wrap
  // renders in a `<WsClientProvider>` + `<MemoryRouter>` alongside the
  // existing `<ReactFlowProvider>`. A stub client returns `'open'` and
  // a no-op `send` — visibility tests don't dispatch clicks.
  const renderWithProviders = async (ui: ReactElement): Promise<RenderResult> => {
    // Visibility tests don't dispatch clicks, so `send` never fires.
    // The stub returns a never-resolving promise to satisfy the
    // `SendFn` signature without resolving a fake ack.
    const stubClient: WsClient = {
      status: () => 'open',
      connect: () => undefined,
      close: () => undefined,
      send: () =>
        new Promise(() => {
          /* never resolves; visibility tests don't click */
        }),
      trackSession: () => Promise.resolve(),
      untrackSession: () => Promise.resolve(),
      onEnvelope: () => () => undefined,
      url: '/api/ws',
    };
    let result!: RenderResult;
    await act(() => {
      result = rtlRender(ui, {
        wrapper: ({ children }) => (
          <MemoryRouter initialEntries={[`/sessions/${SESSION_ID_FOR_TESTS}/operate`]}>
            <WsClientProvider auth={{ status: 'authenticated' }} client={stubClient}>
              <Routes>
                <Route
                  path="/sessions/:id/operate"
                  element={<ReactFlowProvider>{children}</ReactFlowProvider>}
                />
              </Routes>
            </WsClientProvider>
          </MemoryRouter>
        ),
      });
      return Promise.resolve();
    });
    return result;
  };

  it('mounts the affordance when classification is committed AND substance is awaiting-proposal', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-committed',
          data: {
            wording: 'classification settled (committed)',
            kind: 'fact',
            facetStatuses: {
              wording: 'committed',
              classification: 'committed',
              substance: 'awaiting-proposal',
            },
          },
        })}
      />,
    );
    expect(
      screen.getByTestId('node-card-substance-affordance-n-subst-gate-committed'),
    ).toBeTruthy();
  });

  it('mounts the affordance when classification is agreed AND substance is awaiting-proposal', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-agreed',
          data: {
            wording: 'classification settled (agreed)',
            kind: 'fact',
            facetStatuses: {
              wording: 'committed',
              classification: 'agreed',
              substance: 'awaiting-proposal',
            },
          },
        })}
      />,
    );
    expect(screen.getByTestId('node-card-substance-affordance-n-subst-gate-agreed')).toBeTruthy();
  });

  it('does NOT mount the affordance when classification is proposed (still in flight)', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-class-proposed',
          data: {
            wording: 'classification still proposed',
            kind: 'fact',
            facetStatuses: {
              wording: 'committed',
              classification: 'proposed',
              substance: 'awaiting-proposal',
            },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-substance-affordance-n-subst-gate-class-proposed'),
    ).toBeNull();
  });

  it('does NOT mount the affordance when classification is disputed', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-class-disputed',
          data: {
            wording: 'classification disputed',
            kind: 'fact',
            facetStatuses: {
              wording: 'committed',
              classification: 'disputed',
              substance: 'awaiting-proposal',
            },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-substance-affordance-n-subst-gate-class-disputed'),
    ).toBeNull();
  });

  it('does NOT mount the affordance when classification is still awaiting-proposal', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-class-awaiting',
          data: {
            wording: 'wording settled',
            kind: null,
            facetStatuses: {
              wording: 'committed',
              classification: 'awaiting-proposal',
              substance: 'awaiting-proposal',
            },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-substance-affordance-n-subst-gate-class-awaiting'),
    ).toBeNull();
  });

  it('does NOT mount the affordance when substance facet has already been proposed', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-subst-proposed',
          data: {
            wording: 'substance already proposed',
            kind: 'fact',
            facetStatuses: {
              wording: 'committed',
              classification: 'committed',
              substance: 'proposed',
            },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-substance-affordance-n-subst-gate-subst-proposed'),
    ).toBeNull();
  });

  it('does NOT mount the affordance when substance facet is already committed', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-subst-committed',
          data: {
            wording: 'substance committed',
            kind: 'fact',
            facetStatuses: {
              wording: 'committed',
              classification: 'committed',
              substance: 'committed',
            },
          },
        })}
      />,
    );
    expect(
      screen.queryByTestId('node-card-substance-affordance-n-subst-gate-subst-committed'),
    ).toBeNull();
  });

  it('does NOT mount the affordance when all facet states are absent (fresh node)', async () => {
    await renderWithProviders(
      <StatementNode
        {...makeNodeProps({
          id: 'n-subst-gate-empty',
          data: {
            wording: 'no facet states at all',
            kind: null,
            // facetStatuses defaults to {}
          },
        })}
      />,
    );
    expect(screen.queryByTestId('node-card-substance-affordance-n-subst-gate-empty')).toBeNull();
  });
});
