# Production CORS lockdown via APP_BASE_URL

Source: [docs/security/m3-review/auth.md](../../../docs/security/m3-review/auth.md) F-003

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.prod_cors_lockdown`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — the bootstrap that registers `@fastify/cors` exists), `backend.auth.oauth_provider_config` (settled — `APP_BASE_URL` env var already parsed by the OIDC config loader, but this task does not depend on the OIDC plugin being registered)

## Goal

Tighten the production CORS allowlist to `APP_BASE_URL`'s origin (with `credentials: true`). Keep the open dev default (`origin: true`) so localhost development with arbitrary preview origins, `localhost` vs `127.0.0.1`, and the Vite dev server (`:5173`) still work without per-developer env tweaks. Close `docs/security/m3-review/auth.md` F-003.

## Context

Today `apps/server/src/server.ts:158-161` registers `@fastify/cors` with `{ origin: true, credentials: true }`. `origin: true` reflects whatever the inbound `Origin` is back as `Access-Control-Allow-Origin`. Combined with `credentials: true`, that means **every protected JSON endpoint is reachable from any web origin with `withCredentials`**, and the only thing preventing CSRF on state-changing endpoints is `SameSite=Lax` on the session cookie. The code comment said "production tightening lives with `deployment.prod_container`" but that task is deferred and is the wrong owner anyway — the CORS policy is application code, not deployment shape. The M3 security review (F-003, High) explicitly flagged this as a footgun that must close before the app is exposed to a public network surface (M9 — deployment milestone — depends on M3-review per `tasks/99-milestones.tji`).

The session cookie is `SameSite=Lax`. That mitigates state-changing cross-site requests today, but the wide-open CORS surface remains a footgun for two scenarios:

1. **`/auth/me` is fetchable from any origin.** A malicious site can issue a top-level navigation to `/auth/me` and read the user id + screen name. Limited exfil but real.
2. **Any future loosening to `SameSite=None`** (or any future endpoint that accepts a simple GET state-change) becomes an open CSRF surface the moment it ships, with no visible "we changed the policy" review trigger.

Locking down the production policy now closes (1) and removes (2) as a latent regression risk.

## Inputs / context

- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — current `@fastify/cors` registration site.
- [`apps/server/src/auth/config.ts`](../../../apps/server/src/auth/config.ts) — where `APP_BASE_URL` is already parsed (for the OIDC redirect URI). The CORS path deliberately re-parses `APP_BASE_URL` via `new URL(...).origin` rather than reaching into `loadOidcConfig`, because CORS is not OIDC-conditional — a deployment without OIDC env vars but with `APP_BASE_URL` set should still get the locked-down CORS.
- [`apps/server/src/logger.ts`](../../../apps/server/src/logger.ts) — the established pattern for env-driven per-environment config: a pure function from a typed `Env` subset to a Fastify option. `resolveCorsOptions` mirrors `createLoggerOptions`.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical check lands as a committed test. The dev-vs-prod boundary is pinned by Vitest `app.inject(...)` preflight cases, not a one-off curl.
- [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md) F-003: the finding being closed. The suggested fix is verbatim what landed.
- [`docs/security/m3-review/README.md`](../../../docs/security/m3-review/README.md): rolls F-003 up under the auth-hardening cluster.

## Constraints / requirements

- **Production**: `NODE_ENV === 'production'` selects `{ origin: [<APP_BASE_URL.origin>, ...CORS_ORIGIN_ALLOWLIST], credentials: true }`. Only listed origins are echoed back.
- **Dev / test**: anything else (`'development'`, `'test'`, unset, `'ci'`) keeps `{ origin: true, credentials: true }`.
- **Fail-fast in production**: if `NODE_ENV === 'production'` and `APP_BASE_URL` is missing or malformed, the server throws at boot — refusing to ship a wildcard allowlist by default is the safe failure mode.
- **Allowlist parsing**: `CORS_ORIGIN_ALLOWLIST` (optional) is comma-separated; each entry is normalized via `new URL(entry).origin` (so `https://app.example.com/`, `https://app.example.com`, and `https://app.example.com/path` all collapse to the same allowlist entry); duplicates are deduped; malformed entries throw at boot.
- **`credentials: true` stays on**. The session cookie path requires it for the legitimate same-origin frontend; the lockdown narrows `origin`, not `credentials`.
- **Boundary at `process.env`**, not at the route layer. The check happens once at bootstrap and produces a static options object — `@fastify/cors`'s allowlist comparison is what enforces per-request.
- **Tests pin the boundary**. Three integration cases (the spec from the task brief): production + off-allowlist origin → no `Access-Control-Allow-Origin`; production + APP_BASE_URL origin → echoed; development + any origin → echoed.
- **Deterministic tests**. No real DNS, no external services. Env mutation around `createServer({ logger: false })` with `.inject(...)` preflights.

## Acceptance criteria

- `apps/server/src/server.ts` registers `@fastify/cors` with the result of `resolveCorsOptions(process.env)` — no inline `{ origin: true }` anywhere in production code paths.
- `resolveCorsOptions` is exported (so tests and future siblings can call it without re-deriving the env contract).
- The three integration cases (off-allowlist reject, APP_BASE_URL accept, dev default) pass in `apps/server/src/server.test.ts`.
- The boundary cases (missing `APP_BASE_URL` in prod, malformed `APP_BASE_URL`, malformed `CORS_ORIGIN_ALLOWLIST` entry) throw at boot — pinned by the `resolveCorsOptions` unit cases.
- `pnpm run check` and `pnpm run test:smoke` both green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands.

## Decisions

- **Dev keeps `origin: true`**. The threat model is the production network surface; dev runs same-host across multiple ports and the open default is what keeps the developer experience friction-free. The dev/prod split makes the policy change visible in one place (the `NODE_ENV === 'production'` branch in `resolveCorsOptions`) rather than scattering env-conditional code across the codebase.
- **`APP_BASE_URL.origin`, not `APP_BASE_URL` verbatim**. `@fastify/cors` compares origins (scheme + host + port), so the path component on `APP_BASE_URL` is irrelevant and including it would just risk subtle mismatches. `new URL(...).origin` is the canonical extraction.
- **`CORS_ORIGIN_ALLOWLIST` is implemented now, not deferred**. The cost is ~15 lines and the staging / preview deployment shape is the obvious next consumer; deferring it would just create a near-future follow-up task. Each entry is normalized through `new URL(...).origin` (so `https://staging.example.com/`, `https://staging.example.com`, and `https://staging.example.com/foo` collapse to the same entry), and the parser throws on malformed entries — same fail-fast posture as `APP_BASE_URL`.
- **Throw at boot on missing / malformed prod env**. Two alternatives were considered: (a) silently fall back to dev (`origin: true`) when `APP_BASE_URL` is missing in prod — rejected, because the silent fallback is exactly the footgun F-003 flagged; (b) fall back to an empty allowlist that rejects everything — rejected, because a production server with broken CORS gives no useful diagnostic to the operator (they see "CORS failed" from their browser, not "you forgot APP_BASE_URL"). Throwing at boot with a clear error message is the loudest, safest signal.
- **Don't depend on `loadOidcConfig`**. CORS is not OIDC-conditional. A deployment with no OIDC env (the OIDC routes get skipped per the existing bootstrap pattern) but with `APP_BASE_URL` set still gets the locked-down CORS — the two concerns are orthogonal.
- **Unit-test the helper AND integration-test the wire**. The pure function is cheap to test exhaustively (boundary cases on missing/malformed env, allowlist parsing); the integration cases are what pin the actual `@fastify/cors` behavior under the wire-shaped contract. Per ADR 0022, the integration cases are the source of truth; the unit cases are kept because they're 4-line each and they document the contract on the helper directly.
- **Env-mutation pattern in tests**. The CORS path reads `process.env` inside `createServer()` (mirroring `createLoggerOptions`'s pattern, which reads `process.env.NODE_ENV` at the same site). Tests wrap `createServer({ logger: false })` in a `withEnv({ ... })` helper that saves / overrides / restores the keys. Cleaner than refactoring `createServer` to accept an env arg today; if a future task introduces a typed `ServerEnv` shape, the helper can move there.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Code: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — exports `resolveCorsOptions(env)` + `CorsEnv` / `ResolvedCorsOptions` types; the CORS plugin is registered with the result of `resolveCorsOptions(process.env)`.
- Tests: [`apps/server/src/server.test.ts`](../../../apps/server/src/server.test.ts) — +10 Vitest cases (7 unit cases for `resolveCorsOptions` covering the dev default, prod allowlist, `APP_BASE_URL` normalization, `CORS_ORIGIN_ALLOWLIST` parsing + dedup, missing-prod-env throw, malformed-URL throw, malformed-allowlist-entry throw; 3 integration cases for the dev-vs-prod boundary as specified by the task brief — off-allowlist reject, APP_BASE_URL accept, dev default echo).
- `complete 100` marker added in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `pnpm run check` and `pnpm run test:smoke` (1028 tests) both green.
