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
  it('(a) returns wording for an empty status record (nothing settled yet)', () => {
    expect(selectStepFacet({})).toBe('wording');
  });

  it('(b) skips a committed wording to classification', () => {
    expect(selectStepFacet(statuses({ wording: 'committed' }))).toBe('classification');
  });

  it('(c) skips committed wording + classification to substance', () => {
    expect(selectStepFacet(statuses({ wording: 'committed', classification: 'committed' }))).toBe(
      'substance',
    );
  });

  it('(d) returns null when all three are committed (fully settled)', () => {
    expect(
      selectStepFacet(
        statuses({ wording: 'committed', classification: 'committed', substance: 'committed' }),
      ),
    ).toBeNull();
  });

  it('(e) treats open statuses (proposed/agreed/disputed) as the current step', () => {
    expect(selectStepFacet(statuses({ wording: 'agreed' }))).toBe('wording');
    expect(selectStepFacet(statuses({ wording: 'committed', classification: 'disputed' }))).toBe(
      'classification',
    );
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
