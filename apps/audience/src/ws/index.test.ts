// Runtime pin for the audience workspace's WS barrel narrowing.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §6 — read-only enforcement via TypeScript surface
//   narrowing. The barrel re-exports ONLY `audienceWsStore`,
//   `useAudienceSessionEvents`, `useAudienceConnectionStatus`. It
//   does NOT re-export `useWsClient` from `@a-conversa/shell` — any
//   audience UI code that wants a publish path must either import
//   from `@a-conversa/shell` directly or widen this barrel.
//   Both are visible diff-time signals; this runtime test is the
//   committed regression pin for the narrowing contract per
//   ADR 0022.)
//
// The TypeScript surface narrowing is the load-bearing contract; this
// runtime test pins that the published module-level keys conform to
// the documented allowlist.

import { describe, expect, it } from 'vitest';

import * as audienceWsBarrel from './index.js';

describe('audience workspace ws barrel — narrowed read-only surface', () => {
  it('re-exports the documented keys and nothing else', () => {
    // `useAudienceActiveDiagnostics` was added per
    // tasks/refinements/audience/aud_diagnostic_fire_animation.md
    // Decision §3 — the read-only audience-side selector hook for the
    // per-session `activeDiagnostics` map.
    const keys = Object.keys(audienceWsBarrel).sort();
    expect(keys).toEqual([
      'audienceWsStore',
      'useAudienceActiveDiagnostics',
      'useAudienceConnectionStatus',
      'useAudienceSessionEvents',
    ]);
  });

  it('does NOT re-export the send-side WS client surface from @a-conversa/shell', () => {
    const keys = Object.keys(audienceWsBarrel);
    // `useWsClient` is the gateway to `client.send()` / `trackSession`
    // / `untrackSession` / `onEnvelope` — the publish + per-session
    // lifecycle paths the audience surface deliberately does NOT
    // expose. Catch the contract regression here so a future barrel
    // re-export shows up as a failing test, not a silent capability
    // expansion.
    expect(keys).not.toContain('useWsClient');
    expect(keys).not.toContain('WsClient');
    expect(keys).not.toContain('createWsClient');
    expect(keys).not.toContain('WsClientProvider');
    expect(keys).not.toContain('send');
  });

  it('re-exports the audienceWsStore singleton as a Zustand-bound store', () => {
    expect(typeof audienceWsBarrel.audienceWsStore).toBe('function');
    const state = audienceWsBarrel.audienceWsStore.getState();
    expect(state.connectionStatus).toBe('idle');
    expect(typeof state.setConnectionStatus).toBe('function');
  });
});
