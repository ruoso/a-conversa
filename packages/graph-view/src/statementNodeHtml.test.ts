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

  it('(a2) wraps everything in a SINGLE root element (header + body + footer all present)', () => {
    // The plugin appends each child of the parsed body while iterating a
    // live HTMLCollection, which drops every other element when there is
    // more than one root. A single `gv-node` root keeps the wording (the
    // middle child) from vanishing. Parse and assert exactly one root with
    // all three sections beneath it.
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [],
    };
    const html = renderStatementNodeHtml({
      wording: 'the claim',
      step,
      annotations: [{ kind: 'note', kindLabel: 'Note', content: 'n' }],
    });
    const roots = new DOMParser().parseFromString(html, 'text/html').body.children;
    expect(roots.length).toBe(1);
    const root = roots[0]!;
    expect(root.className).toBe('gv-node');
    expect(root.querySelector('.gv-node__header')).not.toBeNull();
    expect(root.querySelector('.gv-node__body')?.textContent).toBe('the claim');
    expect(root.querySelector('.gv-node__footer')).not.toBeNull();
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

  it('(e) renders no footer when there are no axiom marks or annotations', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [],
    };
    const html = renderStatementNodeHtml({ wording: 'w', step });
    expect(html).not.toContain('gv-node__footer');
  });

  it('(f) renders axiom-mark badges with their color class, participant id, and tooltip', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [],
    };
    const html = renderStatementNodeHtml({
      wording: 'w',
      step,
      axiomMarks: [
        {
          participantId: 'p-1',
          colorClass: 'bg-sky-100 text-sky-900',
          tooltip: 'Axiom marked by p-1',
        },
      ],
    });
    expect(html).toContain('gv-node__footer');
    expect(html).toContain('gv-axiom bg-sky-100 text-sky-900');
    expect(html).toContain('data-participant-id="p-1"');
    expect(html).toContain('title="Axiom marked by p-1"');
  });

  it('(g) renders node-targeted annotation chips with kind label, kind attribute, and escaped content title', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [],
    };
    const html = renderStatementNodeHtml({
      wording: 'w',
      step,
      annotations: [{ kind: 'reframe', kindLabel: 'Reframe', content: 'a <tag> note' }],
    });
    expect(html).toContain('gv-anno');
    expect(html).toContain('data-annotation-kind="reframe"');
    expect(html).toContain('>Reframe<');
    expect(html).toContain('title="a &lt;tag&gt; note"');
  });

  it('(h) orders axiom marks before annotations in the footer', () => {
    const step: StatementStepModel = {
      kind: 'step',
      facet: 'wording',
      facetLabel: 'Wording',
      valueLabel: null,
      debaters: [],
    };
    const html = renderStatementNodeHtml({
      wording: 'w',
      step,
      axiomMarks: [{ participantId: 'p-1', colorClass: 'bg-sky-100', tooltip: 'mark' }],
      annotations: [{ kind: 'note', kindLabel: 'Note', content: 'n' }],
    });
    expect(html.indexOf('gv-axiom')).toBeLessThan(html.indexOf('gv-anno'));
  });
});
