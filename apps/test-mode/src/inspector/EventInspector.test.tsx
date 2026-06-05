// Vitest + RTL cases for the test-mode event inspector.
//
// Refinement: tasks/refinements/replay_test/test_mode_event_inspector.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications — the
//   `data-testid` seams are the pinned regression surface); 0024
//   (react-i18next); 0021 (the event envelope the inspector renders).
//
// Pins the read-only inspector: head-position metadata + payload rendering,
// position tracking (mid-log re-render), the `position 0` baseline state, the
// null-actor label, and the empty-payload kind. Plain DOM assertions
// (`textContent` / `queryByTestId`) — jest-dom matchers are not wired into
// this workspace's Vitest setup.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';

import { createI18nInstance } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

import { EventInspector } from './EventInspector';

const SESSION = '00000000-0000-4000-8000-000000000099';
const ACTOR = '00000000-0000-4000-8000-000000000001';

function makeEvent(
  sequence: number,
  kind: string,
  payload: unknown,
  actor: string | null = ACTOR,
): Event {
  return {
    id: `00000000-0000-4000-8000-0000000${String(100 + sequence)}`,
    sessionId: SESSION,
    sequence,
    kind,
    actor,
    payload,
    createdAt: `2026-06-01T10:00:0${String(sequence)}.000Z`,
  } as unknown as Event;
}

// Contiguous events (sequences 1..4); head sequence is 4.
const EVENTS: Event[] = [
  makeEvent(1, 'session-created', { title: 'Worked debate' }),
  makeEvent(2, 'participant-joined', { participantId: ACTOR }, null),
  makeEvent(3, 'node-created', { nodeId: 'n-1', text: 'A claim' }),
  makeEvent(4, 'session-ended', {}),
];
const HEAD = 4;

function fieldText(name: string): string {
  return screen.getByTestId(`test-mode-inspector-${name}`).textContent ?? '';
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('EventInspector — head position', () => {
  it('renders the head event envelope fields and the serialized payload', () => {
    render(<EventInspector events={EVENTS} position={HEAD} />);

    expect(fieldText('sequence')).toBe('4');
    expect(fieldText('kind')).toBe('session-ended');
    expect(fieldText('actor')).toBe(ACTOR);
    expect(fieldText('createdAt')).toBe('2026-06-01T10:00:04.000Z');
    expect(fieldText('id')).toBe('00000000-0000-4000-8000-0000000104');
    expect(fieldText('sessionId')).toBe(SESSION);

    // An empty-payload kind serializes to `{}` without throwing.
    expect(fieldText('payload')).toBe('{}');
    expect(screen.queryByTestId('test-mode-inspector-baseline')).toBeNull();
  });
});

describe('EventInspector — tracking the position', () => {
  it('re-renders the panel with the event at a mid-log position', () => {
    const { rerender } = render(<EventInspector events={EVENTS} position={HEAD} />);
    expect(fieldText('kind')).toBe('session-ended');

    rerender(<EventInspector events={EVENTS} position={3} />);
    expect(fieldText('sequence')).toBe('3');
    expect(fieldText('kind')).toBe('node-created');
    // The payload of event 3 is shown verbatim, pretty-printed.
    expect(fieldText('payload')).toContain('"nodeId": "n-1"');
    expect(fieldText('payload')).toContain('"text": "A claim"');
  });
});

describe('EventInspector — baseline', () => {
  it('renders the baseline state at position 0 with no envelope fields', () => {
    render(<EventInspector events={EVENTS} position={0} />);

    expect(screen.queryByTestId('test-mode-inspector-baseline')).not.toBeNull();
    expect(screen.queryByTestId('test-mode-inspector-sequence')).toBeNull();
    expect(screen.queryByTestId('test-mode-inspector-payload')).toBeNull();
  });
});

describe('EventInspector — null actor', () => {
  it('renders the localized null-actor label, not the literal null', () => {
    render(<EventInspector events={EVENTS} position={2} />);

    expect(fieldText('kind')).toBe('participant-joined');
    expect(fieldText('actor')).toBe('system');
    expect(fieldText('actor')).not.toBe('null');
  });
});
