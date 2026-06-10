// Pins the visible-step model (ADR 0022 — durable, committed test
// artifact): the per-kind/per-arm visibility predicate, the speech
// promotion, the index mapping helpers, and — the honesty guarantee —
// that every SKIPPED position leaves the projected graph deep-equal to
// its predecessor (the scrubber never skips over a change).
//
// Refinement: tasks/refinements/landing_page/walkthrough_visible_steps.md

import { describe, expect, it } from 'vitest';

import { projectGraph } from '@a-conversa/graph-view';

import { walkthroughEvents } from './index';
import { WALKTHROUGH_DIALOGUE } from './dialogue';
import {
  WALKTHROUGH_STEPS,
  computeVisibleSteps,
  positionForStepIndex,
  stepAt,
  stepIndexForPosition,
} from './steps';

const SPEECH_POSITIONS = new Set(WALKTHROUGH_DIALOGUE.map((turn) => turn.position));
const STEP_POSITIONS = new Set(WALKTHROUGH_STEPS.map((step) => step.position));
const kindAt = (position: number): string => walkthroughEvents[position - 1]!.kind;

describe('WALKTHROUGH_STEPS — the visibility predicate', () => {
  it('is strictly increasing and bounded by the stream', () => {
    expect(WALKTHROUGH_STEPS.length).toBeGreaterThan(0);
    for (let i = 0; i < WALKTHROUGH_STEPS.length; i += 1) {
      const step = WALKTHROUGH_STEPS[i]!;
      expect(step.position).toBeGreaterThanOrEqual(1);
      expect(step.position).toBeLessThanOrEqual(walkthroughEvents.length);
      if (i > 0) {
        expect(step.position).toBeGreaterThan(WALKTHROUGH_STEPS[i - 1]!.position);
      }
    }
  });

  it('skips the bookkeeping kinds (unless a dialogue turn lands there)', () => {
    for (let position = 1; position <= walkthroughEvents.length; position += 1) {
      const kind = kindAt(position);
      if (
        ['entity-included', 'snapshot-created', 'participant-joined'].includes(kind) &&
        !SPEECH_POSITIONS.has(position)
      ) {
        expect(STEP_POSITIONS.has(position)).toBe(false);
      }
    }
  });

  it('includes every topology / commit / facet-state event', () => {
    for (let position = 1; position <= walkthroughEvents.length; position += 1) {
      const kind = kindAt(position);
      if (
        [
          'node-created',
          'edge-created',
          'annotation-created',
          'commit',
          'meta-disagreement-marked',
          'withdraw-agreement',
          'proposal-withdrawn',
        ].includes(kind)
      ) {
        expect(STEP_POSITIONS.has(position)).toBe(true);
      }
    }
  });

  it('promotes dialogue positions to steps and stamps the speech kind', () => {
    for (const turn of WALKTHROUGH_DIALOGUE) {
      const step = WALKTHROUGH_STEPS.find((s) => s.position === turn.position);
      expect(step).toBeDefined();
      expect(['speech', 'both']).toContain(step!.kind);
    }
  });

  it('distinguishes facet-valued from structural proposal-keyed votes', () => {
    // The fixture's structural proposals (decompose, axiom-mark, …) keep
    // proposal-keyed votes; those votes light nothing and are skipped.
    // Facet-keyed votes always render (pill checkmarks).
    const facetValued = new Set(
      walkthroughEvents
        .filter(
          (event) =>
            event.kind === 'proposal' &&
            ['classify-node', 'set-node-substance', 'set-edge-substance', 'edit-wording'].includes(
              event.payload.proposal.kind,
            ),
        )
        .map((event) => event.id),
    );
    for (let position = 1; position <= walkthroughEvents.length; position += 1) {
      const event = walkthroughEvents[position - 1]!;
      if (event.kind !== 'vote' || SPEECH_POSITIONS.has(position)) continue;
      const expected =
        event.payload.target === 'facet' || facetValued.has(event.payload.proposal_id);
      expect(STEP_POSITIONS.has(position)).toBe(expected);
    }
  });

  it('HONESTY: every skipped position leaves the projected graph unchanged', () => {
    // The whole point of the model — the scrubber may pass over an event
    // only if rendering it would paint nothing new. Walk the entire
    // stream; for every skipped position, projecting the prefix through
    // the real renderer projection must equal the predecessor's.
    let previous = projectGraph([]);
    for (let position = 1; position <= walkthroughEvents.length; position += 1) {
      const current = projectGraph(walkthroughEvents.slice(0, position));
      if (!STEP_POSITIONS.has(position)) {
        expect(current).toEqual(previous);
      }
      previous = current;
    }
  });
});

describe('step-index mapping helpers', () => {
  it('round-trips step indices through positions', () => {
    expect(positionForStepIndex(0)).toBe(0);
    expect(stepIndexForPosition(0)).toBe(0);
    for (let index = 1; index <= WALKTHROUGH_STEPS.length; index += 1) {
      expect(stepIndexForPosition(positionForStepIndex(index))).toBe(index);
      expect(stepAt(index)).toBe(WALKTHROUGH_STEPS[index - 1]);
    }
  });

  it('maps a between-steps position to the last step at or before it', () => {
    const second = WALKTHROUGH_STEPS[1]!;
    expect(stepIndexForPosition(second.position)).toBe(2);
    expect(stepIndexForPosition(second.position - 1)).toBeLessThanOrEqual(1);
  });

  it('computeVisibleSteps is pure over its inputs', () => {
    const recomputed = computeVisibleSteps(
      walkthroughEvents,
      new Set(WALKTHROUGH_DIALOGUE.map((turn) => turn.position)),
    );
    expect(recomputed).toEqual(WALKTHROUGH_STEPS);
  });
});
