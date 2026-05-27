// Vitest cases for `<AxiomMarkBadge>` — participant-local chromatic
// badge for one committed axiom-mark.
//
// Refinement: tasks/refinements/participant-ui/part_entity_detail_panel_chromatic_axiom_mark_badge.md
//
// Per ADR 0022 these are committed Vitest cases pinning:
//
//   (a) testid + data-participant-id seam;
//   (b) chromatic class triple matches `axiomMarkColorFor(participantId)`
//       for two participants in distinct palette buckets;
//   (c) `title` carries the resolved screen name verbatim;
//   (d) `aria-label` resolves through
//       `participant.detailPanel.axiomMarkBadge.srLabel`;
//   (e) the centered "A" glyph renders as the badge's text content.

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

import { axiomMarkColorFor, createI18nInstance } from '@a-conversa/shell';

import { AxiomMarkBadge } from './AxiomMarkBadge';

// Local `render(...)` shadow wrapping the synchronous testing-library
// render in `await act(async () => { ... })` — same posture as the
// moderator's `AxiomMarkBadge.test.tsx` (mirrored verbatim). Absorbs the
// `useTranslation` microtask-deferred setState fired after mount.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

// PARTICIPANT_A / PARTICIPANT_B hash to two distinct palette buckets
// (sum-of-hex-digits mod 6 = 1 / 2) so the cross-participant distinct-
// color test below pins the per-participant differentiation.
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('AxiomMarkBadge — data attributes + testid', () => {
  it('(a) exposes data-participant-id + testid of the form participant-detail-panel-axiom-mark-badge-{participantId}', async () => {
    await render(<AxiomMarkBadge participantId={PARTICIPANT_A} screenName="alice" />);
    const badge = screen.getByTestId(`participant-detail-panel-axiom-mark-badge-${PARTICIPANT_A}`);
    expect(badge.getAttribute('data-participant-id')).toBe(PARTICIPANT_A);
  });
});

describe('AxiomMarkBadge — per-participant deterministic chromatic class triple', () => {
  it('(b) applies the chromatic class triple (bg/text/ring) matching axiomMarkColorFor for two distinct participantIds in two distinct palette buckets', async () => {
    await render(<AxiomMarkBadge participantId={PARTICIPANT_A} screenName="alice" />);
    const a = screen.getByTestId(`participant-detail-panel-axiom-mark-badge-${PARTICIPANT_A}`);
    const aColor = axiomMarkColorFor(PARTICIPANT_A);
    expect(a.className).toContain(aColor.bg);
    expect(a.className).toContain(aColor.text);
    expect(a.className).toContain(aColor.ring);

    await render(<AxiomMarkBadge participantId={PARTICIPANT_B} screenName="ben" />);
    const b = screen.getByTestId(`participant-detail-panel-axiom-mark-badge-${PARTICIPANT_B}`);
    const bColor = axiomMarkColorFor(PARTICIPANT_B);
    expect(bColor.bg).not.toBe(aColor.bg);
    expect(b.className).toContain(bColor.bg);
    expect(b.className).toContain(bColor.text);
    expect(b.className).toContain(bColor.ring);
  });
});

describe('AxiomMarkBadge — tooltip + aria-label + glyph', () => {
  it('(c) sets the title attribute to the passed screen name verbatim', async () => {
    await render(<AxiomMarkBadge participantId={PARTICIPANT_A} screenName="alice" />);
    const badge = screen.getByTestId(`participant-detail-panel-axiom-mark-badge-${PARTICIPANT_A}`);
    expect(badge.getAttribute('title')).toBe('alice');
  });

  it('(d) resolves the aria-label through participant.detailPanel.axiomMarkBadge.srLabel', async () => {
    await render(<AxiomMarkBadge participantId={PARTICIPANT_A} screenName="alice" />);
    const badge = screen.getByTestId(`participant-detail-panel-axiom-mark-badge-${PARTICIPANT_A}`);
    expect(badge.getAttribute('aria-label')).toBe('Bedrock by alice');
  });

  it('(e) renders the centered "A" glyph as the badge text content', async () => {
    await render(<AxiomMarkBadge participantId={PARTICIPANT_A} screenName="alice" />);
    const badge = screen.getByTestId(`participant-detail-panel-axiom-mark-badge-${PARTICIPANT_A}`);
    expect(badge.textContent).toBe('A');
  });
});
