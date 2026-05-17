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
  EDGE_ROLE_TO_SHORTCUT,
  EDGE_ROLES,
  KIND_TO_SHORTCUT,
  METHODOLOGY_KINDS,
  type EdgeRole,
  type MethodologyKind,
} from '@a-conversa/i18n-catalogs';

import { attachCaptureKeymap, SHORTCUT_TO_EDGE_ROLE, SHORTCUT_TO_KIND } from './captureKeymap';
import { useCaptureStore } from '../stores/captureStore';

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

// Refinement: tasks/refinements/moderator-ui/mod_target_clear_override.md
//
// These cases lock in the Esc → onClearTarget routing the capture-target
// chip consumes. They sit inside the same `attachCaptureKeymap` listener
// as the kind-shortcut branch and therefore inherit the same
// modifier-bail / editable-target / repeat-skip guards.
describe('captureKeymap — onClearTarget handler', () => {
  let detach: (() => void) | null = null;
  let onClearTarget: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onClearTarget = vi.fn();
  });

  afterEach(() => {
    if (detach !== null) {
      detach();
      detach = null;
    }
    document.body.innerHTML = '';
  });

  it('routes a plain `Escape` keypress to onClearTarget', () => {
    detach = attachCaptureKeymap({ onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClearTarget).toHaveBeenCalledTimes(1);
  });

  it('matches case-insensitively (lowercase `escape` also routes)', () => {
    detach = attachCaptureKeymap({ onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'escape', bubbles: true }));
    expect(onClearTarget).toHaveBeenCalledTimes(1);
  });

  it('bails when metaKey is held (Cmd+Esc passes through)', () => {
    detach = attachCaptureKeymap({ onClearTarget });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', metaKey: true, bubbles: true }),
    );
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  it('bails when ctrlKey is held (Ctrl+Esc passes through)', () => {
    detach = attachCaptureKeymap({ onClearTarget });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true, bubbles: true }),
    );
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  it('bails when document.activeElement is a textarea (editable-target guard)', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    detach = attachCaptureKeymap({ onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  it('bails when event.repeat is true (held Esc does not bounce)', () => {
    detach = attachCaptureKeymap({ onClearTarget });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true }),
    );
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  it('preventDefault is called on a matched Escape (keystroke consumed)', () => {
    detach = attachCaptureKeymap({ onClearTarget });
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not throw when Escape fires but no onClearTarget handler is registered', () => {
    detach = attachCaptureKeymap({});
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }).not.toThrow();
  });

  it('a registered onClearTarget alongside onPickKind both route their keys', () => {
    const onPickKind = vi.fn<(kind: MethodologyKind) => void>();
    detach = attachCaptureKeymap({ onPickKind, onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onPickKind).toHaveBeenCalledTimes(1);
    expect(onPickKind).toHaveBeenCalledWith('fact');
    expect(onClearTarget).toHaveBeenCalledTimes(1);
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_edge_role_selector.md
//
// These cases lock the s/r/q/b/g/e/x → onPickEdgeRole routing the
// edge-role selector consumes. They sit inside the same
// `attachCaptureKeymap` listener as the kind and Esc branches and
// inherit the same modifier-bail / editable-target / repeat-skip
// guards. The visibility-gate (`targetEntityId !== null`) is the
// consumer's responsibility — it lives in the selector's handler
// closure, not in the keymap module — so these cases assert the pure
// dispatch behaviour.
describe('captureKeymap — SHORTCUT_TO_EDGE_ROLE inverse table', () => {
  it('is the inverse of EDGE_ROLE_TO_SHORTCUT', () => {
    for (const role of EDGE_ROLES) {
      const key = EDGE_ROLE_TO_SHORTCUT[role];
      expect(SHORTCUT_TO_EDGE_ROLE[key]).toBe(role);
    }
  });

  it('covers every role in EDGE_ROLES', () => {
    const reverseValues = new Set(Object.values(SHORTCUT_TO_EDGE_ROLE));
    for (const role of EDGE_ROLES) {
      expect(reverseValues.has(role)).toBe(true);
    }
  });

  it('has exactly seven entries (one per role)', () => {
    expect(Object.keys(SHORTCUT_TO_EDGE_ROLE).length).toBe(EDGE_ROLES.length);
  });
});

describe('captureKeymap — onPickEdgeRole handler', () => {
  let detach: (() => void) | null = null;
  let onPickEdgeRole: ReturnType<typeof vi.fn<(role: EdgeRole) => void>>;

  beforeEach(() => {
    onPickEdgeRole = vi.fn();
  });

  afterEach(() => {
    if (detach !== null) {
      detach();
      detach = null;
    }
    document.body.innerHTML = '';
  });

  it('routes a plain `s` keypress to onPickEdgeRole(`supports`)', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(onPickEdgeRole).toHaveBeenCalledTimes(1);
    expect(onPickEdgeRole).toHaveBeenCalledWith('supports');
  });

  it('routes each role shortcut to its matching role', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    for (const role of EDGE_ROLES) {
      onPickEdgeRole.mockClear();
      const key = EDGE_ROLE_TO_SHORTCUT[role];
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(onPickEdgeRole).toHaveBeenCalledWith(role);
    }
  });

  it('matches case-insensitively (uppercase `S` -> supports)', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', bubbles: true }));
    expect(onPickEdgeRole).toHaveBeenCalledTimes(1);
    expect(onPickEdgeRole).toHaveBeenCalledWith('supports');
  });

  it('bails when metaKey is held (Cmd+S passes through)', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }),
    );
    expect(onPickEdgeRole).not.toHaveBeenCalled();
  });

  it('bails when ctrlKey is held (Ctrl+S passes through)', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
    );
    expect(onPickEdgeRole).not.toHaveBeenCalled();
  });

  it('bails when altKey is held (Alt+S passes through)', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, bubbles: true }));
    expect(onPickEdgeRole).not.toHaveBeenCalled();
  });

  it('bails when document.activeElement is a textarea (editable-target guard)', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(onPickEdgeRole).not.toHaveBeenCalled();
  });

  it('returns a detach function that removes the listener', () => {
    detach = attachCaptureKeymap({ onPickEdgeRole });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(onPickEdgeRole).toHaveBeenCalledTimes(1);

    detach();
    detach = null;
    onPickEdgeRole.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(onPickEdgeRole).not.toHaveBeenCalled();
  });

  it('does not throw when a role key fires but no onPickEdgeRole handler is registered', () => {
    detach = attachCaptureKeymap({});
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    }).not.toThrow();
  });

  it('a registered onPickEdgeRole alongside onPickKind both route their keys (no collision)', () => {
    const onPickKind = vi.fn<(kind: MethodologyKind) => void>();
    detach = attachCaptureKeymap({ onPickKind, onPickEdgeRole });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(onPickKind).toHaveBeenCalledTimes(1);
    expect(onPickKind).toHaveBeenCalledWith('fact');
    expect(onPickEdgeRole).toHaveBeenCalledTimes(1);
    expect(onPickEdgeRole).toHaveBeenCalledWith('supports');
  });
});

// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
//
// Mode-aware Escape dispatch. The `onExitMode` handler the F2 decompose
// flow registers takes priority over `onClearTarget` when the capture
// store's mode is `'decompose'`. When mode is `'idle'` (the F1 default),
// the existing `onClearTarget` dispatch is unchanged — the cases below
// pin both branches so the priority logic cannot regress.
describe('captureKeymap — onExitMode handler (mode-aware Escape)', () => {
  let detach: (() => void) | null = null;

  beforeEach(() => {
    // Reset the store so each test starts at mode === 'idle' — the
    // tests below explicitly set decompose mode where needed.
    useCaptureStore.getState().reset();
  });

  afterEach(() => {
    if (detach !== null) {
      detach();
      detach = null;
    }
    document.body.innerHTML = '';
    useCaptureStore.getState().reset();
  });

  it('routes Escape to onExitMode when mode === decompose', () => {
    const onExitMode = vi.fn<() => void>();
    useCaptureStore.getState().enterDecomposeMode('n1');
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
  });

  it('does NOT route Escape to onExitMode when mode === idle', () => {
    const onExitMode = vi.fn<() => void>();
    // mode is the default 'idle' after the reset in beforeEach.
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).not.toHaveBeenCalled();
  });

  it('decompose-exit takes priority over target-clear when both handlers are registered (Decision §5)', () => {
    const onExitMode = vi.fn<() => void>();
    const onClearTarget = vi.fn<() => void>();
    useCaptureStore.getState().enterDecomposeMode('n1');
    detach = attachCaptureKeymap({ onExitMode, onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  it('when mode === idle and both handlers are registered, Escape routes to onClearTarget only', () => {
    const onExitMode = vi.fn<() => void>();
    const onClearTarget = vi.fn<() => void>();
    detach = attachCaptureKeymap({ onExitMode, onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClearTarget).toHaveBeenCalledTimes(1);
    expect(onExitMode).not.toHaveBeenCalled();
  });

  it('Escape with onExitMode only (no onClearTarget) does nothing when mode is idle', () => {
    const onExitMode = vi.fn<() => void>();
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).not.toHaveBeenCalled();
  });

  it('Escape with onExitMode only fires the handler when mode flips to decompose mid-mount', () => {
    const onExitMode = vi.fn<() => void>();
    detach = attachCaptureKeymap({ onExitMode });
    // First, mode is idle — Escape is a no-op.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).not.toHaveBeenCalled();
    // Then mode flips to decompose — next Escape fires the handler.
    useCaptureStore.getState().enterDecomposeMode('n1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
  });

  it('preventDefault is called on a matched Escape (keystroke consumed)', () => {
    const onExitMode = vi.fn<() => void>();
    useCaptureStore.getState().enterDecomposeMode('n1');
    detach = attachCaptureKeymap({ onExitMode });
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Escape bails on editable-target when mode === decompose (same guard as onClearTarget)', () => {
    const onExitMode = vi.fn<() => void>();
    useCaptureStore.getState().enterDecomposeMode('n1');
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).not.toHaveBeenCalled();
  });

  // Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
  //
  // The mode-aware Escape early-return generalises to also route
  // `onExitMode` when `mode === 'interpretive-split'`. Decision §8
  // records the single-handler reuse rationale.
  it('routes Escape to onExitMode when mode === interpretive-split', () => {
    const onExitMode = vi.fn<() => void>();
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
  });

  it('interpretive-split exit takes priority over target-clear when both handlers are registered', () => {
    const onExitMode = vi.fn<() => void>();
    const onClearTarget = vi.fn<() => void>();
    useCaptureStore.getState().enterInterpretiveSplitMode('n1');
    detach = attachCaptureKeymap({ onExitMode, onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  // Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md
  //
  // The mode-aware Escape early-return generalises to also route
  // `onExitMode` when `mode === 'operationalization'` (the third F3
  // mode). The Escape priority over `onClearTarget` mirrors the
  // decompose / interpretive-split branches.
  it('routes Escape to onExitMode when mode === operationalization', () => {
    const onExitMode = vi.fn<() => void>();
    useCaptureStore.getState().enterOperationalizationMode('n1');
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
  });

  it('operationalization exit takes priority over target-clear when both handlers are registered', () => {
    const onExitMode = vi.fn<() => void>();
    const onClearTarget = vi.fn<() => void>();
    useCaptureStore.getState().enterOperationalizationMode('n1');
    detach = attachCaptureKeymap({ onExitMode, onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
    expect(onClearTarget).not.toHaveBeenCalled();
  });

  // Refinement: tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md
  //
  // The mode-aware Escape early-return generalises to also route
  // `onExitMode` when `mode === 'warrant-elicitation'` (the fourth F3
  // mode). The Escape priority over `onClearTarget` mirrors the
  // decompose / interpretive-split / operationalization branches.
  it('routes Escape to onExitMode when mode === warrant-elicitation', () => {
    const onExitMode = vi.fn<() => void>();
    useCaptureStore.getState().enterWarrantElicitationMode('n1');
    detach = attachCaptureKeymap({ onExitMode });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
  });

  it('warrant-elicitation exit takes priority over target-clear when both handlers are registered', () => {
    const onExitMode = vi.fn<() => void>();
    const onClearTarget = vi.fn<() => void>();
    useCaptureStore.getState().enterWarrantElicitationMode('n1');
    detach = attachCaptureKeymap({ onExitMode, onClearTarget });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExitMode).toHaveBeenCalledTimes(1);
    expect(onClearTarget).not.toHaveBeenCalled();
  });
});
