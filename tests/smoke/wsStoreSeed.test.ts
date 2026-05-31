// Vitest cover for the `seedWsStore` Playwright helper's facet-round
// extension. Pins:
//
//   1. Backwards compatibility — with only the pre-task arms
//      (`nodes` / `edges` / `annotations`) the helper produces the
//      same events it always has.
//   2. The new facet-round arms (`proposals` / `votes` / `commits`)
//      synthesize events in the canonical loop order
//      (nodes → annotations → edges → proposals → votes → commits) and
//      advance `sequence` by one per event.
//   3. The three new payload shapes parse cleanly through the canonical
//      Zod schemas (`proposalEnvelopePayloadSchema`,
//      `votePayloadSchema`, `commitPayloadSchema`) — a localized guard
//      against drift between the helper and the shared-types contract.
//
// Refinement: tasks/refinements/moderator-ui/playwright_f6_substance_precommit_full_chain.md
//   (Decision §D8 — small Vitest cover for the helper, justified by the
//   helper growing from three event-kinds to six.)
//
// The helper wraps `page.evaluate(fn, args)`; the inner callback runs
// in the browser context and reads `window.__aConversaWsStore`. This
// cover stubs both: the test assigns a recording store to the global
// `window`, then passes a `Page`-shaped mock whose `evaluate(fn, args)`
// just invokes `fn(args)` directly. Captured events are the test's
// assertion surface.

import { describe, expect, it, beforeEach } from 'vitest';

// Direct relative import into `packages/shared-types/src/` — the
// `tests/` tree is not a pnpm workspace member so the
// `@a-conversa/shared-types` package name is not resolvable through
// any `node_modules/` reachable from here (same constraint the
// sibling `dev-user-pool.test.ts` documents at its imports). The
// relative import lets Vitest pick up the source via the workspace
// resolver's `source` export condition without depending on a
// symlinked node_modules.
import { commitPayloadSchema, votePayloadSchema } from '../../packages/shared-types/src/events';
import { proposalEnvelopePayloadSchema } from '../../packages/shared-types/src/events/proposals';

import { seedWsStore } from '../e2e/fixtures/wsStoreSeed';

interface CapturedEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly actor: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

interface FakeStoreState {
  applyEvent(event: CapturedEvent): boolean;
  sessionState: Record<string, { events: CapturedEvent[]; lastAppliedSequence: number }>;
}

function installFakeStore(sessionId: string): { captured: CapturedEvent[] } {
  const captured: CapturedEvent[] = [];
  const session = { events: captured, lastAppliedSequence: 0 };
  const state: FakeStoreState = {
    sessionState: { [sessionId]: session },
    applyEvent(event) {
      captured.push(event);
      session.lastAppliedSequence = event.sequence;
      return true;
    },
  };
  (window as unknown as { __aConversaWsStore: { getState(): FakeStoreState } }).__aConversaWsStore =
    {
      getState: () => state,
    };
  return { captured };
}

function makeFakePage(): {
  evaluate: <T, A>(fn: (args: A) => T, args: A) => Promise<T>;
} {
  return {
    evaluate: <T, A>(fn: (args: A) => T, args: A): Promise<T> => Promise.resolve(fn(args)),
  };
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EDGE_ID = '22222222-2222-4222-8222-222222222221';
const PARTICIPANT_A = '33333333-3333-4333-8333-333333333331';
const PARTICIPANT_B = '33333333-3333-4333-8333-333333333332';

beforeEach(() => {
  // Drop the previous test's store handle so each case starts with a
  // fresh accumulator.
  delete (window as unknown as { __aConversaWsStore?: unknown }).__aConversaWsStore;
});

describe('seedWsStore — regression on pre-task arms', () => {
  it('produces only `node-created` events when called with `nodes` alone (no new arms emit)', async () => {
    const { captured } = installFakeStore(SESSION_ID);
    const page = makeFakePage();

    await seedWsStore(page as never, {
      sessionId: SESSION_ID,
      nodes: [
        { nodeId: '44444444-4444-4444-8444-444444444441', wording: 'X' },
        { nodeId: '44444444-4444-4444-8444-444444444442', wording: 'Y' },
      ],
    });

    expect(captured.map((e) => e.kind)).toEqual(['node-created', 'node-created']);
    expect(captured.map((e) => e.sequence)).toEqual([1, 2]);
  });
});

describe('seedWsStore — facet-round arms', () => {
  it('emits proposal → votes → commit in canonical order, sequence increments per event', async () => {
    const { captured } = installFakeStore(SESSION_ID);
    const page = makeFakePage();

    await seedWsStore(page as never, {
      sessionId: SESSION_ID,
      proposals: [
        {
          proposal: { kind: 'set-edge-substance', edge_id: EDGE_ID, value: 'agreed' },
        },
      ],
      votes: [
        {
          entityKind: 'edge',
          entityId: EDGE_ID,
          facet: 'substance',
          participant: PARTICIPANT_A,
          choice: 'agree',
        },
        {
          entityKind: 'edge',
          entityId: EDGE_ID,
          facet: 'substance',
          participant: PARTICIPANT_B,
          choice: 'agree',
        },
      ],
      commits: [{ entityKind: 'edge', entityId: EDGE_ID, facet: 'substance' }],
    });

    expect(captured.map((e) => e.kind)).toEqual(['proposal', 'vote', 'vote', 'commit']);
    expect(captured.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('honors nodes → annotations → edges → proposals → votes → commits across a mixed call', async () => {
    const { captured } = installFakeStore(SESSION_ID);
    const page = makeFakePage();

    await seedWsStore(page as never, {
      sessionId: SESSION_ID,
      nodes: [{ nodeId: '44444444-4444-4444-8444-444444444441', wording: 'X' }],
      annotations: [
        {
          annotationId: '55555555-5555-4555-8555-555555555551',
          kind: 'note',
          content: 'n',
          targetNodeId: '44444444-4444-4444-8444-444444444441',
        },
      ],
      edges: [
        {
          edgeId: EDGE_ID,
          source: '44444444-4444-4444-8444-444444444441',
          target: '44444444-4444-4444-8444-444444444441',
          role: 'supports',
        },
      ],
      proposals: [{ proposal: { kind: 'set-edge-substance', edge_id: EDGE_ID, value: 'agreed' } }],
      votes: [
        {
          entityKind: 'edge',
          entityId: EDGE_ID,
          facet: 'shape',
          participant: PARTICIPANT_A,
          choice: 'agree',
        },
      ],
      commits: [{ entityKind: 'edge', entityId: EDGE_ID, facet: 'shape' }],
    });

    expect(captured.map((e) => e.kind)).toEqual([
      'node-created',
      'annotation-created',
      'edge-created',
      'proposal',
      'vote',
      'commit',
    ]);
    expect(captured.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('seedWsStore — synthesized payloads parse against canonical Zod schemas', () => {
  it('`proposal` payloads parse as `proposalEnvelopePayloadSchema`', async () => {
    const { captured } = installFakeStore(SESSION_ID);
    const page = makeFakePage();

    await seedWsStore(page as never, {
      sessionId: SESSION_ID,
      proposals: [{ proposal: { kind: 'set-edge-substance', edge_id: EDGE_ID, value: 'agreed' } }],
    });

    const proposalEvent = captured.find((e) => e.kind === 'proposal');
    expect(proposalEvent).toBeDefined();
    const parse = proposalEnvelopePayloadSchema.safeParse(proposalEvent!.payload);
    expect(parse.success, `${parse.success ? '' : JSON.stringify(parse.error.format())}`).toBe(
      true,
    );
  });

  it('facet-keyed `vote` payloads parse as `votePayloadSchema`', async () => {
    const { captured } = installFakeStore(SESSION_ID);
    const page = makeFakePage();

    await seedWsStore(page as never, {
      sessionId: SESSION_ID,
      votes: [
        {
          entityKind: 'edge',
          entityId: EDGE_ID,
          facet: 'substance',
          participant: PARTICIPANT_A,
          choice: 'agree',
        },
      ],
    });

    const voteEvent = captured.find((e) => e.kind === 'vote');
    expect(voteEvent).toBeDefined();
    const parse = votePayloadSchema.safeParse(voteEvent!.payload);
    expect(parse.success, `${parse.success ? '' : JSON.stringify(parse.error.format())}`).toBe(
      true,
    );
  });

  it('facet-keyed `commit` payloads parse as `commitPayloadSchema`', async () => {
    const { captured } = installFakeStore(SESSION_ID);
    const page = makeFakePage();

    await seedWsStore(page as never, {
      sessionId: SESSION_ID,
      commits: [{ entityKind: 'edge', entityId: EDGE_ID, facet: 'substance' }],
    });

    const commitEvent = captured.find((e) => e.kind === 'commit');
    expect(commitEvent).toBeDefined();
    const parse = commitPayloadSchema.safeParse(commitEvent!.payload);
    expect(parse.success, `${parse.success ? '' : JSON.stringify(parse.error.format())}`).toBe(
      true,
    );
  });
});
