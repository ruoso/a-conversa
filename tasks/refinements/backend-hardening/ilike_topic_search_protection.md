# ilike_topic_search_protection

**Source**: [docs/security/m3-review/inputs.md](../../../docs/security/m3-review/inputs.md) F-013
**TaskJuggler**: `backend_hardening.resource_limits_and_dos.ilike_topic_search_protection`
**Sibling**: [user_text_length_caps.md](./user_text_length_caps.md) — same constants module.

## Goal

Bound the abuse surface of `GET /sessions?topic=<pattern>` which executes `ILIKE '%<pattern>%'` against an unindexed `sessions.topic` column. Today an authenticated client can flood the server with expensive queries.

## Context

- **Current**: `?topic=` accepts any string up to the body-limit. With no minimum length, `?topic=a` forces a near-full table scan via `ILIKE '%a%'`. Repeated in parallel, this amplifies into a denial-of-service vector.
- **Index status** (`apps/server/migrations/*.sql`): no GIN/trigram index on `sessions.topic`. The structural fix (a `pg_trgm` index) is bigger and deferred.

## Decisions

- **Length caps**: `MIN_TOPIC_SEARCH_LENGTH = 3`, `MAX_TOPIC_SEARCH_LENGTH = 64`. Both exported from `packages/shared-types/src/limits.ts` (the same constants module that owns `MAX_METHODOLOGY_TEXT_LENGTH` from `user_text_length_caps`).
  - **Min 3**: shorter patterns are unsalvageably broad against an unindexed column. Three chars is the minimum that distinguishes a probe from a real search.
  - **Max 64**: matches the screen-name cap shape; a 64-char ILIKE `'%pattern%'` is bounded compute even on a multi-million-row table.
- **Enforcement layer**: extend the Zod query-string schema for `GET /sessions` in `apps/server/src/sessions/routes.ts`. The schema rejects out-of-range values at the boundary; the route never sees a malformed `?topic=`.
- **Empty / whitespace-only**: rejected (caught by `MIN_TOPIC_SEARCH_LENGTH = 3` after trim).
- **Trim before validate**: leading/trailing whitespace is stripped so `?topic=%20%20` doesn't bypass the min check.
- **Deferred: GIN trigram index**. The structural fix — `CREATE INDEX sessions_topic_trgm_idx ON sessions USING gin (topic gin_trgm_ops);` — is a forward-only migration that needs the `pg_trgm` extension enabled. Out of scope for this task (touches migrations + the DB extension list); a follow-up `sessions_topic_trgm_index` task can land it.

## Acceptance

- `?topic=` empty / whitespace-only → 400.
- `?topic=ab` (2 chars) → 400.
- `?topic=abc` (3 chars) → 200.
- `?topic=<65 chars>` → 400.
- `?topic=<64 chars>` → 200.
- Regression: a typical `?topic=climate` still works.
- `pnpm run check` + `pnpm run test:smoke` green.
- `complete 100` in `tasks/25-backend-hardening.tji`.

## Status

- [x] `MIN_TOPIC_SEARCH_LENGTH` + `MAX_TOPIC_SEARCH_LENGTH` exported from `packages/shared-types/src/limits.ts`.
- [x] `GET /sessions` Zod schema enforces both bounds + trims before validating.
- [x] Per-field tests in `apps/server/src/sessions/routes.test.ts`.
- [x] `complete 100` + refinement note in tji.
- [ ] **Deferred to follow-up**: GIN trigram index migration.
