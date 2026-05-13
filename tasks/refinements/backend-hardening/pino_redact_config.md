# Configure Pino `redact` for cookie / authorization / token fields

**Source**: `docs/security/m3-review/auth.md` F-012 + `docs/security/m3-review/inputs.md` F-007

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.pino_redact_config`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.api_skeleton.request_logging` (settled — `createLoggerOptions(env)` helper at `apps/server/src/logger.ts` is the integration point).

## What this task is

Wire an explicit Pino [`redact`](https://getpino.io/#/docs/redaction) block into `createLoggerOptions` so the value of any cookie / authorization header / token field is replaced by the literal `'[redacted]'` before the log line leaves the process. The block lands in both production (structured-JSON) and development (pino-pretty transport) modes; the test mode keeps returning `false` (no logger) so the redact config is structurally present but moot there.

This is a defense-in-depth task — there is no current log call that leaks any of these fields. The point is to make it impossible for a future log call (a debug print, an unhandled-error path that swallows a request object, a quick "let me see what's in the cookie" line) to leak the value regardless of how the call is shaped.

## Why it needs to be done

Two findings, same root cause:

- **`auth.md` F-012**: the existing WS reject path logs `{ route: '/ws' }` only and is safe today, but the surrounding pattern relies on the developer not adding cookie / token fields to the log object. There is no `redact` configured in `createLoggerOptions`. A future PR that adds `{ cookie: rawHeader }` for "debugging" would leak the 7-day bearer cookie to logs.
- **`inputs.md` F-007**: the 5xx fallback path in `error-handler.ts` emits the full `err` object (`pg`'s `DatabaseError` carries `severity`, `code`, `detail`, `where`, plus in some cases the query text in `message`). Structured prod JSON serializes the whole thing. The `logger.ts` comment claimed "Pino's standard request serializer is replaced so headers are dropped entirely," but no `redact` or `serializers` was actually wired.

The structural fix is identical for both: configure `redact` once, in the helper, pinned by tests that capture log output and assert the censorship. Cost: one block of options + ten or so path strings. Benefit: every future log call is automatically scrubbed for these field names.

## Inputs / context

From [`apps/server/src/logger.ts`](../../../apps/server/src/logger.ts) (pre-task):

```ts
if (nodeEnv === 'production') {
  return { level };
}
return {
  level,
  transport: { target: 'pino-pretty', options: { ... } },
};
```

The starting shape: prod returns `{ level }`, dev adds a `transport`. Neither branch has a `redact` block.

From `docs/security/m3-review/auth.md` F-012 (suggested fix):

> Configure Pino `redact: ['req.headers.cookie', 'req.headers.authorization', '*.cookie', '*.token']` in `logger.ts`. The cost is per-log-line redaction; the benefit is defense-in-depth against future log additions.

From `docs/security/m3-review/inputs.md` F-007 (suggested fix):

> Add a `redact: { paths: [...], remove: true }` config to `createLoggerOptions`'s prod branch [...] or use `pino-std-serializers`'s `err` serializer with explicit allowlist.

This refinement adopts the `redact` form (not the serializer-allowlist form) because (a) it applies to every log call, not just the ones routed through a registered serializer, and (b) the `'[redacted]'` censor is more debuggable than `remove: true` (a missing field looks like an absent value; a `'[redacted]'` value looks like an intentional scrub).

From Pino's [redaction docs](https://getpino.io/#/docs/redaction): `paths` is a list of [`fast-redact`](https://github.com/davidmarkclements/fast-redact) path strings. Two important facts the docs make explicit:

1. **The `*` wildcard matches exactly one path segment.** `*.token` matches `{ a: { token: ... } }` but NOT `{ token: ... }` (the latter has no first segment to match). To cover a top-level field, the explicit bare path (`'token'`) is required.
2. **`paths` and the `censor` apply before any serializer runs.** A custom `err` serializer that produces `{ cookie: '...' }` is also redacted, so the two layers compose.

This dictates the path-list shape: every secret-bearing field is listed in both its bare form and its `*.field` form. The bare form catches `{ token: ... }`; the `*.token` form catches `{ wrapper: { token: ... } }`. Pino does not provide a "recursive descent" wildcard.

## Constraints / requirements

- **Single source of truth**: a module-scope `REDACT_PATHS` constant in `logger.ts`. The `createLoggerOptions` helper builds a fresh `redact` block per call (shallow copy of the constant) so callers can't mutate the shared list via the returned options.
- **Paths to cover** (minimum, per task description):
  - Request headers: `req.headers.cookie`, `req.headers["set-cookie"]`, `req.headers.authorization`, `req.headers["x-api-key"]`.
  - Response headers: `res.headers["set-cookie"]`.
  - Field-name catches: `cookie` + `*.cookie`, `token` + `*.token`, `password` + `*.password`, `secret` + `*.secret`, `authorization` + `*.authorization`.
- **`censor: '[redacted]'`** (not `remove: true`). Reasoning above.
- **Applied across test + dev + prod** at the structural level (the option is in the returned object for dev + prod; test mode returns `false` and there's nothing to redact).
- **Inline comment in `logger.ts`** documenting the rationale + linking the two source findings.
- **Tests in `apps/server/src/logger.test.ts`** (extending the existing file):
  - Structural-pin tests: `redact.paths` is the agreed list in prod and dev; `censor` is `'[redacted]'`; the returned `paths` array is a fresh copy on each call (no shared mutation).
  - End-to-end log-capture tests: build a Pino logger from `createLoggerOptions({ NODE_ENV: 'production' })` + a custom destination stream (`{ write(msg: string): void }`). Log an object with `req.headers.cookie` / `req.headers.authorization` / top-level `token` / `res.headers["set-cookie"]` / `*.cookie` (nested) / `password` + `secret`. Assert the secret value is absent from the line and `'[redacted]'` is present. Negative case: `req.method` and `req.url` pass through verbatim.
- **No ad-hoc probes** (ADR 0022). Capture stream is the test's runnable assertion; no `node -e`, no manual log inspection.
- **`pino` becomes a direct dep** of `apps/server` so the test can `import { pino } from 'pino'` without relying on Fastify's transitive resolution.
- **No change to log format**: dev still uses pino-pretty transport; prod still uses default JSON; test still returns `false`.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` green; `apps/server/src/logger.test.ts` adds +13 tests atop the existing 12 (final count: 25 in the file).
- Each end-to-end log-capture test asserts both "secret absent" and "`'[redacted]'` present" on the captured line; the negative test (`req.method` pass-through) is also present.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- `pnpm run check` green.

## Decisions

- **`redact` over a custom `err` serializer.** The two alternatives:
  - **(A) `redact: { paths, censor }`** (chosen). Per-path, per-log-call, applies uniformly regardless of which field path the value lives under. Pino's documented mechanism; no custom code in the helper.
  - **(B) Custom `err` / `req` / `res` serializers with allowlisted fields.** Tighter (you say "only these fields are logged"), but requires a serializer per object kind and doesn't catch ad-hoc log bags (`{ cookie: '...' }` at the root). Higher maintenance burden for the same defense-in-depth goal.
- **`censor: '[redacted]'` over `remove: true`.** A scrubbed field is more debuggable when its name is preserved with a sentinel value (`'[redacted]'`) than when it silently disappears: a missing field looks like an absent value, but a sentinel value looks like an intentional scrub. The marker also makes log-greps for "where do we log cookies?" trivial.
- **Both bare and `*.field` forms in the path list.** Pino's `*` matches exactly one segment, so `{ token: ... }` is not caught by `*.token`. Listing both is the only way to cover both the top-level and the one-level-nested case. Recursive descent isn't supported by Pino's redact; explicit listing is the project-wide convention.
- **`req.headers["x-api-key"]` listed defensively.** No route accepts this header today, but the redact list outlives any one route — and adding a header-based auth in a future task should not require revisiting this list.
- **`pino` added as a direct dep of `apps/server`.** Pino is already a transitive dep via Fastify, but pinning it as a direct dep makes the test's `import { pino } from 'pino'` legitimate under pnpm's strict resolution. The runtime cost is zero; the dependency-graph cost is one explicit version.
- **One refinement, both findings.** F-012 (auth) and F-007 (inputs) both have the same suggested fix and the same source module. Closing them in one task is more efficient than splitting; the commit message records both.

## Open questions

- **Should `Set-Cookie` be redacted on the response side or only on the request side?** Both — `res.headers["set-cookie"]` is the primary outbound leak surface (auth login mints the cookie there). Pinned in the path list.
- **`logFmt` / `transmit` config for centralized log aggregation.** Out of scope — that's `deployment.observability`. The redact applies before transmit, so any future fan-out inherits the censorship automatically.
- **Performance impact of redact at high request rate.** `fast-redact` is documented as O(paths) per log call and the path list is ~15 entries. Not benchmarked here — the suite would surface a regression if it ever became a problem.

## Status

**Done** — 2026-05-11. Landed as:

- Implementation: [`apps/server/src/logger.ts`](../../../apps/server/src/logger.ts) — adds `REDACT_PATHS` + `REDACT_CENSOR` + `LOGGER_REDACT_CONFIG`; both dev and prod branches return a fresh `redact` block.
- Vitest: [`apps/server/src/logger.test.ts`](../../../apps/server/src/logger.test.ts) (+13 tests; 12 → 25 in the file). Two new describe blocks:
  - "createLoggerOptions redact structural pin" — 4 tests for the path list / censor / fresh-copy invariant.
  - "Pino redact end-to-end log capture" — 7 tests covering cookie / authorization / top-level token / `*.cookie` / `res.headers["set-cookie"]` / negative pass-through / password+secret.
- Dependency: `pino@10.3.1` added as a direct dep of `apps/server` (was transitive via Fastify; needed direct for the test import).
- `complete 100` marker added in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
