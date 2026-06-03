// Vitest cases for `<ParticipantAnnotationDisputeButton>` — the participant
// detail-panel annotation-dispute affordance mounted into
// `<EntityDetailPanel>`'s `actionSlot` when the selection is an annotation.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_dispute_e2e.md
//
// Per ADR 0022 these are committed Vitest cases. They lock:
//
//   1. **Selector contract** — `data-testid="participant-annotation-dispute-button"`
//      + `data-annotation-id` round-trip the bound `annotationId` so the
//      e2e round-trip selector keeps biting.
//   2. **Hook target** — the button binds `useVoteAction` to the facet arm
//      `{ entity_kind:'annotation', entity_id:<id>, facet:'substance' }`
//      (ADR 0038 / `annotation_facet_vote_seam`).
//   3. **Click → dispute dispatch** — one click fires exactly one
//      `castVote('dispute')` through the (mocked) hook.
//   4. **In-flight visual** — `inFlight: true` flips `data-dispute-state`,
//      sets `disabled` + `aria-disabled`, and swaps the label to the
//      `inFlightLabel` catalog string.
//   5. **Resolved status** — `substanceStatus` is reflected on
//      `data-facet-status` so the spec can read the settled `disputed`
//      state off the affordance; absent it floors to `'none'`.
//   6. **Inline wire-error region** — `lastError !== undefined` renders a
//      `role="alert"` region carrying the formatted localized message
//      (where the seam's already-voted rejection surfaces).
//
// The annotation-row → annotation-selection navigation that makes this
// affordance reachable is covered in `EntityDetailPanel.test.tsx`
// (the row lives inside the panel).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { createI18nInstance, I18nProvider, type I18nInstance } from '@a-conversa/shell';

import { ParticipantAnnotationDisputeButton } from './ParticipantAnnotationDisputeButton';
import { useVoteAction, type UseVoteActionResult } from './useVoteAction';

vi.mock('./useVoteAction', () => ({
  useVoteAction: vi.fn(
    (): UseVoteActionResult => ({
      castVote: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    }),
  ),
}));

const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';

let i18n: I18nInstance;

beforeAll(async () => {
  i18n = await createI18nInstance('en-US');
});

beforeEach(() => {
  vi.mocked(useVoteAction).mockReturnValue({
    castVote: () => Promise.resolve(),
    inFlight: false,
    lastError: undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderButton(props: {
  annotationId?: string;
  substanceStatus?: Parameters<typeof ParticipantAnnotationDisputeButton>[0]['substanceStatus'];
}): ReturnType<typeof render> {
  return render(
    <I18nProvider i18n={i18n}>
      <ParticipantAnnotationDisputeButton
        annotationId={props.annotationId ?? ANNOTATION_ID}
        substanceStatus={props.substanceStatus}
      />
    </I18nProvider>,
  );
}

describe('<ParticipantAnnotationDisputeButton> — selector + hook contract', () => {
  it('renders the button with data-testid + data-annotation-id', () => {
    renderButton({});
    const button = screen.getByTestId('participant-annotation-dispute-button');
    expect(button.getAttribute('data-annotation-id')).toBe(ANNOTATION_ID);
    expect(button.tagName).toBe('BUTTON');
  });

  it('mounts the surrounding section under participant-detail-panel-annotation-dispute-section', () => {
    renderButton({});
    expect(screen.getByTestId('participant-detail-panel-annotation-dispute-section')).toBeDefined();
  });

  it('binds useVoteAction to the annotation/substance facet arm', () => {
    renderButton({});
    expect(useVoteAction).toHaveBeenCalledWith({
      entity_kind: 'annotation',
      entity_id: ANNOTATION_ID,
      facet: 'substance',
    });
  });
});

describe('<ParticipantAnnotationDisputeButton> — click dispatches dispute', () => {
  it('clicking the button calls castVote("dispute") exactly once', () => {
    const castVote = vi.fn(() => Promise.resolve());
    vi.mocked(useVoteAction).mockReturnValue({
      castVote,
      inFlight: false,
      lastError: undefined,
    });

    renderButton({});
    fireEvent.click(screen.getByTestId('participant-annotation-dispute-button'));

    expect(castVote).toHaveBeenCalledTimes(1);
    expect(castVote).toHaveBeenCalledWith('dispute');
  });
});

describe('<ParticipantAnnotationDisputeButton> — in-flight visual', () => {
  it('flips data-dispute-state + disabled + aria-disabled + label when inFlight === true', () => {
    vi.mocked(useVoteAction).mockReturnValue({
      castVote: () => Promise.resolve(),
      inFlight: true,
      lastError: undefined,
    });

    renderButton({});
    const button = screen.getByTestId('participant-annotation-dispute-button');
    expect(button.getAttribute('data-dispute-state')).toBe('in-flight');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.textContent).toBe('Sending…');
  });

  it('renders data-dispute-state="enabled" + the canonical label when inFlight === false', () => {
    renderButton({});
    const button = screen.getByTestId('participant-annotation-dispute-button');
    expect(button.getAttribute('data-dispute-state')).toBe('enabled');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(button.textContent).toBe('Dispute');
  });
});

describe('<ParticipantAnnotationDisputeButton> — resolved substance status', () => {
  it('reflects the resolved substance status on data-facet-status', () => {
    renderButton({ substanceStatus: 'disputed' });
    const button = screen.getByTestId('participant-annotation-dispute-button');
    expect(button.getAttribute('data-facet-status')).toBe('disputed');
  });

  it('floors data-facet-status to "none" when no substance status is threaded', () => {
    renderButton({});
    const button = screen.getByTestId('participant-annotation-dispute-button');
    expect(button.getAttribute('data-facet-status')).toBe('none');
  });
});

describe('<ParticipantAnnotationDisputeButton> — inline wire-error region', () => {
  it('renders no error region when lastError === undefined', () => {
    renderButton({});
    expect(screen.queryByTestId('participant-annotation-dispute-button-wire-error')).toBeNull();
  });

  it('renders the wireError-template interpolation for a non-timeout error code', () => {
    vi.mocked(useVoteAction).mockReturnValue({
      castVote: () => Promise.resolve(),
      inFlight: false,
      lastError: { code: 'already-voted', message: 'duplicate vote' },
    });

    renderButton({});
    const region = screen.getByTestId('participant-annotation-dispute-button-wire-error');
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-annotation-id')).toBe(ANNOTATION_ID);
    expect(region.getAttribute('aria-label')).toBe('Vote error');
    expect(region.textContent).toBe('Vote failed: duplicate vote (already-voted)');
  });

  it('renders the pre-localized fallback message verbatim for a timeout error', () => {
    vi.mocked(useVoteAction).mockReturnValue({
      castVote: () => Promise.resolve(),
      inFlight: false,
      lastError: {
        code: 'timeout',
        message: 'The vote request timed out. Check your connection and try again.',
      },
    });

    renderButton({});
    const region = screen.getByTestId('participant-annotation-dispute-button-wire-error');
    expect(region.textContent).toBe(
      'The vote request timed out. Check your connection and try again.',
    );
  });
});

describe('<ParticipantAnnotationDisputeButton> — i18n catalog snapshot (en-US)', () => {
  it('resolves label + aria-label through useTranslation', () => {
    renderButton({});
    const button = screen.getByTestId('participant-annotation-dispute-button');
    expect(button.textContent).toBe('Dispute');
    expect(button.getAttribute('aria-label')).toBe('Dispute this proposal');
  });
});
