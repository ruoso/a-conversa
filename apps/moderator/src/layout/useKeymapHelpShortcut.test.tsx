// Tests for `useKeymapHelpShortcut` — the bare-`?` document-level
// toggle hook for the keymap-help overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   (a) bare `?` toggles the store,
//   (b) `?` while an input/textarea is `activeElement` is a no-op
//       (editable-target bail),
//   (c) `⌘?` / `Ctrl+?` is a no-op (platform-modifier bail),
//   (d) `event.repeat` is ignored,
//   (e) the listener detaches on unmount.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { resetKeymapHelpStore, useKeymapHelpStore } from './useKeymapHelpStore';
import { useKeymapHelpShortcut } from './useKeymapHelpShortcut';

function Harness(): ReactElement {
  useKeymapHelpShortcut();
  return (
    <div>
      <input data-testid="editable-input" />
      <textarea data-testid="editable-textarea" />
    </div>
  );
}

function pressQuestionMark(overrides: Partial<KeyboardEventInit> = {}): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '?',
        bubbles: true,
        cancelable: true,
        ...overrides,
      }),
    );
  });
}

beforeEach(() => {
  resetKeymapHelpStore();
});

afterEach(() => {
  cleanup();
  resetKeymapHelpStore();
});

describe('useKeymapHelpShortcut', () => {
  it('(a) bare `?` toggles the store (open then close)', () => {
    render(<Harness />);
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
    pressQuestionMark();
    expect(useKeymapHelpStore.getState().isOpen).toBe(true);
    pressQuestionMark();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(b) `?` while an input is activeElement is a no-op (editable-target bail)', () => {
    const { getByTestId } = render(<Harness />);
    (getByTestId('editable-input') as HTMLInputElement).focus();
    expect(document.activeElement).toBe(getByTestId('editable-input'));
    pressQuestionMark();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(b) `?` while a textarea is activeElement is a no-op (editable-target bail)', () => {
    const { getByTestId } = render(<Harness />);
    (getByTestId('editable-textarea') as HTMLTextAreaElement).focus();
    expect(document.activeElement).toBe(getByTestId('editable-textarea'));
    pressQuestionMark();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(c) `⌘?` (metaKey) is a no-op (platform-modifier bail)', () => {
    render(<Harness />);
    pressQuestionMark({ metaKey: true });
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(c) `Ctrl+?` is a no-op (platform-modifier bail)', () => {
    render(<Harness />);
    pressQuestionMark({ ctrlKey: true });
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(d) `event.repeat` is ignored', () => {
    render(<Harness />);
    pressQuestionMark({ repeat: true });
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });

  it('(e) detaches the listener on unmount', () => {
    const { unmount } = render(<Harness />);
    unmount();
    pressQuestionMark();
    expect(useKeymapHelpStore.getState().isOpen).toBe(false);
  });
});
