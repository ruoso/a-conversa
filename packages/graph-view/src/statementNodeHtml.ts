// Pure HTML-string builder for a statement node's per-node content
// (`per_facet_step_pill`). `cytoscape-node-html-label`'s `tpl(data)`
// callback returns an HTML string per node; this module is that builder.
// Kept pure (string in, string out) so the Vitest layer pins the markup
// without a Cytoscape mount. All dynamic text is HTML-escaped.
//
// The composed node reads top-to-bottom: a header pill (the current step
// + candidate value + a checkbox per debater, OR a compact settled
// summary) above the statement wording body, with an optional footer row
// of per-participant axiom-mark badges + node-targeted annotation chips
// (`per_facet_step_pill` fold-in; ADR 0004 2026-06-06 amendment — the
// floating axiom-mark / annotation overlays retire for statement nodes,
// edge-targeted annotations stay in `<AudienceAnnotationOverlay>`).
// Styling lives in the package's overlay CSS (`.gv-node*` classes); the
// axiom badge's per-participant color rides Tailwind utility classes
// (resolved by the caller via `axiomMarkColorFor`).

import type { StatementStepModel, VoteMark } from './statementStepModel.js';

/**
 * Resolved view of one node-targeted annotation for the footer chip. The
 * caller localizes `kindLabel` (via `t('methodology.annotationKind.*')`)
 * and carries the raw `kind` (data attribute seam) + `content` (hover
 * title), mirroring `<AudienceAnnotationBadge>`'s contract.
 */
export interface NodeAnnotationView {
  readonly kind: string;
  readonly kindLabel: string;
  readonly content: string;
}

/**
 * Resolved view of one per-participant axiom-mark badge for the footer.
 * `colorClass` is the caller-resolved utility-class string from
 * `axiomMarkColorFor(participantId)` (the same per-participant color the
 * floating `<AxiomMarkBadge>` used); `tooltip` is the localized hover
 * label; `participantId` stays queryable via `data-participant-id` for
 * parity with the retired overlay's badge.
 */
export interface NodeAxiomMarkView {
  readonly participantId: string;
  readonly colorClass: string;
  readonly tooltip: string;
}

/** HTML-escape text destined for an element's text content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The glyph painted inside a debater's checkbox for each vote state. */
function markGlyph(mark: VoteMark): string {
  switch (mark) {
    case 'agree':
      return '✓';
    case 'dispute':
      return '✗';
    default:
      return '';
  }
}

function renderHeader(step: StatementStepModel): string {
  if (step.kind === 'settled') {
    const parts = [step.classificationLabel, step.substanceLabel]
      .filter((label): label is string => label !== null)
      .map(escapeHtml);
    const summary = parts.length > 0 ? `${parts.join(' · ')} ✓` : '✓';
    return `<div class="gv-pill gv-pill--settled">${summary}</div>`;
  }

  const title =
    step.valueLabel === null
      ? escapeHtml(step.facetLabel)
      : `${escapeHtml(step.facetLabel)}: ${escapeHtml(step.valueLabel)}`;

  const debaters = step.debaters
    .map(
      (debater) =>
        `<span class="gv-debater">` +
        `<span class="gv-debater__name">${escapeHtml(debater.name)}</span>` +
        `<span class="gv-mark gv-mark--${debater.mark}">${markGlyph(debater.mark)}</span>` +
        `</span>`,
    )
    .join('');

  return (
    `<div class="gv-pill gv-pill--step">` +
    `<div class="gv-pill__title">${title}</div>` +
    `<div class="gv-pill__debaters">${debaters}</div>` +
    `</div>`
  );
}

/**
 * The footer row: per-participant axiom-mark badges followed by
 * node-targeted annotation chips. Returns `''` (no footer element) when
 * both lists are empty so an undecorated node stays a clean
 * header-over-body. Axiom marks precede annotations to preserve the
 * retired overlays' stacking (axiom row nearest the node, annotations
 * below it).
 */
function renderFooter(
  axiomMarks: readonly NodeAxiomMarkView[],
  annotations: readonly NodeAnnotationView[],
): string {
  if (axiomMarks.length === 0 && annotations.length === 0) return '';
  const markHtml = axiomMarks
    .map(
      (mark) =>
        `<span class="gv-axiom ${mark.colorClass}"` +
        ` data-participant-id="${escapeHtml(mark.participantId)}"` +
        ` title="${escapeHtml(mark.tooltip)}">A</span>`,
    )
    .join('');
  const annotationHtml = annotations
    .map(
      (annotation) =>
        `<span class="gv-anno"` +
        ` data-annotation-kind="${escapeHtml(annotation.kind)}"` +
        ` title="${escapeHtml(annotation.content)}">${escapeHtml(annotation.kindLabel)}</span>`,
    )
    .join('');
  return `<div class="gv-node__footer">${markHtml}${annotationHtml}</div>`;
}

/**
 * Build the inner HTML for one statement node: the step-pill header above
 * the wording body, with an optional footer of axiom-mark badges +
 * node-targeted annotation chips. `cytoscape-node-html-label` wraps the
 * returned string and positions it on the node.
 */
export function renderStatementNodeHtml(args: {
  readonly wording: string;
  readonly step: StatementStepModel;
  readonly axiomMarks?: readonly NodeAxiomMarkView[];
  readonly annotations?: readonly NodeAnnotationView[];
}): string {
  return (
    `<div class="gv-node__header">${renderHeader(args.step)}</div>` +
    `<div class="gv-node__body">${escapeHtml(args.wording)}</div>` +
    renderFooter(args.axiomMarks ?? [], args.annotations ?? [])
  );
}
