// Canonical roster of the dev-only Authelia users seeded in
// `infra/authelia/users.yml`, plus the shared dev password.
//
// Refinements: tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md
//              tasks/refinements/participant-ui/part_e2e_user_pool_expansion_v2.md
// ADRs:        docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0022-no-throwaway-verifications.md
//
// **Why this file is separate from `auth.ts`.** The Vitest pin in
// `tests/smoke/dev-user-pool.test.ts` asserts roster shape, length, and
// ordering. Importing those constants from `auth.ts` drags in the
// top-level `import { Page } from '@playwright/test'`, whose runtime
// initialisation in happy-dom emits a `console.error` on a URL fetch
// the env can't resolve — and `vitest.setup.ts` treats unexpected
// console output as a hard failure. Splitting the data into a module
// with zero playwright imports lets the smoke test load just the
// constants. `auth.ts` re-exports both names so e2e callers keep their
// existing import paths.

/**
 * The dev-only shared password baked into `infra/authelia/users.yml`
 * for the eighteen seeded dev users (per ADR 0017). Hard-coded here
 * rather than read from env — the value is committed in the public
 * repo (the file's header acknowledges it as dev-only), and treating
 * it as a secret would be theater. Production Authelia uses a
 * different users backend and never sees this value.
 */
export const AUTHELIA_DEV_PASSWORD = 'aconversa-dev';

/**
 * The 18 dev-only Authelia users seeded in `infra/authelia/users.yml`,
 * in source order. Maintained as a single source of truth so spec
 * authors can iterate or pick from a freelist without hard-coding the
 * roster. The 6-user → 12-user expansion is documented in
 * `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`;
 * the 12-user → 18-user expansion in
 * `tasks/refinements/participant-ui/part_e2e_user_pool_expansion_v2.md`;
 * the underlying ADR is `docs/adr/0017-mock-oauth-authelia-users-file.md`.
 *
 * Every entry is a valid `loginAs` username and authenticates with
 * {@link AUTHELIA_DEV_PASSWORD}.
 */
export const DEV_USER_POOL: readonly string[] = [
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
  'nora',
  'oscar',
  'peter',
  'quinn',
  'rosa',
  'sam',
] as const;
