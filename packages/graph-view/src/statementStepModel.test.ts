// Vitest for the pure step-pill view-model (`per_facet_step_pill`).
// ADR 0022 — committed pins, not throwaway probes.

import { describe, expect, it } from 'vitest';
import type { FacetName, FacetStatus, Vote } from '@a-conversa/shell';

import {
  buildStatementStepModel,
  selectStepFacet,
  type StatementStepData,
  type StepLabels,
} from './statementStepModel';

const LABELS: StepLabels = {
  facet: (f) => `F:${f}`,
  classification: (k) => `K:${k}`,
  substance: (v) => `S:${v}`,
};

const ALICE = 'p-alice';
const BEN = 'p-ben';
const ROSTER = [
  { role: 'debater-A', participantId: ALICE, screenName: 'Alice' },
  { role: 'debater-B', participantId: BEN, screenName: 'Ben' },
] as const;

function statuses(
  s: Partial<Record<FacetName, FacetStatus>>,
): Partial<Record<FacetName, FacetStatus>> {
  return s;
}

describe('selectStepFacet', () => {
  it('(a) returns wording for an empty status record (nothing opened yet)', () => {
    expect(selectStepFacet({})).toBe('wording');
  });

  it('(b) advances to classification once a classification candidate has opened', () => {
    // The realistic shape: wording stays 'proposed' (a node always carries
    // a proposed wording, never 'committed'); classification opens. The
    // step must advance even though wording is not committed.
    expect(selectStepFacet(statuses({ wording: 'proposed', classification: 'proposed' }))).toBe(
      'classification',
    );
  });

  it('(c) advances to substance once a substance candidate has opened', () => {
    expect(
      selectStepFacet(
        statuses({ wording: 'proposed', classification: 'committed', substance: 'proposed' }),
      ),
    ).toBe('substance');
  });

  it('(d) returns null when classification AND substance are committed (fully settled)', () => {
    expect(
      selectStepFacet(
        statuses({ wording: 'proposed', classification: 'committed', substance: 'committed' }),
      ),
    ).toBeNull();
  });

  it('(e) treats an awaiting-proposal facet as not-yet-opened (does NOT advance)', () => {
    // Regression for the "stuck on Wording" bug: an un-opened deeper facet
    // must NOT pull the step forward — only a started one does.
    expect(
      selectStepFacet(
        statuses({
          wording: 'proposed',
          classification: 'awaiting-proposal',
          substance: 'awaiting-proposal',
        }),
      ),
    ).toBe('wording');
    expect(
      selectStepFacet(
        statuses({
          wording: 'proposed',
          classification: 'committed',
          substance: 'awaiting-proposal',
        }),
      ),
    ).toBe('classification');
  });

  it('(f) treats open statuses (agreed/disputed) on a deeper facet as the current step', () => {
    expect(selectStepFacet(statuses({ wording: 'proposed', classification: 'disputed' }))).toBe(
      'classification',
    );
    expect(selectStepFacet(statuses({ wording: 'agreed' }))).toBe('wording');
  });
});

describe('buildStatementStepModel', () => {
  it('(f) wording step shows the facet label and NO value (the wording is the body)', () => {
    const data: StatementStepData = { facetStatuses: {}, debaters: ROSTER };
    const model = buildStatementStepModel(data, LABELS);
    expect(model.kind).toBe('step');
    if (model.kind !== 'step') throw new Error('expected step');
    expect(model.facet).toBe('wording');
    expect(model.facetLabel).toBe('F:wording');
    expect(model.valueLabel).toBeNull();
  });

  it('(g) classification step shows the candidate kind label + per-debater marks', () => {
    const votes: readonly Vote[] = [
      { participantId: ALICE, choice: 'agree' },
      { participantId: BEN, choice: 'dispute' },
    ];
    const data: StatementStepData = {
      facetStatuses: statuses({ wording: 'committed', classification: 'proposed' }),
      facetCandidates: { classification: 'fact' },
      facetVotes: { classification: votes },
      debaters: ROSTER,
    };
    const model = buildStatementStepModel(data, LABELS);
    if (model.kind !== 'step') throw new Error('expected step');
    expect(model.facet).toBe('classification');
    expect(model.valueLabel).toBe('K:fact');
    expect(model.debaters).toEqual([
      { name: 'Alice', mark: 'agree' },
      { name: 'Ben', mark: 'dispute' },
    ]);
  });

  it('(h) a debater with no vote on the current facet gets mark "none"', () => {
    const data: StatementStepData = {
      facetStatuses: statuses({ wording: 'committed', classification: 'proposed' }),
      facetCandidates: { classification: 'value' },
      facetVotes: { classification: [{ participantId: ALICE, choice: 'agree' }] },
      debaters: ROSTER,
    };
    const model = buildStatementStepModel(data, LABELS);
    if (model.kind !== 'step') throw new Error('expected step');
    expect(model.debaters).toEqual([
      { name: 'Alice', mark: 'agree' },
      { name: 'Ben', mark: 'none' },
    ]);
  });

  it('(i) substance step resolves the candidate through the substance label', () => {
    const data: StatementStepData = {
      facetStatuses: statuses({
        wording: 'committed',
        classification: 'committed',
        substance: 'proposed',
      }),
      facetCandidates: { classification: 'fact', substance: 'agreed' },
      debaters: ROSTER,
    };
    const model = buildStatementStepModel(data, LABELS);
    if (model.kind !== 'step') throw new Error('expected step');
    expect(model.facet).toBe('substance');
    expect(model.valueLabel).toBe('S:agreed');
  });

  it('(j) all-committed yields the settled summary with both decided values', () => {
    const data: StatementStepData = {
      facetStatuses: statuses({
        wording: 'committed',
        classification: 'committed',
        substance: 'committed',
      }),
      facetCandidates: { classification: 'fact', substance: 'agreed' },
      debaters: ROSTER,
    };
    const model = buildStatementStepModel(data, LABELS);
    if (model.kind !== 'settled') throw new Error('expected settled');
    expect(model.classificationLabel).toBe('K:fact');
    expect(model.substanceLabel).toBe('S:agreed');
  });
});
