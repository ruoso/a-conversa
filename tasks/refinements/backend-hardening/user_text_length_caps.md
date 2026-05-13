# `backend_hardening.resource_limits_and_dos.user_text_length_caps`

**Source finding**: [`docs/security/m3-review/inputs.md`](../../../docs/security/m3-review/inputs.md) F-003.
**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.user_text_length_caps`.
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.event_types.event_validation` — settled (`validateEvent` two-stage parse).
- `backend.websocket_protocol.ws_message_envelope` — settled (`parseWsEnvelope` two-stage parse).
- Sibling `fastify_body_limit` is the structural ceiling (64 KiB frame); per-field caps land independently of it.

## What this task is

Every user-authored text field in the proposal / event vocabulary used
to be `z.string().min(1)` with **no upper bound**. The frame-level
`bodyLimit` is the only ceiling, and the unbounded `session_events` row
count (F-011) amplifies the abuse: one client can store an MB-sized
wording string and force every subscribed connection to receive the
inflated payload on every broadcast.

This task adds a per-field `.max(N)` to every user-authored string in
the shared-types vocabulary, with the cap constants centralised in a
new `packages/shared-types/src/limits.ts` module. Three tiers:

| Tier | Cap | Fields |
| --- | --- | --- |
| Methodology text (`MAX_METHODOLOGY_TEXT_LENGTH`) | 10 000 | `node-created.wording`, `annotation-created.content`, `edit-wording.reword/restructure.new_wording`, `decompose.components[].wording`, `interpretive-split.readings[].wording`, `meta-move.content`, `amend-node.new_content`, `annotate.content` |
| Topic (`MAX_TOPIC_LENGTH`) | 256 | `session-created.topic` (mirrors the existing HTTP-layer `maxLength: 256` on `createSessionBodySchema`) |
| Snapshot label (`MAX_SNAPSHOT_LABEL_LENGTH`) | 128 | `snapshot-created.label` (pre-existing 128 lifted to a named constant) |
| Screen name (`MAX_SCREEN_NAME_LENGTH`) | 64 | `participant-joined.screen_name` (mirrors `validateScreenName`'s post-trim 64 ceiling) |

The artefacts:

- `packages/shared-types/src/limits.ts` — the new constants module.
- `packages/shared-types/src/events.ts` — `topic`, `screen_name`, `wording`, `content`, `label` get `.max(constant)`.
- `packages/shared-types/src/events/proposals.ts` — every proposal sub-kind's user-authored string gets `.max(MAX_METHODOLOGY_TEXT_LENGTH)`.
- `packages/shared-types/src/index.ts` — re-exports `./limits.js`.
- `packages/shared-types/src/limits.test.ts` — per-field at-cap-accept / over-cap-reject (28 cases).

## Why it needs to be done

F-003 in `docs/security/m3-review/inputs.md` documents the
amplification surface: a single propose envelope can carry an
~MB-sized wording string, get JSON-parsed, re-validated, stored
verbatim in `session_events.payload`, re-validated on read, projected,
and re-broadcast in `event-applied` to every subscriber. Per-field
caps close the user-text amplification path; the sibling
`fastify_body_limit` task closes the envelope-level path (both are
needed — neither subsumes the other).

The 10 KiB methodology cap is generous on purpose: a debate statement
that legitimately needs paragraphs of nuance has room (10 000 chars is
~6–8 pages of typed text), while still being orders of magnitude under
the 64 KiB frame cap and under any plausible legitimate use. The
tighter caps on topic / screen-name / snapshot-label are structural —
those fields are short labels surfaced in lists, not free-form text.

## Inputs / context

From [`docs/security/m3-review/inputs.md`](../../../docs/security/m3-review/inputs.md) F-003:

> Every user-authored text field in the methodology vocabulary
> (`new_wording`, `wording`, `content`, `new_content`) is
> `z.string().min(1)` with no upper bound. The frame-level `bodyLimit`
> (F-002) is the only ceiling. A single `propose` envelope can carry an
> ~MB wording string that gets (1) JSON-parsed, (2) re-validated, (3)
> stored verbatim in `session_events.payload`, (4) re-validated on
> read, (5) projected, and (6) re-broadcast in `event-applied` to every
> subscriber.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):
each cap is pinned by a committed Vitest unit case in
`limits.test.ts` — the first run is the verification, and the test
moves with the constant on every future change.

## Constraints / requirements

- **Single source of truth**: every cap lives in `limits.ts`. No
  magic numbers scattered across schemas — every `.max(...)` call
  takes a named constant.
- **At-cap accepted, cap+1 rejected**: per-field tests pin both
  boundaries.
- **Below the frame cap**: the methodology cap times the worst-case
  UTF-8 expansion (4×) stays well under the 64 KiB `bodyLimit` the
  sibling `fastify_body_limit` task lands. The
  `limits.test.ts` cap-constants-are-well-formed block pins this
  arithmetic invariant.
- **Surfaced as `bad-request`**: a payload-shape rejection routes
  through the existing two-stage parse — the WS path emits a
  `malformed-envelope` error envelope; the HTTP path emits a
  `validation-failed` 400. No code-change needed in the dispatcher /
  error-handler; the cap is a `z.string().max()` like every other
  shape rule.
- **Exports**: constants exported through the package index so
  downstream tests and clients can reference them.

## Acceptance criteria

- `packages/shared-types/src/limits.ts` exports
  `MAX_METHODOLOGY_TEXT_LENGTH = 10_000`,
  `MAX_TOPIC_LENGTH = 256`,
  `MAX_SNAPSHOT_LABEL_LENGTH = 128`,
  `MAX_SCREEN_NAME_LENGTH = 64`.
- Every user-authored text field listed in the table above has a
  `.max(...)` from one of these constants.
- 28 new Vitest cases in `limits.test.ts` pin at-cap / over-cap /
  typical-short behavior across all affected fields.
- `pnpm run check` and `pnpm run test:smoke` pass.

## Decisions

- **Cap value for methodology text: 10 000.** Generous enough for
  nuanced multi-paragraph statements; tight enough that 4× UTF-8
  worst-case stays under the 64 KiB frame ceiling. A single
  `propose` envelope can carry at most one or two such fields (e.g.
  `decompose` with up to 10 components, each capped) — the bus-of-N
  amplification is real but bounded.
- **Pre-existing 128 on snapshot label kept, not retightened.** The
  prior value moves into the new constants module unchanged; no
  behavioural change for snapshot labels, just naming.
- **No cap on `error.message`.** The error envelope is server-emitted;
  the message is constructed by the server (often echoing a Zod issue
  path). Capping it would risk a server-internal serialise-time
  failure on a legitimately-long error. Not in scope.
- **No cap added to the WS `error.code` field.** Already
  `z.string().min(1)`; the discipline that `code` is kebab-case is
  enforced by the construction surface (`buildWsErrorEnvelope`), not
  the schema. Out of scope for this finding.
- **Tests live in a dedicated `limits.test.ts`, not scattered.** A
  single file is the natural home for "this matrix of fields is
  capped"; the per-field event tests in `events.test.ts` and
  `proposals.test.ts` already pin shape, not size.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

- Limits module: `packages/shared-types/src/limits.ts` (exports the
  four `MAX_*` constants).
- Schema updates: `packages/shared-types/src/events.ts` (`topic`,
  `screen_name`, `wording`, `content`, `label`) and
  `packages/shared-types/src/events/proposals.ts` (every proposal
  sub-kind's user-authored string).
- Tests: `packages/shared-types/src/limits.test.ts` (28 cases —
  at-cap accept + cap+1 reject per field; plus a cap-constants
  well-formedness block).
- `pnpm run check` + `pnpm run test:smoke` clean (1046 tests pass; 28
  net new).
