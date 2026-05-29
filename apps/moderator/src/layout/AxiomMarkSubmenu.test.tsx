// Tests for `<AxiomMarkSubmenu>` — the participant-picker submenu the
// node context menu's `axiom-mark` item opens.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Lists every joined non-moderator participant** — derived via
//      `deriveCurrentParticipants(events)` + `derivePartipantScreenNames`.
//      Each participant renders as a `<button
//      data-testid="axiom-mark-submenu-participant-{id}">` carrying the
//      participant's screen name.
//   2. **Empty state** — when zero debaters have joined, the empty-state
//      row `data-testid="axiom-mark-submenu-empty"` renders.
//   3. **Excludes the moderator** — a moderator-role `participant-joined`
//      event does NOT produce a button.
//   4. **Click → markAxiom(participantId)** — clicking a participant
//      button fires the hook's `markAxiom` with the right id; the
//      submenu then closes via `onClose`.
//   5. **Inline error region** — when `lastErrorFor(participantId)`
//      returns a WireError, the submenu renders an
//      `axiom-mark-submenu-error` region with the localized message.
//   6. **Localization** — the three new labels (`header`, `empty`,
//      `notSelf` error) resolve to the catalog-correct string for each
//      of en-US / pt-BR / es-419 (9 cross-locale cases).
//   7. **`derivePartipantScreenNames` walker** — direct unit cases pin
//      the participant-joined / participant-left collapse and the
//      moderator-exclusion rule.
//   8. **`resolveAxiomMarkErrorMessage` helper** — the error-message
//      resolver maps `axiom-mark-not-self` → catalog message, `timeout`
//      → catalog message, anything else → `error.message` fallback.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import i18next from 'i18next';
import type { Event } from '@a-conversa/shared-types';

import {
  AxiomMarkSubmenu,
  derivePartipantScreenNames,
  resolveAxiomMarkErrorMessage,
} from './AxiomMarkSubmenu';
import {
  resetAxiomMarkStore,
  type UseAxiomMarkActionResult,
  type WireError,
} from './useAxiomMarkAction';
import { WsClientProvider } from '@a-conversa/shell';
import type { WsClient, WsClientStatus } from '@a-conversa/shell';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '00000000-0000-4000-8000-0000000000a0';
const ALICE_ID = '00000000-0000-4000-8000-0000000000a1';
const BEN_ID = '00000000-0000-4000-8000-0000000000b1';
const CARLA_ID = '00000000-0000-4000-8000-0000000000c1';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
  resetAxiomMarkStore();
});

afterEach(() => {
  cleanup();
});

// Build a minimal `WsClient` stub for the WsClientProvider wrapper. The
// submenu's hookOverride bypasses the hook's WS call entirely; the
// provider is mounted so the inner `useWsClient()` in the real hook
// doesn't throw (the real hook still runs per Rules of Hooks even when
// hookOverride shadows its result).
function makeStubClient(): WsClient {
  return {
    status: (): WsClientStatus => 'open',
    connect: (): void => undefined,
    close: (): void => undefined,
    killWebSocket: (): void => undefined,
    send: () => new Promise(() => undefined),
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
}

function wrap(children: ReactNode): ReactElement {
  return (
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={makeStubClient()}>
        <Routes>
          <Route path="/sessions/:id/operate" element={children} />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>
  );
}

function joinedEvent(opts: {
  userId: string;
  role: 'moderator' | 'debater-A' | 'debater-B';
  screenName: string;
  sequence: number;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x9000 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'participant-joined',
    actor: opts.userId,
    payload: {
      user_id: opts.userId,
      role: opts.role,
      screen_name: opts.screenName,
      joined_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
  } as unknown as Event;
}

function leftEvent(userId: string, sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0xa000 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'participant-left',
    actor: userId,
    payload: {
      user_id: userId,
      left_at: '2026-05-16T00:00:00.000Z',
    },
    createdAt: '2026-05-16T00:00:00.000Z',
  } as unknown as Event;
}

function makeHookOverride(opts?: {
  markAxiom?: (participantId: string) => Promise<void>;
  inFlightFor?: (participantId: string) => boolean;
  lastErrorFor?: (participantId: string) => WireError | undefined;
}): UseAxiomMarkActionResult {
  return {
    markAxiom: opts?.markAxiom ?? (() => Promise.resolve()),
    inFlightFor: opts?.inFlightFor ?? (() => false),
    lastErrorFor: opts?.lastErrorFor ?? (() => undefined),
  };
}

describe('derivePartipantScreenNames — walker semantics', () => {
  it('returns an empty map on an empty events array', () => {
    expect(derivePartipantScreenNames([])).toEqual(new Map());
  });

  it('collects screen names from participant-joined events', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
      joinedEvent({ userId: BEN_ID, role: 'debater-B', screenName: 'ben', sequence: 2 }),
    ];
    expect(derivePartipantScreenNames(events)).toEqual(
      new Map([
        [ALICE_ID, 'alice'],
        [BEN_ID, 'ben'],
      ]),
    );
  });

  it('excludes the moderator role', () => {
    const events: Event[] = [
      joinedEvent({ userId: MODERATOR_ID, role: 'moderator', screenName: 'mod', sequence: 1 }),
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 2 }),
    ];
    const result = derivePartipantScreenNames(events);
    expect(result.has(MODERATOR_ID)).toBe(false);
    expect(result.get(ALICE_ID)).toBe('alice');
  });

  it('removes a participant on participant-left', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
      joinedEvent({ userId: BEN_ID, role: 'debater-B', screenName: 'ben', sequence: 2 }),
      leftEvent(ALICE_ID, 3),
    ];
    const result = derivePartipantScreenNames(events);
    expect(result.has(ALICE_ID)).toBe(false);
    expect(result.get(BEN_ID)).toBe('ben');
  });

  it('re-add on rejoin replaces the screen name', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'old-name', sequence: 1 }),
      leftEvent(ALICE_ID, 2),
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'new-name', sequence: 3 }),
    ];
    expect(derivePartipantScreenNames(events).get(ALICE_ID)).toBe('new-name');
  });
});

describe('resolveAxiomMarkErrorMessage — error-code mapping', () => {
  it('maps axiom-mark-not-self → catalog notSelf message', () => {
    const t = (key: string): string => `T:${key}`;
    expect(
      resolveAxiomMarkErrorMessage({ code: 'axiom-mark-not-self', message: 'raw wire' }, t),
    ).toBe('T:moderator.axiomMarkAction.errorBanner.notSelf');
  });

  it('maps timeout → catalog timeout message', () => {
    const t = (key: string): string => `T:${key}`;
    expect(resolveAxiomMarkErrorMessage({ code: 'timeout', message: 'whatever' }, t)).toBe(
      'T:moderator.axiomMarkAction.errorBanner.timeout',
    );
  });

  it('unmapped code with a non-empty message → message verbatim', () => {
    const t = (key: string): string => `T:${key}`;
    expect(
      resolveAxiomMarkErrorMessage({ code: 'unknown', message: 'something went wrong' }, t),
    ).toBe('something went wrong');
  });

  it('unmapped code with an empty message → catalog unknown message', () => {
    const t = (key: string): string => `T:${key}`;
    expect(resolveAxiomMarkErrorMessage({ code: 'unknown', message: '' }, t)).toBe(
      'T:moderator.axiomMarkAction.errorBanner.unknown',
    );
  });
});

describe('AxiomMarkSubmenu — render shape', () => {
  it('renders the header from the catalog', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.getByTestId('axiom-mark-submenu-header').textContent).toBe('Mark as axiom for…');
  });

  it('renders one button per joined non-moderator participant', () => {
    const events: Event[] = [
      joinedEvent({ userId: MODERATOR_ID, role: 'moderator', screenName: 'mod', sequence: 1 }),
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 2 }),
      joinedEvent({ userId: BEN_ID, role: 'debater-B', screenName: 'ben', sequence: 3 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.queryByTestId(`axiom-mark-submenu-participant-${MODERATOR_ID}`)).toBeNull();
    const aliceBtn = screen.getByTestId(`axiom-mark-submenu-participant-${ALICE_ID}`);
    const benBtn = screen.getByTestId(`axiom-mark-submenu-participant-${BEN_ID}`);
    expect(aliceBtn.textContent).toBe('alice');
    expect(benBtn.textContent).toBe('ben');
  });

  it('renders the empty-state row when no debaters have joined', () => {
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={[]}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.getByTestId('axiom-mark-submenu-empty').textContent).toBe(
      'No debaters have joined yet',
    );
    expect(screen.queryByTestId(`axiom-mark-submenu-participant-${ALICE_ID}`)).toBeNull();
  });

  it('renders the empty-state row when only the moderator has joined', () => {
    const events: Event[] = [
      joinedEvent({ userId: MODERATOR_ID, role: 'moderator', screenName: 'mod', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.queryByTestId('axiom-mark-submenu-empty')).not.toBeNull();
  });

  it('stamps the bound nodeId on the menu root for downstream tests', () => {
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={[]}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const root = screen.getByTestId('axiom-mark-submenu');
    expect(root.getAttribute('data-node-id')).toBe(NODE_ID);
  });
});

describe('AxiomMarkSubmenu — click behavior', () => {
  it('clicking a participant button calls markAxiom with that participantId', () => {
    const markAxiom = vi.fn(() => Promise.resolve());
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride({ markAxiom })}
        />,
      ),
    );
    const button = screen.getByTestId(`axiom-mark-submenu-participant-${ALICE_ID}`);
    fireEvent.click(button);
    expect(markAxiom).toHaveBeenCalledTimes(1);
    expect(markAxiom).toHaveBeenCalledWith(ALICE_ID);
  });

  it('clicking a participant button calls onClose after the markAxiom promise settles', async () => {
    const onClose = vi.fn();
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={onClose}
          hookOverride={makeHookOverride({ markAxiom: () => Promise.resolve() })}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId(`axiom-mark-submenu-participant-${ALICE_ID}`));
    // The .finally() runs after the microtask queue flushes; wait one
    // microtask tick before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a button whose inFlightFor returns true is disabled and carries data-axiom-mark-state="in-flight"', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride({
            inFlightFor: (id) => id === ALICE_ID,
          })}
        />,
      ),
    );
    const button = screen.getByTestId(`axiom-mark-submenu-participant-${ALICE_ID}`);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('data-axiom-mark-state')).toBe('in-flight');
  });
});

describe('AxiomMarkSubmenu — inline error region', () => {
  it('renders the error region with the localized notSelf message for axiom-mark-not-self', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride({
            lastErrorFor: (id) =>
              id === ALICE_ID
                ? { code: 'axiom-mark-not-self', message: 'raw wire message' }
                : undefined,
          })}
        />,
      ),
    );
    const errorRegion = screen.getByTestId('axiom-mark-submenu-error');
    expect(errorRegion.textContent).toBe(
      'Axiom-marks are personal — the debater must propose this from their own tablet',
    );
    expect(errorRegion.getAttribute('data-error-code')).toBe('axiom-mark-not-self');
  });

  it('does not render the error region when lastErrorFor returns undefined', () => {
    const events: Event[] = [
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.queryByTestId('axiom-mark-submenu-error')).toBeNull();
  });
});

describe('AxiomMarkSubmenu — locale parity (header, empty, notSelf × en-US / pt-BR / es-419)', () => {
  const cases = [
    {
      locale: 'en-US',
      header: 'Mark as axiom for…',
      empty: 'No debaters have joined yet',
      notSelf: 'Axiom-marks are personal — the debater must propose this from their own tablet',
    },
    {
      locale: 'pt-BR',
      header: 'Marcar como axioma para…',
      empty: 'Nenhum debatedor entrou ainda',
      notSelf:
        'Marcas de axioma são pessoais — o debatedor precisa propor isso a partir do seu próprio tablet',
    },
    {
      locale: 'es-419',
      header: 'Marcar como axioma para…',
      empty: 'Ningún debatedor se ha unido aún',
      notSelf:
        'Las marcas de axioma son personales — el debatedor debe proponer esto desde su propia tableta',
    },
  ] as const;

  for (const { locale, header, empty, notSelf } of cases) {
    it(`${locale} — header text resolves to the catalog string`, async () => {
      await i18next.changeLanguage(locale);
      render(
        wrap(
          <AxiomMarkSubmenu
            nodeId={NODE_ID}
            x={100}
            y={200}
            events={[]}
            onClose={() => undefined}
            hookOverride={makeHookOverride()}
          />,
        ),
      );
      expect(screen.getByTestId('axiom-mark-submenu-header').textContent).toBe(header);
    });

    it(`${locale} — empty-state text resolves to the catalog string`, async () => {
      await i18next.changeLanguage(locale);
      render(
        wrap(
          <AxiomMarkSubmenu
            nodeId={NODE_ID}
            x={100}
            y={200}
            events={[]}
            onClose={() => undefined}
            hookOverride={makeHookOverride()}
          />,
        ),
      );
      expect(screen.getByTestId('axiom-mark-submenu-empty').textContent).toBe(empty);
    });

    it(`${locale} — notSelf error text resolves to the catalog string`, async () => {
      await i18next.changeLanguage(locale);
      const events: Event[] = [
        joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 1 }),
      ];
      render(
        wrap(
          <AxiomMarkSubmenu
            nodeId={NODE_ID}
            x={100}
            y={200}
            events={events}
            onClose={() => undefined}
            hookOverride={makeHookOverride({
              lastErrorFor: (id) =>
                id === ALICE_ID ? { code: 'axiom-mark-not-self', message: 'x' } : undefined,
            })}
          />,
        ),
      );
      expect(screen.getByTestId('axiom-mark-submenu-error').textContent).toBe(notSelf);
    });
  }
});

describe('AxiomMarkSubmenu — sort order', () => {
  it('participants render in screen-name alphabetical order', () => {
    const events: Event[] = [
      joinedEvent({ userId: CARLA_ID, role: 'debater-A', screenName: 'carla', sequence: 1 }),
      joinedEvent({ userId: ALICE_ID, role: 'debater-A', screenName: 'alice', sequence: 2 }),
      joinedEvent({ userId: BEN_ID, role: 'debater-B', screenName: 'ben', sequence: 3 }),
    ];
    render(
      wrap(
        <AxiomMarkSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          events={events}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid^="axiom-mark-submenu-participant-"]',
    );
    expect(Array.from(buttons).map((b) => b.getAttribute('data-participant-id'))).toEqual([
      ALICE_ID,
      BEN_ID,
      CARLA_ID,
    ]);
  });
});
