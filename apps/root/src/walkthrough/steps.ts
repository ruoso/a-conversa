// The visible-step model — the demo's scrubbing/playback unit.
//
// Not every event in the walkthrough log changes what a visitor SEES:
// session lifecycle, `entity-included` bookkeeping (43 events!), the
// snapshot, and structural proposals (whose visuals arrive via sibling
// `node-created` / `commit` events) all render nothing. Stepping through
// them one by one made the scrubber feel broken — press next, nothing
// happens. This module computes the ordered list of VISIBLE steps —
// positions where the rendered graph changes or a dialogue turn lands —
// and the controls walk step indices instead of raw positions.
//
// Refinement: tasks/refinements/landing_page/walkthrough_visible_steps.md
//
// Visibility is decided per event kind (and per arm where the kind is
// target-discriminated), mirroring what the renderer actually consumes:
//
//   - `node-created` / `edge-created` / `annotation-created` — topology.
//   - `commit` (both arms) — classification flips, wording swaps,
//     supersession, agreed→committed paint.
//   - `meta-disagreement-marked`, `withdraw-agreement`,
//     `proposal-withdrawn` — facet-status paint changes.
//   - `proposal` of the four facet-valued sub-kinds — the per-node pill's
//     in-flight candidate appears/changes. Structural sub-kinds
//     (decompose, interpretive-split, axiom-mark, meta-move, annotate,
//     capture-node, break-edge) are invisible at propose time.
//   - `vote` — the facet-keyed arm always (pill checkmarks); the
//     proposal-keyed arm only when the referenced proposal is
//     facet-valued (votes on structural proposals light nothing until
//     their commit).
//   - any position carrying a dialogue turn — the chat panel grows.
//
// The model accepts kind-level granularity: an edge-substance agree vote
// that doesn't yet flip the rollup paints nothing NEW, but it is an
// honest "something happened" beat the pill/edge color is building
// toward. What the model refuses is the 40-press dead zone.

import type { Event } from '@a-conversa/shared-types';

import { walkthroughEvents } from './index.js';
import { WALKTHROUGH_DIALOGUE } from './dialogue.js';

export type StepKind = 'graph' | 'speech' | 'both';

export interface VisibleStep {
  /** 1-based position into the event stream this step renders. */
  readonly position: number;
  /** What made the step visible — drives the autoplay dwell time. */
  readonly kind: StepKind;
}

/** The four proposal sub-kinds whose proposals (and proposal-keyed
 *  votes) change the rendered pill. Mirrors the shell's `targetOf` /
 *  votes-by-facet partition. */
const FACET_VALUED_PROPOSAL_KINDS = new Set([
  'classify-node',
  'set-node-substance',
  'set-edge-substance',
  'edit-wording',
]);

const VISIBLE_KINDS = new Set([
  'node-created',
  'edge-created',
  'annotation-created',
  'commit',
  'meta-disagreement-marked',
  'withdraw-agreement',
  'proposal-withdrawn',
]);

/**
 * Compute the ordered visible steps for an event stream + the set of
 * positions where dialogue turns land. Pure; exported for the suite —
 * consumers read the precomputed `WALKTHROUGH_STEPS`.
 */
export function computeVisibleSteps(
  events: readonly Event[],
  speechPositions: ReadonlySet<number>,
): readonly VisibleStep[] {
  const facetValuedProposalIds = new Set<string>();
  const steps: VisibleStep[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    const position = i + 1;
    let graphVisible = false;
    if (VISIBLE_KINDS.has(event.kind)) {
      graphVisible = true;
    } else if (event.kind === 'proposal') {
      if (FACET_VALUED_PROPOSAL_KINDS.has(event.payload.proposal.kind)) {
        facetValuedProposalIds.add(event.id);
        graphVisible = true;
      }
    } else if (event.kind === 'vote') {
      graphVisible =
        event.payload.target === 'facet' || facetValuedProposalIds.has(event.payload.proposal_id);
    }
    const speech = speechPositions.has(position);
    if (graphVisible && speech) {
      steps.push({ position, kind: 'both' });
    } else if (graphVisible) {
      steps.push({ position, kind: 'graph' });
    } else if (speech) {
      steps.push({ position, kind: 'speech' });
    }
  }
  return steps;
}

const SPEECH_POSITIONS: ReadonlySet<number> = new Set(
  WALKTHROUGH_DIALOGUE.map((turn) => turn.position),
);

/**
 * The walkthrough's visible steps, computed once at module load. Step
 * index 0 is reserved for the empty board (position 0); the table here
 * holds steps 1..N.
 */
export const WALKTHROUGH_STEPS: readonly VisibleStep[] = computeVisibleSteps(
  walkthroughEvents,
  SPEECH_POSITIONS,
);

/**
 * The LAST step index whose position ≤ `position` (0 when `position` is
 * below the first step — the empty-board step). Lets consumers map a raw
 * position (a beat anchor, a seam value) back into step space.
 */
export function stepIndexForPosition(position: number): number {
  let index = 0;
  for (let i = 0; i < WALKTHROUGH_STEPS.length; i += 1) {
    if (WALKTHROUGH_STEPS[i]!.position <= position) {
      index = i + 1;
    } else {
      break;
    }
  }
  return index;
}

/** The position a 1-based step index renders (step 0 → empty board). */
export function positionForStepIndex(stepIndex: number): number {
  if (stepIndex <= 0) return 0;
  const step = WALKTHROUGH_STEPS[Math.min(stepIndex, WALKTHROUGH_STEPS.length) - 1];
  return step?.position ?? 0;
}

/** The step at a 1-based index, if any (step 0 — the empty board — has
 *  no entry). */
export function stepAt(stepIndex: number): VisibleStep | undefined {
  return stepIndex >= 1 ? WALKTHROUGH_STEPS[stepIndex - 1] : undefined;
}
