# URL parameter for log position — `?position=<sequence>` deep-link grammar

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_url_routing.aud_url_position_param` (lines 377-381).
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_url_routing.aud_session_url` (settled — `/sessions/:sessionId` and `/:locale/sessions/:sessionId` mount `<AudienceLiveRoute>` at [`apps/audience/src/App.tsx:178-179`](../../../apps/audience/src/App.tsx#L178); the route reads `useParams<{ sessionId }>` and drives `useWsClient().trackSession(sessionId)` at [`apps/audience/src/routes/AudienceLiveRoute.tsx:37-77`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx#L37); the spec at [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) pins live-mode behaviour across six scenarios). The out-of-scope §25 of [`aud_session_url.md`](aud_session_url.md) explicitly hands the `?position=<sequence>` grammar to **this** leaf.
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_state_management` (settled — the existing URL parser `sessionIdFromPathname()` at [`apps/audience/src/state/sessionId.ts:53-65`](../../../apps/audience/src/state/sessionId.ts#L53) is the precedent for "pure-function pathname → typed-value parser, hook wraps it." This leaf mirrors the same shape one level deeper — into the query-string layer rather than the path layer).

## What this task is

The audience surface's first **query-string** parameter: `?position=<sequence>`, a nonnegative integer naming a point in the session's event log. The shape lands on both reachable session URLs:

- `/a/sessions/<uuid>?position=<sequence>`
- `/a/<locale>/sessions/<uuid>?position=<sequence>`

This leaf delivers the **URL-grammar surface**, not the replay-rendering behaviour. After this leaf:

- A new pure helper `parsePositionParam(searchParams: URLSearchParams): number | null` in `apps/audience/src/state/positionParam.ts` parses the value — returns the canonical nonnegative integer on a valid encoding, `null` on any failure mode (missing, non-numeric, decimal, negative, exceeds `Number.MAX_SAFE_INTEGER`). The helper is pure and trivially Vitest-tested.
- A new React hook `useAudienceLogPosition(): number | null` in `apps/audience/src/state/useAudienceLogPosition.ts` wraps `useSearchParams()` (React Router) and calls the parser. Returns the same `number | null` contract; re-runs reactively when the query string changes.
- Both are re-exported from the existing barrel at [`apps/audience/src/state/index.ts`](../../../apps/audience/src/state/index.ts).
- `<AudienceLiveRoute>` calls `useAudienceLogPosition()` and stores the result in a route-local `const` so future replay-loading downstream consumers can read it from the same component without re-parsing. **No behaviour change in this leaf** — the route continues to call `trackSession(sessionId)` for live-mode subscription. The position value sits dormant until `replay_test.replay_ui.replay_url_position_loading` (0.5d, lines 58-62 of [`tasks/60-replay-and-test-mode.tji`](../../60-replay-and-test-mode.tji)) wires it into replay-mode initialisation.
- Vitest coverage pins the parser's contract (eight failure-mode rows + the happy path) and the hook's contract (re-runs on URL change; locale-prefix and bare paths both yield the same result; absent param returns `null`).
- The existing Playwright spec `tests/e2e/audience-live-session.spec.ts` gains a thin regression-pin scenario: navigating to `/a/sessions/<uuid>?position=42` mounts the live route cleanly (canvas appears, no crash, no error toast) — the URL grammar widens without breaking the live path.

Out of scope (deferred to downstream siblings):

- **Replay rendering when `position` is present** — owned by `replay_test.replay_ui.replay_url_position_loading` (0.5d), which depends on this leaf and on `replay_seek_bar`. That task interprets the position, drives `wsClient` into a catch-up-from-zero-through-position replay, and renders the frozen state. This leaf only surfaces the parsed value.
- **The full replay-mode audience surface** (playback controls, seek bar, speed) — owned by `replay_test.replay_ui.replay_mode_audience_surface` (2d) and its dependent leaves (`replay_playback_controls`, `replay_speed_controls`, `replay_seek_bar`). The replay surface uses a separate URL grammar `/replay/:id` (per [`tasks/60-replay-and-test-mode.tji:40`](../../60-replay-and-test-mode.tji#L40)); the `?position` param this leaf adds is the audience-surface deep-link variant that the replay surface (and possibly other future consumers) reads.
- **Chapter / snapshot deep-linking** — owned by `replay_chapter_jumping`. This leaf only handles the integer-sequence form; symbolic chapter names (`?chapter=axiom-marks`) are a separate URL grammar question.
- **Out-of-range positions** (e.g. `?position=999999` on a session with max sequence 12) — bounded validation requires knowing the session's high-water mark, which the URL parser does not. The downstream replay-loading consumer handles bounds; this leaf returns the syntactically-valid value verbatim and lets the consumer clamp.
- **Editing / shareability affordances** (a "copy link with position" button) — the audience surface is broadcast-clean; no in-route chrome. Any future producer/moderator affordance that emits a `?position=...` link lives in those surfaces' refinements.

## Why it needs to be done

The `replay_test.*` work-stream needs an established URL grammar for "deep-link into a specific moment of a session" **before** the replay surface can consume it. Specifically, `replay_url_position_loading` (0.5d) names this leaf as a dependency at [`tasks/60-replay-and-test-mode.tji:61`](../../60-replay-and-test-mode.tji#L61): without the parsed value available to the route, the replay-loading consumer has nothing to call. Splitting the parser from the consumer keeps each task's scope tight (the parser is 1d of URL-grammar + tests; the consumer is 0.5d of wiring catch-up against an already-parsed value), and isolates the URL-grammar decision (parameter name, type, validation rules) from the replay-behaviour decision.

The downstream consequences of landing this concretely:

- **`replay_url_position_loading` becomes mechanical** — the consumer reads `useAudienceLogPosition()` (or the route-local prop), and calls `wsClient.requestCatchUp({ sessionId, sinceSequence: 0 })` (or similar) when present, with the `position` value bounding the playback. No URL-parsing logic in that task — it's a pure behaviour-wiring leaf.
- **Producer tooling can hand out shareable links** — the moderator UI can emit `/a/sessions/<uuid>?position=<sequence>` URLs that, once the replay-loading consumer lands, render a frozen snapshot at the named moment. The URL grammar is the inter-surface contract.
- **The audience surface stays broadcast-clean** — the parameter is read but invisible in this leaf; no affordance, no chrome, no overlay. The OBS-no-input invariant (`aud_obs_no_input_required`) is preserved by construction (a query-string parameter cannot break it).
- **The parser becomes the canonical "is this URL a replay deep-link?" predicate** — any future surface (the replay surface, a future thumbnail-snapshot producer tool, an embed-iframe consumer) reads the same helper and gets the same answer.

Architecturally, this is the audience surface's **second** URL-driven typed value (after `sessionId`), establishing the pattern that broader URL grammar additions should follow: pure parser → hook wrapper → barrel export → route consumes. The pattern already exists in [`apps/audience/src/state/sessionId.ts`](../../../apps/audience/src/state/sessionId.ts) and [`apps/audience/src/state/useAudienceSessionId.ts`](../../../apps/audience/src/state/useAudienceSessionId.ts); this leaf extends it to the query-string layer.

## Inputs / context

### ADRs

- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — fixes the URL prefix table. The `?position` query string lives under the audience surface's `/a/*` namespace; the root host's basename-strip is upstream and unchanged.
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the locale-prefixed variant `/<locale>/sessions/:id?position=N` must keep working. Query strings are orthogonal to path matching, so `negotiateUrlLocale(pathname)` at [`apps/audience/src/App.tsx:147-157`](../../../apps/audience/src/App.tsx#L147) and the route table at [lines 178-179](../../../apps/audience/src/App.tsx#L178) need no change; the new helper only reads `useSearchParams()`.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every claim about parser behaviour lands as a committed Vitest case; the route-level URL-grammar widening lands as a committed Playwright scenario.
- [ADR 0008 — E2E framework: Playwright](../../../docs/adr/0008-e2e-framework-playwright.md) — Playwright is the test-stack constraint for the route-level pin. The new scenario extends [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) rather than landing a new spec file (no new test category — just a regression pin on existing live-mode behaviour).

### Sibling refinements

- [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md) — §25 of the out-of-scope list names this leaf as the owner of the `?position` reader and explicitly hands off the replay-mode projection threading to the downstream replay tasks. Decision §1 of that refinement (use `useParams` for the matched-route session id) establishes the route-local hook-call pattern this leaf mirrors for the query string.
- [`tasks/refinements/audience/aud_state_management.md`](aud_state_management.md) — the URL-parser-plus-hook pattern this leaf reuses. Decision §3 in particular documents the "pure-function parser at module scope, React-aware hook wrapper that re-runs on URL change" split. The new helpers land in the same directory and barrel.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — the locale-prefix URL grammar (`/a/{locale}?/sessions/{id}`). Confirms the query-string layer is independent of path-segment locale negotiation.

### Live code the leaf plugs into

- [`apps/audience/src/routes/AudienceLiveRoute.tsx:37-77`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx#L37) — the route component this leaf extends. Adds a single `const logPosition = useAudienceLogPosition();` line after the existing `useParams` / `useWsClient` reads. Currently no consumer for the value — it sits as a route-local readonly so downstream replay-loading code in `replay_url_position_loading` can read it without re-parsing.
- [`apps/audience/src/state/sessionId.ts:53-65`](../../../apps/audience/src/state/sessionId.ts#L53) — the precedent pure parser. The new `parsePositionParam` mirrors the same shape: a single typed input, a single typed output, no side effects, `null` on any failure.
- [`apps/audience/src/state/useAudienceSessionId.ts`](../../../apps/audience/src/state/useAudienceSessionId.ts) — the precedent React hook (subscribes via `useSyncExternalStore` over `popstate`). The new `useAudienceLogPosition` uses React Router's `useSearchParams` instead because the query-string layer is React Router's responsibility and `useSearchParams` already provides a reactive subscription; using `useSyncExternalStore` over `popstate` would re-invent that.
- [`apps/audience/src/state/index.ts`](../../../apps/audience/src/state/index.ts) — the barrel that gains two new exports (`parsePositionParam`, `useAudienceLogPosition`).
- [`packages/shared-types/src/events.ts:796`](../../../packages/shared-types/src/events.ts#L796) — `sequence: z.number().int().nonnegative()` is the canonical event-envelope shape. The parser's accepted value-space mirrors this exactly: nonnegative integer, no fractional, no negative.
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `catch-up { sessionId, sinceSequence }` is the wire surface the **downstream** replay-loading consumer eventually drives. This leaf does NOT call it; just naming the future consumer for context.
- [`packages/shell/src/ws/client.ts`](../../../packages/shell/src/ws/client.ts) — `useWsClient().trackSession(sessionId)` is the existing call site. This leaf leaves it untouched; the position-aware wiring is downstream.
- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — the existing audience Playwright spec (six scenarios from `aud_session_url`). This leaf adds one regression-pin scenario for the `?position` URL grammar.

## Constraints / requirements

1. **The parser is pure.** `parsePositionParam(searchParams: URLSearchParams): number | null` takes its input as a parameter; no `window.location` read inside. Single source of truth for the value-space; Vitest-trivial.
2. **`null` is the universal absent / invalid sentinel.** No exceptions, no console warnings, no validation errors thrown to the route. A typo in the URL bar (`?position=abc`) silently falls back to live mode — the audience is broadcast-clean and refuses to surface URL-parsing errors to the producer / OBS scene.
3. **The accepted value-space matches `sequence`.** Nonnegative integer, no fractional component, no negative. `"0"` is valid (the genesis of the log); `"-1"` is invalid; `"3.5"` is invalid; `"9999999999999999999"` (above `MAX_SAFE_INTEGER`) is invalid.
4. **The hook re-runs on URL change.** React Router's `useSearchParams()` provides this; no additional `popstate` subscription needed.
5. **No behaviour change to live-mode subscription.** When `?position` is present, the route still calls `trackSession(sessionId)` and renders `<AudienceGraphView>` against the live store. The position is a route-local readonly waiting for the downstream consumer.
6. **No new external dependencies.** The parser is plain JavaScript over `URLSearchParams` (Web Platform API, already available in every target environment); the hook is React Router + React (already in the audience workspace).
7. **The locale-prefixed URL works identically.** `/sessions/<uuid>?position=42` and `/<locale>/sessions/<uuid>?position=42` produce the same parsed value at the hook tier.
8. **`<AudienceLiveRoute>` does NOT branch on the position value.** Branching belongs to the downstream replay-loading consumer; this leaf only reads the value into a route-local `const`. This keeps the diff trivial and avoids speculative state that would need rework when the consumer lands.

## Acceptance criteria

Per ADR 0022, every empirical claim below is a committed test.

1. **Vitest parser contract** (`apps/audience/src/state/positionParam.test.ts`). Eight failure-mode rows + the happy path:
   - `parsePositionParam(new URLSearchParams("position=42"))` → `42`
   - `parsePositionParam(new URLSearchParams("position=0"))` → `0`
   - `parsePositionParam(new URLSearchParams(""))` → `null`
   - `parsePositionParam(new URLSearchParams("position=abc"))` → `null`
   - `parsePositionParam(new URLSearchParams("position=-1"))` → `null`
   - `parsePositionParam(new URLSearchParams("position=3.5"))` → `null`
   - `parsePositionParam(new URLSearchParams("position=9999999999999999999"))` → `null` (exceeds `Number.MAX_SAFE_INTEGER`)
   - `parsePositionParam(new URLSearchParams("position="))` → `null` (empty value)
   - `parsePositionParam(new URLSearchParams("position=42&foo=bar"))` → `42` (unrelated params ignored)
2. **Vitest hook contract** (`apps/audience/src/state/useAudienceLogPosition.test.tsx`). Mounted under `MemoryRouter`:
   - Initial route `/sessions/<uuid>?position=42` — hook returns `42`.
   - Initial route `/<locale>/sessions/<uuid>?position=42` — hook returns `42` (locale prefix has no effect).
   - Initial route `/sessions/<uuid>` (no query) — hook returns `null`.
   - Initial route `/sessions/<uuid>?position=abc` (invalid) — hook returns `null`.
   - Navigating from `?position=42` to `?position=43` — hook re-renders with `43`.
3. **Vitest route smoke** (`apps/audience/src/routes/AudienceLiveRoute.test.tsx` — extending the existing file from `aud_session_url`). Adds one case: route mounted at `/sessions/<uuid>?position=42` renders `<AudienceGraphView>` and calls `trackSession(<uuid>)` exactly once (proves the position param does not regress the live-mode subscribe).
4. **Barrel export pin** — `apps/audience/src/state/index.ts` re-exports `parsePositionParam` and `useAudienceLogPosition`; a Vitest case in `apps/audience/src/state/positionParam.test.ts` (or the hook test file) imports both via the barrel and confirms the re-export path is wired.
5. **Playwright regression pin** — extend [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) with one new scenario (modeled on the existing "Live projection rendering" scenario at scenarios 1-2): navigate to `/a/sessions/<seeded-uuid>?position=42` with the existing authenticated `storageState`, seed a single `node-created` event via the `window.__aConversaWsStore` seam (the high-sequence pattern from line 47-86 of the spec), and assert:
   - The `audience-graph-root` testid is visible within the 5-second budget the other scenarios use.
   - The seeded node renders as a Cytoscape element (the same `expect.poll(() => readEventsLength(...))` predicate the existing scenarios use).
   - No console error or page-level `error` event fires during navigation.
6. **No regression in the six existing `audience-live-session.spec.ts` scenarios.** The Playwright project block `chromium-audience-skeleton` (or whichever block the spec runs under per [`playwright.config.ts`](../../../playwright.config.ts)) must continue to pass all prior scenarios alongside the new one.
7. **Lint / type-check / Vitest / Playwright / Cucumber pre-commit gate** passes per `Makefile` / `.husky/pre-commit` (the standard task-completion criterion).

## Decisions

- **R1 — Parameter name is `position`** (not `sequence`, `at`, `event`, `from`).
  - **Rationale.** The task title and the WBS entry both use "position." Human readers parse `?position=42` as "the moment in the log labelled 42" more readily than `?sequence=42` (which leans engineering-jargon) or `?at=42` (which is too generic — "at what?"). `from` collides with the existing auth flow's `?from=callback` param at `apps/root/src/routes/ScreenNameRoute.tsx`, which would create grep ambiguity. `event` collides with the per-event id (a UUID, not an integer sequence).
- **R2 — The value-space is `sequence: int, >= 0`** mirroring the canonical event-envelope shape at `packages/shared-types/src/events.ts:796`.
  - **Rationale.** The parameter names a point in the log, and "a point in the log" is exactly the `sequence` field of an event envelope. Borrowing the same value-space means the parser's accepted-input set and the wire `catch-up { sinceSequence }` payload's accepted-input set are identical — no impedance mismatch at the URL-to-wire boundary the downstream `replay_url_position_loading` consumer will cross.
  - **Alternatives rejected.** Floating-point (rejected — fractional sequences are nonsense). Negative integers (rejected — log positions are zero-anchored). Symbolic chapter names (rejected — out of scope; owned by `replay_chapter_jumping`).
- **R3 — Helper location is `apps/audience/src/state/positionParam.ts` and `apps/audience/src/state/useAudienceLogPosition.ts`** (not a new `apps/audience/src/url/` directory).
  - **Rationale.** The state directory already houses URL-driven typed-value helpers (`sessionId.ts`, `useAudienceSessionId.ts`) — the position param is the same kind of value, one query-string layer deeper. Co-location keeps the related helpers searchable in one place; the barrel at `state/index.ts` already exports the precedent helpers.
  - **Alternatives rejected.** New `url/` directory (rejected — premature for two helpers; the existing `state/` directory is the established home and `aud_state_management.md` Decision §3 is the precedent). Inside `routes/AudienceLiveRoute.tsx` (rejected — the parser must be importable without the route component for the downstream replay-loading consumer).
- **R4 — `null` is the universal absent / invalid sentinel** (no thrown exceptions, no `Result`-style `{ ok, value }` tuple, no symbolic error codes).
  - **Rationale.** Every consumer of the parser cares about exactly one distinction: "do I have a valid position to act on?" A `number | null` return type narrows that question to a single `if (position !== null)` branch. The existing `sessionIdFromPathname()` parser at `apps/audience/src/state/sessionId.ts:53` uses the same `string | null` shape — established precedent.
  - **Alternatives rejected.** `Result<number, ParseError>` tuple (rejected — over-engineered; no consumer distinguishes "missing" from "invalid" — both fall back to live mode). Throwing exceptions (rejected — would force the route to wrap every read in a `try`/`catch` and would surface URL-typo errors to the producer / OBS scene, breaking broadcast-clean).
- **R5 — Validation is strict via `Number.isInteger` + range checks**, not lenient via `parseInt` / `Number()` coercion.
  - **Rationale.** `Number("3.5")` returns `3.5` and `parseInt("3.5", 10)` returns `3` — both lossy. The parser uses `Number(value)` then `Number.isInteger(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER` as the gate, returning `null` for any failed check. This rejects the decimal-truncation footgun (a producer hand-typing `?position=3.5` should not land at position 3 — they should land in live mode and notice the URL is wrong).
  - **Alternatives rejected.** Zod schema (rejected — overkill for a single-field URL parser; the in-line predicate is three lines and zero dependencies). `parseInt` lenient parse (rejected — silently coerces `3.5` to `3` and `3abc` to `3`, both undesirable).
- **R6 — The route reads the value but does not branch on it.** `<AudienceLiveRoute>` calls `const logPosition = useAudienceLogPosition();` and does nothing else with the value in this leaf.
  - **Rationale.** Branching on the value is the **downstream** task's responsibility (`replay_url_position_loading`, 0.5d). Adding speculative branching in this leaf would either (a) be no-op dead code that the downstream task replaces (waste), or (b) lock in a behaviour choice (e.g. "call `requestCatchUp` here") that the downstream task should make with full context of the replay-mode surface design. The route-local readonly is the minimum surface area that lets the downstream consumer read the value without re-parsing.
  - **Alternatives rejected.** "Drive `catch-up` from this leaf" (rejected — overlaps `replay_url_position_loading`'s scope). "Stash in a Zustand store slot for cross-component read" (rejected — speculative state; no current cross-component consumer; can be added later if a need emerges).
- **R7 — The Playwright pin extends the existing `audience-live-session.spec.ts`** rather than landing a new spec file.
  - **Rationale.** The new scenario is a regression pin on existing live-mode behaviour (the URL grammar widened; the route must still mount), not a new test category. Co-locating with the live-mode scenarios keeps the test budget tight and lets the new case reuse the existing spec's seed helpers (`readEventsLength`, the `__aConversaWsStore` seed flavour).
  - **Alternatives rejected.** New file `audience-position-param.spec.ts` (rejected — premature; one scenario doesn't justify a new file or a new `playwright.config.ts` project block).
- **R8 — No deferred-e2e debt against this leaf.** The replay-rendering behaviour is owned by downstream tasks (`replay_url_position_loading` and `replay_mode_audience_surface`); those tasks scope their own Playwright coverage in their own refinements. This leaf's e2e pin is complete (one regression scenario for the URL grammar widening).
  - **Rationale.** The UI-stream e2e policy in `tasks/refinements/README.md` calls for deferred-e2e debt **only** when a component is not reachable. The new URL parameter IS reachable (the live route mounts at the new URL shape), and the regression pin asserts the reachable behaviour. Behaviour change for the replay case is downstream — those tasks scope their own e2e.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- Pure helper `apps/audience/src/state/positionParam.ts` — `parsePositionParam(searchParams: URLSearchParams): number | null`; accepts nonneg integers up to `MAX_SAFE_INTEGER`, returns `null` for missing/invalid/decimal/negative values.
- React hook `apps/audience/src/state/useAudienceLogPosition.ts` — wraps `useSearchParams()` and calls the parser; re-runs reactively on URL change.
- Barrel `apps/audience/src/state/index.ts` — exports `parsePositionParam` and `useAudienceLogPosition`.
- Route `apps/audience/src/routes/AudienceLiveRoute.tsx` — calls `useAudienceLogPosition()` into a route-local `const _logPosition`; no behaviour change (live-mode `trackSession` untouched, value dormant until `replay_url_position_loading`).
- Vitest `apps/audience/src/state/positionParam.test.ts` — 10 parser contract cases (happy path + 8 failure modes + barrel re-export).
- Vitest `apps/audience/src/state/useAudienceLogPosition.test.tsx` — 6 hook contract cases (locale-prefix, absent param, invalid, URL-change re-render, barrel re-export).
- Vitest `apps/audience/src/routes/AudienceLiveRoute.test.tsx` — case `(j)`: `?position=42` URL mounts + `trackSession` fires once.
- Playwright `tests/e2e/audience-live-session.spec.ts` — scenario `(8)`: `?position=42` navigation pin — graph mounts, seeded node lands, no console/page errors.
