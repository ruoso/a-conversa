// Shared string-length caps for user-authored text on the
// envelope / wire / event-log surfaces.
//
// Refinement: tasks/refinements/backend-hardening/user_text_length_caps.md
// Source finding: docs/security/m3-review/inputs.md F-003
// TaskJuggler: backend_hardening.resource_limits_and_dos.user_text_length_caps
//
// Every user-authored string in the proposal / event vocabulary used to
// be `z.string().min(1)` with NO upper bound — the only ceiling was the
// frame-level `bodyLimit` / `maxPayload` (the sibling
// `fastify_body_limit` task lands those at 64 KiB). Without per-field
// caps a single client could push (1) a multi-MB string into a single
// `propose` envelope, (2) have it persisted verbatim in
// `session_events.payload`, and (3) re-broadcast to every subscribed
// connection. Combined with the unbounded `session_events` row count
// (F-011) the amplification is storage-exhaustion + bandwidth-abuse
// shaped.
//
// **Centralised so the caps live in one place** — every schema that
// needs a length cap imports the matching constant rather than spelling
// a magic number. Tests reference the same constants when constructing
// at-cap and over-cap fixtures so the assertions move with the
// constants.
//
// **Three tiers** —
//   - Methodology text (`wording`, `content`, `new_wording`,
//     `new_content`): generous (10 KiB) because nuanced debate text
//     legitimately needs paragraphs of room. Far longer than a typical
//     debate statement; far shorter than the 64 KiB frame cap so a
//     single envelope can never approach the wire ceiling on the text
//     alone.
//   - Short labels (`topic`, snapshot `label`): structural identifiers
//     surfaced in lists and headers; tight cap (256 / 128).
//   - User display name (`screen_name`): mirrors the auth-route
//     validator's 64-char trim cap.
//
// Adding a new user-authored text field: pick the matching tier, import
// the constant, and add a per-field test that pins both the at-cap and
// over-cap paths.

/**
 * Methodology-text cap — node `wording`, annotation `content`,
 * proposal `new_wording` / `new_content` / `content`, decomposition /
 * interpretive-split component `wording`, meta-move `content`.
 *
 * 10 000 UTF-16 code units. Comfortably under the 64 KiB frame
 * `bodyLimit` (a single 10 000-char string serialises to ~10 KiB JSON,
 * leaving headroom for surrounding envelope structure even at the
 * largest plausible field count).
 */
export const MAX_METHODOLOGY_TEXT_LENGTH = 10_000;

/**
 * Session-topic cap — mirrors the existing HTTP-layer `maxLength: 256`
 * in `apps/server/src/sessions/routes.ts`'s `createSessionBodySchema`.
 * The session topic is a short label surfaced in session-list and
 * detail views.
 */
export const MAX_TOPIC_LENGTH = 256;

/**
 * Snapshot-label cap — pre-existing 128 from
 * `snapshot_events`. Kept at its prior value; the constant is here so
 * future changes update a single source of truth.
 */
export const MAX_SNAPSHOT_LABEL_LENGTH = 128;

/**
 * Screen-name cap — mirrors the `validateScreenName` post-trim 64
 * check in `apps/server/src/auth/routes.ts`. The event-log
 * `participant-joined` payload carries the persisted screen name; the
 * schema enforces the same ceiling at validation time.
 */
export const MAX_SCREEN_NAME_LENGTH = 64;

/**
 * `GET /sessions` `?offset` upper bound.
 *
 * Refinement: tasks/refinements/backend-hardening/list_sessions_offset_cap.md
 * Source finding: docs/security/m3-review/coverage.md G-013
 *
 * The list-sessions schema previously capped `?limit` at 200 but left
 * `?offset` with only a `minimum: 0` — so a well-formed request like
 * `GET /sessions?offset=999999999999` arrived at Postgres as a valid
 * `OFFSET 999999999999`. Postgres returns an empty result correctly
 * but burns I/O and CPU scanning past the offset; an authenticated
 * client can multiply that cost with parallel requests.
 *
 * 100 000 = 500 pages at the maximum `limit` of 200 — orders of
 * magnitude beyond any human pagination need. Over-cap requests are
 * rejected at the schema layer (400 `validation-failed`) before any
 * DB round-trip; the cost of an abuse attempt collapses to the cost
 * of parsing the query string.
 */
export const MAX_SESSION_LIST_OFFSET = 100_000;
