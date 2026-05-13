# Namespace `oauth_subject` by full issuer URL (not hostname only)

Source: docs/security/m3-review/auth.md F-008

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend.hardening.auth_hardening.oauth_subject_full_namespacing`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.oauth_callback_handler` (settled — `namespacedOauthSubject` exists in `apps/server/src/auth/routes.ts`, callable from `/auth/callback`); `data_and_methodology.schema.users_table` (settled — `users.oauth_subject TEXT NOT NULL UNIQUE`).

## What this task is

Closes finding **F-008** from the M3 auth security review. The OIDC subject identifier stored in `users.oauth_subject` is currently namespaced by `${issuerUrl.hostname}:${sub}`. Two issuers sharing a hostname on different ports (e.g. `https://auth.example.com:443` and `https://auth.example.com:9091`) — or one on `http://` and one on `https://` — collapse to the same namespace prefix. If a single OIDC `sub` is reused across the two (deliberately or not), the second-arriving user inserts onto the first user's row and silently inherits their identity binding (the UNIQUE constraint on `oauth_subject` is the safety net but the failure mode is "two distinct OIDC principals merge into one platform identity" — worse than a hard failure).

The fix is a one-character change in `namespacedOauthSubject`: switch from `issuerUrl.hostname` to `issuerUrl.origin`. The WHATWG `URL.origin` getter returns `<protocol>//<host>[:port]` and elides the default port for the protocol — `https://example.com:443`.origin is `"https://example.com"`, `https://example.com:9091`.origin is `"https://example.com:9091"`, and `http://example.com`.origin is `"http://example.com"` — which is exactly the partition the finding asks for: protocol + host + non-default port.

## Why it needs to be done

- **Latent silent-merge risk.** Two OIDC principals on the same hostname (different ports / different protocols) reusing a `sub` collide on the UNIQUE constraint, and the second login succeeds as the first user. No alert, no log entry distinguishing the two — the only signal is the operator notices "wait, that's not my account."
- **The fix is cheap and forward-only.** One call-site change, no migration runner work, no schema change, no downstream-consumer rewrite. The cost is one round of test-fixture key updates plus pinning the new invariant with unit tests.
- **Pre-launch timing.** The project has no production users; no real data exists keyed on the old format. The discontinuity window is "any pre-launch dev / staging session." Doing this before launch is essentially free; doing it after launch requires a data-migration tool that recovers the original issuer URL from rows that don't record it.

Downstream consumers (none structural — all are passive readers of `oauth_subject` as an opaque key):

- `backend.auth.session_token_management` — the platform session JWT carries `users.id`, not the namespaced subject. No format dependency.
- `backend.auth.no_profile_data_policy` — the audit asserts no profile-claim values appear in `oauth_subject`. Holds under the new format (the new prefix carries protocol + host + port, none of which are profile data).
- `backend.auth.middleware` — looks up by `users.id`, not by `oauth_subject`. No dependency.

## Inputs / context

From [docs/security/m3-review/auth.md](../../../docs/security/m3-review/auth.md) F-008:

> The namespaced key stored in `users.oauth_subject` is `${hostname}:${sub}`. If a deployment ever points at two different OIDC issuers on the SAME hostname (different ports — `auth.example.com:443` vs `auth.example.com:9091`) or rotates issuers while keeping the same hostname, two distinct OIDC `sub` values would collide. The Authelia dev shape and a future production swap on the same `auth.example.com` URL fall in this bucket.
>
> **Suggested fix**: Include port + protocol in the namespace key (or use the full `issuer` claim verbatim — openid-client validates it).

From [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) (lines 183-185, pre-change):

```typescript
export function namespacedOauthSubject(issuerUrl: URL, sub: string): string {
  return `${issuerUrl.hostname}:${sub}`;
}
```

WHATWG URL semantics — relevant for the fix:

- `new URL('http://authelia:9091').origin` → `'http://authelia:9091'`
- `new URL('https://auth.example.com:443').origin` → `'https://auth.example.com'` (the default https port is elided)
- `new URL('https://auth.example.com:9091').origin` → `'https://auth.example.com:9091'`
- `new URL('http://localhost').origin` → `'http://localhost'`

The protocol's default port is stripped — this is intentional and matches how operators typically reason about URLs (`https://example.com` and `https://example.com:443` are the same origin). The partition still distinguishes the F-008 scenarios:

- Same host, default `:443` vs explicit `:9091` → different origins → different keys. ✓
- Same host, `http://` vs `https://` → different origins → different keys. ✓
- Same issuer, two `sub` values → same origin → same prefix. ✓

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of system behavior is a committed test. The new invariants are pinned by Vitest unit tests in `apps/server/src/auth/routes.test.ts`.

## Constraints / requirements

- **Implementation change**: `namespacedOauthSubject` returns `${issuerUrl.origin}:${sub}` instead of `${issuerUrl.hostname}:${sub}`. Single-line change in `apps/server/src/auth/routes.ts`. The export surface (function name + signature) is unchanged.
- **No schema change.** The `oauth_subject` column is still `TEXT NOT NULL UNIQUE` — the value just gets longer. The longest plausible origin (`https://` + 253-char DNS host + `:65535`) is well under any TEXT length limit Postgres enforces.
- **No migration runner change.** There is no forward data migration for existing rows. Existing dev/staging rows keyed by `authelia:<sub>` will simply miss the lookup on next login, and the upsert will insert a fresh row keyed by `http://authelia:9091:<sub>`. The old rows persist but never resolve to a live login — they're orphaned, not deleted, and harmless (UNIQUE constraint is per-row, no conflict).
- **Test-fixture key updates.** Three categories of test artifact carry a hardcoded namespace key that flows through `namespacedOauthSubject`:
  1. **Vitest** in `apps/server/src/auth/routes.test.ts` — the `/auth/callback` happy-path test asserts `body.oauthSubject === 'authelia:alice'`. Update to `'http://authelia:9091:alice'` (the test config's `issuerUrl` is `http://authelia:9091`).
  2. **Vitest** in `apps/server/src/auth/no-profile-data.test.ts` — same `/auth/callback` flow, two assertions. Update to the origin-prefixed form.
  3. **Vitest** in `apps/server/src/auth/session-token.test.ts` — one returning-user test seeds a row whose `oauth_subject` must match what the callback produces; update the seed and the new-user assertion to the origin-prefixed form.
  4. **Cucumber** in `tests/behavior/backend/oauth-callback.feature` — happy-path + returning-user scenarios assert `"authelia:alice"`. Update.
  5. **Cucumber** in `tests/behavior/backend/no-profile-data.feature` — one scenario asserts `"authelia:alice"`. Update.

  All other `authelia:<name>` literals in tests are opaque seed values that never round-trip through `namespacedOauthSubject` — they just need to be valid TEXT for the UNIQUE column and are left as-is.

- **New unit tests** in `apps/server/src/auth/routes.test.ts` — a new `describe('namespacedOauthSubject', ...)` block with four cases pinning the F-008 invariants:
  1. The returned key uses the full origin (protocol + host + port) — `new URL('http://authelia:9091')` → `'http://authelia:9091:alice'`.
  2. Same hostname / different port → different keys. Pin the WHATWG behavior that `:443` is elided for https and `:9091` is preserved.
  3. Same issuer / different `sub` → same namespace prefix.
  4. Same hostname+port / different protocols (`http://` vs `https://`) → different keys.

- **Backward compatibility / migration.** Pre-launch project, no production users. The deployment posture treats any existing dev/staging `users` rows keyed by the old hostname-only format as orphaned — they will not match any future OIDC callback. On next login, each existing user produces a fresh row under the new namespace. Documented as the **(b) "accept the discontinuity"** choice in Decisions.

- **Per ADR 0022**: the new tests are committed as the empirical verification; no `node -e` probes; the Vitest `describe('namespacedOauthSubject', ...)` block IS the probe and stays as the regression net.

## Acceptance criteria

- `apps/server/src/auth/routes.ts` — `namespacedOauthSubject` returns `${issuerUrl.origin}:${sub}`. Docstring updated to describe the new semantics and reference F-008.
- `apps/server/src/auth/routes.test.ts` — new `describe('namespacedOauthSubject', ...)` block with the four cases above. The existing `/auth/callback` happy-path assertion updated to `'http://authelia:9091:alice'`.
- `apps/server/src/auth/no-profile-data.test.ts` — two assertions updated to the origin-prefixed form.
- `apps/server/src/auth/session-token.test.ts` — one returning-user seed + one new-user assertion updated to the origin-prefixed form.
- `tests/behavior/backend/oauth-callback.feature` — happy-path + returning-user scenarios updated.
- `tests/behavior/backend/no-profile-data.feature` — one scenario updated.
- `pnpm run check` succeeds (lint + typecheck + build across the workspace).
- `pnpm run test:smoke` succeeds (Vitest unit + Cucumber behavior).
- Refinement carries a Status block on completion; `tasks/25-backend-hardening.tji` carries `complete 100` after the task's `allocate team` line; `tj3 project.tjp` parses silent.

## Decisions

- **D1 (migration strategy).** Choice **(b) — accept the discontinuity**. The project is pre-launch; no production users exist; existing dev/staging rows under the old hostname-only namespace are orphaned by the change. On next OIDC callback, each existing user looks like a new user from the server's perspective, gets a fresh `users` row under the new namespace, and proceeds through the screen-name picker again.

  Choice (a) — rewrite existing rows — is **not viable**: the original issuer URL is not recorded in the `users` table (only the hostname-only namespaced subject is), so there's no way to deterministically derive `http://authelia:9091:alice` from `authelia:alice` without out-of-band knowledge.

  Choice (c) — add an `issuer_url` column + split the existing `oauth_subject` into `(issuer_url, sub)` and rebuild the UNIQUE key — is reasonable but overweight for v1: it requires a forward-only migration, two new query paths (lookup by `(issuer_url, sub)` and by `id`), and a backfill step that still needs operator-supplied input for the old rows. Deferred until a real production deployment requires migration tooling.

  **TODO (post-launch)**: when v2 / a real prod deployment is on the roadmap, revisit. The likely shape is: add `issuer_url TEXT NOT NULL` to `users`, drop the namespaced `oauth_subject` format in favor of a UNIQUE `(issuer_url, sub)` pair, and add a migration tool the operator points at the old issuer URL so the rebuild is deterministic.

- **D2 (origin vs the full id_token `iss` claim).** Use `issuerUrl.origin` (derived from the server's `OIDC_ISSUER_URL` env var) rather than the id_token's `iss` claim. The reasons: (1) the server-configured issuer URL is the trust anchor — using it as the namespace makes the same trust anchor that gates token verification also gate the user-row binding; (2) `iss` claims sometimes include path components (e.g. `https://auth.example.com/realms/aconversa`), which would change if the realm were reconfigured even on the same origin — using the origin keeps the namespace stable across realm renames while still distinguishing host/port/protocol changes; (3) the `iss` claim is data; the configured `OIDC_ISSUER_URL` is config — config-driven keys are easier to reason about for operators.

- **D3 (URL.origin's default-port elision).** Pinned by unit test. `new URL('https://example.com:443').origin === 'https://example.com'` — the default port is elided. This is acceptable: the case of "two issuers on the same host where one runs on the protocol's default port and the other does not" is still distinguished (the non-default port appears in the origin); the case of "two issuers both on the protocol's default port, same host" is by definition the same origin and would be the same identity in any sane deployment.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

- Implementation: `apps/server/src/auth/routes.ts` — `namespacedOauthSubject` switched from `issuerUrl.hostname` to `issuerUrl.origin`; docstring updated with F-008 cross-reference.
- New tests: `apps/server/src/auth/routes.test.ts` — `describe('namespacedOauthSubject', ...)` block with four cases (full-origin shape, same-hostname-different-port, same-issuer-different-sub, http-vs-https). Existing `/auth/callback` test fixtures updated to the origin-prefixed form.
- Updated test fixtures: `apps/server/src/auth/no-profile-data.test.ts` (2 assertions), `apps/server/src/auth/session-token.test.ts` (1 seed + 1 assertion), `tests/behavior/backend/oauth-callback.feature` (2 scenarios), `tests/behavior/backend/no-profile-data.feature` (1 scenario).
- `pnpm run check` green; `pnpm run test:smoke` green.
- TJI: `tasks/25-backend-hardening.tji` carries `complete 100` on this task; `tj3 project.tjp` parses silent.
