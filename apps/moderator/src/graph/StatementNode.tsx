// `<StatementNode>` — custom ReactFlow node for the moderator's graph.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md
// (prior:     tasks/refinements/moderator-ui/mod_disputed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_agreed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_proposed_state_styling.md,
//             tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Every domain node on the moderator's canvas is a "statement" — a
// piece of methodology text with (eventually) a classification. The
// node card renders three things:
//
//   1. The statement wording (the `node-created` payload's `wording`).
//   2. The localized methodology kind label (`methodology.kind.<id>`
//      from the i18n catalog landed by `i18n_methodology_glossary`).
//   3. A decoration row of annotation badges, one per `annotation-
//      created` event whose `target_node_id` is this node. Badges
//      render only when the list is non-empty so the unannotated
//      card stays clean. See `mod_annotation_rendering`.
//
// Classification is null until a `classify-node` proposal has been
// committed (see `projectNodes` in `GraphCanvasPane.tsx`). When kind
// is null we render an em-dash placeholder rather than guessing a
// default — `node-created` carries no classification, and surfacing
// an "uncategorized" state honestly is more useful than a misleading
// default tag.
//
// The visual states (proposed / agreed / disputed / meta-disagreement)
// and the per-facet decorations are owned by separate downstream tasks
// (`mod_proposed_state_styling`, `mod_agreed_state_styling`,
// `mod_disputed_state_styling`, `mod_meta_disagreement_split_render`,
// `mod_per_facet_state_visualization`, `mod_axiom_mark_decoration`, ...)
// and layer on top of this card.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from 'reactflow';
import type { StatementKind } from '@a-conversa/shared-types';

import { AnnotationBadge } from './AnnotationBadge.js';
import type { FacetName, FacetStatus } from './facetStatus.js';
import type { Annotation } from './selectors.js';

/**
 * The shape of `data` ReactFlow hands to `<StatementNode>` via
 * `NodeProps<StatementNodeData>`. Wording and kind come from the
 * `node-created` payload + any committed `classify-node` proposal;
 * `annotations` is enriched in `projectNodes` from the same event log.
 */
export interface StatementNodeData {
  /** The node's wording (verbatim from `node-created` / `edit-wording.reword`). */
  readonly wording: string;
  /**
   * The node's current methodology classification, or `null` when the
   * node has not yet had a `classify-node` proposal committed.
   */
  readonly kind: StatementKind | null;
  /**
   * Annotations targeting this node. Empty when no `annotation-created`
   * event references the node — the badge list is omitted entirely in
   * that case (no empty container in the DOM).
   */
  readonly annotations: readonly Annotation[];
  /**
   * Per-facet `FacetStatus` for this node. Populated by `projectNodes`
   * via `computeFacetStatuses(events)`. Empty when no facet-targeting
   * proposal references the node — the card renders with the solid-
   * border / fully-opaque baseline in that case. The sibling per-facet
   * state-visualization task (`mod_per_facet_state_visualization`)
   * subdivides the card into per-facet slices using this same record.
   */
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
}

/**
 * The ReactFlow `type` key under which `StatementNode` is registered
 * on `<ReactFlow nodeTypes={...} />`. Hoisted to a constant so the
 * registration and every projected `Node.type` stay in lockstep — a
 * literal typo would silently fall back to ReactFlow's default node
 * (no custom rendering, no localized label).
 */
export const STATEMENT_NODE_TYPE = 'statement';

/**
 * Card-level rollup of the per-facet statuses. Returns the highest-priority
 * status present in the per-facet record, or `undefined` when the record is
 * empty (i.e. no facet-targeting event has touched this entity yet — the
 * card renders with its solid-border / fully-opaque baseline).
 *
 * **Priority order** (refinement `mod_agreed_state_styling` Decisions):
 *   1. `proposed`            — in-flight, the moderator can act on it now.
 *   2. `meta-disagreement`   — escalation; the moderator's attention is needed.
 *   3. `disputed`            — needs resolution before commit.
 *   4. `agreed`              — pre-commit unanimous agreement.
 *   5. `committed`           — closed, kept in the rollup so downstream tasks
 *                              (`mod_disputed_state_styling`,
 *                              `mod_per_facet_state_visualization`) can stamp
 *                              the seam attribute and add their own styling
 *                              branches without re-deciding the order.
 *   6. `withdrawn`           — same rationale as committed; closed.
 *
 * Rationale: "things you can act on" sort first; `committed` / `withdrawn`
 * are closed and sort last. Within the agreement layer, `proposed` outranks
 * `disputed` outranks `agreed` because `proposed` means "still gathering
 * votes" — the most active surface for the moderator to drive forward.
 * `meta-disagreement` sits second because the methodology-engine
 * escalation always takes precedence over a normal disputed facet.
 *
 * The sibling state-styling tasks (`mod_disputed_state_styling`,
 * `mod_meta_disagreement_split_render`, etc.) extend the rendering branch
 * for their status; `mod_per_facet_state_visualization` ultimately replaces
 * this rollup with per-facet rendering. Exported so the test suite can pin
 * the rollup logic without re-rendering.
 */
const ROLLUP_PRIORITY: readonly FacetStatus[] = [
  'proposed',
  'meta-disagreement',
  'disputed',
  'agreed',
  'committed',
  'withdrawn',
];

export function cardRollupStatus(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): FacetStatus | undefined {
  const present = new Set(Object.values(facetStatuses));
  for (const status of ROLLUP_PRIORITY) {
    if (present.has(status)) return status;
  }
  return undefined;
}

export function StatementNode(props: NodeProps<StatementNodeData>): ReactElement {
  const { id, data } = props;
  const { t } = useTranslation();
  const { wording, kind, annotations, facetStatuses } = data;

  // Resolve the kind label off the canonical glossary namespace from
  // `i18n_methodology_glossary`. `t('methodology.kind.fact')` etc.
  // returns the localized string for the active locale; on `null` we
  // render an em-dash placeholder so the card height stays stable
  // regardless of classification state.
  const kindLabel = kind === null ? '—' : t(`methodology.kind.${kind}`);

  // Card-level state-styling rollup. The rollup picks the highest-
  // priority facet status (see `cardRollupStatus` JSDoc for the order).
  // Four branches are implemented today:
  //   - `'proposed'` (refinement `mod_proposed_state_styling`): dashed
  //     border + opacity-60 — the "in flight" visual.
  //   - `'agreed'`   (refinement `mod_agreed_state_styling`): solid
  //     border + full opacity, but with `border-slate-700` (darker than
  //     the unstyled baseline's `border-slate-300`) to make the "this
  //     has been agreed" signal visually distinct from the unstyled
  //     "nothing has happened yet" baseline.
  //   - `'disputed'` (refinement `mod_disputed_state_styling`): solid
  //     red border (`border-rose-600`) + a 2-px `ring-rose-500` halo —
  //     the unambiguous "this needs resolution" red marker the moderator
  //     scans for. `opacity-100` is explicit defense against any
  //     inherited dim opacity.
  //   - `'meta-disagreement'` (refinement
  //     `mod_meta_disagreement_split_render`): `border-double` (CSS's
  //     two parallel lines — the literal "split decision" visual) in
  //     `border-violet-600` + a 2-px `ring-violet-400` halo. The violet
  //     palette is the methodology-escalation color family, chosen to
  //     not collide with slate (baseline / agreed) or rose (disputed).
  //     The double border maps the methodology's "both proposed values
  //     are carried side by side" semantics directly into the canvas.
  //
  // Other rollup statuses (`'committed'`, `'withdrawn'`) still receive
  // a `data-facet-status` attribute (the stable seam — Tailwind class
  // strings aren't stable across JIT / production builds, but
  // `[data-facet-status="…"]` selectors are), but the rendered classes
  // fall back to the baseline until the sibling state-styling task for
  // that status lands its own className branch.
  const rollupStatus = cardRollupStatus(facetStatuses);

  const baseClassName =
    'rounded-md border bg-white shadow-sm px-3 py-2 min-w-[12rem] max-w-[18rem]';
  const styleClassName =
    rollupStatus === 'proposed'
      ? 'border-dashed border-slate-400 opacity-60'
      : rollupStatus === 'agreed'
        ? 'border-solid border-slate-700 opacity-100'
        : rollupStatus === 'disputed'
          ? 'border-solid border-rose-600 ring-2 ring-rose-500 opacity-100'
          : rollupStatus === 'meta-disagreement'
            ? 'border-double border-violet-600 ring-2 ring-violet-400 opacity-100'
            : 'border-slate-300';
  const cardClassName = `${baseClassName} ${styleClassName}`;
  const rootProps = rollupStatus !== undefined ? { 'data-facet-status': rollupStatus } : {};

  return (
    <div data-testid={`statement-node-${id}`} className={cardClassName} {...rootProps}>
      <p
        data-testid={`statement-node-wording-${id}`}
        className="text-sm text-slate-900 leading-snug whitespace-pre-line break-words"
      >
        {wording}
      </p>
      <p
        data-testid={`statement-node-kind-${id}`}
        className={
          kind === null
            ? 'mt-1 text-xs uppercase tracking-wide text-slate-400'
            : 'mt-1 text-xs uppercase tracking-wide text-slate-500'
        }
      >
        {kindLabel}
      </p>
      {annotations.length > 0 ? (
        <div data-testid={`annotation-badge-list-node-${id}`} className="mt-1 flex flex-wrap gap-1">
          {annotations.map((annotation) => (
            <AnnotationBadge key={annotation.id} annotation={annotation} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
