Source: docs/security/m3-review/coverage.md G-013

# `backend_hardening.resource_limits_and_dos.list_sessions_offset_cap`

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.list_sessions_offset_cap`.
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `backend.session_management.list_sessions_endpoint` — settled (`GET /sessions` at `apps/server/src/sessions/routes.ts:1281`; `listSessionsQuerystringSchema` at line 756).
- `backend_hardening.resource_limits_and_dos.user_text_length_caps` — settled. Introduced `packages/shared-types/src/limits.ts`, the shared module that owns wire-level numeric ceilings. This task adds one more constant to that module.

## What this task is

Cap the `?offset` query parameter on `GET /sessions` so an
authenticated client can't burn DB scan budget with
`?offset=1e18`-style requests. The pre-task schema enforces
`minimum: 0` with **no upper bound**; a well-formed request like
`GET /sessions?offset=999999999999` reaches Postgres as a valid
`OFFSET 999999999999`. Postgres returns an empty result correctly but
spends I/O / CPU scanning past the offset; an authenticated attacker
can multiply that with parallel requests.

The artefacts:

- `packages/shared-types/src/limits.ts` — add `MAX_SESSION_LIST_OFFSET = 100_000` alongside the existing four text-length caps.
- `apps/server/src/sessions/routes.ts` — import the constant; add `maximum: MAX_SESSION_LIST_OFFSET` to the `offset` property of `listSessionsQuerystringSchema`. Update the inline description so the OpenAPI surface documents the cap.
- `apps/server/src/sessions/routes.test.ts` — four new Vitest cases: at-cap accept, cap+1 reject, far-over-cap (1e15) reject, and a regression on `?offset=0`.

## Why it needs to be done

G-013 in `docs/security/m3-review/coverage.md`:

> A request like `GET /sessions?offset=999999999999` is well-formed
> (Zod allows any nonnegative integer), Postgres handles a giant
> OFFSET correctly but burns disk/CPU to scan past it. No `?offset`
> upper-bound test.
>
> Adversarial scenario: Authenticated denial-of-service:
> `GET /sessions?offset=1e18` repeated in parallel chews
> session_index scans on the server until the connection pool
> exhausts.

The `?limit` parameter is already capped at 200 at the same schema
layer; adding the offset cap is the symmetric tightening. 100 000 is
a generous ceiling — at the maximum `?limit=200` that's 500 pages of
history. Any UI that legitimately paginates beyond 500 pages has
bigger problems than this cap; production can lift the value through
the constants module if a future feature demands it.

The cap is structural — it fails fast at the Ajv validator layer, so
an over-cap request never reaches the visibility-gated SQL query.
The cost of an abuse attempt collapses to the cost of parsing the
query string + emitting the 400 envelope.

## Inputs / context

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts)
(pre-task, the `offset` property of `listSessionsQuerystringSchema`
at line 812):

```ts
offset: {
  type: 'integer',
  minimum: 0,
  default: 0,
  description: '...',
},
```

No upper bound — any nonnegative integer that fits in a JS number
is accepted by the validator and passed through as `OFFSET $N` to
the SQL query.

From [`packages/shared-types/src/limits.ts`](../../../packages/shared-types/src/limits.ts)
(post-`user_text_length_caps`): the module exists, exports
`MAX_METHODOLOGY_TEXT_LENGTH`, `MAX_TOPIC_LENGTH`,
`MAX_SNAPSHOT_LABEL_LENGTH`, `MAX_SCREEN_NAME_LENGTH`, and is the
documented home for shared wire-level numeric caps.

From the existing limit-cap test pattern in
[`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts):

```ts
it('returns 400 validation-failed when ?limit exceeds the 200 cap', async () => {
  // ... seed + token
  const response = await built.app.inject({
    method: 'GET',
    url: '/sessions?limit=999',
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');
});
```

The offset-cap tests mirror this shape, plus an at-cap accept case
and a regression on the default `?offset=0`.

## Constraints / requirements

- **Constant home**: `packages/shared-types/src/limits.ts`. Re-uses
  the module landed by `user_text_length_caps`; consumers import via
  `@a-conversa/shared-types`.
- **Cap value**: `100_000`. 500 pages at `?limit=200`, decisively
  beyond any legitimate human pagination scenario.
- **Schema integration**: the constant lands as the `maximum`
  property of the existing JSON-schema (Ajv-validated) `offset`
  field. No new schema layer is introduced; this is the same shape
  as the pre-task `maximum: 200` cap on `limit`.
- **Inline comment**: a comment on the `maximum:` line cross-
  references G-013 and the rationale, so a future reader walking the
  schema can trace the cap to its source finding.
- **Per ADR 0022**: every cap-behavior assertion lands as a
  committed Vitest case. The at-cap-accept, cap+1-reject, far-over-
  cap-reject, and offset=0-regression are all pinned tests in
  `apps/server/src/sessions/routes.test.ts`.

## Acceptance criteria

- `MAX_SESSION_LIST_OFFSET = 100_000` exported from
  `packages/shared-types/src/limits.ts`.
- `apps/server/src/sessions/routes.ts` imports the constant and
  applies it as `maximum:` on the `offset` schema property.
- The OpenAPI `description` for the field mentions the cap so the
  documented contract reflects the runtime behavior.
- Vitest cases pin:
  - `?offset=100000` → 200 (at-cap accept).
  - `?offset=100001` → 400 `validation-failed` (cap+1 reject).
  - `?offset=999999999999999` → 400 `validation-failed` (the G-013
    DoS-scenario integer).
  - `?offset=0` → 200 with the seeded session in the body
    (regression — the default path stays unaffected).
- `pnpm run check` clean.
- `pnpm run test:smoke` passes including the four new cases.
- `complete 100` added to the `list_sessions_offset_cap` task entry
  in `tasks/25-backend-hardening.tji`;
  `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **Cap value of 100 000.** 500 pages at the existing `?limit=200`
  ceiling. Any legitimate paged UI bumps the ceiling at one tenth
  of that scale; sustained access beyond 500 pages is a methodology-
  question (the session-history surface design), not a paging
  question. Tight enough that an attacker cannot iterate the
  visibility-gated index without paying per-page, generous enough
  that the cap never interferes with legitimate use.
- **Same schema layer as `?limit`'s 200 cap.** The task is the
  symmetric tightening of an already-existing structural ceiling.
  Sticking with the JSON-schema `maximum:` keeps both caps visible
  in the same `properties` block of `listSessionsQuerystringSchema`;
  introducing a parallel Zod layer would split the validation
  surface for no benefit.
- **Constant lives in shared-types, not in the server package.** The
  cap is a wire-shape contract; clients building a pager UI should
  read the same constant when deciding whether to keep paging.
  Co-locates with the existing four `MAX_*` constants from
  `user_text_length_caps` — the module's documented purpose is
  exactly this kind of cap.
- **400 not 422 on over-cap.** Matches the existing `?limit > 200`
  rejection shape — Fastify's Ajv-driven validator emits 400 with
  the canonical `validation-failed` envelope. Clients distinguish
  validation errors by the `error.code` discriminator, not the
  status code.
- **No env override.** The other recently-added caps
  (`BODY_LIMIT_BYTES`, `WS_MAX_PAYLOAD_BYTES`,
  `FLOW_STATE_MAX_ENTRIES`, `WS_CATCHUP_MAX_EVENTS`) take env
  overrides because they're memory ceilings an operator might tune
  for a specific deployment. A pagination offset cap is a UX-shape
  decision, not an operator concern — the value is fixed in code
  and changes via a code change (which then re-runs the test
  matrix). Skipping the env override keeps the surface small.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`packages/shared-types/src/limits.ts`](../../../packages/shared-types/src/limits.ts) — added `MAX_SESSION_LIST_OFFSET = 100_000` alongside the existing four `MAX_*` constants from `user_text_length_caps`. JSDoc cross-references the G-013 finding and the rationale (500 pages at `?limit=200`).
  - [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — imported `MAX_SESSION_LIST_OFFSET` from `@a-conversa/shared-types`; added `maximum: MAX_SESSION_LIST_OFFSET` on the `offset` property of `listSessionsQuerystringSchema`. Inline comment + updated `description` document the cap in the OpenAPI surface.

- Tests (Vitest, per ADR 0022) — [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts), +4 cases (72 → 76 in the file):
  - `?offset` exactly at the cap (100 000) → 200 (at-cap accept; empty body + correct total).
  - `?offset` at cap+1 (100 001) → 400 `validation-failed`.
  - `?offset=999999999999999` (the G-013 DoS-scenario integer) → 400 `validation-failed`.
  - `?offset=0` (the default) → 200 with the seeded session in the body (regression — the default path stays unaffected).

- `tasks/25-backend-hardening.tji` — `complete 100` added to the `list_sessions_offset_cap` task entry under `resource_limits_and_dos`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (clean parse).

Test count delta: +4 Vitest cases (routes.test.ts: 72 → 76). `pnpm run check` and `pnpm run test:smoke` both green (1326 tests across 74 files).
