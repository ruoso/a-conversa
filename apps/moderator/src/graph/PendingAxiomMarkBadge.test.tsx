// Tests for `<PendingAxiomMarkBadge>` — the small per-participant dot
// rendering one IN-FLIGHT (proposed-but-not-yet-committed) axiom-mark
// on a statement node.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_pending_render.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. The localized tooltip (`title`) resolves through `useTranslation`
//      against `methodology.axiomMark.pendingTooltip` for each of the
//      three v1 locales (3 locales × tooltip + srLabel + glyph = 9
//      cross-locale cases).
//   2. `data-participant-id` mirrors the prop — same seam shape as the
//      committed `<AxiomMarkBadge>` so per-participant assertions /
//      styling layer across both lifecycles.
//   3. `data-pending="true"` — the new boolean attribute (Decision §5)
//      that lets downstream selectors target "every pending axiom-mark
//      on this node" without per-participant DOM walking.
//   4. `data-testid` follows the `pending-axiom-mark-badge-{nodeId}-
//      {participantId}` shape — distinct from the committed testid
//      shape so existing committed-side tests stay stable.
//   5. Per-participant color determinism — rendering the same
//      participantId twice produces the same Tailwind background class
//      (the participant-color attribution survives the proposed-state
//      overlay, per Decision §3).
//   6. The proposed-state overlay composes correctly — the className
//      includes `border-dashed` AND `opacity-60` (the dashed slate
//      border + faded 60% opacity per `mod_proposed_state_styling`).
//   7. Per-participant color survives the overlay — the className
//      includes the per-participant `bg-…-100` AND `ring-…-300`
//      (Decision §3 — the moderator can still identify whose mark is
//      pending under the fade).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';

import { PendingAxiomMarkBadge } from './PendingAxiomMarkBadge';
import type { PendingAxiomMark } from './selectors';
import { axiomMarkColorFor, createI18nInstance } from '@a-conversa/shell';

// Local `render(...)` shadow that flushes the microtask-deferred
// setState scheduled by `useTranslation()` (react-i18next subscribes
// to the i18next instance on mount, which schedules a deferred state
// update). Wrapping `rtlRender(...)` in `await act(async () => …)`
// absorbs that deferred update inside the act block, eliminating the
// "An update to <Component> was not wrapped in act(...)" warning that
// surfaces now that `globalThis.IS_REACT_ACT_ENVIRONMENT = true`.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  // `act` takes the async (microtask-flushing) path when the callback
  // returns a thenable — `return Promise.resolve()` is enough; no
  // `async` keyword (which would trip `require-await` since the body
  // does not await anything).
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const NODE_ID = '00000000-0000-4000-8000-000000000a02';
// PARTICIPANT_A and PARTICIPANT_B hash to two distinct palette buckets
// (sum-of-hex-digits mod 6 = 1 / 2) so the cross-participant distinct-
// color test below pins per-participant differentiation under the
// proposed-state overlay. Same constants as the committed-badge tests
// in `AxiomMarkBadge.test.tsx`.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';

function makeMark(overrides: Partial<PendingAxiomMark> = {}): PendingAxiomMark {
  return {
    proposalEventId: overrides.proposalEventId ?? PROPOSAL_ID,
    nodeId: overrides.nodeId ?? NODE_ID,
    participantId: overrides.participantId ?? PARTICIPANT_A,
    proposedAt: overrides.proposedAt ?? '2026-05-16T00:00:00.000Z',
  };
}

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('PendingAxiomMarkBadge — localized tooltip per locale', () => {
  const EXPECTED = {
    'en-US': {
      tooltip: `Pending axiom mark by ${PARTICIPANT_A}`,
      srLabel: `Pending axiom mark from participant ${PARTICIPANT_A} — not yet committed`,
    },
    'pt-BR': {
      tooltip: `Marca de axioma pendente por ${PARTICIPANT_A}`,
      srLabel: `Marca de axioma pendente do participante ${PARTICIPANT_A} — ainda não confirmada`,
    },
    'es-419': {
      tooltip: `Marca de axioma pendiente por ${PARTICIPANT_A}`,
      srLabel: `Marca de axioma pendiente del participante ${PARTICIPANT_A} — aún no confirmada`,
    },
  } as const;

  for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
    it(`renders the localized tooltip for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      await render(<PendingAxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('title')).toBe(EXPECTED[locale].tooltip);
    });

    it(`renders the localized aria-label for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      await render(<PendingAxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.getAttribute('aria-label')).toBe(EXPECTED[locale].srLabel);
    });

    it(`renders the visible "A" glyph for ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      await render(<PendingAxiomMarkBadge mark={makeMark()} />);
      const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
      expect(badge.textContent).toBe('A');
    });
  }
});

describe('PendingAxiomMarkBadge — data attributes', () => {
  it('exposes `data-participant-id` matching the participantId prop', async () => {
    await render(<PendingAxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_B })} />);
    const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_B);
  });

  it('stamps `data-pending="true"` on every pending badge', async () => {
    // Decision §5 — distinct boolean attribute for the "this is the
    // pending variant" seam. Distinct from `data-facet-status` (which
    // is reserved for the per-facet state machine — axiom-marks are
    // not facets per `mod_axiom_mark_decoration` Decision).
    await render(<PendingAxiomMarkBadge mark={makeMark()} />);
    const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(badge.getAttribute('data-pending')).toBe('true');
  });

  it('exposes a testid of the form `pending-axiom-mark-badge-{nodeId}-{participantId}`', async () => {
    // Distinct from the committed `axiom-mark-badge-{nodeId}-…` testid
    // shape so existing committed-side tests stay stable (Decision §5).
    const mark = makeMark({ nodeId: NODE_ID, participantId: PARTICIPANT_A });
    await render(<PendingAxiomMarkBadge mark={mark} />);
    expect(screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`)).toBeTruthy();
  });
});

describe('PendingAxiomMarkBadge — per-participant deterministic color survives the overlay', () => {
  it('applies the same Tailwind background class for the same participantId across two renders', async () => {
    const expectedColor = axiomMarkColorFor(PARTICIPANT_A);
    const { unmount } = await render(<PendingAxiomMarkBadge mark={makeMark()} />);
    const first = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const firstClassName = first.className;
    expect(firstClassName).toContain(expectedColor.bg);
    expect(firstClassName).toContain(expectedColor.text);
    expect(firstClassName).toContain(expectedColor.ring);
    unmount();
    await render(<PendingAxiomMarkBadge mark={makeMark()} />);
    const second = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(second.className).toBe(firstClassName);
  });

  it('applies a different background class for a different participantId', async () => {
    await render(<PendingAxiomMarkBadge mark={makeMark({ participantId: PARTICIPANT_A })} />);
    await render(
      <PendingAxiomMarkBadge
        mark={makeMark({
          proposalEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          participantId: PARTICIPANT_B,
        })}
      />,
    );
    const a = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    const b = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_B}`);
    const aColor = axiomMarkColorFor(PARTICIPANT_A);
    const bColor = axiomMarkColorFor(PARTICIPANT_B);
    expect(aColor.bg).not.toBe(bColor.bg);
    expect(a.className).toContain(aColor.bg);
    expect(b.className).toContain(bColor.bg);
  });
});

describe('PendingAxiomMarkBadge — proposed-state overlay composition', () => {
  it('includes `border-dashed` AND `opacity-60` (the proposed-state visual contract per mod_proposed_state_styling)', async () => {
    // Decision §3 — the proposed-state overlay is the dashed slate
    // border + opacity-60 fade. Both classes must be present so the
    // visual vocabulary matches the rest of the proposed-state surface
    // (the card frame + facet pills).
    await render(<PendingAxiomMarkBadge mark={makeMark()} />);
    const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    expect(badge.className).toContain('border-dashed');
    expect(badge.className).toContain('opacity-60');
    // The dashed border is slate-400 specifically (Decision §3 — the
    // slate palette signals "in flight" across every state-styling
    // task; reusing the same border-color keeps the visual vocabulary
    // consistent with the card frame's proposed state).
    expect(badge.className).toContain('border-slate-400');
  });

  it('keeps the per-participant background + ring under the overlay (attribution survives the fade)', async () => {
    // Decision §3 — losing per-participant attribution at the moment
    // the moderator most needs to anticipate the vote flow was
    // explicitly rejected. The participant-color background + ring stay
    // underneath the dashed slate border + opacity-60 overlay so the
    // moderator can still identify whose mark is pending.
    const color = axiomMarkColorFor(PARTICIPANT_A);
    await render(<PendingAxiomMarkBadge mark={makeMark()} />);
    const badge = screen.getByTestId(`pending-axiom-mark-badge-${NODE_ID}-${PARTICIPANT_A}`);
    // `bg-…-100` (background) AND `ring-…-300` (ring halo) both
    // present despite the proposed-state overlay.
    expect(badge.className).toContain(color.bg);
    expect(badge.className).toContain(color.ring);
  });
});
