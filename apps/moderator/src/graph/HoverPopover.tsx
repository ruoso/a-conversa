// `<HoverPopover>` — transient detail popover surfaced beside a hovered
// or keyboard-focused node / edge on the moderator's graph canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md
// (prior:     tasks/refinements/moderator-ui/mod_hover_details.md,
//             tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md,
//             tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md,
//             tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md,
//             tasks/refinements/moderator-ui/mod_selection.md,
//             tasks/refinements/moderator-ui/mod_context_menus.md,
//             tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0005-styling-tailwind-with-shared-tokens.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// **Node popover** — the node card visual is intentionally compact
// (`max-w-[18rem]` so a long wording wraps to several lines, but with
// measured dimensions per `mod_layout_measured_dimensions` the card
// fits its full content). The popover adds the localized kind, every
// per-facet status with localized state, every axiom-mark line, and
// any active diagnostic title(s). The node popover continues to render
// the full wording paragraph as a deliberate redundancy with the card
// (the popover is the structured detail surface for keyboard / hover
// users; the card and the popover both want to surface the wording).
//
// **Edge popover** — the edge label is a single role pill, and per
// `mod_edge_popover_full_target_wording` the popover surfaces what
// the pill leaves out: the role's full meaning (a conditional
// `methodology.edgeRole.<role>.description` line, rendered only when
// the catalog carries the key) and the endpoint relationship (the
// source / target node ids, rendered as a font-mono `{sourceId} ->
// {targetId}` line in the canonical canvas-stable handle form). The
// popover deliberately does NOT render the source / target wordings —
// the cards already show them inline.
//
// **Positioning is pure CSS.** The popover layers as a child of the
// already-positioned `data-testid="statement-node-<id>"` root (for
// nodes) or the role-label's parent `flex flex-col items-center
// gap-0.5` container inside `<EdgeLabelRenderer>` (for edges). No
// positioning library, no portal — just `position: absolute; bottom:
// calc(100% + 4px); left: 0`. The trade-off: a node hovered at the very
// top of the viewport clips at the top edge. Accepted as a v1
// trade-off; a future task `mod_hover_details_flip_on_clip` can add a
// `getBoundingClientRect` measurement + a flip-side branch if real
// moderation sessions show the issue is real.
//
// **`pointer-events: none`.** Click / mousedown / mouseup events flow
// through the popover to the entity below. This is load-bearing for
// (a) `mod_selection` (click still drives `useSelectionStore`),
// (b) `mod_context_menus` (right-click still opens the menu), and
// (c) the popover cannot be interactively clicked. A future task that
// wants interactive popover content MUST switch to a click-pinned panel
// pattern.
//
// **A11y.** `role="tooltip"` + `id="hover-popover-<id>"`; the parent
// entity carries `aria-describedby` only when the popover is rendered.
// Focus-visible on the entity opens the popover (the `setIsHovered`
// flag is driven by both `onMouseEnter` / `onMouseLeave` AND `onFocus` /
// `onBlur` — see `<StatementNode>` / `<StatementEdge>`). WCAG 2.1
// SC 1.4.13: keyboard users see the same content as hover users.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { axiomMarkColorFor, type StatementEdgeData } from './selectors.js';
import type { StatementNodeData } from './StatementNode.js';
import type { FacetName } from './facetStatus.js';

/**
 * Canonical reading order for the per-facet section. Same order as the
 * node card's `FACET_RENDER_ORDER` (see `<StatementNode>`): `wording →
 * classification → substance`. Owned here so the popover renderer can
 * iterate without coupling to the node-internal constant — the two
 * surfaces SHOULD render facets in the same order, but the duplication
 * keeps the popover testable in isolation. Refinement:
 * `mod_per_facet_state_visualization`.
 */
const FACET_RENDER_ORDER: readonly FacetName[] = ['wording', 'classification', 'substance'];

/**
 * Status set that has a localized `methodology.facetState.<id>` entry
 * in every v1 locale. Mirrors `METHODOLOGY_VALUES.facetState` in
 * `packages/i18n-catalogs/src/methodology.test.ts`. Statuses outside
 * this set (`committed`, `withdrawn`) render the bare wire identifier
 * with `text-slate-400` styling so the missing-translation gap is
 * visually distinguishable. Adding the missing keys is a separate task
 * (`i18n_facet_state_completion`).
 */
const LOCALIZED_FACET_STATES = new Set(['proposed', 'agreed', 'disputed', 'meta-disagreement']);

export interface HoverPopoverProps {
  /** Entity id; drives `id="hover-popover-<id>"` and `data-testid`. */
  readonly id: string;
  /**
   * The hovered entity. Discriminator is `kind`; `data` carries the
   * matching projection payload (`StatementNodeData` for nodes,
   * `StatementEdgeData` for edges). The component is the boundary that
   * fans out into the two per-kind layouts.
   */
  readonly target:
    | { kind: 'node'; data: StatementNodeData }
    | { kind: 'edge'; data: StatementEdgeData };
}

export function HoverPopover(props: HoverPopoverProps): ReactElement {
  const { id, target } = props;
  const { t } = useTranslation();

  // Common popover frame: `position: absolute; bottom: calc(100% + 4px);
  // left: 0` anchors above the entity. `pointer-events: none` is the
  // load-bearing click-through requirement. `z-10` keeps the popover
  // above sibling canvas decorations (the per-facet pill row, the
  // annotation badge row) without competing with the context menu's
  // `z-[1000]` from `<GraphContextMenu>`.
  //
  // `inline-style` positioning rather than Tailwind utilities for the
  // anchor: `position: absolute; bottom: calc(100% + 4px); left: 0` is
  // unambiguous across Tailwind builds. Tailwind's `bottom-full` only
  // gets you `bottom: 100%`; the 4px gap requires the `calc(...)` value
  // which arbitrary-value Tailwind syntax (`bottom-[calc(100%+4px)]`)
  // would express but is harder to read in source.
  //
  // The popover content (DOM children) is rendered in a per-target
  // branch below.
  const popoverStyle = {
    position: 'absolute' as const,
    bottom: 'calc(100% + 4px)',
    left: 0,
    pointerEvents: 'none' as const,
    zIndex: 10,
  };
  const popoverClassName =
    'rounded-md border border-slate-300 bg-white shadow-lg px-3 py-2 text-sm text-slate-900 space-y-1 min-w-[16rem] max-w-[24rem]';
  const testId = `hover-popover-${id}`;
  const tooltipId = `hover-popover-${id}`;

  if (target.kind === 'node') {
    const { wording, kind, facetStatuses, axiomMarks, diagnosticHighlight } = target.data;
    // Kind line — em-dash placeholder when null (mirrors the card's
    // null-kind rendering).
    const kindLabel = kind === null ? '—' : t(`methodology.kind.${kind}`);
    // Per-facet section. Iterate in `FACET_RENDER_ORDER`; emit rows
    // only for facets that have a status. Status text is the localized
    // facetState for the four pre-commit states; bare wire identifier
    // styled `text-slate-400` for `committed` / `withdrawn` (the
    // documented v1 catalog gap — see refinement Decisions).
    const facetRows = FACET_RENDER_ORDER.flatMap((facet) => {
      const status = facetStatuses[facet];
      if (status === undefined) return [];
      const facetLabel = t(`methodology.facet.${facet}`);
      const isLocalized = LOCALIZED_FACET_STATES.has(status);
      const stateLabel = isLocalized ? t(`methodology.facetState.${status}`) : status;
      const stateClass = isLocalized ? 'text-slate-700' : 'text-slate-400';
      return [
        <div
          key={facet}
          data-hover-popover-facet={facet}
          className="flex items-center gap-1 text-xs"
        >
          <span className="font-medium text-slate-700">{facetLabel}</span>
          <span className={stateClass}>{stateLabel}</span>
        </div>,
      ];
    });
    // Axiom-mark line. Reuses `methodology.axiomMark.tooltip` (the
    // existing per-participant template) per participant; the line is
    // omitted entirely when no axiom-mark touches this node.
    const hasAxiomMarks = axiomMarks.length > 0;
    // Active-diagnostic line. Mirrors the content `mod_diagnostic_
    // highlighting` previously stamped on the native `title` attribute
    // (which this task removes from the entity): the severity on its
    // own row above the kind titles. Severity is the bare wire
    // identifier — the catalog has no `diagnostics.severity.*` entries
    // today (see refinement Decisions, "facetState localization gap").
    return (
      <div
        id={tooltipId}
        role="tooltip"
        data-testid={testId}
        data-hover-target-kind="node"
        style={popoverStyle}
        className={popoverClassName}
      >
        <p
          data-hover-popover-section="wording"
          className="text-sm text-slate-900 leading-snug whitespace-pre-line break-words"
        >
          {wording}
        </p>
        <p
          data-hover-popover-section="kind"
          className={
            kind === null
              ? 'text-xs uppercase tracking-wide text-slate-400'
              : 'text-xs uppercase tracking-wide text-slate-500'
          }
        >
          {kindLabel}
        </p>
        {facetRows.length > 0 ? (
          <div data-hover-popover-section="facets" className="flex flex-col gap-0.5">
            {facetRows}
          </div>
        ) : null}
        {hasAxiomMarks ? (
          <div data-hover-popover-section="axiom-marks" className="text-xs text-slate-700">
            <span>
              {t('methodology.axiomMark.label')}
              {': '}
            </span>
            <span className="inline-flex flex-wrap gap-1">
              {axiomMarks.map((mark) => {
                const color = axiomMarkColorFor(mark.participantId);
                return (
                  <span
                    key={mark.participantId}
                    data-hover-popover-axiom-mark-participant={mark.participantId}
                    className={`font-medium ${color.text}`}
                  >
                    {mark.participantId}
                  </span>
                );
              })}
            </span>
          </div>
        ) : null}
        {diagnosticHighlight !== undefined ? (
          <div data-hover-popover-section="diagnostic" className="space-y-0.5">
            <p
              data-hover-popover-diagnostic-severity={diagnosticHighlight.severity}
              className="text-xs uppercase tracking-wide text-slate-400"
            >
              {diagnosticHighlight.severity}
            </p>
            <p className="text-xs text-slate-700">
              {diagnosticHighlight.kinds.map((k) => t(`diagnostics.${k}.title`)).join(', ')}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  // Edge target. Sections (post `mod_edge_popover_full_target_wording`):
  // role headline → optional role-description → endpoint references
  // (source/target ids) → per-facet (substance only in v1) → active
  // diagnostic. Source/target *wordings* are no longer rendered by the
  // popover — the cards already show wording with measured dimensions
  // per `mod_layout_measured_dimensions`. The endpoint references row
  // surfaces the canvas-stable canonical handle (the node ids) instead.
  const { role, facetStatuses, diagnosticHighlight, sourceId, targetId } = target.data;
  const roleLabel = t(`methodology.edgeRole.${role}`);
  // Conditional role-description seam. Refinement:
  // `mod_edge_popover_full_target_wording` (Option C). The popover
  // renders a small description paragraph below the role headline IFF
  // the catalog carries a `methodology.edgeRole.<role>.description`
  // entry for the active locale. i18next's miss behavior under
  // `returnNull: false` (see `i18n-catalogs/config.ts`) returns the
  // literal key string when no translation is found — the "key !==
  // resolved string" idiom is the documented miss detection. Today
  // every locale's lookup misses; the descriptions land in a future
  // task `i18n_methodology_role_descriptions` without further code
  // change here.
  const roleDescriptionKey = `methodology.edgeRole.${role}.description`;
  const roleDescription = t(roleDescriptionKey);
  const hasRoleDescription = roleDescription !== roleDescriptionKey;
  // `moderator.hoverPopover.edgeEndpointsReference` is the ICU template
  // that replaced the retired `edgeEndpoints` template in
  // `mod_edge_popover_full_target_wording`. Substitutes `{sourceId}` /
  // `{targetId}` — node ids, not user-authored wordings. Locale-
  // identical body (pure punctuation per the typography codepoint-range
  // policy).
  const endpointsLine = t('moderator.hoverPopover.edgeEndpointsReference', {
    sourceId,
    targetId,
  });
  const facetRows = FACET_RENDER_ORDER.flatMap((facet) => {
    const status = facetStatuses[facet];
    if (status === undefined) return [];
    const facetLabel = t(`methodology.facet.${facet}`);
    const isLocalized = LOCALIZED_FACET_STATES.has(status);
    const stateLabel = isLocalized ? t(`methodology.facetState.${status}`) : status;
    const stateClass = isLocalized ? 'text-slate-700' : 'text-slate-400';
    return [
      <div key={facet} data-hover-popover-facet={facet} className="flex items-center gap-1 text-xs">
        <span className="font-medium text-slate-700">{facetLabel}</span>
        <span className={stateClass}>{stateLabel}</span>
      </div>,
    ];
  });
  return (
    <div
      id={tooltipId}
      role="tooltip"
      data-testid={testId}
      data-hover-target-kind="edge"
      style={popoverStyle}
      className={popoverClassName}
    >
      <p
        data-hover-popover-section="role"
        className="text-xs uppercase tracking-wide text-slate-500 font-medium"
      >
        {roleLabel}
      </p>
      {hasRoleDescription ? (
        <p
          data-hover-popover-section="role-description"
          className="text-xs text-slate-600 leading-snug"
        >
          {roleDescription}
        </p>
      ) : null}
      <p
        data-hover-popover-section="endpoints"
        data-hover-popover-source-id={sourceId}
        data-hover-popover-target-id={targetId}
        className="text-xs text-slate-700 font-mono break-all"
      >
        {endpointsLine}
      </p>
      {facetRows.length > 0 ? (
        <div data-hover-popover-section="facets" className="flex flex-col gap-0.5">
          {facetRows}
        </div>
      ) : null}
      {diagnosticHighlight !== undefined ? (
        <div data-hover-popover-section="diagnostic" className="space-y-0.5">
          <p
            data-hover-popover-diagnostic-severity={diagnosticHighlight.severity}
            className="text-xs uppercase tracking-wide text-slate-400"
          >
            {diagnosticHighlight.severity}
          </p>
          <p className="text-xs text-slate-700">
            {diagnosticHighlight.kinds.map((k) => t(`diagnostics.${k}.title`)).join(', ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
