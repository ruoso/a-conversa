// Vitest cases for `sessionId.ts`.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §3 — `stripAudienceBasename` + `sessionIdFromPathname`
//   are pure helpers; the `useSyncExternalStore` subscription that
//   composes them lives in `useAudienceSessionId.ts` and is pinned
//   separately.)
//
// Eight cases:
//   sessionIdFromPathname:
//   (a) `/sessions/<uuid>` → UUID,
//   (b) `/en-US/sessions/<uuid>` → UUID (locale-prefixed),
//   (c) `/` → `null`,
//   (d) `/sessions/` → `null`,
//   (e) `/sessions/<malformed>` → `null` (UUID regex check),
//   stripAudienceBasename:
//   (f) `/a/sessions/<uuid>` → `/sessions/<uuid>`,
//   (g) `/a` → `/`,
//   (h) `/p/foo` → `/p/foo` (no strip if no audience basename).

import { describe, expect, it } from 'vitest';

import { sessionIdFromPathname, stripAudienceBasename } from './sessionId.js';

const UUID = '00000000-0000-4000-8000-000000000099';

describe('sessionIdFromPathname', () => {
  it('(a) extracts the UUID from `/sessions/<uuid>`', () => {
    expect(sessionIdFromPathname(`/sessions/${UUID}`)).toBe(UUID);
  });

  it('(b) extracts the UUID from a locale-prefixed `/en-US/sessions/<uuid>`', () => {
    expect(sessionIdFromPathname(`/en-US/sessions/${UUID}`)).toBe(UUID);
  });

  it('(c) returns null for the root pathname `/`', () => {
    expect(sessionIdFromPathname('/')).toBeNull();
  });

  it('(d) returns null for a `/sessions/` pathname with no trailing UUID', () => {
    expect(sessionIdFromPathname('/sessions/')).toBeNull();
  });

  it('(e) returns null for a `/sessions/<malformed>` pathname (UUID regex rejects non-UUID tails)', () => {
    expect(sessionIdFromPathname('/sessions/not-a-uuid')).toBeNull();
    expect(sessionIdFromPathname('/sessions/12345')).toBeNull();
    // Right shape but wrong UUID version byte.
    expect(sessionIdFromPathname('/sessions/00000000-0000-9000-8000-000000000001')).toBeNull();
  });
});

describe('stripAudienceBasename', () => {
  it('(f) strips the `/a` prefix from `/a/sessions/<uuid>`', () => {
    expect(stripAudienceBasename(`/a/sessions/${UUID}`)).toBe(`/sessions/${UUID}`);
  });

  it('(g) maps the bare `/a` pathname to `/`', () => {
    expect(stripAudienceBasename('/a')).toBe('/');
  });

  it('(h) returns the pathname unchanged when the audience basename is absent', () => {
    expect(stripAudienceBasename('/p/foo')).toBe('/p/foo');
    expect(stripAudienceBasename('/')).toBe('/');
    expect(stripAudienceBasename('/sessions/abc')).toBe('/sessions/abc');
  });
});
