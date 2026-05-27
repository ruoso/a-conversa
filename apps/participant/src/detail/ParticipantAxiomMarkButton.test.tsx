// Vitest cases for `<ParticipantAxiomMarkButton>` — the participant
// detail-panel axiom-mark affordance mounted into `<EntityDetailPanel>`'s
// `actionSlot`.
//
// Refinement: tasks/refinements/participant-ui/part_mark_axiom_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock:
//
//   1. **Selector contract** — `data-testid="participant-axiom-mark-button"`
//      + `data-node-id` round-trip the bound `nodeId` so the locked
//      Playwright Phase 7.1 selector keeps biting.
//   2. **Suppression** — `alreadyMarked === true` returns `null` (the
//      panel's `AxiomMarkAttributionSection` surfaces the existing mark
//      already, so a second affordance would be incoherent).
//   3. **Click → hook dispatch** — one click fires exactly one
//      `markAsAxiom()` call through the (mocked) hook.
//   4. **In-flight visual** — `inFlight: true` flips
//      `data-axiom-mark-state`, sets `disabled` + `aria-disabled`, and
//      swaps the label to the `inFlightLabel` catalog string.
//   5. **Inline wire-error region** — `lastError !== undefined` renders
//      a `role="alert"` region carrying the formatted localized
//      message. Timeout errors surface the pre-localized fallback
//      directly; other codes interpolate `{code}` + `{message}` through
//      `participant.axiomMarkButton.wireError`.
//   6. **i18n keys resolve through `useTranslation()`** — section
//      heading, button label, aria-label all hit en-US catalog values
//      verbatim (catalog-snapshot assertion).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { createI18nInstance, I18nProvider, type I18nInstance } from '@a-conversa/shell';

import { ParticipantAxiomMarkButton } from './ParticipantAxiomMarkButton';
import { useAxiomMarkAction, type UseAxiomMarkActionResult } from './useAxiomMarkAction';

vi.mock('./useAxiomMarkAction', () => ({
  useAxiomMarkAction: vi.fn(
    (): UseAxiomMarkActionResult => ({
      markAsAxiom: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    }),
  ),
}));

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

beforeEach(() => {
  vi.mocked(useAxiomMarkAction).mockReturnValue({
    markAsAxiom: () => Promise.resolve(),
    inFlight: false,
    lastError: undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderButton(props: {
  nodeId?: string;
  currentParticipantId?: string;
  alreadyMarked?: boolean;
}): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <ParticipantAxiomMarkButton
        nodeId={props.nodeId ?? NODE_ID}
        currentParticipantId={props.currentParticipantId ?? PARTICIPANT_ID}
        alreadyMarked={props.alreadyMarked ?? false}
      />
    </I18nProvider>,
  );
}

describe('<ParticipantAxiomMarkButton> — selector contract', () => {
  it('renders the button with data-testid + data-node-id when alreadyMarked === false', () => {
    renderButton({ alreadyMarked: false });
    const button = screen.getByTestId('participant-axiom-mark-button');
    expect(button.getAttribute('data-node-id')).toBe(NODE_ID);
    expect(button.tagName).toBe('BUTTON');
  });

  it('mounts the surrounding section under participant-detail-panel-axiom-mark-section', () => {
    renderButton({ alreadyMarked: false });
    expect(screen.getByTestId('participant-detail-panel-axiom-mark-section')).toBeDefined();
  });

  it('passes the nodeId + participantId arg through to useAxiomMarkAction', () => {
    renderButton({ alreadyMarked: false });
    expect(useAxiomMarkAction).toHaveBeenCalledWith({
      nodeId: NODE_ID,
      participantId: PARTICIPANT_ID,
    });
  });
});

describe('<ParticipantAxiomMarkButton> — suppression when alreadyMarked', () => {
  it('returns null when alreadyMarked === true (no button, no section)', () => {
    const { container } = renderButton({ alreadyMarked: true });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('participant-axiom-mark-button')).toBeNull();
    expect(screen.queryByTestId('participant-detail-panel-axiom-mark-section')).toBeNull();
  });
});

describe('<ParticipantAxiomMarkButton> — click dispatches markAsAxiom', () => {
  it('clicking the button calls markAsAxiom() exactly once', () => {
    const markAsAxiom = vi.fn(() => Promise.resolve());
    vi.mocked(useAxiomMarkAction).mockReturnValue({
      markAsAxiom,
      inFlight: false,
      lastError: undefined,
    });

    renderButton({ alreadyMarked: false });
    const button = screen.getByTestId('participant-axiom-mark-button');
    fireEvent.click(button);

    expect(markAsAxiom).toHaveBeenCalledTimes(1);
  });
});

describe('<ParticipantAxiomMarkButton> — in-flight visual', () => {
  it('flips data-axiom-mark-state + disabled + aria-disabled + label when inFlight === true', () => {
    vi.mocked(useAxiomMarkAction).mockReturnValue({
      markAsAxiom: () => Promise.resolve(),
      inFlight: true,
      lastError: undefined,
    });

    renderButton({ alreadyMarked: false });
    const button = screen.getByTestId('participant-axiom-mark-button');
    expect(button.getAttribute('data-axiom-mark-state')).toBe('in-flight');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.textContent).toBe('Marking…');
  });

  it('renders data-axiom-mark-state="enabled" + the canonical label when inFlight === false', () => {
    renderButton({ alreadyMarked: false });
    const button = screen.getByTestId('participant-axiom-mark-button');
    expect(button.getAttribute('data-axiom-mark-state')).toBe('enabled');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.textContent).toBe('Mark as my axiom');
  });
});

describe('<ParticipantAxiomMarkButton> — inline wire-error region', () => {
  it('renders no error region when lastError === undefined', () => {
    renderButton({ alreadyMarked: false });
    expect(screen.queryByTestId('participant-axiom-mark-button-wire-error')).toBeNull();
  });

  it('renders the wireError-template interpolation for a non-timeout error code', () => {
    vi.mocked(useAxiomMarkAction).mockReturnValue({
      markAsAxiom: () => Promise.resolve(),
      inFlight: false,
      lastError: { code: 'axiom-mark-not-self', message: 'not your node' },
    });

    renderButton({ alreadyMarked: false });
    const region = screen.getByTestId('participant-axiom-mark-button-wire-error');
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-node-id')).toBe(NODE_ID);
    expect(region.getAttribute('aria-label')).toBe('Axiom-mark error');
    expect(region.textContent).toBe('Axiom-mark failed: not your node (axiom-mark-not-self)');
  });

  it('renders the pre-localized fallback message verbatim for a timeout error', () => {
    vi.mocked(useAxiomMarkAction).mockReturnValue({
      markAsAxiom: () => Promise.resolve(),
      inFlight: false,
      lastError: {
        code: 'timeout',
        message: 'The axiom-mark request timed out. Check your connection and try again.',
      },
    });

    renderButton({ alreadyMarked: false });
    const region = screen.getByTestId('participant-axiom-mark-button-wire-error');
    expect(region.textContent).toBe(
      'The axiom-mark request timed out. Check your connection and try again.',
    );
  });
});

describe('<ParticipantAxiomMarkButton> — i18n catalog snapshot (en-US)', () => {
  it('resolves section heading, label, and aria-label through useTranslation', () => {
    renderButton({ alreadyMarked: false });
    expect(screen.getByText('My axioms')).toBeDefined();

    const button = screen.getByTestId('participant-axiom-mark-button');
    expect(button.textContent).toBe('Mark as my axiom');
    expect(button.getAttribute('aria-label')).toBe(
      'Mark this statement as one of my axioms (bedrock for me)',
    );
  });
});
