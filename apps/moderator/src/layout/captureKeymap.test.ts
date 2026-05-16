// Tests for `captureKeymap` — document-level keyboard plumbing for
// the bottom-strip capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_classification_palette.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in the bail-rules the module documents and the inverse
// table `SHORTCUT_TO_KIND` the palette + future capture-flow tasks
// will consume.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type MethodologyKind,
} from '@a-conversa/i18n-catalogs';

import { attachCaptureKeymap, SHORTCUT_TO_KIND } from './captureKeymap';

describe('captureKeymap — SHORTCUT_TO_KIND inverse table', () => {
  it('is the inverse of KIND_TO_SHORTCUT', () => {
    for (const kind of METHODOLOGY_KINDS) {
      const key = KIND_TO_SHORTCUT[kind];
      expect(SHORTCUT_TO_KIND[key]).toBe(kind);
    }
  });

  it('covers every kind in METHODOLOGY_KINDS', () => {
    const reverseValues = new Set(Object.values(SHORTCUT_TO_KIND));
    for (const kind of METHODOLOGY_KINDS) {
      expect(reverseValues.has(kind)).toBe(true);
    }
  });

  it('has exactly five entries (one per kind)', () => {
    expect(Object.keys(SHORTCUT_TO_KIND).length).toBe(METHODOLOGY_KINDS.length);
  });
});

describe('captureKeymap — attachCaptureKeymap listener behaviour', () => {
  let detach: (() => void) | null = null;
  let onPickKind: ReturnType<typeof vi.fn<(kind: MethodologyKind) => void>>;

  beforeEach(() => {
    onPickKind = vi.fn();
  });

  afterEach(() => {
    if (detach !== null) {
      detach();
      detach = null;
    }
    document.body.innerHTML = '';
  });

  it('routes a plain `f` keypress to onPickKind(`fact`)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(onPickKind).toHaveBeenCalledTimes(1);
    expect(onPickKind).toHaveBeenCalledWith('fact');
  });

  it('routes each kind shortcut to its matching kind', () => {
    detach = attachCaptureKeymap({ onPickKind });
    for (const kind of METHODOLOGY_KINDS) {
      onPickKind.mockClear();
      const key = KIND_TO_SHORTCUT[kind];
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(onPickKind).toHaveBeenCalledWith(kind);
    }
  });

  it('matches case-insensitively (uppercase `F` -> fact)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }));
    expect(onPickKind).toHaveBeenCalledTimes(1);
    expect(onPickKind).toHaveBeenCalledWith('fact');
  });

  it('returns a detach function that removes the listener', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(onPickKind).toHaveBeenCalledTimes(1);

    detach();
    detach = null;
    onPickKind.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('bails when metaKey is held (Cmd+F passes through)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }),
    );
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('bails when ctrlKey is held (Ctrl+F passes through)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
    );
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('bails when altKey is held (Alt+F passes through)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('does NOT bail when shiftKey is held (Shift+F still routes)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    // `event.key` under shift would be `'F'`; the listener lowercases
    // it and resolves the same kind.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F', shiftKey: true, bubbles: true }),
    );
    expect(onPickKind).toHaveBeenCalledTimes(1);
    expect(onPickKind).toHaveBeenCalledWith('fact');
  });

  it('bails when event.repeat is true (held key does not bounce)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', repeat: true, bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('bails when document.activeElement is a textarea (editable-target guard)', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('bails when document.activeElement is an input (editable-target guard)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('bails when document.activeElement is a contenteditable element', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();
    expect(document.activeElement).toBe(div);

    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('ignores unmapped keys (no handler call)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onPickKind).not.toHaveBeenCalled();
  });

  it('preventDefault is called on a matched key (keystroke consumed)', () => {
    detach = attachCaptureKeymap({ onPickKind });
    const ev = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('preventDefault is NOT called when modifier-bail fires', () => {
    detach = attachCaptureKeymap({ onPickKind });
    const ev = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('preventDefault is NOT called on an unmapped key', () => {
    detach = attachCaptureKeymap({ onPickKind });
    const ev = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('treats onPickKind as optional — handlers with no methods do not throw', () => {
    detach = attachCaptureKeymap({});
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    }).not.toThrow();
  });
});
