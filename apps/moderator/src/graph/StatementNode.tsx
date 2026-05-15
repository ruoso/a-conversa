// `<StatementNode>` — custom ReactFlow node for the moderator's graph.
//
// Refinement: tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md
// (prior:     tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md,
//             tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md,
//             tasks/refinements/moderator-ui/mod_meta_disagreement_split_render.md,
//             tasks/refinements/moderator-ui/mod_disputed_state_styling.md,
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

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from 'reactflow';
import type { StatementKind } from '@a-conversa/shared-types';

import { useSelectionStore } from '../stores/index.js';
import { AnnotationBadge } from './AnnotationBadge.js';
import { AxiomMarkBadge } from './AxiomMarkBadge.js';
import { FacetPill } from './FacetPill.js';
import { HoverPopover } from './HoverPopover.js';
import type { DiagnosticHighlight } from './diagnosticHighlights.js';
import type { FacetName, FacetStatus } from './facetStatus.js';
import { EMPTY_VOTES, type Annotation, type AxiomMark, type Vote } from './selectors.js';

/**
 * Canonical reading order for the per-facet pill row. Matches the
 * methodology's enumeration in `docs/methodology.md` § "Facets":
 *
 *   1. Wording        — "does the captured text faithfully represent what was said?"
 *   2. Classification — "what kind of statement is it?"
 *   3. Substance      — "do we agree the content is true / the claim holds?"
 *
 * **This is the reading order, not the rollup priority.** The card-level
 * rollup priority (`ROLLUP_PRIORITY`, below) is about *importance* —
 * what status wins when multiple are present, for the whole-card frame.
 * `FACET_RENDER_ORDER` is about *reading sequence* — the order pills
 * appear left-to-right inside the per-facet bar so the moderator scans
 * "wording / classification / substance" in the same order as the
 * methodology document enumerates them.
 *
 * Refinement: `mod_per_facet_state_visualization`.
 */
const FACET_RENDER_ORDER: readonly FacetName[] = ['wording', 'classification', 'substance'];

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
   * border / fully-opaque baseline AND no per-facet pill row in that
   * case. When non-empty, drives BOTH the whole-card frame styling (via
   * `cardRollupStatus`) AND the per-facet pill row (refinement
   * `mod_per_facet_state_visualization`).
   */
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  /**
   * Committed per-participant axiom-marks on this node. Each entry is
   * one `(node, participant)` pair where the participant has marked this
   * node as bedrock and the moderator has committed the proposal. Empty
   * when no committed axiom-mark exists — the badge row is omitted from
   * the DOM in that case (no empty container, same pattern as the
   * annotation row). Refinement: `mod_axiom_mark_decoration`.
   */
  readonly axiomMarks: readonly AxiomMark[];
  /**
   * Per-facet `Vote[]` index for this node — one entry per facet that
   * has at least one vote on its pending proposal. Each entry is the
   * list of per-participant votes (latest arm each), preserving each
   * participant's first-vote arrival order so the indicator dots don't
   * jump position on an agree↔dispute switch. Empty / absent facets
   * render their pill unchanged (no in-pill indicator row). Refinement:
   * `mod_vote_indicators_on_graph`.
   */
  readonly votesByFacet: Readonly<Partial<Record<FacetName, readonly Vote[]>>>;
  /**
   * Per-entity diagnostic highlight, or `undefined` when no active
   * diagnostic touches this node. Read by `<StatementNode>` to compose
   * the amber halo onto the card root. Refinement:
   * `tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md`.
   */
  readonly diagnosticHighlight?: DiagnosticHighlight;
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
  const {
    wording,
    kind,
    annotations,
    facetStatuses,
    axiomMarks,
    votesByFacet,
    diagnosticHighlight,
  } = data;

  // Selection state for this card. Refinement: `mod_selection`. The
  // selector reduces the store's `selected: Selection | null` to a single
  // boolean specific to THIS node, so only the previously- or newly-
  // selected card re-renders when selection changes — every other card on
  // the canvas keeps the same `isSelected = false` return value across
  // the selection change and Zustand's strict-equality check skips the
  // re-render. The store's `select`/`clear` are written by the canvas's
  // click handlers in `GraphCanvasPane.tsx` (no per-component `onClick`
  // wiring here — ReactFlow's `onNodeClick` is the canonical seam).
  const isSelected = useSelectionStore(
    (state) => state.selected?.kind === 'node' && state.selected.id === id,
  );

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
  // Selection ring (refinement `mod_selection`). Composed ON TOP of the
  // status ring (`ring-2 ring-rose-500` / `ring-2 ring-violet-400`) —
  // Tailwind's `ring-4` widens the ring and `ring-sky-500` overrides
  // the ring color. The sky palette reads neutrally against slate
  // (baseline / agreed), rose (disputed), and violet (meta-disagreement)
  // so the selection ring doesn't fight the status signal.
  const selectionClassName = isSelected ? 'ring-4 ring-sky-500' : '';
  // Diagnostic-highlight ring (refinement `mod_diagnostic_highlighting`).
  // Composes on top of the status ring (rose / violet) and the selection
  // ring (sky). The blocking variant uses `ring-4` + `ring-offset-2` +
  // `motion-safe:animate-pulse` — the wider ring + the offset separator
  // + the motion cue together read as "this is urgent". The advisory
  // variant uses `ring-2` + `ring-offset-1` and no pulse so the canvas
  // doesn't become a wall of motion when several coherency hints fire
  // simultaneously. Both share the amber palette so the "this is a
  // diagnostic" signal is consistent regardless of severity. The
  // `motion-safe:` Tailwind variant respects `prefers-reduced-motion`
  // automatically, so users who opted out see a static blocking ring
  // (still differentiated from advisory by width + offset).
  const diagnosticClassName =
    diagnosticHighlight === undefined
      ? ''
      : diagnosticHighlight.severity === 'blocking'
        ? 'ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white motion-safe:animate-pulse'
        : 'ring-2 ring-amber-300/70 ring-offset-1 ring-offset-white';
  const cardClassName = `${baseClassName} ${styleClassName}${
    selectionClassName ? ` ${selectionClassName}` : ''
  }${diagnosticClassName ? ` ${diagnosticClassName}` : ''} relative`;
  // Hover / focus-visible state for the per-card popover. Refinement:
  // `mod_hover_details`. Single boolean flipped by both pointer and
  // keyboard input paths so WCAG 2.1 SC 1.4.13 ("Content on Hover or
  // Focus") is satisfied: the keyboard user sees the same popover as
  // the mouse user. The flag lives in component-local `useState` —
  // pinning the open-popover position to one entity's lifetime mirrors
  // `mod_context_menus`'s decision to keep menu position out of the
  // selection store.
  const [isHovered, setIsHovered] = useState(false);
  // Root data attributes: `data-facet-status` is the existing seam for
  // the status-styling tasks; `data-selected` is the stable boolean
  // selection seam this task adds (Tailwind class strings aren't
  // load-bearing across builds, but data attributes are). Both branches
  // of `data-selected` are stamped (true / false) so downstream tests
  // can target the negative case without relying on attribute absence.
  // `data-diagnostic-severity` is stamped only when a diagnostic
  // highlight is present (mirrors the `data-facet-status` decision to
  // omit on baseline rather than stamp `"none"`).
  //
  // The native `title` attribute previously stamped for diagnostic-
  // highlight kind names has been REMOVED. Refinement:
  // `mod_hover_details`. The popover surfaces the same content in a
  // richer layout; leaving `title` would race a native multi-second
  // tooltip against our instant popover.
  const rootProps = {
    ...(rollupStatus !== undefined ? { 'data-facet-status': rollupStatus } : {}),
    'data-selected': isSelected ? 'true' : 'false',
    ...(diagnosticHighlight !== undefined
      ? { 'data-diagnostic-severity': diagnosticHighlight.severity }
      : {}),
    ...(isHovered ? { 'aria-describedby': `hover-popover-${id}` } : {}),
  };

  // Per-facet pill row — the per-facet *detail* layer that sits above
  // the wording paragraph. The card frame above is the whole-card
  // *rollup* signal (the "scan the canvas" view); the pill row surfaces
  // the per-facet statuses simultaneously so the moderator sees at a
  // glance which facets are committed vs disputed vs proposed without
  // drilling into the right sidebar. Renders only when at least one
  // pill would render — mirrors the annotation / axiom-mark row pattern
  // (no empty container in the DOM). Pills iterate in canonical reading
  // order (`wording > classification > substance`, per
  // `FACET_RENDER_ORDER`); only facets present in `facetStatuses`
  // produce a pill. Refinement: `mod_per_facet_state_visualization`.
  const facetPills = FACET_RENDER_ORDER.flatMap((facet) => {
    const status = facetStatuses[facet];
    if (status === undefined) return [];
    const votes = votesByFacet[facet] ?? EMPTY_VOTES;
    return [<FacetPill key={facet} facet={facet} status={status} votes={votes} />];
  });

  return (
    <div
      data-testid={`statement-node-${id}`}
      className={cardClassName}
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      {...rootProps}
    >
      {facetPills.length > 0 ? (
        <div data-testid={`facet-pill-row-node-${id}`} className="mb-1 flex flex-wrap gap-1">
          {facetPills}
        </div>
      ) : null}
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
      {axiomMarks.length > 0 ? (
        // Axiom-mark badge row — rendered ABOVE the annotation row.
        // Axiom-marks are methodology-disposition (load-bearing for
        // "what is the recorded outcome for this participant"); annotations
        // are commentary. The reader's eye should land on the load-bearing
        // decoration first when scanning the card. Refinement:
        // `mod_axiom_mark_decoration`. The container is omitted entirely
        // when no committed axiom-marks exist, keeping the DOM clean for
        // the common case. Per-mark key uses `participantId` because the
        // per-participant uniqueness invariant (one mark per (node,
        // participant) — pinned by `proposeAxiomMark.test.ts` rule 4)
        // guarantees uniqueness within the per-node list.
        <div data-testid={`axiom-mark-list-node-${id}`} className="mt-1 flex flex-wrap gap-1">
          {axiomMarks.map((mark) => (
            <AxiomMarkBadge key={mark.participantId} mark={mark} />
          ))}
        </div>
      ) : null}
      {annotations.length > 0 ? (
        <div data-testid={`annotation-badge-list-node-${id}`} className="mt-1 flex flex-wrap gap-1">
          {annotations.map((annotation) => (
            <AnnotationBadge key={annotation.id} annotation={annotation} />
          ))}
        </div>
      ) : null}
      {isHovered ? <HoverPopover id={id} target={{ kind: 'node', data }} /> : null}
    </div>
  );
}
