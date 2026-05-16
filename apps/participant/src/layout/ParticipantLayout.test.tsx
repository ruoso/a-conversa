// Tests for `<ParticipantLayout>` — the participant tablet's landscape
// chrome shell.
//
// Refinement: tasks/refinements/participant-ui/part_landscape_layout.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The four stable `data-testid` region IDs render.
//   2. Each render-prop slot lands in its named region (header / main /
//      footer), so downstream tasks can rely on the slot mapping when
//      they plug in `part_status_indicator` (footer) and the future
//      session-join / graph-view leaves (main).
//   3. The layout root carries the Tailwind grid utility classes so the
//      bundler chain (Tailwind v4 → Vite plugin → emitted CSS) is
//      provably running over JSX in this workspace.
//   4. The layout renders cleanly when any of the three slots is
//      omitted (the footer specifically is empty today; downstream
//      `part_status_indicator` lands the chip in a separate commit).
//
// Mirrors `apps/moderator/src/layout/OperateLayout.test.tsx` except
// for the region names and the number of slots (three vs. three).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ParticipantLayout } from './ParticipantLayout';

afterEach(() => {
  cleanup();
});

describe('ParticipantLayout — landscape chrome shell', () => {
  it('renders the four stable data-testid regions', () => {
    render(<ParticipantLayout />);
    expect(screen.getByTestId('participant-layout-root')).toBeTruthy();
    expect(screen.getByTestId('participant-header')).toBeTruthy();
    expect(screen.getByTestId('participant-main')).toBeTruthy();
    expect(screen.getByTestId('participant-footer')).toBeTruthy();
  });

  it('routes the header child into the header region', () => {
    render(<ParticipantLayout header={<span data-testid="header-child">HEADER</span>} />);
    const header = screen.getByTestId('participant-header');
    const child = screen.getByTestId('header-child');
    expect(header.contains(child)).toBe(true);
  });

  it('routes the main child into the main region', () => {
    render(<ParticipantLayout main={<span data-testid="main-child">MAIN</span>} />);
    const main = screen.getByTestId('participant-main');
    const child = screen.getByTestId('main-child');
    expect(main.contains(child)).toBe(true);
  });

  it('routes the footer child into the footer region', () => {
    render(<ParticipantLayout footer={<span data-testid="footer-child">FOOTER</span>} />);
    const footer = screen.getByTestId('participant-footer');
    const child = screen.getByTestId('footer-child');
    expect(footer.contains(child)).toBe(true);
  });

  it('applies the Tailwind grid utility classes to the layout root', () => {
    // Locks in the Tailwind-via-Vite chain: if the bundler is not running
    // Tailwind over JSX, the layout still renders but downstream slot
    // content will be invisible because the grid never claims viewport
    // height. The class-name assertion is the cheapest test that catches
    // a broken styling chain.
    render(<ParticipantLayout />);
    const root = screen.getByTestId('participant-layout-root');
    const classes = root.className.split(/\s+/);
    expect(classes).toContain('grid');
    expect(classes).toContain('h-screen');
    expect(classes).toContain('w-screen');
  });

  it('renders empty regions cleanly when no slots are passed', () => {
    // The footer specifically is empty today (the chip is
    // `part_status_indicator`'s deliverable); the shell must not throw
    // or render any extra DOM when a slot is omitted.
    render(<ParticipantLayout />);
    expect(screen.getByTestId('participant-header').textContent).toBe('');
    expect(screen.getByTestId('participant-main').textContent).toBe('');
    expect(screen.getByTestId('participant-footer').textContent).toBe('');
  });
});
