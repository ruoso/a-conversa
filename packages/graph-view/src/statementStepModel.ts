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

/** The methodology's capture flow (wording → classification → substance)
 *  in deepest-first order — `selectStepFacet` scans this to find the
 *  deepest facet that has opened. */
const DEEPEST_FIRST: readonly FacetName[] = ['substance', 'classification', 'wording'];

/**
 * Whether a facet has been STARTED — i.e. a candidate value has been
 * proposed on it. `'awaiting-proposal'` (and an absent status) mean the
 * facet has not opened yet. The wording facet carries its candidate
 * inline from node creation, so it is started from birth.
 */
function isStarted(status: FacetStatus | undefined): boolean {
  return status !== undefined && status !== 'awaiting-proposal';
}

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
 * The current step facet — the DEEPEST facet (substance → classification
 * → wording) that has been started. Returns `null` only when the node is
 * fully settled: classification AND substance both committed (→ the
 * compact summary, which shows those two decided values).
 *
 * Why deepest-started and NOT first-not-committed: the wording facet is
 * never "committed" in the methodology — a node always carries a *proposed*
 * wording (its status sits at `'proposed'`/`'agreed'`/`'disputed'`, never
 * `'committed'`). A first-not-committed scan would therefore stay pinned on
 * wording forever, even as classification and substance progress. The step
 * instead advances as each deeper facet OPENS: wording until a
 * classification candidate is proposed, classification until a substance
 * candidate is proposed, substance until both decided facets commit.
 */
export function selectStepFacet(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): FacetName | null {
  if (facetStatuses.classification === 'committed' && facetStatuses.substance === 'committed') {
    return null;
  }
  for (const facet of DEEPEST_FIRST) {
    if (isStarted(facetStatuses[facet])) return facet;
  }
  // No facet has opened yet (an empty status record): the node is at the
  // wording step by default.
  return 'wording';
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
