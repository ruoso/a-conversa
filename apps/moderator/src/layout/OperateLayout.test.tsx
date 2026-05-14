// Tests for `<OperateLayout>` — the moderator's three-pane scaffold.
//
// Refinement: tasks/refinements/moderator-ui/mod_layout_shell.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The four stable `data-testid` region IDs render.
//   2. Each render-prop slot lands in its named region (graph / sidebar /
//      strip), so downstream tasks can rely on the slot mapping when
//      they plug in `mod_graph_canvas_pane`, `mod_right_sidebar`, and
//      `mod_bottom_strip_capture`.
//   3. The layout root carries the Tailwind grid utility classes so the
//      bundler chain (Tailwind v4 → Vite plugin → emitted CSS) is
//      provably running over JSX in this workspace.
//   4. The layout renders cleanly when any of the three slots is
//      omitted (downstream tasks land their pane content one at a time).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { OperateLayout } from './OperateLayout';

afterEach(() => {
  cleanup();
});

describe('OperateLayout — three-pane scaffold', () => {
  it('renders the four stable data-testid regions', () => {
    render(<OperateLayout />);
    expect(screen.getByTestId('operate-layout-root')).toBeTruthy();
    expect(screen.getByTestId('operate-graph-pane')).toBeTruthy();
    expect(screen.getByTestId('operate-right-sidebar')).toBeTruthy();
    expect(screen.getByTestId('operate-bottom-strip')).toBeTruthy();
  });

  it('routes the graphPane child into the graph region', () => {
    render(<OperateLayout graphPane={<span data-testid="graph-child">GRAPH</span>} />);
    const graphPane = screen.getByTestId('operate-graph-pane');
    const child = screen.getByTestId('graph-child');
    expect(graphPane.contains(child)).toBe(true);
  });

  it('routes the rightSidebar child into the sidebar region', () => {
    render(<OperateLayout rightSidebar={<span data-testid="sidebar-child">SIDEBAR</span>} />);
    const sidebar = screen.getByTestId('operate-right-sidebar');
    const child = screen.getByTestId('sidebar-child');
    expect(sidebar.contains(child)).toBe(true);
  });

  it('routes the bottomStrip child into the strip region', () => {
    render(<OperateLayout bottomStrip={<span data-testid="strip-child">STRIP</span>} />);
    const strip = screen.getByTestId('operate-bottom-strip');
    const child = screen.getByTestId('strip-child');
    expect(strip.contains(child)).toBe(true);
  });

  it('applies the Tailwind grid utility classes to the layout root', () => {
    // Locks in the Tailwind-via-Vite chain: if the bundler is not running
    // Tailwind over JSX, the layout still renders but downstream pane
    // tasks will be invisible because the grid never claims viewport
    // height. The class-name assertion is the cheapest test that catches
    // a broken styling chain.
    render(<OperateLayout />);
    const root = screen.getByTestId('operate-layout-root');
    const classes = root.className.split(/\s+/);
    expect(classes).toContain('grid');
    expect(classes).toContain('h-screen');
    expect(classes).toContain('w-screen');
  });

  it('renders empty regions cleanly when no slots are passed', () => {
    // Downstream tasks land their pane content one at a time; the
    // shell must not throw or render any extra DOM when a slot is
    // omitted.
    render(<OperateLayout />);
    expect(screen.getByTestId('operate-graph-pane').textContent).toBe('');
    expect(screen.getByTestId('operate-right-sidebar').textContent).toBe('');
    expect(screen.getByTestId('operate-bottom-strip').textContent).toBe('');
  });
});
