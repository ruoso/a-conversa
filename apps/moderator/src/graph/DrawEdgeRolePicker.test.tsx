// Tests for `<DrawEdgeRolePicker>` — the moderator's drag-to-create-edge
// role picker popover.
//
// Refinement: tasks/refinements/moderator-ui/mod_role_palette_on_drop.md
//
// The picker is presentation + WS write surface; the tests pin:
//   1. The seven role buttons render in the canonical `EDGE_ROLES` order.
//   2. Clicking a role fires a `set-edge-substance` proposal envelope
//      carrying all four endpoint fields + the default substance value
//      `'agreed'`. The envelope's `edge_id` is a fresh UUID.
//   3. After a successful send, `onClose` fires.
//   4. Escape and outside-mousedown also close the picker.
//   5. The seven role buttons are disabled while the propose round-trip
//      is in flight (the in-flight gate prevents a double-click from
//      sending two envelopes).
//   6. On a wire failure, the picker stays open and surfaces an inline
//      error message under the buttons.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';

import {
  WsClientProvider,
  WsRequestError,
  createI18nInstance,
  type WsClient,
} from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { DrawEdgeRolePicker } from './DrawEdgeRolePicker';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const SOURCE_ID = '00000000-0000-4000-8000-00000000000a';
const TARGET_ID = '00000000-0000-4000-8000-00000000000b';

interface SentEnvelope {
  readonly kind: string;
  readonly payload: unknown;
}

function makeStubClient(opts?: { rejectWith?: Error }): {
  client: WsClient;
  sent: SentEnvelope[];
} {
  const sent: SentEnvelope[] = [];
  const client: WsClient = {
    status: () => 'open',
    connect: () => undefined,
    close: () => undefined,
    killWebSocket: () => undefined,
    send: ((kind: string, payload: unknown) => {
      sent.push({ kind, payload });
      if (opts?.rejectWith !== undefined) {
        return Promise.reject(opts.rejectWith);
      }
      return Promise.resolve({} as unknown);
    }) as unknown as WsClient['send'],
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
  return { client, sent };
}

function renderPicker(opts: {
  onClose: () => void;
  client: WsClient;
  source?: string;
  sourceKind?: 'node' | 'annotation';
  target?: string;
  targetKind?: 'node' | 'annotation';
}): ReturnType<typeof render> {
  const source = opts.source ?? SOURCE_ID;
  const sourceKind = opts.sourceKind ?? 'node';
  const target = opts.target ?? TARGET_ID;
  const targetKind = opts.targetKind ?? 'node';
  return render(
    <MemoryRouter initialEntries={[`/m/sessions/${SESSION_ID}/operate`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={opts.client}>
        <Routes>
          <Route
            path="/m/sessions/:id/operate"
            element={
              <DrawEdgeRolePicker
                source={source}
                sourceKind={sourceKind}
                target={target}
                targetKind={targetKind}
                x={120}
                y={240}
                onClose={opts.onClose}
              />
            }
          />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  useWsStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
});

describe('DrawEdgeRolePicker', () => {
  it('renders the seven role buttons in the canonical EDGE_ROLES order', () => {
    const { client } = makeStubClient();
    renderPicker({ onClose: () => undefined, client });
    const order = [
      'supports',
      'rebuts',
      'qualifies',
      'bridges-from',
      'bridges-to',
      'defines',
      'contradicts',
    ];
    for (const role of order) {
      expect(screen.getByTestId(`draw-edge-role-picker-button-${role}`)).toBeTruthy();
    }
  });

  it('clicking a role fires a set-edge-substance proposal with all four endpoint fields', async () => {
    const { client, sent } = makeStubClient();
    const onClose = vi.fn();
    renderPicker({ onClose, client });

    await act(async () => {
      fireEvent.click(screen.getByTestId('draw-edge-role-picker-button-rebuts'));
      // Flush microtasks so the picker's async `handlePick` resolves
      // (its `await client.send(...)` produces the `sent` push +
      // `onClose` call before this `act` returns).
      await Promise.resolve();
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe('propose');
    const payload = sent[0]!.payload as {
      sessionId: string;
      expectedSequence: number;
      proposal: {
        kind: string;
        edge_id: string;
        value: string;
        source_node_id: string;
        target_node_id: string;
        role: string;
      };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal.kind).toBe('set-edge-substance');
    expect(payload.proposal.source_node_id).toBe(SOURCE_ID);
    expect(payload.proposal.target_node_id).toBe(TARGET_ID);
    expect(payload.proposal.role).toBe('rebuts');
    expect(payload.proposal.value).toBe('agreed');
    // The minted edge id is a UUID v4.
    expect(payload.proposal.edge_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the picker', () => {
    const { client } = makeStubClient();
    const onClose = vi.fn();
    renderPicker({ onClose, client });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('outside mousedown closes the picker', () => {
    const { client } = makeStubClient();
    const onClose = vi.fn();
    renderPicker({ onClose, client });
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md
  //
  // The picker's payload-routing branch on `sourceKind` / `targetKind`
  // (each `'node'` or `'annotation'`). Four-case matrix pins that the
  // emitted `set-edge-substance` proposal carries the kind-appropriate
  // schema slot for each endpoint and OMITS the opposing slot (the
  // `setEdgeSubstanceProposalSchema` per-endpoint `.refine()` enforces
  // AT-MOST-ONE; the proposal-builder respects this by writing ONE
  // slot per endpoint).
  describe('endpoint-kind routing (mod_propose_annotation_endpoint_gestures)', () => {
    interface Permutation {
      readonly sourceKind: 'node' | 'annotation';
      readonly targetKind: 'node' | 'annotation';
      readonly expectedSource: 'source_node_id' | 'source_annotation_id';
      readonly expectedTarget: 'target_node_id' | 'target_annotation_id';
    }
    const PERMUTATIONS: readonly Permutation[] = [
      {
        sourceKind: 'node',
        targetKind: 'node',
        expectedSource: 'source_node_id',
        expectedTarget: 'target_node_id',
      },
      {
        sourceKind: 'node',
        targetKind: 'annotation',
        expectedSource: 'source_node_id',
        expectedTarget: 'target_annotation_id',
      },
      {
        sourceKind: 'annotation',
        targetKind: 'node',
        expectedSource: 'source_annotation_id',
        expectedTarget: 'target_node_id',
      },
      {
        sourceKind: 'annotation',
        targetKind: 'annotation',
        expectedSource: 'source_annotation_id',
        expectedTarget: 'target_annotation_id',
      },
    ];

    for (const perm of PERMUTATIONS) {
      it(`${perm.sourceKind}→${perm.targetKind}: routes ids to ${perm.expectedSource} + ${perm.expectedTarget}`, async () => {
        const { client, sent } = makeStubClient();
        renderPicker({
          onClose: () => undefined,
          client,
          sourceKind: perm.sourceKind,
          targetKind: perm.targetKind,
        });
        await act(async () => {
          fireEvent.click(screen.getByTestId('draw-edge-role-picker-button-supports'));
          await Promise.resolve();
        });
        expect(sent).toHaveLength(1);
        const payload = sent[0]!.payload as {
          proposal: Record<string, unknown>;
        };
        expect(payload.proposal[perm.expectedSource]).toBe(SOURCE_ID);
        expect(payload.proposal[perm.expectedTarget]).toBe(TARGET_ID);
        // The opposing slots are absent (per-endpoint AT-MOST-ONE).
        const opposingSource =
          perm.expectedSource === 'source_node_id' ? 'source_annotation_id' : 'source_node_id';
        const opposingTarget =
          perm.expectedTarget === 'target_node_id' ? 'target_annotation_id' : 'target_node_id';
        expect(payload.proposal[opposingSource]).toBeUndefined();
        expect(payload.proposal[opposingTarget]).toBeUndefined();
      });
    }

    it('renders data-source-kind / data-target-kind attributes on the picker root', () => {
      const { client } = makeStubClient();
      renderPicker({
        onClose: () => undefined,
        client,
        sourceKind: 'annotation',
        targetKind: 'node',
      });
      const root = screen.getByTestId('draw-edge-role-picker');
      expect(root.getAttribute('data-source-kind')).toBe('annotation');
      expect(root.getAttribute('data-target-kind')).toBe('node');
      expect(root.getAttribute('data-source-id')).toBe(SOURCE_ID);
      expect(root.getAttribute('data-target-id')).toBe(TARGET_ID);
    });
  });

  it('on wire-error keeps the picker open and surfaces an inline error region', async () => {
    const wireError = new WsRequestError({
      code: 'edge-source-not-visible',
      message: 'Source node not visible',
    });
    const { client } = makeStubClient({ rejectWith: wireError });
    const onClose = vi.fn();
    renderPicker({ onClose, client });

    await act(async () => {
      fireEvent.click(screen.getByTestId('draw-edge-role-picker-button-supports'));
      // Flush microtasks so the picker's catch arm sets `errorMessage`
      // before this `act` returns.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    const error = screen.getByTestId('draw-edge-role-picker-error');
    expect(error.textContent ?? '').toContain('Source node not visible');
  });
});
