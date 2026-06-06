// Vitest for the pure statement-node HTML builder (`per_facet_step_pill`).
// ADR 0022 — committed pins.

import { describe, expect, it } from 'vitest';

import { escapeHtml, renderStatementNodeHtml } from './statementNodeHtml';
import type { StatementStepModel } from './statementStepModel';

describe('escapeHtml', () => {
  it('escapes the HTML metacharacters', () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe(
      '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;',
    );
  });
});

describe('renderStatementNodeHtml', () => {
  it('(a) renders the wording body, escaped', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [],
    };
    const html = renderStatementNodeHtml({ wording: 'UBI <lifts> welfare', step });
    expect(html).toContain('gv-node__body');
    expect(html).toContain('UBI &lt;lifts&gt; welfare');
    expect(html).not.toContain('<lifts>');
  });

  it('(b) a wording step shows the facet label with no ": value"', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [{ name: 'Alice', mark: 'none' }],
    };
    const html = renderStatementNodeHtml({ wording: 'w', step });
    expect(html).toContain('<div class="gv-pill__title">Wording</div>');
    expect(html).toContain('Alice');
    expect(html).toContain('gv-mark--none');
  });

  it('(c) a classification step shows "Label: Value" and per-debater marks', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'classification',
      facetLabel: 'Classification',
      valueLabel: 'Fact',
      debaters: [
        { name: 'Alice', mark: 'agree' },
        { name: 'Ben', mark: 'dispute' },
      ],
    };
    const html = renderStatementNodeHtml({ wording: 'w', step });
    expect(html).toContain('Classification: Fact');
    expect(html).toContain('gv-mark--agree');
    expect(html).toContain('gv-mark--dispute');
    expect(html).toContain('✓');
    expect(html).toContain('✗');
  });

  it('(d) a settled summary joins the two values with a check', () => {
    const step: StatementStepModel = {
      kind: 'settled',
      classificationLabel: 'Fact',
      substanceLabel: 'Holds',
    };
    const html = renderStatementNodeHtml({ wording: 'w', step });
    expect(html).toContain('gv-pill--settled');
    expect(html).toContain('Fact · Holds ✓');
  });
});
