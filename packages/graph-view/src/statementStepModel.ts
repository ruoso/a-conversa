// Pure view-model for the per-node "step" pill (`per_facet_step_pill`).
//
// Given a statement node's facet statuses + candidate values + per-facet
// votes + debater roster (all stamped on `AudienceNodeData` by
// `projectGraph`) plus a label resolver, computes WHAT the pill should
// show: the current facet step (with its candidate value and a mark per
// debater), or — once every facet is committed — a compact settled
// summary. Pure given its inputs (the `labels` resolver is injected), so
// the Vitest layer pins it without i18n or Cytoscape.

import type { FacetName, FacetStatus, Vote } from '@a-conversa/shell';

import type { StepDebater } from './projectGraph.js';

/** Canonical facet order — the methodology's sequential capture flow. */
const STEP_ORDER: readonly FacetName[] = ['wording', 'classification', 'substance'];

/**
 * Statuses that mean a facet is CLOSED (no longer the live step). The
 * current step is the first facet that is NOT one of these (an unset /
 * `proposed` / `agreed` / `disputed` facet is still open).
 */
const CLOSED_STATUSES: ReadonlySet<FacetStatus> = new Set<FacetStatus>([
  'committed',
  'withdrawn',
  'meta-disagreement',
]);

export type VoteMark = 'none' | 'agree' | 'dispute';

export interface StepDebaterMark {
  readonly name: string;
  readonly mark: VoteMark;
}

/**
 * The pill view-model: either the live STEP (current facet + candidate +
 * per-debater marks) or the SETTLED summary (the two decided values).
 */
export type StatementStepModel =
  | {
      readonly kind: 'step';
      readonly facet: FacetName;
      /** Localized facet label, e.g. "Classification". */
      readonly facetLabel: string;
      /** Localized candidate value (e.g. "Fact" / "Holds"), or `null`
       *  when there's no candidate yet or the facet is `wording`. */
      readonly valueLabel: string | null;
      readonly debaters: readonly StepDebaterMark[];
    }
  | {
      readonly kind: 'settled';
      /** Localized committed classification value, or `null`. */
      readonly classificationLabel: string | null;
      /** Localized committed substance value, or `null`. */
      readonly substanceLabel: string | null;
    };

/** The subset of `AudienceNodeData` the model reads. */
export interface StatementStepData {
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
  readonly facetCandidates?: Readonly<Partial<Record<FacetName, string>>>;
  readonly facetVotes?: Readonly<Partial<Record<FacetName, readonly Vote[]>>>;
  readonly debaters?: readonly StepDebater[];
}

/** Label resolvers (wrap `t(...)` at the call site). */
export interface StepLabels {
  readonly facet: (facet: FacetName) => string;
  readonly classification: (kind: string) => string;
  readonly substance: (value: string) => string;
}

/**
 * The current step facet — the first in `wording → classification →
 * substance` whose status is not closed. Returns `null` when all three
 * are settled (→ the compact summary).
 */
export function selectStepFacet(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): FacetName | null {
  for (const facet of STEP_ORDER) {
    const status = facetStatuses[facet];
    if (status === undefined || !CLOSED_STATUSES.has(status)) return facet;
  }
  return null;
}

export function buildStatementStepModel(
  data: StatementStepData,
  labels: StepLabels,
): StatementStepModel {
  const candidates = data.facetCandidates ?? {};
  const step = selectStepFacet(data.facetStatuses);

  if (step === null) {
    const classification = candidates.classification;
    const substance = candidates.substance;
    return {
      kind: 'settled',
      classificationLabel:
        classification !== undefined ? labels.classification(classification) : null,
      substanceLabel: substance !== undefined ? labels.substance(substance) : null,
    };
  }

  const candidate = candidates[step];
  const valueLabel =
    candidate === undefined
      ? null
      : step === 'classification'
        ? labels.classification(candidate)
        : step === 'substance'
          ? labels.substance(candidate)
          : null; // wording carries no separate value (the node body is the text)

  const choiceByParticipant = new Map<string, 'agree' | 'dispute'>();
  for (const vote of data.facetVotes?.[step] ?? []) {
    choiceByParticipant.set(vote.participantId, vote.choice);
  }
  const debaters: readonly StepDebaterMark[] = (data.debaters ?? []).map((debater) => ({
    name: debater.screenName,
    mark: choiceByParticipant.get(debater.participantId) ?? 'none',
  }));

  return { kind: 'step', facet: step, facetLabel: labels.facet(step), valueLabel, debaters };
}
