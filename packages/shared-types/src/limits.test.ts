// Per-field length-cap tests.
//
// Refinement: tasks/refinements/backend-hardening/user_text_length_caps.md
// Source finding: docs/security/m3-review/inputs.md F-003
//
// Pins the at-cap-accept / over-cap-reject behavior for every
// user-authored text field in the proposal / event vocabulary, plus
// the structural caps on topic / screen-name / snapshot label. The
// fixtures construct length-N strings via `'x'.repeat(N)`; the cap
// constants come from `./limits.ts` so changing a cap moves both the
// constant and the test in lockstep.

import { describe, expect, it } from 'vitest';

import {
  annotationCreatedPayloadSchema,
  nodeCreatedPayloadSchema,
  participantJoinedPayloadSchema,
  sessionCreatedPayloadSchema,
  snapshotCreatedPayloadSchema,
} from './events.js';
import {
  amendNodeProposalSchema,
  annotateProposalSchema,
  decomposeProposalSchema,
  interpretiveSplitProposalSchema,
  metaMoveProposalSchema,
  restructureEditProposalSchema,
  rewordEditProposalSchema,
} from './events/proposals.js';
import {
  MAX_METHODOLOGY_TEXT_LENGTH,
  MAX_SCREEN_NAME_LENGTH,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_TOPIC_LENGTH,
} from './limits.js';

// Valid sample v4 UUIDs reused across cases.
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

const TS = '2026-05-11T12:34:56Z';

/**
 * Build a string of `n` ASCII characters. ASCII is one UTF-16 code
 * unit per character, so `.length === n` — the Zod `.max(n)` check
 * compares against `.length`, so a one-over fixture is exactly
 * `n + 1`.
 */
function repeat(n: number): string {
  return 'x'.repeat(n);
}

describe('limits — methodology-text cap (10 KiB)', () => {
  describe('node-created.wording', () => {
    const base = {
      node_id: UUID_A,
      created_by: UUID_B,
      created_at: TS,
    };

    it('accepts wording exactly at the cap', () => {
      const result = nodeCreatedPayloadSchema.safeParse({
        ...base,
        wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects wording at cap+1', () => {
      const result = nodeCreatedPayloadSchema.safeParse({
        ...base,
        wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });

    it('accepts a typical short wording', () => {
      const result = nodeCreatedPayloadSchema.safeParse({
        ...base,
        wording: 'Capital punishment deters murder.',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('annotation-created.content', () => {
    const base = {
      annotation_id: UUID_A,
      kind: 'note' as const,
      target_node_id: UUID_B,
      target_edge_id: null,
      created_by: UUID_C,
      created_at: TS,
    };

    it('accepts content exactly at the cap', () => {
      const result = annotationCreatedPayloadSchema.safeParse({
        ...base,
        content: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects content at cap+1', () => {
      const result = annotationCreatedPayloadSchema.safeParse({
        ...base,
        content: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('edit-wording (reword).new_wording', () => {
    const base = {
      kind: 'edit-wording' as const,
      edit_kind: 'reword' as const,
      node_id: UUID_A,
    };

    it('accepts new_wording exactly at the cap', () => {
      const result = rewordEditProposalSchema.safeParse({
        ...base,
        new_wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects new_wording at cap+1', () => {
      const result = rewordEditProposalSchema.safeParse({
        ...base,
        new_wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('edit-wording (restructure).new_wording', () => {
    const base = {
      kind: 'edit-wording' as const,
      edit_kind: 'restructure' as const,
      node_id: UUID_A,
      new_node_id: UUID_B,
    };

    it('accepts new_wording exactly at the cap', () => {
      const result = restructureEditProposalSchema.safeParse({
        ...base,
        new_wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects new_wording at cap+1', () => {
      const result = restructureEditProposalSchema.safeParse({
        ...base,
        new_wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('decompose.components[].wording', () => {
    const base = {
      kind: 'decompose' as const,
      parent_node_id: UUID_A,
    };

    it('accepts a component wording exactly at the cap', () => {
      const result = decomposeProposalSchema.safeParse({
        ...base,
        components: [
          { wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH), classification: 'fact' as const },
          { wording: 'Other half.', classification: 'value' as const },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a component wording at cap+1', () => {
      const result = decomposeProposalSchema.safeParse({
        ...base,
        components: [
          { wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1), classification: 'fact' as const },
          { wording: 'Other half.', classification: 'value' as const },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('interpretive-split.readings[].wording', () => {
    const base = {
      kind: 'interpretive-split' as const,
      parent_node_id: UUID_A,
    };

    it('accepts a reading wording exactly at the cap', () => {
      const result = interpretiveSplitProposalSchema.safeParse({
        ...base,
        readings: [
          { wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH), classification: 'fact' as const },
          { wording: 'Alternative reading.', classification: 'value' as const },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a reading wording at cap+1', () => {
      const result = interpretiveSplitProposalSchema.safeParse({
        ...base,
        readings: [
          { wording: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1), classification: 'fact' as const },
          { wording: 'Alternative reading.', classification: 'value' as const },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('meta-move.content', () => {
    const base = {
      kind: 'meta-move' as const,
      meta_kind: 'reframe' as const,
      target_kind: 'node' as const,
      target_id: UUID_A,
    };

    it('accepts content exactly at the cap', () => {
      const result = metaMoveProposalSchema.safeParse({
        ...base,
        content: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects content at cap+1', () => {
      const result = metaMoveProposalSchema.safeParse({
        ...base,
        content: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('amend-node.new_content', () => {
    const base = {
      kind: 'amend-node' as const,
      node_id: UUID_A,
    };

    it('accepts new_content exactly at the cap', () => {
      const result = amendNodeProposalSchema.safeParse({
        ...base,
        new_content: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects new_content at cap+1', () => {
      const result = amendNodeProposalSchema.safeParse({
        ...base,
        new_content: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('annotate.content', () => {
    const base = {
      kind: 'annotate' as const,
      target_kind: 'node' as const,
      target_id: UUID_A,
      annotation_kind: 'note' as const,
    };

    it('accepts content exactly at the cap', () => {
      const result = annotateProposalSchema.safeParse({
        ...base,
        content: repeat(MAX_METHODOLOGY_TEXT_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects content at cap+1', () => {
      const result = annotateProposalSchema.safeParse({
        ...base,
        content: repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('limits — short-label caps', () => {
  describe('session-created.topic (256)', () => {
    const base = {
      host_user_id: UUID_A,
      privacy: 'public' as const,
      created_at: TS,
    };

    it('accepts topic exactly at the cap', () => {
      const result = sessionCreatedPayloadSchema.safeParse({
        ...base,
        topic: repeat(MAX_TOPIC_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects topic at cap+1', () => {
      const result = sessionCreatedPayloadSchema.safeParse({
        ...base,
        topic: repeat(MAX_TOPIC_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });

    it('accepts a typical topic', () => {
      const result = sessionCreatedPayloadSchema.safeParse({
        ...base,
        topic: 'Should we abolish the senate?',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('participant-joined.screen_name (64)', () => {
    const base = {
      user_id: UUID_A,
      role: 'debater-A' as const,
      joined_at: TS,
    };

    it('accepts screen_name exactly at the cap', () => {
      const result = participantJoinedPayloadSchema.safeParse({
        ...base,
        screen_name: repeat(MAX_SCREEN_NAME_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects screen_name at cap+1', () => {
      const result = participantJoinedPayloadSchema.safeParse({
        ...base,
        screen_name: repeat(MAX_SCREEN_NAME_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('snapshot-created.label (128)', () => {
    const base = {
      snapshot_id: UUID_A,
      log_position: 1,
    };

    it('accepts label exactly at the cap', () => {
      const result = snapshotCreatedPayloadSchema.safeParse({
        ...base,
        label: repeat(MAX_SNAPSHOT_LABEL_LENGTH),
      });
      expect(result.success).toBe(true);
    });

    it('rejects label at cap+1', () => {
      const result = snapshotCreatedPayloadSchema.safeParse({
        ...base,
        label: repeat(MAX_SNAPSHOT_LABEL_LENGTH + 1),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('limits — cap constants are well-formed', () => {
  it('every cap is a positive integer', () => {
    for (const cap of [
      MAX_METHODOLOGY_TEXT_LENGTH,
      MAX_TOPIC_LENGTH,
      MAX_SNAPSHOT_LABEL_LENGTH,
      MAX_SCREEN_NAME_LENGTH,
    ]) {
      expect(Number.isInteger(cap)).toBe(true);
      expect(cap).toBeGreaterThan(0);
    }
  });

  it('the methodology-text cap fits comfortably under the 64 KiB frame ceiling', () => {
    // F-002's sibling task lands `bodyLimit: 64 * 1024`. Each
    // methodology-text field at its cap encodes to at most
    // MAX_METHODOLOGY_TEXT_LENGTH UTF-8 bytes (ASCII path) up to ~4x
    // for worst-case multi-byte. Even at 4x the cap is still well
    // under 64 KiB — leaving room for the envelope structure +
    // multiple shorter fields.
    expect(MAX_METHODOLOGY_TEXT_LENGTH * 4).toBeLessThan(64 * 1024);
  });
});
