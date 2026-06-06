// Tests for `formatChord` — the structured-chord → display-glyph
// composer for the keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Per ADR 0022 these are committed Vitest cases. They pin the chord →
// glyph mapping: the platform modifier renders `⌘` on macOS vs `Ctrl`
// elsewhere; `shift` renders `⇧` / `Shift`; special keys map
// (`escape` → `Esc`, `enter` → `Enter`, `?` → `?`); a bare single
// letter uppercases. `isMacPlatform()` is mocked so the platform branch
// is exercised deterministically without touching `navigator`.

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the `isMacPlatform` re-home in `useGlobalKeymap` so the
// platform branch is exercised deterministically. The hoisted mock fn
// is mutated per-case via `mockMac`.
const isMacPlatformMock = vi.fn<() => boolean>(() => false);
vi.mock('./useGlobalKeymap', () => ({
  isMacPlatform: () => isMacPlatformMock(),
}));

import { formatChord } from './formatChord';

afterEach(() => {
  isMacPlatformMock.mockReset();
  isMacPlatformMock.mockReturnValue(false);
});

function mockMac(isMac: boolean): void {
  isMacPlatformMock.mockReturnValue(isMac);
}

describe('formatChord', () => {
  it('renders the platform modifier as ⌘ on macOS (⌘+S)', () => {
    mockMac(true);
    expect(formatChord({ key: 's', platformModifier: true })).toBe('⌘+S');
  });

  it('renders the platform modifier as Ctrl on non-macOS (Ctrl+S)', () => {
    mockMac(false);
    expect(formatChord({ key: 's', platformModifier: true })).toBe('Ctrl+S');
  });

  it('renders shift as ⇧ on macOS (⇧+Enter)', () => {
    mockMac(true);
    expect(formatChord({ key: 'enter', shift: true })).toBe('⇧+Enter');
  });

  it('renders shift as Shift on non-macOS (Shift+Enter)', () => {
    mockMac(false);
    expect(formatChord({ key: 'enter', shift: true })).toBe('Shift+Enter');
  });

  it('combines platform modifier + shift + key in order (⌘+⇧+Enter)', () => {
    mockMac(true);
    expect(formatChord({ key: 'enter', platformModifier: true, shift: true })).toBe('⌘+⇧+Enter');
  });

  it('maps escape → Esc', () => {
    mockMac(false);
    expect(formatChord({ key: 'escape' })).toBe('Esc');
  });

  it('maps enter → Enter', () => {
    mockMac(false);
    expect(formatChord({ key: 'enter' })).toBe('Enter');
  });

  it('renders `?` verbatim', () => {
    mockMac(false);
    expect(formatChord({ key: '?' })).toBe('?');
  });

  it('uppercases a bare single letter (f → F)', () => {
    mockMac(false);
    expect(formatChord({ key: 'f' })).toBe('F');
  });
});
