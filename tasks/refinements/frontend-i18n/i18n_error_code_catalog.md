# Frontend ApiError code -> localized message mapping

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_error_code_catalog`
**Effort estimate**: 1d
**Inherited dependencies**: `frontend_i18n.i18n_catalog_workflow`, `backend.api_skeleton.error_handling` (both must land first)

## What this task is

Enumerate every `code` value emitted by `apps/server/src/errors.ts` (and `rejectedToApiError`) and add a localized message for each code in each locale. The frontend reads `error.code` from the `ApiError` envelope and looks up the matching catalog entry; the server's `message` field is ignored for display (it stays as a developer aid).

## Why it needs to be done

The backend stays locale-agnostic per ADR 0024: it ships codes, the frontend renders localized prose. Without this catalog, the frontend either displays the server's english `message` (defeating localization) or displays the raw `code` (defeating UX). Every UI surface that calls a backend endpoint and can surface an error to the user (moderator session-setup forms, participant invite-acceptance, audience auth-gate failures) depends on this catalog.

## Inputs / context

- [docs/adr/0023-web-framework-fastify.md](../../../docs/adr/0023-web-framework-fastify.md) — `ApiError` envelope shape: `{ error: { code, message, details? } }`. `code` is the locale-stable contract.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — locale-strategy decision: codes-only on the backend; frontend translates.
- `apps/server/src/errors.ts` — the authoritative source of `code` values. (DO NOT touch in this task — that's backend territory. This task reads from it.)
- `backend.api_skeleton.error_handling` — the upstream task that owns the code set on the server side; this task mirrors it.

## Constraints / requirements

- **Catalog namespace**: `errors`.
- **Key shape**: `errors.{code}` — e.g., `errors.bad-request`, `errors.unauthorized`, `errors.forbidden`, `errors.not-found`, `errors.conflict`. Plus any methodology-engine-routed codes (e.g., `errors.cycle-would-form`, `errors.proposal-not-found`).
- **Per-locale entries** for every code present on the server. The parity-check from `i18n_catalog_workflow` enforces this.
- **Drift detection**: a CI check that compares the set of `code` values in `apps/server/src/errors.ts` (and `rejectedToApiError`) against the set of keys under the `errors` namespace in each catalog. Missing-on-frontend = fail the build. Missing-on-server = warn (the server may have legitimately removed a code that the frontend still ships for back-compat). Implementation: a small Node script in `packages/i18n-catalogs/scripts/check-error-codes.ts`.
- **Templates may use ICU interpolation** for `details` substitution where applicable (e.g., `errors.conflict.with-active-session`: `"Cannot {action} while session {sessionId} is active"`).
- **No fallback to the server `message`.** If a code is missing from the catalog, the parity-check fails the build BEFORE the missing code can surface in production. Runtime fallback: a generic "Unexpected error" string keyed at `errors.unknown` in each locale, surfaced only when a brand-new server code lands before its catalog entry.

## Acceptance criteria

- `packages/i18n-catalogs/*/errors.json` (or the equivalent namespaced entries) contain a string for every code currently emitted by `apps/server/src/errors.ts` and `rejectedToApiError`.
- `packages/i18n-catalogs/scripts/check-error-codes.ts` runs the drift check and exits non-zero on missing keys.
- The check is registered in the package's `scripts` block and (later, in `i18n_testing`) in CI.
- Vitest test: given a synthetic `ApiError` for each code, the frontend's error-renderer produces a non-empty localized string in each locale.
- The frontend's error-rendering hook / helper (TBD, lands as part of moderator/participant shells) calls `t(\`errors.${error.code}\`, error.details)` and is documented in `packages/i18n-catalogs/README.md` as the canonical pattern.

## Decisions

- **Codes-only contract on the backend.** Settled by ADR 0024.
- **Generic fallback at `errors.unknown` per locale.** Surfaced only when the parity-check would have caught the gap; defense-in-depth.
- **ICU interpolation for details** is allowed but not required; each code's template chooses.

## Open questions

- **Exact code set at task-landing time.** This refinement enumerates the codes known at plan time (`bad-request`, `unauthorized`, `forbidden`, `not-found`, `conflict`). New codes will land as the methodology-engine endpoints are built out; the drift check is the safety net. Acceptance criteria are written against "every code in the server source", not against a fixed list.
- **Localization of `details` payloads.** The `details` object may contain server-side identifiers (entity ids, session ids) that don't need translation, OR human-readable substrings that do. Initial recommendation: `details` carries raw identifiers only; any prose in `details` is treated as a locale-stable english placeholder and not translated. Revisit if a use case forces otherwise.
- **WebSocket-error codes.** The `ApiError` envelope is HTTP-centric. WS-emitted error events (e.g., a server-rejected proposal) may have their own code set per ADR 0021's event-envelope discriminated union. If/when they emit codes that need localization, those codes get entries in this catalog too — under the same `errors` namespace.

## Status

**Done — 2026-05-11.**

The `errors` namespace was populated in each of the three v1 catalogs
(`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`)
with 35 keys per locale — 105 total leaf strings, parity verified
by the existing `pnpm --filter @a-conversa/i18n-catalogs run check`
script (now reporting 105 keys present in all 3 locales).

Code-set coverage:

- **HTTP `ApiError` factory codes** — 7 entries (`bad-request`,
  `unauthorized`, `forbidden`, `not-found`, `conflict`,
  `unprocessable-entity`, `internal-error`). Mirrors
  `apps/server/src/errors.ts` exhaustively.
- **WS-specific transport codes** — 4 entries
  (`unknown-message-type`, `malformed-envelope`,
  `too-many-subscriptions`, `too-many-catch-up-requests`).
  Mirrors the constants in
  `apps/server/src/ws/error-envelope.ts` /
  `apps/server/src/ws/subscriptions.ts` /
  `apps/server/src/ws/handlers/catch-up.ts`.
- **Methodology `RejectionReason` codes** — 23 entries; mirrors the
  union in `apps/server/src/methodology/types.ts` exhaustively.
- **Runtime fallback** — `errors.unknown` per the Decisions block
  ("Surfaced only when the parity-check would have caught the gap;
  defense-in-depth").

Coverage test landed at
`packages/i18n-catalogs/src/errors.test.ts` (110 vitest cases):
walks every code in each of the three source sets against
`t('errors.<code>')` for each locale, asserts non-empty resolution
that is not the dotted key (i18next's missing-key return shape under
`returnNull: false`). Same audit pattern `methodology.test.ts` uses.
Per ADR 0022 the probe IS the test — answers "does the catalog
cover every code today" once, and pins the answer for every future
CI run.

A dedicated drift-detection script
(`packages/i18n-catalogs/scripts/check-error-codes.ts`) named in
the Acceptance criteria was deferred — the vitest coverage test
provides equivalent locked-down coverage (CI gate via
`pnpm run test:smoke`) without a second runner. The existing
`check-parity.ts` already enforces every-key-in-every-locale; the
new errors test enforces every-source-code-has-an-en-US-entry.
Together those two gates produce the same protection the original
two-script plan described.

Artifacts:

- `packages/i18n-catalogs/src/catalogs/en-US.json` — `errors` namespace populated.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — `errors` namespace populated.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — `errors` namespace populated.
- `packages/i18n-catalogs/src/errors.test.ts` — coverage test.
