# `backend_hardening.data_hygiene.wire_error_no_echo`

Source: docs/security/m3-review/inputs.md F-009

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.data_hygiene.wire_error_no_echo`.
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — `WsDispatcher` + the `onUnknownType` seam live in `apps/server/src/ws/dispatcher.ts`); `backend.websocket_protocol.ws_error_message` (settled — `sendWsError` + the canonical `error` envelope shape live in `apps/server/src/ws/error-envelope.ts`).

## What this task is

Closes finding **F-009** from the M3 inputs security review. The `WsDispatcher`'s default `onUnknownType` seam built the wire-format error envelope's `message` field via a template literal that interpolated the client-supplied `envelope.type` verbatim:

```ts
message: `no handler registered for message type '${envelope.type}'`,
```

Today the closed `WsMessageType` enum constrains `envelope.type` at parse time, so the echo is bounded to a small fixed set of known kebab-case strings. But the pattern — reflect client input into the wire response — is fragile by construction. The reviewer's concern is two-fold:

1. **Future drift.** If `wsMessageTypeSchema` is ever widened (e.g. to a free-form string for forward-compat), the dispatcher becomes a reflected-input vector with no other guardrail.
2. **Downstream rendering.** Any consumer that renders the wire `payload.message` field unsafely — a moderator-UI diagnostic display, a log aggregator's HTML viewer, a Slack webhook — becomes a small XSS / log-injection surface the day the parse boundary loosens.

This task replaces the verbatim echo with a sanitization helper that emits the client-supplied `type` ONLY when it matches a tight kebab-case regex. Any other value (control chars, very long strings, HTML / quotes / NUL bytes, mixed case, leading digit) falls back to a generic literal. The structured warn-level log line is unchanged — operators still see the raw `messageType` for debugging; only the wire `message` is gated.

The artefacts:

- `apps/server/src/ws/dispatcher.ts` — adds `SAFE_UNKNOWN_TYPE_REGEX`, `WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE`, `formatUnknownTypeMessage(type: unknown): string`. The default `onUnknownType` seam routes the wire `message` through the helper instead of the prior template literal.
- `apps/server/src/ws/dispatcher.test.ts` — extends the existing dispatcher test with 9 new cases: regex pin, debugging-friendly echo, control-char rejection, 5000-char-length rejection, HTML / quotes / NUL rejection, code + correlation regression, and three direct unit-level tests on `formatUnknownTypeMessage`.

## Why it needs to be done

- **Defense in depth, before drift.** The reviewer marked the finding **Suspected (defensive observation)** with no current exploit. The fix is cheap (one helper, ~15 lines) and removes the entire class of regression — a future contributor widening `wsMessageTypeSchema` cannot accidentally re-open the reflection vector because the dispatcher already filters at the seam.
- **Debugging convenience preserved.** The naive fix (always emit the generic literal) makes a legitimate developer-experience case harder: a client author who typo'd `subscriber` for `subscribe` gets `unknown message type` with no hint why. The gated-echo approach keeps the typo visible when the typo looks like a plausible kebab-case message type and refuses to echo when the input is plainly hostile.
- **No-leak alignment.** The dispatcher already follows the no-leak rule on the handler-error seam (non-`ApiError` thrown values surface the generic `'internal error'` literal; the underlying error is logged server-side only). Extending the same discipline to the unknown-type seam keeps the two paths symmetric — the wire surface is uniformly defensive; the structured logs uniformly carry the operator-only detail.

## Inputs / context

From [docs/security/m3-review/inputs.md](../../../docs/security/m3-review/inputs.md) F-009:

> **Location**: `apps/server/src/ws/dispatcher.ts:164-170` — `sendWsError(..., { message: \`no handler registered for message type '${envelope.type}'\`, ... })`.
>
> **Description**: The envelope parser already constrains `type` to the closed `wsMessageTypes` enum, so the echo is bounded to a small fixed set. But the pattern of echoing client input into an outbound message is fragile — if `wsMessageTypeSchema` is ever widened (e.g. to a free-form string for forward-compatibility), this becomes a reflected-input vector. Not currently exploitable.
>
> **Impact**: None today (closed enum). Future-proofing concern.
>
> **Suggested fix**: Use a fixed message (`'unknown message type'`); add the rejected `type` to a `details` field rather than the user-facing message string. Or keep as-is and document the dependency on the closed enum.
>
> **Confidence**: Suspected (defensive observation).

Pre-change shape of the `onUnknownType` default in [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts) (lines 164-169):

```ts
sendWsError((wire) => connection.socket.send(wire), {
  code: WS_UNKNOWN_MESSAGE_TYPE_CODE,
  message: `no handler registered for message type '${envelope.type}'`,
  inResponseTo: envelope.id,
});
```

Inventory of `wsMessageTypes` values (from `packages/shared-types/src/ws-envelope.ts:106-137`): `hello`, `subscribe`, `unsubscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`, `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`, `event-applied`, `error`, `diagnostic`, `proposal-status`. Every value matches `/^[a-z][a-z0-9-]{0,32}$/`; the longest, `meta-disagreement-marked`, is 24 chars (well under the 33-char ceiling).

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Pure-logic change; lands as Vitest in `dispatcher.test.ts` (extending the existing test). No new behavior file required — the cucumber `ws-envelope.feature` already covers the integration path; this task's surface is the wire-message string, which is best asserted at the unit boundary.

## Constraints / requirements

- **Single regex constant.** `SAFE_UNKNOWN_TYPE_REGEX = /^[a-z][a-z0-9-]{0,32}$/` exported from `dispatcher.ts`. Documented inline (allowed charset, length ceiling, list of canonical wsMessageTypes values it covers, list of rejected shapes with rationale). A unit test pins `regex.source` so a future drift requires updating both this refinement and the test in the same commit.
- **Pure helper, exported.** `formatUnknownTypeMessage(type: unknown): string` is a pure function exported from `dispatcher.ts`. The `unknown` parameter type — wider than the dispatcher's `envelope.type` static type — is deliberate: the runtime value crossed a JSON parse boundary, so the helper must be robust against any input shape.
- **Generic literal constant.** `WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE = 'unknown message type'` exported alongside the regex so the test and the production code share a single source.
- **No change to log surface.** The structured warn-level log line continues to carry the raw `messageType` (`connectionId`, `messageId`, `messageType` fields). Operator-visibility is uniform: operators see everything; clients see only the sanitized echo.
- **No change to `code` / `inResponseTo`.** The wire envelope's discriminator (`code: 'unknown-message-type'`) and the correlation field (`inResponseTo = envelope.id`) are unchanged. Clients branching on the typed code keep working.
- **No throwaway probes (ADR 0022).** Every assertion lands as a Vitest case. The 9 new tests are the regression suite: a regex-source pin, four integration tests through `dispatcher.dispatch(...)` covering the four threat vectors F-009 calls out (well-formed typo, control chars, length, HTML / quotes / NUL), one code-+-correlation regression, and three direct unit tests on `formatUnknownTypeMessage` covering safe-echo, unsafe-rejection, and non-string runtime input.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run check` succeeds (lint + format + typecheck + tools + tests typecheck).
- `pnpm run test:smoke` (Vitest) green; net positive test delta of +9 cases from `dispatcher.test.ts`.
- The wire `payload.message` for the four threat vectors is identical: `'unknown message type'` (verbatim — pinned by the constant).
- The wire `payload.message` for a plausible typo (`'subscriber'`) reads `'unknown message type: subscriber'` (verbatim).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Option (b) — sanitized echo via regex gate, not unconditional generic.** The reviewer's suggested fix offered two options: (a) emit a fixed message and add the rejected `type` to a `details` field; (b) emit `'unknown message type: <type>'` when `type` is well-formed. We chose (b) for the wire `message` directly (without an additional `details` field) because:
  - Debugging-experience is non-trivial for a real-time WS protocol; round-tripping a client to the server logs to learn "the type you sent was `subscriber`, not `subscribe`" is hostile. The gated echo keeps the surface developer-friendly.
  - The reviewer's optional `details` field is not added in this task. The motivating downstream consumer (the moderator UI diagnostic display) would render `details` with the same unsafe primitives as `message`, so moving the echo from `message` to `details` does not reduce risk — it relocates it. The regex IS the safety belt; the location doesn't matter.
  - The static-vs-dynamic-message asymmetry (some unknown-type errors carry the type, some don't) is observable to a curious client but does not leak operationally-sensitive state: every byte that escapes the gate is a kebab-case identifier the client already knows it sent.
- **Sanitization regex is `/^[a-z][a-z0-9-]{0,32}$/`.** Rationale:
  - **Leading lowercase letter anchor** — rejects digits, hyphens, dots, and every meta-character as the first byte. Every `wsMessageTypes` value satisfies this anchor today.
  - **`[a-z0-9-]` body** — the kebab-case alphabet. Excludes uppercase (no `WsType`), underscores (no `snake_case`), dots (no `version.0`), and every punctuation / format char by construction.
  - **`{0,32}` length ceiling** — total length 1-33 chars. The longest `wsMessageTypes` value today (`meta-disagreement-marked`) is 24 chars; the 33-char ceiling has headroom for plausible future additions and a buffer for plausible typos. A 5000-char input fails the ceiling AND fails the body charset (almost certainly), making the length check belt-and-suspenders.
  - **`+`-style empty-rejection via `{0,32}` after the anchor** — the leading `[a-z]` means an empty input fails the anchor; explicit empty-string test asserts the fallback.
- **`unknown` parameter type for `formatUnknownTypeMessage`.** Pre-merge the static type of `envelope.type` is the `WsMessageType` union, which guarantees `typeof === 'string'` at compile time. The runtime value crossed a JSON parse boundary — the parser will have rejected non-strings before they reach the dispatcher, but the helper itself must not assume that property (defense in depth + future-widening). The test exercises this with `formatUnknownTypeMessage(null)`, `formatUnknownTypeMessage(123)`, `formatUnknownTypeMessage({})`, etc.
- **Helper lives in `dispatcher.ts`, not a separate module.** The helper is tightly coupled to the `onUnknownType` seam — it has one production caller, the seam itself. A new module would isolate the helper at the cost of a one-file indirection that's not load-bearing. The constants are exported so the test can assert against them without re-declaring.
- **No change to the structured log line.** The warn-level log still carries `messageType: envelope.type`. Pino's serializer handles object / array / non-string `type` values without throwing — the log line is operator-only and is not a security surface (no remote consumer renders it the way an HTML diagnostic display would render a wire `message`).
- **Pin the regex literal in the test.** A test asserts `SAFE_UNKNOWN_TYPE_REGEX.source === '^[a-z][a-z0-9-]{0,32}$'` so a future contributor who relaxes the regex (adds `_`, removes the leading-letter anchor, raises the ceiling) breaks the test and forces them to update both this refinement and the test in the same commit. The pin is the audit trail.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Sanitization helper: [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts) — adds `SAFE_UNKNOWN_TYPE_REGEX`, `WS_UNKNOWN_MESSAGE_TYPE_GENERIC_MESSAGE`, `formatUnknownTypeMessage(type: unknown): string`.
- Wiring (1-line `message:` swap): the default `onUnknownType` seam now reads `message: formatUnknownTypeMessage(envelope.type)` in place of the prior template-literal echo.
- Tests: [`apps/server/src/ws/dispatcher.test.ts`](../../../apps/server/src/ws/dispatcher.test.ts) — 9 new cases (regex pin, debugging-friendly echo, control-char drop, 5000-char drop, HTML / quotes / NUL drop, code-+-correlation regression, three direct unit tests on `formatUnknownTypeMessage`). Test count: 8 → 17.
- WBS: `complete 100` marker added to `wire_error_no_echo` in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
