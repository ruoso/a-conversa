// Vitest cases for `positionParam.ts`.
//
// Refinement: tasks/refinements/audience/aud_url_position_param.md
//   (Acceptance criteria §1 — eight failure-mode rows + the happy path
//   pinned; Acceptance criteria §4 — barrel re-export confirmed by
//   importing the helper through `./index.js`.)
// ADRs:        0022 (no throwaway verifications).

import { describe, expect, it } from 'vitest';

import { parsePositionParam } from './positionParam.js';
import { parsePositionParam as parsePositionParamFromBarrel } from './index.js';

describe('parsePositionParam', () => {
  it('(a) returns the integer for `position=42`', () => {
    expect(parsePositionParam(new URLSearchParams('position=42'))).toBe(42);
  });

  it('(b) returns 0 for `position=0` (the genesis of the log)', () => {
    expect(parsePositionParam(new URLSearchParams('position=0'))).toBe(0);
  });

  it('(c) returns null when the param is absent', () => {
    expect(parsePositionParam(new URLSearchParams(''))).toBeNull();
  });

  it('(d) returns null for a non-numeric value `position=abc`', () => {
    expect(parsePositionParam(new URLSearchParams('position=abc'))).toBeNull();
  });

  it('(e) returns null for a negative value `position=-1`', () => {
    expect(parsePositionParam(new URLSearchParams('position=-1'))).toBeNull();
  });

  it('(f) returns null for a fractional value `position=3.5`', () => {
    expect(parsePositionParam(new URLSearchParams('position=3.5'))).toBeNull();
  });

  it('(g) returns null for a value above Number.MAX_SAFE_INTEGER', () => {
    expect(parsePositionParam(new URLSearchParams('position=9999999999999999999'))).toBeNull();
  });

  it('(h) returns null for an empty value `position=`', () => {
    expect(parsePositionParam(new URLSearchParams('position='))).toBeNull();
  });

  it('(i) ignores unrelated params and returns the position value', () => {
    expect(parsePositionParam(new URLSearchParams('position=42&foo=bar'))).toBe(42);
  });

  it('(j) is re-exported from the state barrel', () => {
    expect(parsePositionParamFromBarrel(new URLSearchParams('position=7'))).toBe(7);
  });
});
