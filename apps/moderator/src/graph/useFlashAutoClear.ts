// `useFlashAutoClear` — the self-clearing half of the entity-flash
// channel.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_click_to_flash.md
//             (Constraint §7, Decision §D1)
//
// The flash is transient: `useFlashStore.flash(ids)` stamps a set of
// entity ids onto the store, and this effect — mounted ONCE inside the
// `<ReactFlowProvider>` alongside `useCanvasFocusEffect` — schedules a
// single `setTimeout(clear, FLASH_DURATION_MS)` to empty it again. The
// clock lives ONLY here (the store stays a pure in-memory channel,
// mirroring `uiStore.focusRequest` + `useCanvasFocusEffect`).
//
// The `lastHandledNonce` ref (not a store write-back) is what makes the
// effect idempotent and StrictMode-safe, exactly like
// `useCanvasFocusEffect`'s guard: it re-arms the timer only when
// `flashNonce` advances. A second `flash` before expiry advances the
// nonce, which cancels the in-flight timer and starts a fresh one — so
// the set survives until the NEW duration elapses (Constraint §11). The
// cleanup cancels a pending timer on unmount.

import { useEffect, useRef } from 'react';

import { useFlashStore } from '../stores/flashStore.js';

// How long an activated flash pulses before it self-clears. Tunable, not
// contract (Constraint §8) — a `mod_vr_*` sibling pins the pixels; this
// task pins the behaviour.
export const FLASH_DURATION_MS = 1500;

export function useFlashAutoClear(): void {
  const flashNonce = useFlashStore((state) => state.flashNonce);
  const lastHandledNonce = useRef<number | null>(null);

  useEffect(() => {
    // Nonce 0 is the initial "nothing has flashed yet" state — no timer.
    if (flashNonce === 0) return;
    // Ref-guard: re-arm only when the nonce advances past the last one we
    // handled. A same-nonce re-render (StrictMode double-invoke, an
    // unrelated store update) is a no-op.
    if (lastHandledNonce.current === flashNonce) return;
    lastHandledNonce.current = flashNonce;

    const handle = setTimeout(() => {
      useFlashStore.getState().clear();
    }, FLASH_DURATION_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [flashNonce]);
}
