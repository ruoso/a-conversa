// Tests for `useProposalCommitChord` — the route-mounted bridge that
// wires the `Cmd/Ctrl+Shift+Enter` commit chord to the selected pending
// proposal.
//
// Refinement:
//   tasks/refinements/moderator-ui/mod_proposal_selection_commit_chord.md
//
// Per ADR 0022 these are committed Vitest cases. They drive the
// registered `useCommitChordStore.run` callback directly (the unit the
// document dispatcher invokes) and assert against a spy WS client:
//   (a) a selected all-agree proposal → `run` sends the expected
//       `commit` envelope (correct `target` arm);
//   (b) gate closed (a participant disputes) → `run` sends nothing;
//   (c) no selection → no send;
//   (d) a stale selection (id absent from the pending list) → no send +
//       selection cleared;
//   (e) unmount clears the registration (`getState().run === null`).
//
// The bridge captures `useWsClient()`, so the probe mounts inside a
// `<WsClientProvider>` + `<MemoryRouter>` (the `:id` param feeds the
// session id). All volatile inputs (selection, events, votes) are read
// fresh via `getState()` at `run()` time.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import i18next from 'i18next';
import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { createI18nInstance, WsClientProvider } from '@a-conversa/shell';
import type { WsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { resetCommitStore } from './useCommitAction';
import {
  resetSelectedProposalStore,
  useSelectedProposalStore,
} from '../stores/selectedProposalStore';
import { resetCommitChordStore, useCommitChordStore } from './useCommitChordStore';
import { useProposalCommitChord } from './useProposalCommitChord';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const NODE_X = '00000000-0000-4000-8000-00000000000a';
const PROPOSAL_P = '00000000-0000-4000-8000-0000000000ff';
const ABSENT_PROPOSAL = '00000000-0000-4000-8000-0000000000fc';
const DEBATER_A = '00000000-0000-4000-8000-0000000000d1';
const DEBATER_B = '00000000-0000-4000-8000-0000000000d2';

function envId(prefix: string, seq: number): string {
  return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 256 + seq).toString(16).padStart(12, '0')}`;
}

const classifyNodeFact: ProposalPayload = {
  kind: 'classify-node',
  node_id: NODE_X,
  classification: 'fact',
};

function proposalEvent(seq: number, envelopeId: string, proposal: ProposalPayload): Event {
  return {
    id: envelopeId,
    sessionId: SESSION,
    sequence: seq,
    kind: 'proposal',
    actor: DEBATER_A,
    payload: { proposal },
    createdAt: '2026-05-16T00:01:00.000Z',
  };
}

function joinedEvent(
  seq: number,
  userId: string,
  role: 'moderator' | 'debater-A' | 'debater-B',
): Event {
  return {
    id: envId('j', seq),
    sessionId: SESSION,
    sequence: seq,
    kind: 'participant-joined',
    actor: userId,
    payload: {
      user_id: userId,
      role,
      screen_name: `User-${role}`,
      joined_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
  };
}

function voteEvent(opts: {
  seq: number;
  proposalEnvelopeId: string;
  participant: string;
  choice: 'agree' | 'dispute';
}): Event {
  return {
    id: envId('v', opts.seq),
    sessionId: SESSION,
    sequence: opts.seq,
    kind: 'vote',
    actor: opts.participant,
    payload: {
      target: 'proposal' as const,
      proposal_id: opts.proposalEnvelopeId,
      participant: opts.participant,
      choice: opts.choice,
      voted_at: '2026-05-16T00:01:05.000Z',
    },
    createdAt: '2026-05-16T00:01:05.000Z',
  };
}

interface SpyClient {
  client: WsClient;
  calls: Array<{ type: WsMessageType; payload: unknown }>;
}

function makeSpyClient(): SpyClient {
  const calls: Array<{ type: WsMessageType; payload: unknown }> = [];
  const client: WsClient = {
    status: () => 'open',
    connect: () => undefined,
    close: () => undefined,
    killWebSocket: () => undefined,
    send: <T extends WsMessageType>(
      type: T,
      payload: WsMessagePayloadMap[T],
    ): Promise<WsEnvelopeUnion> => {
      calls.push({ type, payload });
      return new Promise<WsEnvelopeUnion>(() => {
        /* never resolves — we only assert the send was made */
      });
    },
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
  return { client, calls };
}

function HookProbe(): ReactElement {
  useProposalCommitChord();
  return <span data-testid="hook-probe" />;
}

function renderProbe(client: WsClient): { unmount: () => void } {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={[`/sessions/${SESSION}/operate`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/operate" element={children} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>
    );
  }
  const { unmount } = render(
    <Wrapper>
      <HookProbe />
    </Wrapper>,
  );
  return { unmount };
}

/** Seed the all-agree scenario: two debaters joined + a facet proposal + two agree votes. */
function seedAllAgree(): void {
  useWsStore.getState().setConnectionStatus('open');
  useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
  useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
  useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
  useWsStore.getState().applyEvent(
    voteEvent({
      seq: 4,
      proposalEnvelopeId: PROPOSAL_P,
      participant: DEBATER_A,
      choice: 'agree',
    }),
  );
  useWsStore.getState().applyEvent(
    voteEvent({
      seq: 5,
      proposalEnvelopeId: PROPOSAL_P,
      participant: DEBATER_B,
      choice: 'agree',
    }),
  );
}

beforeEach(async () => {
  useWsStore.getState().reset();
  resetCommitStore();
  resetSelectedProposalStore();
  resetCommitChordStore();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  resetCommitStore();
  resetSelectedProposalStore();
  resetCommitChordStore();
});

describe('useProposalCommitChord', () => {
  it('(a) all-agree selected proposal → run sends the canonical facet-arm commit envelope', () => {
    const { client, calls } = makeSpyClient();
    act(() => {
      seedAllAgree();
      useSelectedProposalStore.getState().select(PROPOSAL_P);
    });
    renderProbe(client);

    act(() => {
      useCommitChordStore.getState().run?.();
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.type).toBe('commit');
    const payload = calls[0]?.payload as {
      sessionId: string;
      expectedSequence: number;
      target: string;
      entity_kind: string;
      entity_id: string;
      facet: string;
    };
    expect(payload.sessionId).toBe(SESSION);
    expect(payload.target).toBe('facet');
    expect(payload.entity_kind).toBe('node');
    expect(payload.entity_id).toBe(NODE_X);
    expect(payload.facet).toBe('classification');
    // High-water mark after 5 applied events.
    expect(payload.expectedSequence).toBe(5);
  });

  it('(b) gate closed (a debater disputes) → run sends nothing', () => {
    const { client, calls } = makeSpyClient();
    act(() => {
      useWsStore.getState().setConnectionStatus('open');
      useWsStore.getState().applyEvent(joinedEvent(1, DEBATER_A, 'debater-A'));
      useWsStore.getState().applyEvent(joinedEvent(2, DEBATER_B, 'debater-B'));
      useWsStore.getState().applyEvent(proposalEvent(3, PROPOSAL_P, classifyNodeFact));
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 4,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_A,
          choice: 'agree',
        }),
      );
      useWsStore.getState().applyEvent(
        voteEvent({
          seq: 5,
          proposalEnvelopeId: PROPOSAL_P,
          participant: DEBATER_B,
          choice: 'dispute',
        }),
      );
      useSelectedProposalStore.getState().select(PROPOSAL_P);
    });
    renderProbe(client);

    act(() => {
      useCommitChordStore.getState().run?.();
    });

    expect(calls.length).toBe(0);
  });

  it('(c) no selection → run sends nothing', () => {
    const { client, calls } = makeSpyClient();
    act(() => {
      seedAllAgree();
      // No select() — selectedProposalId stays null.
    });
    renderProbe(client);

    act(() => {
      useCommitChordStore.getState().run?.();
    });

    expect(calls.length).toBe(0);
  });

  it('(d) stale selection (id absent from the pending list) → no send + selection cleared', () => {
    const { client, calls } = makeSpyClient();
    act(() => {
      seedAllAgree();
      // Select an id that is NOT in the derived pending list.
      useSelectedProposalStore.getState().select(ABSENT_PROPOSAL);
    });
    renderProbe(client);

    act(() => {
      useCommitChordStore.getState().run?.();
    });

    expect(calls.length).toBe(0);
    expect(useSelectedProposalStore.getState().selectedProposalId).toBeNull();
  });

  it('(e) unmount clears the registered run', () => {
    const { client } = makeSpyClient();
    const { unmount } = renderProbe(client);
    expect(useCommitChordStore.getState().run).not.toBeNull();
    act(() => {
      unmount();
    });
    expect(useCommitChordStore.getState().run).toBeNull();
  });
});
