# Refinement — `replay_test.test_mode.test_mode_load_session`

**Load a saved session's event log.**

## TaskJuggler entry

- Task: `test_mode_load_session` — [`tasks/60-replay-and-test-mode.tji:77`](../../60-replay-and-test-mode.tji).
- Parent group: `test_mode` ([`tasks/60-replay-and-test-mode.tji:70`](../../60-replay-and-test-mode.tji)).
- Grandparent stream: `replay_test` ([`tasks/60-replay-and-test-mode.tji:22`](../../60-replay-and-test-mode.tji)).

## Effort estimate

**1d** ([`tasks/60-replay-and-test-mode.tji:78`](../../60-replay-and-test-mode.tji)). One reusable data hook + one app-local route view + a route-table edit + i18n keys + three test layers. No scrubber, no projection-at-position, no graph render — this task only *loads and displays the raw log*; the scrubber, inspectors, and graph drive off the loaded log in downstream leaves.

## Inherited dependencies

`test_mode_load_session` declares two direct edges and inherits three through its ancestors.

**Direct:**

- **`!test_mode_app`** — *settled (Done 2026-06-05)*. The sibling skeleton ([`tasks/60-replay-and-test-mode.tji:80`](../../60-replay-and-test-mode.tji); refinement [`tasks/refinements/replay_test/test_mode_app.md`](test_mode_app.md)). It created the `apps/test-mode/` surface, the `/t/*` root route, the backend manifest entry, and a placeholder `App` whose single `*` wildcard route this task replaces with a real session route. The mount contract, auth gate, and i18n bridge are already in place — this task adds a route inside that surface, nothing about the mount boundary changes.
- **`backend.replay_endpoints.get_session_log`** — *settled (Done 2026-06-03)*. The paginated REST endpoint `GET /api/sessions/:id/events` ([`apps/server/src/replay/routes.ts:453`](../../../apps/server/src/replay/routes.ts); refinement [`tasks/refinements/backend/get_session_log.md`](../backend/get_session_log.md)). This task is its first UI consumer inside test-mode. Response shape `{ events: Event[], nextCursor: number | null }`, ascending `sequence` order, `after`/`limit` cursor paging, `canSeeSession` visibility gate, 404 for unknown-or-invisible, 401 unauthenticated.

**Inherited through ancestors:**

- **`backend.backend_tests.be_e2e_tests.auth_flow_integration`** — *settled (Done)*. Inherited from the `replay_test` stream (`complete 100` at [`tasks/20-backend.tji:447`](../../20-backend.tji)). The OIDC handshake the authenticated test-mode surface rides on.
- **`data_and_methodology.replay_primitive`** — *settled (Done)*. Inherited from the `test_mode` group ([`tasks/60-replay-and-test-mode.tji:71`](../../60-replay-and-test-mode.tji)). **Inherited but not consumed by this task.** Render-at-position projection is consumed by `test_mode_timeline_scrubber` and the inspectors; loading the raw log needs no projection.
- **`audience.aud_graph_rendering`** — *settled (Done)*. Inherited from the `test_mode` group. **Inherited but not consumed by this task.** The graph renderer engages once a scrubber drives a projected state into a viewport; this task displays only the textual log readout.

All inherited edges are settled; nothing this task needs is pending.

## What this task is

Make the test-mode surface able to **load and display the complete persisted event log of a saved session, addressed by session id in the URL**. Concretely:

1. **A reusable data hook** `useSessionEventLog(sessionId)` in a new `@a-conversa/shell` module `session-log/`, modeled line-for-line on the snapshot hook ([`packages/shell/src/snapshot-list/useSessionSnapshots.ts:49-109`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.ts)). It fetches `GET /api/sessions/:id/events`, **pages through `nextCursor` until `null` to assemble the full log in ascending `sequence` order**, and exposes a load-state machine: `{ status: 'loading' | 'ready' | 'not-found' | 'error', events: readonly Event[], retry: () => void }`. It reuses the wire `Event` type from [`@a-conversa/shared-types`](../../../packages/shared-types/src/events.ts) (lines 820–863) and a defensive `isEventLike()` element guard (mirroring [`useSessionEventLogPrefetch.ts:54-69`](../../../apps/moderator/src/layout/useSessionEventLogPrefetch.ts)).
2. **An app-local route view** in `apps/test-mode/src/session-log/` that consumes the hook and renders each load state observably: a loading affordance, an error + retry affordance, a `not-found` affordance ("session not found or not visible"), an empty-log affordance, and a ready readout listing every event (`sequence` · `kind` · `createdAt`) under a stable `data-testid` container with a total-count header. This readout is **deliberately inert scaffolding** — the timeline scrubber, event inspector, and graph supersede it in place downstream (Decision §4).
3. **A real route** `/sessions/:sessionId` added to [`apps/test-mode/src/App.tsx`](../../../apps/test-mode/src/App.tsx) (today only a `*` placeholder at lines 35–37), reading `:sessionId` from the router and handing it to the view.
4. **i18n keys** `testMode.loadSession.*` in all three catalogs ([`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/)) plus the `.review.json` companions; the existing `testMode.placeholder.*` keys stay (the root `/` keeps rendering the placeholder).
5. **Test layers** (per ADR 0022): Vitest hook tests, Vitest view tests, a Playwright load-session e2e (new `chromium-*` project), and a small edit to the existing skeleton smoke spec to keep it green under the new route table.

## Why it needs to be done

Every downstream test-mode leaf needs *the log in hand*. `test_mode_timeline_scrubber` ([`tji:87`](../../60-replay-and-test-mode.tji)) makes every event in the log a scrubber stop; `test_mode_event_inspector`, `test_mode_changed_highlights`, and `test_mode_diagnostic_inspector` all `depends !test_mode_timeline_scrubber`; `test_mode_synthetic_session` `depends !test_mode_load_session` directly. None of them can run without a loaded log keyed by session id. The skeleton (`test_mode_app`) gave the surface a place to mount; this task gives it its data source. Placing the fetch in `@a-conversa/shell` (not the app) means the scrubber and inspectors consume the same loaded `events` array without re-implementing paging (Decision §1).

The test-mode surface is the operator-side design-iteration / debugging tool: one authenticated person scrubs a recorded session without three live participants. Step one of that is "point it at a session and see its events."

## Inputs / context

- **Backend endpoint (the dependency)** — `GET /api/sessions/:id/events`, registered at [`apps/server/src/replay/routes.ts:453`](../../../apps/server/src/replay/routes.ts), handler at [`routes.ts:487-525`](../../../apps/server/src/replay/routes.ts). Path param `:id` (UUID; 400 on non-UUID), query `after` (integer ≥ 0, exclusive cursor, default 0) and `limit` (1–1000, default 100). Returns `200 { events: Event[], nextCursor: number | null }` with `events` ascending by `sequence`; `nextCursor` is the next `after` value or `null` at log head. `401 auth-required` unauthenticated; `404 not-found` for unknown **or** invisible session (deliberately indistinguishable, [`get_session_log.md`](../backend/get_session_log.md)); empty log is `200 { events: [], nextCursor: null }`, not 404. Read helper `readSessionEventsPage` at [`apps/server/src/events/read.ts:113-139`](../../../apps/server/src/events/read.ts).
- **Wire `Event` type** — [`packages/shared-types/src/events.ts:820-844`](../../../packages/shared-types/src/events.ts) (`EventEnvelope`: `id`, `sessionId`, `sequence`, `kind`, `actor`, `payload`, `createdAt`) and the discriminated `Event` union at [`events.ts:861-863`](../../../packages/shared-types/src/events.ts). Governed by ADR 0021 (event envelope). Already a dependency of both `@a-conversa/shell` and `@a-conversa/test-mode`.
- **Reference hook (the template)** — [`packages/shell/src/snapshot-list/useSessionSnapshots.ts:49-109`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.ts): single `fetch('/api/sessions/${sessionId}/snapshots', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } })`, `loading → ready | error` state machine, `isSnapshotRecord()` guard, `cancelled` flag + `retryNonce` re-run, effect dep `[sessionId, retryNonce]`. Types at [`snapshot-list/types.ts:12-17`](../../../packages/shell/src/snapshot-list/types.ts). The new hook follows this shape, adding the `nextCursor` paging loop and the `not-found` status.
- **Reference hook (the paging loop)** — [`apps/moderator/src/layout/useSessionEventLogPrefetch.ts`](../../../apps/moderator/src/layout/useSessionEventLogPrefetch.ts): fetch at line 96 (`/api/sessions/${sessionId}/events?after=${after}&limit=${PAGE_LIMIT}`), `PAGE_LIMIT = 100` (line 32, "matches the endpoint default"), `for (;;)` loop advancing `after = page.nextCursor` until non-numeric (lines 95–128), `isEventLike()` guard (lines 54–69), `cancelled` early-exits after each async boundary. This is the moderator's app-local prefetch; the new shell hook is the canonical reusable version (Decision §1).
- **Shell barrel pattern** — [`packages/shell/src/index.ts:140-152`](../../../packages/shell/src/index.ts) re-exports the `snapshot-list/` subsystem under an ASCII-ruled comment block from `./snapshot-list/index.js`; that sub-barrel is [`snapshot-list/index.ts:1-13`](../../../packages/shell/src/snapshot-list/index.ts). The new `session-log/` module follows this exact pattern.
- **Test-mode app surface** — [`apps/test-mode/src/App.tsx`](../../../apps/test-mode/src/App.tsx) (placeholder route `*` at lines 35–37; `data-testid="route-test-mode-placeholder"` at line 26); [`apps/test-mode/src/main.tsx:40-67`](../../../apps/test-mode/src/main.tsx) (mount bridges host `auth`/`i18n`/`routerBasePath`, `requiredAuthLevel: 'authenticated'`). The surface depends on `@a-conversa/shell`, `@a-conversa/shared-types`, `react-router-dom` already ([`apps/test-mode/package.json:12-22`](../../../apps/test-mode/package.json)) — no new runtime dependency.
- **i18n catalogs** — [`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/): `en-US.json` (source), `pt-BR.json` + `pt-BR.review.json`, `es-419.json` + `es-419.review.json`. Current `testMode` block: `{ "placeholder": { "title": …, "body": … } }`. Parity gate: `pnpm --filter @a-conversa/i18n-catalogs run check` ([`packages/i18n-catalogs/scripts/check-parity.ts`](../../../packages/i18n-catalogs/scripts/check-parity.ts) — every en-US leaf must exist in both other locales and vice-versa).
- **Existing skeleton e2e** — [`tests/e2e/test-mode-skeleton-smoke.spec.ts`](../../../tests/e2e/test-mode-skeleton-smoke.spec.ts) navigates `/t/sessions/00000000-0000-4000-8000-000000000099` (line 40) and asserts `route-test-mode-placeholder` is visible, plus an unauthenticated `/login` deflection. **This task's new `/sessions/:sessionId` route changes what that URL renders** (Constraint §7, Decision §6) — the spec must be updated. Project `chromium-test-mode-skeleton` at [`playwright.config.ts:428-438`](../../../playwright.config.ts); auth bootstrap via the `setup-auth` project at [`playwright.config.ts:206-215`](../../../playwright.config.ts).
- **e2e session creation** — no `make up` fixture seeding; each spec calls `POST /api/sessions` to mint a session id (pattern across `tests/e2e/`, e.g. `participant-invite-acceptance.spec.ts:61-72`). A freshly-created session has an **empty** persisted log; the browser-store seeding helpers ([`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts)) hydrate the *in-page WS store*, **not** the backend DB, so they do not populate `/events` (Decision §6).
- **ADRs** — 0026 (micro-frontend mount contract, already satisfied by the skeleton), 0021 (event envelope), 0006 (Vitest), 0008 (Playwright + compose), 0010 (pnpm workspaces), 0022 (no throwaway verification).

## Constraints / requirements

1. **Full log, every event.** The hook must page through `nextCursor` until `null` and concatenate all pages in ascending `sequence` order. A multi-page log (>1 page) must assemble completely — downstream scrubber granularity is per-event, so a truncated log is a correctness bug.
2. **Hook in shell, view in the app.** `useSessionEventLog` + its types + sub-barrel live in `packages/shell/src/session-log/` and are re-exported from `packages/shell/src/index.ts`. The route view lives in `apps/test-mode/src/session-log/`. (Decisions §1, §4.)
3. **Reuse the wire `Event` type.** Type events with `Event` / `EventEnvelope` from `@a-conversa/shared-types`; do not redefine an event shape. The `isEventLike()` guard validates `id`/`sequence`/`kind`/`actor`/`createdAt` defensively at the fetch boundary.
4. **Four-state load machine.** `'loading' | 'ready' | 'not-found' | 'error'`. A 404 maps to `'not-found'` (operator pasted an unknown or invisible id — a likely, distinct UX); any other non-200, network failure, or unparseable body maps to `'error'` with a working `retry`. Empty log on a visible session is `'ready'` with `events: []`. (Decision §5.)
5. **No new runtime dependencies.** Plain `fetch` + `useState` (the established convention — there is no React Query / SWR / central api-client in this codebase). No `cytoscape`/`zustand`/graph stack — those land with the scrubber.
6. **Authenticated fetch.** `credentials: 'include'`, `Accept: application/json`. The surface is already gated to authenticated operators by `SurfaceHost`; the hook does not handle login, but a stray 401 falls through to `'error'`.
7. **Keep the skeleton smoke green.** Adding `/sessions/:sessionId` means `/t/sessions/<uuid>` no longer renders the placeholder. Update [`tests/e2e/test-mode-skeleton-smoke.spec.ts`](../../../tests/e2e/test-mode-skeleton-smoke.spec.ts): point its placeholder-presence assertion at the surface root `/t/` (still renders `route-test-mode-placeholder`), and keep its unauthenticated `/login`-deflection assertion (route-independent — the auth gate fires before mount regardless of path). This is inherited wiring debt from the route-table change, paid in-task.
8. **Catalog parity stays green.** `testMode.loadSession.*` additions land in all three catalogs + the two `.review.json` companions; `pnpm --filter @a-conversa/i18n-catalogs run check` exits zero.
9. **Build + check green.** `pnpm -F @a-conversa/shell build`, `pnpm -F @a-conversa/test-mode build`, and `pnpm run check` (lint + format + typecheck) all stay green.

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **`pnpm -F @a-conversa/shell typecheck` and `pnpm -F @a-conversa/test-mode typecheck`** exit zero; `useSessionEventLog`, its return type, and the `session-log/` sub-barrel are re-exported from `packages/shell/src/index.ts` under their own ASCII-ruled block.
2. **Vitest hook tests** (`packages/shell/src/session-log/useSessionEventLog.test.tsx`), mocking `fetch`:
   - request shape — URL `/api/sessions/${id}/events?after=0&limit=100`, `method GET`, `credentials: 'include'`, `Accept: application/json`;
   - single-page `200` → `status: 'ready'`, `events` in ascending `sequence` order;
   - **multi-page paging** — first page returns `nextCursor: N`, the hook refetches with `after=N`, second page returns `nextCursor: null`, and the assembled `events` is the concatenation of both pages in order (pins Constraint §1);
   - empty log `200 { events: [], nextCursor: null }` → `status: 'ready'`, `events: []`;
   - `404` → `status: 'not-found'`;
   - non-200 (e.g. 500) and network throw → `status: 'error'`, and `retry()` re-runs the fetch to `ready`;
   - a malformed element in the page array is dropped by `isEventLike()` while well-formed siblings survive;
   - unmount mid-flight does not `setState` (cancelled flag).
3. **Vitest view tests** (`apps/test-mode/src/session-log/SessionLogRoute.test.tsx` or equivalent), mocking the hook: each of `loading` / `ready` (renders the event count header + one row per event with `sequence`·`kind`·`createdAt` under the stable `data-testid`) / empty-`ready` / `not-found` / `error`+retry renders its affordance and reads its `testMode.loadSession.*` key; ready rows are in ascending `sequence` order.
4. **`pnpm run test:smoke`** stays green; the unit/component smoke count grows by the new hook + view cases.
5. **Playwright load-session e2e** (`tests/e2e/test-mode-load-session.spec.ts`, new `chromium-test-mode-load-session` project in `playwright.config.ts`, `dependencies: ['setup-auth']`) — **e2e is in scope, not deferred** (Decision §6). Under `make up` + `pnpm run test:e2e`, authenticated via the bootstrap storage state:
   - (a) `POST /api/sessions` mints a session; navigating `/t/sessions/<that-id>` reaches the `ready` state showing the empty-log affordance (real surface → real REST fetch → real backend, the wiring proof);
   - (b) navigating `/t/sessions/<a-random-unused-uuid>` reaches the `not-found` affordance (the 404 path);
   - one spec, en-US only, no new fixture or backend mock, completes well under the suite per-spec budget. *(The rich multi-event readout and the paging loop are pinned deterministically by the Vitest hook + view tests in AC 2–3 — driving a non-empty **persisted** log in e2e would require a full moderator-gesture walkthrough, which adds flakiness for coverage the unit layer already gives; the e2e proves reachability + real-backend wiring + the two cheap end states.)*
6. **Skeleton smoke stays green** — [`tests/e2e/test-mode-skeleton-smoke.spec.ts`](../../../tests/e2e/test-mode-skeleton-smoke.spec.ts) updated per Constraint §7 (placeholder check on `/t/`, auth-deflection assertion retained) and passing under `chromium-test-mode-skeleton`.
7. **`pnpm --filter @a-conversa/i18n-catalogs run check`** green after the `testMode.loadSession.*` additions (all three catalogs + `.review.json` companions).
8. **`pnpm -F @a-conversa/shell build` + `pnpm -F @a-conversa/test-mode build` + `pnpm run check`** all green.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"`** silent after `complete 100` is added (closer step).
10. **No file modifications outside the task allowlist** (Constraint §2 files + `apps/test-mode/src/App.tsx` route + the two i18n catalog dirs + the two e2e specs + `playwright.config.ts`); no backend change (the endpoint already exists and is tested).

**No Cucumber scenario.** This task is a pure *consumer* of `GET /api/sessions/:id/events`; it changes no wire behavior, broadcast shape, or projector output. The endpoint's own protocol/replay-seam behavior is already pinned by the Cucumber + Vitest coverage that shipped with `get_session_log` (Done 2026-06-03). The new behavior here (paging assembly, load-state mapping, route rendering) is client-side and is pinned by Vitest + Playwright, the correct layering for a UI consumer.

## Decisions

### §1 — The fetch hook lives in `@a-conversa/shell`, not in the test-mode app

**Chosen:** a new reusable `useSessionEventLog(sessionId)` in `packages/shell/src/session-log/`, exported from the shell barrel, mirroring `useSessionSnapshots`. **Rejected — app-local hook in `apps/test-mode/`:** `test_mode_timeline_scrubber`, the three inspectors, and `test_mode_synthetic_session` all need the same loaded log; an app-local hook would be re-extracted into shell the moment the scrubber lands. The snapshot subsystem set the precedent — the *data substrate* (`useSessionSnapshots`) is in shell; apps compose it. **Rejected — reuse / relocate the moderator's `useSessionEventLogPrefetch`:** that hook is app-local to the moderator, carries prefetch-cache + WS-overlay semantics specific to the live operator console (its events feed a live store overlay, not a static replay readout), and moving it would touch the moderator surface and change its contract — out of scope. The two hooks have divergent enough semantics that they coexist; a possible future consolidation is a judgment call surfaced for the parking lot, not encoded here.

### §2 — Page the full log eagerly, `limit=100`, loop until `nextCursor === null`

**Chosen:** load the entire log up front in a `nextCursor` loop with `PAGE_LIMIT = 100` (matching the endpoint default and the moderator prefetch's established constant). The scrubber needs every event addressable, so the complete log must be in memory; eager full-load is the simplest correct model and matches the moderator prefetch precedent. **Rejected — lazy/windowed paging:** premature optimization with no current call site that benefits, and it would force the scrubber to deal with partial logs. **Rejected — `limit=1000`** (the endpoint max): saves round-trips on large logs but diverges from the precedent constant for no measured need; the loop handles arbitrary length either way. If large-log performance ever bites, the page size is a one-line change behind the same hook contract.

### §3 — Sessions are reached by URL id, no in-task session picker

**Chosen:** the route is `/sessions/:sessionId`; the operator arrives with an id in the URL (pasted, linked, or — later — chosen from a synthetic-session list). **Rejected — build a session-list/picker landing in this task:** that is browsing UI orthogonal to "load *a* log," and a real picker overlaps `test_mode_synthetic_session` (generate/load synthetic sessions) and any future session-index surface. The `/` root keeps the existing placeholder; this task adds exactly the one addressable route the downstream leaves need.

### §4 — The ready view is an inert textual readout, superseded in place by the scrubber

**Chosen:** render the loaded log as a plain count + ascending event list under a stable `data-testid`. **Rejected — build any scrubber/inspector/graph affordance now:** those are their own WBS leaves (`test_mode_timeline_scrubber` et al., each with its own effort and dependencies); building them here would collapse four tasks into one and front-run the `replay_primitive` projection seam this task explicitly does not consume. The readout is the minimum observable proof that the log loaded; the scrubber replaces it in `apps/test-mode/src/session-log/` when it lands. **The view is app-local, not in shell** (unlike `SnapshotList`) precisely because it is throwaway scaffolding rather than a reusable widget.

### §5 — Distinguish `404 → 'not-found'` from other failures

**Chosen:** a four-state machine adding `'not-found'` to the snapshot hook's three states. Operators navigate test-mode by typing/pasting raw session ids, so "this id doesn't exist or you can't see it" is a frequent, distinct outcome that deserves its own affordance rather than a generic "error — retry" (retrying a 404 is pointless). **Rejected — collapse 404 into `'error'`** (the snapshot hook's shape): the snapshot list is only ever rendered for a session the operator already holds, so it never needed the distinction; test-mode's by-URL entry does. The backend deliberately returns the same 404 for unknown and invisible sessions, so the affordance copy says "not found or not visible" without claiming which.

### §6 — E2e is in scope (real-backend reachability + two end states), rich readout pinned by Vitest

**Chosen:** a Playwright spec that creates a real session, loads it (`ready`/empty), and hits a 404 (`not-found`), proving the `/sessions/:id` route fetches the real backend through the mounted surface. Per the UI-stream e2e policy the surface *is reachable* the moment this route lands, so deferral does not apply. **The multi-event readout and paging loop are pinned by the Vitest hook + view tests, not e2e**, because the browser-store seed helpers populate the in-page WS store rather than the persisted log, so a non-empty `/events` response in e2e would require driving a full moderator-gesture walkthrough — flaky setup for behavior the unit layer covers deterministically. This is a coverage-placement call, not a deferral: every behavior the task adds is tested; the rich case simply lives in the layer that can assert it cheaply and reliably. **Snapshot-list e2e debt does not land here** — per [`test_mode_app.md`](test_mode_app.md) §4 that debt is aimed at `test_mode_timeline_scrubber` (the first surface that *mounts the snapshot list*); this task mounts no snapshot list. **Updating the skeleton smoke spec is in-task** (Constraint §7) because this task is what changes the route table out from under it.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `packages/shell/src/session-log/useSessionEventLog.ts` — new reusable paging hook (4-state machine: `loading | ready | not-found | error`); pages `GET /api/sessions/:id/events` with `nextCursor` loop until `null`, assembling full ascending log; `isEventLike()` guard drops malformed elements; cancelled-flag prevents post-unmount `setState`.
- `packages/shell/src/session-log/index.ts` — sub-barrel re-exporting hook and types.
- `packages/shell/src/session-log/useSessionEventLog.test.tsx` — 8 Vitest cases: request shape, single-page, multi-page paging, empty log, 404→not-found, error+retry, network-throw+retry, malformed-drop, unmount-cancel.
- `apps/test-mode/src/session-log/SessionLogRoute.tsx` — app-local route view consuming the hook; renders loading / error+retry / not-found / empty-ready / ready (event count header + ascending sequence·kind·createdAt rows under `data-testid="test-mode-session-log"`).
- `apps/test-mode/src/session-log/SessionLogRoute.test.tsx` — 5 Vitest view cases covering each load state.
- `apps/test-mode/src/App.tsx` — real `/sessions/:sessionId` route added; passes `:sessionId` to `SessionLogRoute`.
- `apps/test-mode/src/mount.test.tsx` — mount test updated to push `/t/` (root) instead of a session URL so it still hits the placeholder wildcard.
- `packages/shell/src/index.ts` — `session-log/` export block added under ASCII-ruled comment.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` + `{pt-BR,es-419}.review.json` — `testMode.loadSession.*` keys added; catalog parity check stays green.
- `tests/e2e/test-mode-load-session.spec.ts` — Playwright spec (`chromium-test-mode-load-session`): asserts real-wiring readout with `session-created` and `participant-joined` rows; 404 path hits not-found affordance.
- `playwright.config.ts` — new `chromium-test-mode-load-session` project with `dependencies: ['setup-auth']`.
- `tests/e2e/test-mode-skeleton-smoke.spec.ts` — placeholder-presence assertion updated to `/t/` per Constraint §7; unauthenticated deflection assertion retained.
