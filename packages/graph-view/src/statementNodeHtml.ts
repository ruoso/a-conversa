// Pure HTML-string builder for a statement node's per-node content
// (`per_facet_step_pill`). `cytoscape-node-html-label`'s `tpl(data)`
// callback returns an HTML string per node; this module is that builder.
// Kept pure (string in, string out) so the Vitest layer pins the markup
// without a Cytoscape mount. All dynamic text is HTML-escaped.
//
// The composed node reads top-to-bottom: a header pill (the current step
// + candidate value + a checkbox per debater, OR a compact settled
// summary) above the statement wording body. Styling lives in the
// package's overlay CSS (`.gv-node*` classes).

import type { StatementStepModel, VoteMark } from './statementStepModel.js';

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
 * Build the inner HTML for one statement node: the step-pill header above
 * the wording body. `cytoscape-node-html-label` wraps the returned
 * string and positions it on the node.
 */
export function renderStatementNodeHtml(args: {
  readonly wording: string;
  readonly step: StatementStepModel;
}): string {
  return (
    `<div class="gv-node__header">${renderHeader(args.step)}</div>` +
    `<div class="gv-node__body">${escapeHtml(args.wording)}</div>`
  );
}
