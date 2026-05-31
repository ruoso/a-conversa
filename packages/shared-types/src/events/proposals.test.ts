// Tests for the proposal payload schemas.
//
// Refinement: tasks/refinements/data-and-methodology/proposal_events.md
//
// One happy-path round-trip per sub-kind plus the negative cases
// listed in the task spec. The full envelope is exercised separately
// in `events.test.ts`; here we focus on the proposal payload shape.

import { describe, expect, it } from 'vitest';

import {
  EventValidationError,
  proposalEnvelopePayloadSchema,
  proposalPayloadSchema,
  validateEvent,
} from '../events.js';

// Valid sample UUIDs (v4: version-nibble = 4, variant-nibble in [89ab]).
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const NODE_ID = '88888888-8888-4888-8888-888888888888';
const NODE_ID_2 = '99999999-9999-4999-8999-999999999999';
const EDGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARTICIPANT_ID = '66666666-6666-4666-8666-666666666666';

// Roundtrip helper: parse → JSON → parse → equal.
function roundTrip(payload: unknown): unknown {
  const parsed = proposalPayloadSchema.parse(payload);
  const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
  return proposalPayloadSchema.parse(wire);
}

describe('proposal payload — classify-node', () => {
  const valid = {
    kind: 'classify-node' as const,
    node_id: NODE_ID,
    classification: 'fact' as const,
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('accepts each of the five StatementKind values', () => {
    for (const classification of [
      'fact',
      'predictive',
      'value',
      'normative',
      'definitional',
    ] as const) {
      const result = proposalPayloadSchema.safeParse({ ...valid, classification });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown classification ('opinion')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, classification: 'opinion' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID node_id', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, node_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — set-node-substance', () => {
  const valid = {
    kind: 'set-node-substance' as const,
    node_id: NODE_ID,
    value: 'agreed' as const,
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('accepts both agreed and disputed', () => {
    for (const value of ['agreed', 'disputed'] as const) {
      const result = proposalPayloadSchema.safeParse({ ...valid, value });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown value ('pending')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, value: 'pending' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — set-edge-substance', () => {
  const valid = {
    kind: 'set-edge-substance' as const,
    edge_id: EDGE_ID,
    value: 'disputed' as const,
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it("rejects an unknown value ('agreed-with-caveat')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, value: 'agreed-with-caveat' });
    expect(result.success).toBe(false);
  });

  // Per `mod_set_edge_substance_endpoint_carriage` the schema gains
  // three optional endpoint fields used by the connecting-edge case.
  // The substance-only re-vote shape (no endpoints) stays valid; the
  // connecting case round-trips with all three present; malformed
  // values on the new fields are rejected.
  describe('endpoint carriage (mod_set_edge_substance_endpoint_carriage)', () => {
    const connecting = {
      ...valid,
      source_node_id: NODE_ID,
      target_node_id: NODE_ID_2,
      role: 'supports' as const,
    };

    it('round-trips the connecting shape with source_node_id + target_node_id + role', () => {
      expect(roundTrip(connecting)).toEqual(connecting);
    });

    it('accepts the substance-only shape (no endpoint fields) for the defeater-precommit / re-vote case', () => {
      const result = proposalPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('rejects a non-UUID source_node_id', () => {
      const result = proposalPayloadSchema.safeParse({
        ...connecting,
        source_node_id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-UUID target_node_id', () => {
      const result = proposalPayloadSchema.safeParse({
        ...connecting,
        target_node_id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it("rejects an invalid role ('invalid-role')", () => {
      const result = proposalPayloadSchema.safeParse({ ...connecting, role: 'invalid-role' });
      expect(result.success).toBe(false);
    });

    it('accepts each of the seven EdgeRole values', () => {
      for (const role of [
        'supports',
        'rebuts',
        'qualifies',
        'bridges-from',
        'bridges-to',
        'defines',
        'contradicts',
      ] as const) {
        const result = proposalPayloadSchema.safeParse({ ...connecting, role });
        expect(result.success).toBe(true);
      }
    });
  });

  // Per `set_edge_substance_annotation_endpoint` the schema gains two
  // more optional endpoint fields (`source_annotation_id`,
  // `target_annotation_id`) plus per-endpoint `.refine()` at-most-one
  // checks. The connecting shape may pair any node-or-annotation
  // source with any node-or-annotation target; the substance-only
  // re-vote shape stays valid (zero endpoint fields).
  describe('polymorphic endpoints (set_edge_substance_annotation_endpoint)', () => {
    const ANNOTATION_ID_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee01ee';
    const ANNOTATION_ID_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee02ee';

    it('round-trips node→annotation connecting case', () => {
      const payload = {
        ...valid,
        source_node_id: NODE_ID,
        target_annotation_id: ANNOTATION_ID_A,
        role: 'contradicts' as const,
      };
      expect(roundTrip(payload)).toEqual(payload);
    });

    it('round-trips annotation→node connecting case', () => {
      const payload = {
        ...valid,
        source_annotation_id: ANNOTATION_ID_A,
        target_node_id: NODE_ID,
        role: 'contradicts' as const,
      };
      expect(roundTrip(payload)).toEqual(payload);
    });

    it('round-trips annotation→annotation connecting case', () => {
      const payload = {
        ...valid,
        source_annotation_id: ANNOTATION_ID_A,
        target_annotation_id: ANNOTATION_ID_B,
        role: 'contradicts' as const,
      };
      expect(roundTrip(payload)).toEqual(payload);
    });

    it('rejects when both source_node_id and source_annotation_id are set', () => {
      const result = proposalPayloadSchema.safeParse({
        ...valid,
        source_node_id: NODE_ID,
        source_annotation_id: ANNOTATION_ID_A,
        target_node_id: NODE_ID_2,
        role: 'supports' as const,
      });
      expect(result.success).toBe(false);
    });

    it('rejects when both target_node_id and target_annotation_id are set', () => {
      const result = proposalPayloadSchema.safeParse({
        ...valid,
        source_node_id: NODE_ID,
        target_node_id: NODE_ID_2,
        target_annotation_id: ANNOTATION_ID_A,
        role: 'supports' as const,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-UUID source_annotation_id', () => {
      const result = proposalPayloadSchema.safeParse({
        ...valid,
        source_annotation_id: 'not-a-uuid',
        target_node_id: NODE_ID_2,
        role: 'supports' as const,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-UUID target_annotation_id', () => {
      const result = proposalPayloadSchema.safeParse({
        ...valid,
        source_node_id: NODE_ID,
        target_annotation_id: 'not-a-uuid',
        role: 'supports' as const,
      });
      expect(result.success).toBe(false);
    });

    it('continues to accept the zero-endpoint substance-only shape', () => {
      const result = proposalPayloadSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});

describe('proposal payload — edit-wording (reword)', () => {
  const valid = {
    kind: 'edit-wording' as const,
    edit_kind: 'reword' as const,
    node_id: NODE_ID,
    new_wording: 'Refined wording.',
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects a missing new_wording', () => {
    const { new_wording: _omit, ...rest } = valid;
    const result = proposalPayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an empty new_wording', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, new_wording: '' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — edit-wording (restructure)', () => {
  const valid = {
    kind: 'edit-wording' as const,
    edit_kind: 'restructure' as const,
    node_id: NODE_ID,
    new_wording: 'Restructured wording.',
    new_node_id: NODE_ID_2,
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects a missing new_node_id', () => {
    const { new_node_id: _omit, ...rest } = valid;
    const result = proposalPayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID new_node_id', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, new_node_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it("rejects a bogus edit_kind ('rephrase')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, edit_kind: 'rephrase' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — decompose', () => {
  const COMPONENT_ID_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccca1';
  const COMPONENT_ID_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccca2';
  const validComponent = {
    wording: 'Sub-claim A.',
    classification: 'fact' as const,
    node_id: COMPONENT_ID_A,
  };
  const valid = {
    kind: 'decompose' as const,
    parent_node_id: NODE_ID,
    components: [
      validComponent,
      { wording: 'Sub-claim B.', classification: 'value' as const, node_id: COMPONENT_ID_B },
    ],
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects a single-component decomposition (min 2)', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, components: [validComponent] });
    expect(result.success).toBe(false);
  });

  it('rejects an 11-component decomposition (max 10)', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      wording: `Sub-claim ${String(i)}.`,
      classification: 'fact' as const,
      node_id: `cccccccc-cccc-4ccc-8ccc-cccccccccc${i.toString(16).padStart(2, '0')}`,
    }));
    const result = proposalPayloadSchema.safeParse({ ...valid, components: eleven });
    expect(result.success).toBe(false);
  });

  it('rejects a component with empty wording', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      components: [
        { wording: '', classification: 'fact' as const, node_id: COMPONENT_ID_A },
        { wording: 'Ok.', classification: 'fact' as const, node_id: COMPONENT_ID_B },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a component with bogus classification ('opinion')", () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      components: [
        { wording: 'Ok.', classification: 'opinion', node_id: COMPONENT_ID_A },
        { wording: 'Also ok.', classification: 'fact' as const, node_id: COMPONENT_ID_B },
      ],
    });
    expect(result.success).toBe(false);
  });

  // Per `mod_decompose_propose_time_canvas_visibility` D1: `node_id`
  // is a REQUIRED field on each `proposalComponentSchema` element.
  // The three cases below pin (a) the required-ness (missing field
  // is rejected), (b) the UUID-shape validation (non-UUID string is
  // rejected), and (c) the round-trip of the new field.
  it('rejects a component missing the required node_id field', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      components: [
        { wording: 'Has id.', classification: 'fact' as const, node_id: COMPONENT_ID_A },
        // Intentionally missing node_id on second component.
        { wording: 'Missing id.', classification: 'fact' as const },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a component whose node_id is not a UUID', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      components: [
        { wording: 'Bad id.', classification: 'fact' as const, node_id: 'not-a-uuid' },
        { wording: 'Has id.', classification: 'fact' as const, node_id: COMPONENT_ID_B },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('preserves each component node_id through a JSON round-trip', () => {
    const parsed = roundTrip(valid) as { components: Array<{ node_id: string }> };
    expect(parsed.components[0]!.node_id).toBe(COMPONENT_ID_A);
    expect(parsed.components[1]!.node_id).toBe(COMPONENT_ID_B);
  });
});

describe('proposal payload — interpretive-split', () => {
  const READING_ID_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccdb1';
  const READING_ID_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccdb2';
  const validReading = {
    wording: 'Reading A.',
    classification: 'definitional' as const,
    node_id: READING_ID_A,
  };
  const valid = {
    kind: 'interpretive-split' as const,
    parent_node_id: NODE_ID,
    readings: [
      validReading,
      { wording: 'Reading B.', classification: 'value' as const, node_id: READING_ID_B },
    ],
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects a single-reading split (min 2)', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, readings: [validReading] });
    expect(result.success).toBe(false);
  });

  it('rejects an 11-reading split (max 10)', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      wording: `Reading ${String(i)}.`,
      classification: 'value' as const,
      node_id: `cccccccc-cccc-4ccc-8ccc-cccccccccdb${i.toString(16).padStart(2, '0')}`,
    }));
    const result = proposalPayloadSchema.safeParse({ ...valid, readings: eleven });
    expect(result.success).toBe(false);
  });

  // Per `mod_decompose_propose_time_canvas_visibility` D1: `node_id`
  // is REQUIRED on each `proposalComponentSchema` element. Symmetric
  // round-trip + required + UUID-shape cases for the readings array.
  it('rejects a reading missing the required node_id field', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      readings: [
        { wording: 'Has id.', classification: 'fact' as const, node_id: READING_ID_A },
        // Intentionally missing node_id on second reading.
        { wording: 'Missing id.', classification: 'fact' as const },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a reading whose node_id is not a UUID', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      readings: [
        { wording: 'Bad id.', classification: 'fact' as const, node_id: 'not-a-uuid' },
        { wording: 'Has id.', classification: 'fact' as const, node_id: READING_ID_B },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('preserves each reading node_id through a JSON round-trip', () => {
    const parsed = roundTrip(valid) as { readings: Array<{ node_id: string }> };
    expect(parsed.readings[0]!.node_id).toBe(READING_ID_A);
    expect(parsed.readings[1]!.node_id).toBe(READING_ID_B);
  });
});

describe('proposal payload — axiom-mark', () => {
  const valid = {
    kind: 'axiom-mark' as const,
    node_id: NODE_ID,
    participant: PARTICIPANT_ID,
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects a non-UUID participant', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, participant: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — meta-move', () => {
  const valid = {
    kind: 'meta-move' as const,
    meta_kind: 'reframe' as const,
    content: 'Re-frame the question as a value disagreement.',
    target_kind: 'node' as const,
    target_id: NODE_ID,
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('accepts each of reframe / scope-change / stance', () => {
    for (const meta_kind of ['reframe', 'scope-change', 'stance'] as const) {
      const result = proposalPayloadSchema.safeParse({ ...valid, meta_kind });
      expect(result.success).toBe(true);
    }
  });

  it('accepts an edge target', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      target_kind: 'edge' as const,
      target_id: EDGE_ID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing target_id (R28: target required in v1)', () => {
    const { target_id: _omit, ...rest } = valid;
    const result = proposalPayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a missing target_kind (R28: target required in v1)', () => {
    const { target_kind: _omit, ...rest } = valid;
    const result = proposalPayloadSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a bogus meta_kind ('reword')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, meta_kind: 'reword' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty content', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, content: '' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — break-edge', () => {
  const valid = { kind: 'break-edge' as const, edge_id: EDGE_ID };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects a non-UUID edge_id', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, edge_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — amend-node', () => {
  const valid = {
    kind: 'amend-node' as const,
    node_id: NODE_ID,
    new_content: 'Amended content.',
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('rejects an empty new_content', () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, new_content: '' });
    expect(result.success).toBe(false);
  });
});

describe('proposal payload — annotate', () => {
  const valid = {
    kind: 'annotate' as const,
    target_kind: 'node' as const,
    target_id: NODE_ID,
    annotation_kind: 'note' as const,
    content: 'Worth flagging.',
  };

  it('round-trips a well-formed payload through JSON', () => {
    expect(roundTrip(valid)).toEqual(valid);
  });

  it('accepts each of the four annotation_kind values', () => {
    for (const annotation_kind of ['note', 'reframe', 'scope-change', 'stance'] as const) {
      const result = proposalPayloadSchema.safeParse({ ...valid, annotation_kind });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a bogus annotation_kind ('rebuttal')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, annotation_kind: 'rebuttal' });
    expect(result.success).toBe(false);
  });

  it('accepts an edge target', () => {
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      target_kind: 'edge' as const,
      target_id: EDGE_ID,
    });
    expect(result.success).toBe(true);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
  // (Decision §1 — wire widening so the menu's items are real, not stubs).
  it('accepts an annotation target', () => {
    const ANNOTATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa01ee';
    const result = proposalPayloadSchema.safeParse({
      ...valid,
      target_kind: 'annotation' as const,
      target_id: ANNOTATION_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bogus target_kind ('proposal')", () => {
    const result = proposalPayloadSchema.safeParse({ ...valid, target_kind: 'proposal' });
    expect(result.success).toBe(false);
  });
});

// Per `set_edge_substance_annotation_endpoint` the
// `captureNodeEdgeShapeSchema` widens to four polymorphic endpoint
// fields with per-endpoint EXACTLY-ONE refines (capture-with-edge
// always carries fully-specified endpoints; no substance-only shape).
describe('proposal payload — capture-node (capture-with-edge polymorphic endpoints)', () => {
  const ANNOTATION_ID_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee01ee';
  const ANNOTATION_ID_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee02ee';

  const baseValid = {
    kind: 'capture-node' as const,
    node_id: NODE_ID,
    wording: 'A fresh node.',
  };

  it('round-trips wording-only capture (no edge block)', () => {
    expect(roundTrip(baseValid)).toEqual(baseValid);
  });

  it('round-trips node→node capture-with-edge', () => {
    const payload = {
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_node_id: NODE_ID,
        target_node_id: NODE_ID_2,
      },
    };
    expect(roundTrip(payload)).toEqual(payload);
  });

  it('round-trips node→annotation capture-with-edge', () => {
    const payload = {
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'contradicts' as const,
        source_node_id: NODE_ID,
        target_annotation_id: ANNOTATION_ID_A,
      },
    };
    expect(roundTrip(payload)).toEqual(payload);
  });

  it('round-trips annotation→node capture-with-edge', () => {
    const payload = {
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_annotation_id: ANNOTATION_ID_A,
        target_node_id: NODE_ID_2,
      },
    };
    expect(roundTrip(payload)).toEqual(payload);
  });

  it('round-trips annotation→annotation capture-with-edge', () => {
    const payload = {
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'contradicts' as const,
        source_annotation_id: ANNOTATION_ID_A,
        target_annotation_id: ANNOTATION_ID_B,
      },
    };
    expect(roundTrip(payload)).toEqual(payload);
  });

  it('rejects when both source_node_id and source_annotation_id are set', () => {
    const result = proposalPayloadSchema.safeParse({
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_node_id: NODE_ID,
        source_annotation_id: ANNOTATION_ID_A,
        target_node_id: NODE_ID_2,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when both target_node_id and target_annotation_id are set', () => {
    const result = proposalPayloadSchema.safeParse({
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_node_id: NODE_ID,
        target_node_id: NODE_ID_2,
        target_annotation_id: ANNOTATION_ID_A,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when neither source-side slot is set (exactly-one required)', () => {
    const result = proposalPayloadSchema.safeParse({
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        target_node_id: NODE_ID_2,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when neither target-side slot is set (exactly-one required)', () => {
    const result = proposalPayloadSchema.safeParse({
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_node_id: NODE_ID,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID source_annotation_id', () => {
    const result = proposalPayloadSchema.safeParse({
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_annotation_id: 'not-a-uuid',
        target_node_id: NODE_ID_2,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID target_annotation_id', () => {
    const result = proposalPayloadSchema.safeParse({
      ...baseValid,
      edge: {
        edge_id: EDGE_ID,
        role: 'supports' as const,
        source_node_id: NODE_ID,
        target_annotation_id: 'not-a-uuid',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('proposal envelope — wired into validateEvent', () => {
  it('round-trips a proposal envelope end-to-end', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 7,
      kind: 'proposal' as const,
      actor: ACTOR_ID,
      payload: {
        proposal: {
          kind: 'classify-node' as const,
          node_id: NODE_ID,
          classification: 'normative' as const,
        },
      },
      createdAt: '2026-05-10T12:34:56Z',
    };
    const wire = JSON.parse(JSON.stringify(envelope)) as unknown;
    const validated = validateEvent(wire);
    expect(validated).toEqual(envelope);
  });

  it("rejects an envelope whose payload omits the 'proposal' nesting key", () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 8,
      kind: 'proposal' as const,
      actor: ACTOR_ID,
      payload: { kind: 'classify-node', node_id: NODE_ID, classification: 'fact' },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'proposal'");
  });

  it('rejects an unknown top-level proposal kind via validateEvent', () => {
    const envelope = {
      id: EVENT_ID,
      sessionId: SESSION_ID,
      sequence: 9,
      kind: 'proposal' as const,
      actor: ACTOR_ID,
      payload: {
        proposal: {
          kind: 'invent-node',
          node_id: NODE_ID,
        },
      },
      createdAt: '2026-05-10T12:34:56Z',
    };
    let caught: unknown;
    try {
      validateEvent(envelope);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EventValidationError);
    expect((caught as Error).message).toContain("'proposal'");
  });
});

describe('proposal envelope payload schema (direct)', () => {
  it('round-trips a meta-move proposal envelope payload', () => {
    const valid = {
      proposal: {
        kind: 'meta-move' as const,
        meta_kind: 'stance' as const,
        content: 'Stance-shift annotation content.',
        target_kind: 'edge' as const,
        target_id: EDGE_ID,
      },
    };
    const parsed = proposalEnvelopePayloadSchema.parse(valid);
    const wire = JSON.parse(JSON.stringify(parsed)) as unknown;
    expect(proposalEnvelopePayloadSchema.parse(wire)).toEqual(valid);
  });
});
