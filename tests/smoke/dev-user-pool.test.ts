// Pin for the Authelia dev-user pool exported from the e2e auth fixture.
//
// Refinement: tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md
// ADRs:        docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: participant_ui.part_graph_view.part_e2e_user_pool_expansion
//
// Per the refinement's Acceptance criteria, this Vitest case asserts
// `DEV_USER_POOL.length === 12`, the no-duplicates property, and the
// `/^[a-z]+$/` ASCII-only naming convention. The pool is the
// single source of truth that backs the Authelia users-file at
// `infra/authelia/users.yml`; a future PR that drops or renames a
// user (or adds a diacritic-bearing one) surfaces here as red.
//
// Lives under `tests/smoke/` rather than next to the fixture in
// `tests/e2e/fixtures/` because the root `vitest.config.ts` include
// pattern only walks `tests/smoke/**`, `packages/**`, and `apps/**`.
// The cross-reference back to the fixture is the explicit import
// below.

import { describe, expect, it } from 'vitest';

import { DEV_USER_POOL } from '../e2e/fixtures/auth';

describe('Authelia dev user pool', () => {
  it('exposes exactly 12 users (the 6-user → 12-user expansion landed)', () => {
    expect(DEV_USER_POOL).toHaveLength(12);
  });

  it('contains every entry as an ASCII lowercase-only identifier (no diacritics, no digits)', () => {
    for (const username of DEV_USER_POOL) {
      expect(username, `username "${username}" must match /^[a-z]+$/`).toMatch(/^[a-z]+$/);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(DEV_USER_POOL).size).toBe(DEV_USER_POOL.length);
  });

  it('lists the canonical 12 names in source order matching infra/authelia/users.yml', () => {
    // Order is part of the contract: spec authors that hand-pick pairs
    // ("block N owns DEV_USER_POOL[2*N]/[2*N+1]") rely on a stable
    // index assignment.
    expect([...DEV_USER_POOL]).toEqual([
      'alice',
      'ben',
      'maria',
      'dave',
      'erin',
      'frank',
      'grace',
      'henry',
      'ivan',
      'julia',
      'kate',
      'leo',
    ]);
  });
});
