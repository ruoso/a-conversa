// Tests for `<BottomStripCapture>` — the bottom-strip capture-pane
// scaffold.
//
// Refinement: tasks/refinements/moderator-ui/mod_bottom_strip_capture.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//   1. The pane renders with the stable `bottom-strip-capture` testid
//      and the labelled `region` role so the structure that downstream
//      capture-flow tasks plug into is regression-tested from the
//      moment it ships.
//   2. The five sub-slot test ids render (mode-banner, text-input,
//      classification, edge-role, propose-action) so the downstream
//      `mod_capture_flow.*` tasks and `mod_mode_banner` can target them
//      without re-deciding the DOM shape.
//   3. Each slot routes its child into the labelled region — the
//      slot-mapping contract that lets the downstream tasks ship
//      independently.
//   4. Placeholder copy is visible when a slot is empty (the
//      pane reads as "wired but unimplemented" rather than blank
//      during the foundation pass).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { BottomStripCapture } from './BottomStripCapture';

afterEach(() => {
  cleanup();
});

describe('BottomStripCapture — bottom-strip capture-pane scaffold', () => {
  it('renders the outer pane region with the stable testid', () => {
    render(<BottomStripCapture />);
    expect(screen.getByTestId('bottom-strip-capture')).toBeTruthy();
  });

  it('exposes the pane as an accessible labelled region', () => {
    render(<BottomStripCapture />);
    const region = screen.getByRole('region', { name: 'Capture pane' });
    expect(region).toBeTruthy();
    expect(region.getAttribute('data-testid')).toBe('bottom-strip-capture');
  });

  it('renders the five sub-slot test ids', () => {
    render(<BottomStripCapture />);
    expect(screen.getByTestId('bottom-strip-mode-banner')).toBeTruthy();
    expect(screen.getByTestId('bottom-strip-text-input')).toBeTruthy();
    expect(screen.getByTestId('bottom-strip-classification')).toBeTruthy();
    expect(screen.getByTestId('bottom-strip-edge-role')).toBeTruthy();
    expect(screen.getByTestId('bottom-strip-propose-action')).toBeTruthy();
  });

  it('shows placeholder copy in every sub-slot when no children are passed', () => {
    render(<BottomStripCapture />);
    expect(screen.getByTestId('bottom-strip-mode-banner').textContent).toBe('[mode banner]');
    expect(screen.getByTestId('bottom-strip-text-input').textContent).toBe('[statement text]');
    expect(screen.getByTestId('bottom-strip-classification').textContent).toBe('[classification]');
    expect(screen.getByTestId('bottom-strip-edge-role').textContent).toBe('[edge role]');
    expect(screen.getByTestId('bottom-strip-propose-action').textContent).toBe('[propose]');
  });

  it('routes the modeBanner child into the mode-banner sub-slot', () => {
    render(<BottomStripCapture modeBanner={<span data-testid="banner-child">B</span>} />);
    const slot = screen.getByTestId('bottom-strip-mode-banner');
    expect(slot.contains(screen.getByTestId('banner-child'))).toBe(true);
  });

  it('routes the textInput child into the text-input sub-slot', () => {
    render(<BottomStripCapture textInput={<span data-testid="text-child">T</span>} />);
    const slot = screen.getByTestId('bottom-strip-text-input');
    expect(slot.contains(screen.getByTestId('text-child'))).toBe(true);
  });

  it('routes the classificationPalette child into the classification sub-slot', () => {
    render(<BottomStripCapture classificationPalette={<span data-testid="class-child">C</span>} />);
    const slot = screen.getByTestId('bottom-strip-classification');
    expect(slot.contains(screen.getByTestId('class-child'))).toBe(true);
  });

  // Per `pf_mod_capture_pane_wording_only`: passing `null` explicitly to
  // the `classificationPalette` slot suppresses the foundation-pass
  // placeholder (the capture-pane gesture is wording-only and the
  // operate route mounts the slot as `null`). The slot's outer
  // testid + the labelled-region structure stay intact so downstream
  // tasks can still target the slot if they ever mount content here.
  it('renders an empty classification sub-slot when classificationPalette is explicitly null', () => {
    render(<BottomStripCapture classificationPalette={null} />);
    const slot = screen.getByTestId('bottom-strip-classification');
    expect(slot.textContent).toBe('');
  });

  it('routes the edgeRoleSelector child into the edge-role sub-slot', () => {
    render(<BottomStripCapture edgeRoleSelector={<span data-testid="edge-child">E</span>} />);
    const slot = screen.getByTestId('bottom-strip-edge-role');
    expect(slot.contains(screen.getByTestId('edge-child'))).toBe(true);
  });

  it('routes the proposeAction child into the propose-action sub-slot', () => {
    render(<BottomStripCapture proposeAction={<span data-testid="propose-child">P</span>} />);
    const slot = screen.getByTestId('bottom-strip-propose-action');
    expect(slot.contains(screen.getByTestId('propose-child'))).toBe(true);
  });
});
