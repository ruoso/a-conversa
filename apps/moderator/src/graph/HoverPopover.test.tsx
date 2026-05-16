// Tests for `<HoverPopover>` — the transient detail popover surfaced
// beside a hovered or keyboard-focused node / edge on the moderator's
// graph canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_hover_details.md
//
// Per ADR 0022 these are committed Vitest cases. They cover:
//
//   - Node target: wording / kind / facet / axiom-mark / diagnostic
//     sections render conditionally on the corresponding data fields.
//   - Edge target: role + endpoints + facet + diagnostic sections.
//   - Per-target test seams: `role="tooltip"`, `data-testid`,
//     `data-hover-target-kind`, `pointer-events: none` on the popover.
//   - The ICU template for the edge endpoints resolves correctly in
//     each of the three v1 locales (the only catalog change in this
//     task).
//   - Wording truncation at 60 chars for the edge endpoint template.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { HoverPopover } from './HoverPopover';
import type { StatementNodeData } from './StatementNode';
import type { StatementEdgeData } from './selectors';
import type { AxiomMark, Annotation, PendingAxiomMark } from './selectors';
import type { FacetName, FacetStatus } from './facetStatus';
import { createI18nInstance } from '@a-conversa/shell';

function nodeData(overrides: Partial<StatementNodeData> & { wording: string }): StatementNodeData {
  const emptyAnnotations: readonly Annotation[] = [];
  const emptyAxiomMarks: readonly AxiomMark[] = [];
  const emptyPendingAxiomMarks: readonly PendingAxiomMark[] = [];
  const emptyFacets: Readonly<Partial<Record<FacetName, FacetStatus>>> = {};
  return {
    wording: overrides.wording,
    kind: overrides.kind ?? null,
    annotations: overrides.annotations ?? emptyAnnotations,
    facetStatuses: overrides.facetStatuses ?? emptyFacets,
    axiomMarks: overrides.axiomMarks ?? emptyAxiomMarks,
    pendingAxiomMarks: overrides.pendingAxiomMarks ?? emptyPendingAxiomMarks,
    votesByFacet: overrides.votesByFacet ?? {},
    ...(overrides.diagnosticHighlight !== undefined
      ? { diagnosticHighlight: overrides.diagnosticHighlight }
      : {}),
  };
}

function edgeData(overrides: Partial<StatementEdgeData> = {}): StatementEdgeData {
  return {
    role: overrides.role ?? 'supports',
    annotations: overrides.annotations ?? ([] as readonly Annotation[]),
    facetStatuses: overrides.facetStatuses ?? {},
    sourceId: overrides.sourceId ?? 'src-default',
    targetId: overrides.targetId ?? 'tgt-default',
    sourceWording: overrides.sourceWording ?? 'source wording',
    targetWording: overrides.targetWording ?? 'target wording',
    ...(overrides.diagnosticHighlight !== undefined
      ? { diagnosticHighlight: overrides.diagnosticHighlight }
      : {}),
  };
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

// -- Node target ------------------------------------------------------

describe('HoverPopover — node target rendering', () => {
  it('renders the wording paragraph + em-dash kind placeholder when minimal data is given', () => {
    render(
      <HoverPopover
        id="n-minimal"
        target={{ kind: 'node', data: nodeData({ wording: 'minimal node wording' }) }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-n-minimal');
    expect(popover.textContent).toContain('minimal node wording');
    // The em-dash placeholder for the null kind.
    expect(popover.textContent).toContain('—');
    // No facet rows / axiom-mark line / diagnostic line.
    expect(popover.querySelector('[data-hover-popover-section="facets"]')).toBeNull();
    expect(popover.querySelector('[data-hover-popover-section="axiom-marks"]')).toBeNull();
    expect(popover.querySelector('[data-hover-popover-section="diagnostic"]')).toBeNull();
  });

  it('renders the localized kind via methodology.kind.<kind>', () => {
    render(
      <HoverPopover
        id="n-fact"
        target={{ kind: 'node', data: nodeData({ wording: 'w', kind: 'fact' }) }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-n-fact');
    expect(popover.textContent).toContain('Fact');
  });

  it('renders kind localized across locales (pt-BR + es-419)', async () => {
    await i18next.changeLanguage('pt-BR');
    const { rerender } = render(
      <HoverPopover
        id="n-pt"
        target={{ kind: 'node', data: nodeData({ wording: 'w', kind: 'fact' }) }}
      />,
    );
    expect(screen.getByTestId('hover-popover-n-pt').textContent).toContain('Fato');

    await i18next.changeLanguage('es-419');
    rerender(
      <HoverPopover
        id="n-pt"
        target={{ kind: 'node', data: nodeData({ wording: 'w', kind: 'fact' }) }}
      />,
    );
    expect(screen.getByTestId('hover-popover-n-pt').textContent).toContain('Hecho');
    await i18next.changeLanguage('en-US');
  });

  it('renders one facet row when facetStatuses has one entry', () => {
    render(
      <HoverPopover
        id="n-facet"
        target={{
          kind: 'node',
          data: nodeData({ wording: 'w', facetStatuses: { substance: 'disputed' } }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-n-facet');
    const rows = popover.querySelectorAll('[data-hover-popover-facet]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-hover-popover-facet')).toBe('substance');
    expect(rows[0]?.textContent).toContain('Substance');
    expect(rows[0]?.textContent).toContain('Disputed');
  });

  it('renders facet rows in canonical reading order (wording → classification → substance)', () => {
    render(
      <HoverPopover
        id="n-multi-facet"
        target={{
          kind: 'node',
          data: nodeData({
            wording: 'w',
            facetStatuses: {
              substance: 'proposed',
              classification: 'agreed',
              wording: 'disputed',
            },
          }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-n-multi-facet');
    const rows = Array.from(popover.querySelectorAll('[data-hover-popover-facet]'));
    expect(rows.map((r) => r.getAttribute('data-hover-popover-facet'))).toEqual([
      'wording',
      'classification',
      'substance',
    ]);
  });

  it('renders the axiom-mark line with each participant id when axiomMarks is non-empty', () => {
    const PA = '00000000-0000-4000-8000-000000000001';
    const PB = '00000000-0000-4000-8000-000000000002';
    render(
      <HoverPopover
        id="n-ax"
        target={{
          kind: 'node',
          data: nodeData({
            wording: 'w',
            axiomMarks: [
              { nodeId: 'n-ax', participantId: PA, committedAt: '2026-05-11T00:00:00.000Z' },
              { nodeId: 'n-ax', participantId: PB, committedAt: '2026-05-11T00:00:00.000Z' },
            ],
          }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-n-ax');
    const axiomSection = popover.querySelector('[data-hover-popover-section="axiom-marks"]');
    expect(axiomSection).not.toBeNull();
    expect(axiomSection!.textContent).toContain(PA);
    expect(axiomSection!.textContent).toContain(PB);
  });

  it('renders the diagnostic section with severity + joined kind titles', () => {
    render(
      <HoverPopover
        id="n-diag"
        target={{
          kind: 'node',
          data: nodeData({
            wording: 'w',
            diagnosticHighlight: { severity: 'blocking', kinds: ['cycle', 'contradiction'] },
          }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-n-diag');
    const diag = popover.querySelector('[data-hover-popover-section="diagnostic"]');
    expect(diag).not.toBeNull();
    // Severity surfaced as bare wire identifier (catalog has no
    // `diagnostics.severity.*` keys today — documented v1 gap).
    expect(diag!.textContent).toContain('blocking');
    // Multi-kind titles joined with ", ".
    expect(diag!.textContent).toContain('Cycle in supports, Contradiction');
  });
});

// -- Edge target ------------------------------------------------------
//
// Refinement: `mod_edge_popover_full_target_wording` (Option C).
// The edge popover surfaces role + (conditional) role-description +
// endpoint references (source/target node ids) + per-facet status +
// active diagnostic. Source/target *wordings* are NOT rendered — the
// cards already show them inline with measured dimensions, so
// duplicating wording in the popover would not earn the popover's
// existence on the edge surface.

describe('HoverPopover — edge target rendering', () => {
  it('renders the role headline and the endpoint references row with source/target ids', () => {
    render(
      <HoverPopover
        id="edge-1"
        target={{
          kind: 'edge',
          data: edgeData({
            role: 'supports',
            sourceId: 'src-1',
            targetId: 'tgt-1',
          }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-edge-1');
    expect(popover.textContent).toContain('Supports');
    const endpoints = popover.querySelector('[data-hover-popover-section="endpoints"]');
    expect(endpoints).not.toBeNull();
    expect(endpoints!.textContent).toContain('src-1');
    expect(endpoints!.textContent).toContain('tgt-1');
    // ASCII arrow per the typography codepoint-range policy.
    expect(endpoints!.textContent).toContain('->');
  });

  it('renders the role headline localized across locales (pt-BR / es-419)', async () => {
    await i18next.changeLanguage('pt-BR');
    const { rerender } = render(
      <HoverPopover
        id="edge-locale"
        target={{
          kind: 'edge',
          data: edgeData({ role: 'supports', sourceId: 'src-1', targetId: 'tgt-1' }),
        }}
      />,
    );
    expect(screen.getByTestId('hover-popover-edge-locale').textContent).toContain('Apoia');

    await i18next.changeLanguage('es-419');
    rerender(
      <HoverPopover
        id="edge-locale"
        target={{
          kind: 'edge',
          data: edgeData({ role: 'supports', sourceId: 'src-1', targetId: 'tgt-1' }),
        }}
      />,
    );
    expect(screen.getByTestId('hover-popover-edge-locale').textContent).toContain('Apoya');
    await i18next.changeLanguage('en-US');
  });

  it('renders endpoint ids in the endpoints row consistently across locales (template is locale-identical)', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      const { unmount } = render(
        <HoverPopover
          id={`edge-${locale}`}
          target={{
            kind: 'edge',
            data: edgeData({ sourceId: 'src-1', targetId: 'tgt-1' }),
          }}
        />,
      );
      const endpoints = screen
        .getByTestId(`hover-popover-edge-${locale}`)
        .querySelector('[data-hover-popover-section="endpoints"]');
      expect(endpoints, `endpoints section in ${locale}`).not.toBeNull();
      expect(endpoints!.textContent).toContain('src-1');
      expect(endpoints!.textContent).toContain('tgt-1');
      expect(endpoints!.textContent).toContain('->');
      unmount();
    }
    await i18next.changeLanguage('en-US');
  });

  it('stamps data-hover-popover-source-id / data-hover-popover-target-id on the endpoints row', () => {
    render(
      <HoverPopover
        id="edge-seam"
        target={{
          kind: 'edge',
          data: edgeData({ sourceId: 'src-1', targetId: 'tgt-1' }),
        }}
      />,
    );
    const endpoints = screen
      .getByTestId('hover-popover-edge-seam')
      .querySelector('[data-hover-popover-section="endpoints"]');
    expect(endpoints).not.toBeNull();
    expect(endpoints!.getAttribute('data-hover-popover-source-id')).toBe('src-1');
    expect(endpoints!.getAttribute('data-hover-popover-target-id')).toBe('tgt-1');
  });

  it('does NOT render source/target wordings on the edge popover (regardless of wording length)', () => {
    const longSource =
      'A source wording that is significantly longer than 60 characters so this test catches any re-introduction of the prior truncate path';
    const longTarget =
      'A target wording that is similarly long so neither slice prefix appears in the rendered DOM under any path';
    render(
      <HoverPopover
        id="edge-no-wordings"
        target={{
          kind: 'edge',
          data: edgeData({
            role: 'supports',
            sourceId: 'src-no-wordings',
            targetId: 'tgt-no-wordings',
            sourceWording: longSource,
            targetWording: longTarget,
          }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-edge-no-wordings');
    // Negative pin: neither full nor 60-char-prefixed wording appears.
    expect(popover.textContent).not.toContain(longSource);
    expect(popover.textContent).not.toContain(longSource.slice(0, 60));
    expect(popover.textContent).not.toContain(longTarget);
    expect(popover.textContent).not.toContain(longTarget.slice(0, 60));
    // No ellipsis truncation marker either (the prior renderer added one).
    expect(popover.textContent).not.toContain('…');
  });

  it('does NOT render the role-description section when the catalog lacks methodology.edgeRole.<role>.description', () => {
    // The canonical catalog now carries a description for every role
    // (`i18n_methodology_role_descriptions`). To keep the omitted-DOM
    // branch covered we shadow the `supports.description` resource with
    // the literal dotted key — that is exactly what i18next's
    // `returnNull: false` miss behavior emits, so the popover's
    // `roleDescription !== roleDescriptionKey` guard evaluates to
    // `false` and the description paragraph is omitted. (i18next 26
    // removed the legacy `removeResource` method; `addResource` with
    // the key-as-value is the supported way to simulate a miss while
    // keeping the rest of the catalog intact.) The next test's
    // `beforeEach` calls `createI18nInstance('en-US')` which resets the resource
    // store, so the override does not leak across tests.
    const missKey = 'methodology.edgeRole.supports.description';
    i18next.addResource('en-US', 'translation', missKey, missKey);
    render(
      <HoverPopover
        id="edge-no-desc"
        target={{
          kind: 'edge',
          data: edgeData({ role: 'supports' }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-edge-no-desc');
    expect(popover.querySelector('[data-hover-popover-section="role-description"]')).toBeNull();
  });

  it('renders the role-description section when the catalog DOES carry methodology.edgeRole.<role>.description', () => {
    // The canonical catalog (post `i18n_methodology_role_descriptions`)
    // carries a description for every role. The popover renders the
    // description paragraph iff the lookup resolves to something OTHER
    // than the literal key string. No `addResource()` injection needed:
    // the en-US `qualifies.description` entry from the catalog suffices.
    render(
      <HoverPopover
        id="edge-with-desc"
        target={{
          kind: 'edge',
          data: edgeData({ role: 'qualifies' }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-edge-with-desc');
    const desc = popover.querySelector('[data-hover-popover-section="role-description"]');
    expect(desc).not.toBeNull();
    // Assert the canonical en-US sentence per the refinement's
    // authoritative-text table (`tasks/refinements/frontend-i18n/
    // i18n_methodology_role_descriptions.md`).
    expect(desc!.textContent).toContain('Source hedges the scope or degree of target');
  });

  it('renders the substance facet row when facetStatuses has substance', () => {
    render(
      <HoverPopover
        id="edge-facet"
        target={{
          kind: 'edge',
          data: edgeData({ facetStatuses: { substance: 'agreed' } }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-edge-facet');
    const rows = popover.querySelectorAll('[data-hover-popover-facet]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute('data-hover-popover-facet')).toBe('substance');
    expect(rows[0]?.textContent).toContain('Substance');
    expect(rows[0]?.textContent).toContain('Agreed');
  });

  it('renders the diagnostic section on edges identically to nodes', () => {
    render(
      <HoverPopover
        id="edge-diag"
        target={{
          kind: 'edge',
          data: edgeData({
            diagnosticHighlight: { severity: 'advisory', kinds: ['coherency-hint'] },
          }),
        }}
      />,
    );
    const popover = screen.getByTestId('hover-popover-edge-diag');
    const diag = popover.querySelector('[data-hover-popover-section="diagnostic"]');
    expect(diag).not.toBeNull();
    expect(diag!.textContent).toContain('advisory');
    expect(diag!.textContent).toContain('Coherency hint');
  });
});

// -- Test seams -------------------------------------------------------

describe('HoverPopover — test seams', () => {
  it('stamps role="tooltip" + id="hover-popover-<id>" on the root', () => {
    render(
      <HoverPopover id="seam-1" target={{ kind: 'node', data: nodeData({ wording: 'w' }) }} />,
    );
    const popover = screen.getByTestId('hover-popover-seam-1');
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.getAttribute('id')).toBe('hover-popover-seam-1');
  });

  it('stamps data-hover-target-kind="node" for a node target', () => {
    render(
      <HoverPopover id="seam-node" target={{ kind: 'node', data: nodeData({ wording: 'w' }) }} />,
    );
    expect(
      screen.getByTestId('hover-popover-seam-node').getAttribute('data-hover-target-kind'),
    ).toBe('node');
  });

  it('stamps data-hover-target-kind="edge" for an edge target', () => {
    render(<HoverPopover id="seam-edge" target={{ kind: 'edge', data: edgeData() }} />);
    expect(
      screen.getByTestId('hover-popover-seam-edge').getAttribute('data-hover-target-kind'),
    ).toBe('edge');
  });

  it('applies pointer-events: none on the popover root (click-through requirement)', () => {
    render(
      <HoverPopover id="seam-pe" target={{ kind: 'node', data: nodeData({ wording: 'w' }) }} />,
    );
    const popover = screen.getByTestId('hover-popover-seam-pe');
    // Inline style is serialized; happy-dom returns the lowercased
    // `pointer-events: none` form.
    const style = popover.getAttribute('style') ?? '';
    expect(style.toLowerCase()).toContain('pointer-events: none');
  });
});
