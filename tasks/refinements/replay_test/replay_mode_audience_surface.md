# Replay-mode variant of the audience surface

**TaskJuggler entry**: [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) — task `replay_test.replay_ui.replay_mode_audience_surface` (lines 33–42).

**Effort estimate**: 2d. The renderer reuse is nearly free (the shared `@a-conversa/graph-view` `GraphView` is already props-in and already mounted from a replayed log by test-mode); the budget goes to the new replay routes, the load-state UI, the `audience.replay.*` i18n keys, and the Vitest + Playwright pins. This sits at the upper edge of 2d only because it is the *foundational* leaf of the replay-UI stream — every later replay leaf hangs off it.

## Inherited dependencies

Direct (`.tji` line 36):

- **`frontend_i18n.i18n_catalog_workflow`** — **settled.** The catalog workflow (`packages/i18n-catalogs/`) is shipped: `SUPPORTED_LOCALES = ['en-US', 'pt-BR', 'es-419']`, `negotiateUrlLocale(pathname)` for unauthenticated/URL-prefix locale, `createI18nInstance`, the `.review.json` companion convention, and the parity gate `pnpm --filter @a-conversa/i18n-catalogs run check`. This task adds keys under `audience.replay.*` and consumes the existing URL-locale negotiation the audience `App` already performs.

Inherited from the parent `replay_ui` block (`.tji` line 32) and the grandparent `replay_test` block (`.tji` line 30):

- **`data_and_methodology.replay_primitive`** — **settled.** Client-side prefix-replay: a full event log + a position yields a projection. The client port of the position-navigation contract lives in `packages/shell/src/replay-position/replay-position.ts` (`nextPosition`, `prevPosition`, `isAtStart`, `isAtEnd`, `replayHeadSequence`, `clampPosition`). This task renders at the log **head** and so only needs `replayHeadSequence` (or, equivalently, the full log) — the navigation helpers are for the downstream playback leaves.
- **`audience.aud_graph_rendering`** — **settled.** The read-only Cytoscape renderer, its projector, layout, stylesheet, and overlays were extracted to `@a-conversa/graph-view` ([ADR 0039](../../../docs/adr/0039-shared-read-only-graph-view-package.md)). The package component takes `{ events, instanceKey, activeDiagnostics?, cyRef? }` as plain props.
- **`audience.aud_animations`** — **settled.** Animation behavior lives inside the package renderer; replay inherits it by mounting the same component. No replay-specific animation work.
- **`backend.backend_tests.be_e2e_tests.auth_flow_integration`** — **settled.** The OIDC handshake e2e safety net; relevant because the replay surface's authenticated viewer path and its sign-in CTA exercise the same auth surface.

## What this task is

Ship the **replay-mode variant of the audience surface**: the same read-only graph renderer the live audience uses, but fed from a saved session's event **log** instead of the live WebSocket stream, mounted in the public audience bundle at `/{locale}/replay/{id}` (i.e. `/a/{locale}/replay/{id}` globally, and the locale-less `/a/replay/{id}`). Concretely:

- Two new routes in `apps/audience/src/App.tsx` — `/replay/:sessionId` and `/:locale/replay/:sessionId` — inserted **above** the `*` wildcard (the placeholder route's comment at `App.tsx:177` already anticipates "future `/a/replay/...`").
- A new `AudienceReplayRoute` (`apps/audience/src/routes/AudienceReplayRoute.tsx`) that loads the full log via the shipped `useSessionEventLog(sessionId)` hook and renders the reconstructed graph **at the log head** by mounting the shared `@a-conversa/graph-view` `GraphView` directly — the exact pattern test-mode uses at `apps/test-mode/src/scrubber/TimelineScrubber.tsx:99` (`<GraphView events={prefix} instanceKey={sessionId} />`).
- Load-state handling: `loading` → neutral affordance; `ready` → the graph; `not-found` / `error` for an **unauthenticated** (or not-visible) viewer → the existing `PrivateSessionCta` sign-in affordance reused verbatim; `error` for an authenticated viewer → a generic "unavailable" message.
- `audience.replay.*` i18n keys in all three catalogs plus `.review.json` companions.

Explicitly **out of scope** (owned by downstream leaves, all depending transitively on this one): play/pause/step (`replay_playback_controls`), speed (`replay_speed_controls`), the seek bar (`replay_seek_bar`), `?position` deep-linking (`replay_url_position_loading`), chapter-jump (`replay_chapter_jumping`). This task renders the terminal (head) state with no position UI; the scrubber/lifted-position machinery arrives with playback controls.

## Why it needs to be done

- It is the **root of the replay-UI stream**: `replay_playback_controls` depends `!replay_mode_audience_surface` (`.tji` line 46), and the seek/speed/url-position/chapter leaves chain off that. Nothing in replay-UI renders until this surface exists.
- It is the public, shareable counterpart to the live audience broadcast — "watch the debate again" at a `/{locale}/replay/{id}` link, mirroring the live `/{locale}/sessions/{id}` shape.
- It proves the ADR 0039 props-in inversion a second time on a real route: the renderer is genuinely data-source-agnostic — live WS for `AudienceLiveRoute`, replayed log here.

## Inputs / context

Routing + locale (audience `App`):

- `apps/audience/src/App.tsx:138–185` — the `App` router. Locale is negotiated **once, route-agnostically** at `App.tsx:149–165`: it strips the `/a` basename off `window.location.pathname`, calls `negotiateUrlLocale(...)`, and `i18n.changeLanguage(locale)` in an effect. This already covers any path, so `/a/{locale}/replay/{id}` gets URL-locale **for free** — the replay routes need no locale code of their own. The existing session routes (`App.tsx:180–181`) are the exact shape to mirror; the wildcard placeholder is `App.tsx:182`.

Renderer + the data-source seam:

- `apps/audience/src/graph/GraphView.tsx:46–57` — `AudienceGraphView`, the **live** adapter. It calls `useAudienceSession()` (live WS store) and `useAudienceActiveDiagnostics(sessionId)`, then passes them into the package `GraphView`. Per its own header comment (lines 1–25) and ADR 0039, this adapter *is* "the single audience-specific coupling — the WS/session data source." The replay route does **not** reuse this adapter; it mounts the package `GraphView` with a replay-sourced `events` prop instead.
- `apps/test-mode/src/scrubber/TimelineScrubber.tsx:65–99` — the proven precedent: it computes a `prefix` of the loaded log and mounts `<GraphView events={prefix} instanceKey={sessionId} />` from `@a-conversa/graph-view`. The replay route does the same with the full log (head) instead of a position-filtered prefix.

Log loading (shell, shipped):

- `packages/shell/src/session-log/useSessionEventLog.ts` — pages `GET /api/sessions/:id/events` (cursor pagination, `?after`/`?limit`, default page 100) until `nextCursor === null`, assembling the full ascending-sequence log. Returns `{ status: 'loading' | 'ready' | 'not-found' | 'error', events, retry }`. HTTP 404 → `not-found`; any other non-200 (including the current 401 for anonymous) → `error`; network throw → `error`.
- `packages/shell/src/replay-position/replay-position.ts` — `replayHeadSequence(events)` gives the head; for the head render, passing the full `events` array is equivalent (`events.filter(e => e.sequence <= head)` === `events`).

Backend endpoint (the visibility seam):

- `apps/server/src/replay/routes.ts` — `GET /sessions/:id/events`, **authenticated-only** (`preHandler: app.authenticate` → 401 anonymous), visibility-gated by `canSeeSession` (`public OR host OR participant incl. historical`). Refinement: [`tasks/refinements/backend/get_session_log.md`](../backend/get_session_log.md). Status codes: 200 visible / 400 bad param / 401 unauthenticated / 404 absent-or-invisible.
- `apps/server/src/sessions/visibility.ts` — `canSeeSession` (authenticated full rule) and `canSeeSessionAnonymously` (`privacy = 'public' AND ended_at IS NULL`, live-only). Neither matches anonymous replay of an *ended* public session — see Decisions §6 and [ADR 0045](../../../docs/adr/0045-audience-replay-surface-visibility-gating.md).

Sign-in CTA (live route precedent):

- `apps/audience/src/routes/AudienceLiveRoute.tsx:96–101` — renders `<AudienceGraphView />` and, on a `not-found` subscribe rejection, overlays `<PrivateSessionCta />`.
- `apps/audience/src/routes/PrivateSessionCta.tsx` — the overlay; renders only when auth status is `unauthenticated` / `needs-screen-name` (hidden for `authenticated` / `loading`), with a title/body (`audience.privateSession.*`) and a `<LoginButton>`. Reused verbatim by the replay route.

i18n:

- `packages/i18n-catalogs/src/catalogs/en-US.json:1039` — the existing `"audience"` key block; the new keys nest as `audience.replay.*`. `negotiateUrlLocale` is the unauthenticated URL-prefix negotiator already wired into the audience `App`.

ADRs: [0039](../../../docs/adr/0039-shared-read-only-graph-view-package.md) (shared renderer — the boundary this route mounts on), [0026](../../../docs/adr/0026-micro-frontend-root-app.md) (the audience is a `requiredAuthLevel: 'public'` micro-frontend; replay is routes inside it, not a new bundle), [0029](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) (anonymous public-session viewing; it deferred anonymous replay — now resolved by 0045), [0045](../../../docs/adr/0045-audience-replay-surface-visibility-gating.md) (this surface's auth posture + the anonymous follow-up), [0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) (react-i18next), [0040](../../../docs/adr/0040-automated-accessibility-checks-axe-playwright.md) (axe-playwright), [0022](../../../docs/adr/0022-no-throwaway-verifications.md) (committed test pins).

## Constraints / requirements

- **Routes.** Add `/replay/:sessionId` and `/:locale/replay/:sessionId` to `apps/audience/src/App.tsx`, above the `*` wildcard, mirroring the two existing session routes. Both mount `AudienceReplayRoute`. Non-replay paths must keep their current behavior (session routes, placeholder fallback) — the wildcard stays last.
- **No new locale code.** The `App`-level `negotiateUrlLocale` effect already negotiates locale from `window.location.pathname` for any path; the replay routes inherit it. Do **not** add a parallel locale read inside the route.
- **Renderer reuse.** Mount `@a-conversa/graph-view`'s `GraphView` directly with `events` from the replay log and `instanceKey={sessionId}`. Do **not** mount `AudienceGraphView` (it is WS-bound) and do **not** add a replay branch inside `AudienceGraphView` or `useAudienceSession()` — the live broadcast path stays untouched (Decision §1).
- **Data source.** Load the log via `useSessionEventLog(sessionId)` from `@a-conversa/shell`. Do not reinvent paging. Render at the head (pass the full assembled log).
- **Position is out of scope.** No scrubber, no lifted position state, no `?position` branch. Render the terminal state (Decision §3). The dormant `useAudienceLogPosition()` and the navigation helpers belong to downstream leaves.
- **Load states.** `loading` → a neutral, `data-testid`'d affordance; `ready` → the graph mounted in a viewport-filling container (reuse the live route's `h-screen w-screen` sizing rationale, `AudienceLiveRoute.tsx:87–97`); `not-found` / `error` for an unauthenticated or not-visible viewer → `<PrivateSessionCta />`; `error` for an authenticated viewer → a localized "unavailable" message with the hook's `retry`.
- **Auth posture (per ADR 0045).** v1 is visibility-gated through the authenticated endpoint: authenticated + visible → graph; anonymous (or not-visible) → sign-in CTA. Anonymous *public-session* replay without sign-in is the named follow-up `backend.replay_endpoints.anonymous_public_session_log` (see Acceptance + Decisions §6). The privacy boundary stays server-side; the UI never decides visibility.
- **i18n.** New keys under `audience.replay.*` (loading label, unavailable message, retry, any CTA-adjacent copy) in `en-US.json`, `pt-BR.json`, `es-419.json`, with `.review.json` companions for the non-English catalogs. Components read via `useTranslation()`.
- **No backend change in this task.** This task is a UI consumer of the existing-shape endpoint (the `test_mode_load_session` precedent: Vitest + Playwright, no Cucumber). The protocol-seam relaxation rides the named backend follow-up.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed regression pin, not a throwaway verification.

1. **Build + typecheck green** — `pnpm --filter @a-conversa/audience run build` and `pnpm run check` succeed.
2. **Vitest — load-state matrix** (`apps/audience/src/routes/AudienceReplayRoute.test.tsx`, mocking `useSessionEventLog`): `ready` → the package `GraphView` mounts and the graph root (`data-testid="audience-graph-root"`) is present with the log's nodes; `loading` → the loading affordance; `not-found` + unauthenticated → `PrivateSessionCta` renders; `error` + authenticated → the unavailable message + a working `retry`. Assert the route renders **at head** (full log passed to `GraphView`).
3. **Vitest — routing** (extend `apps/audience/src/App.test.tsx` or a sibling): `/replay/<uuid>` and `/<locale>/replay/<uuid>` mount `AudienceReplayRoute`; non-replay paths still resolve to the session routes / placeholder; the wildcard remains the fallback.
4. **Playwright — reachable behaviors** (`chromium-audience-replay` project; the route is reachable today, so e2e is **in scope**, not deferred):
   - **Authenticated viewer → graph renders.** With a seeded session log and an authenticated session (reuse the test-mode auth + session-log fixture harness, e.g. the `setup-auth` dependency and the synthetic-session seed that `test_mode_load_session` / `test_mode_synthetic_session` established), navigate `/a/replay/<id>` → assert the graph root mounts with nodes.
   - **Anonymous viewer → sign-in CTA.** Navigate `/a/replay/<id>` with no session cookie → the endpoint 401s, the surface renders `PrivateSessionCta` (sign-in affordance). No auth setup needed.
   - **Locale prefix applied.** Navigate `/a/pt-BR/replay/<id>` → assert a `pt-BR`-localized string renders (e.g. the loading/unavailable label), proving URL-locale flows through the replay route.
5. **Deferred e2e (named, registered).** The **anonymous public-session replays without sign-in** behavior is **not reachable** until the events endpoint accepts anonymous public reads. Its Playwright coverage is deferred to **`backend.replay_endpoints.anonymous_public_session_log`** (closer registers in WBS; see below) — that leaf relaxes the endpoint, making the behavior reachable, and its refinement scopes the anonymous-public replay spec. This is the **only** refinement deferring e2e to that leaf (debt count = 1; no catch-all pile-up). Component-level Vitest (criterion 2) and the two reachable Playwright behaviors (criterion 4) cover the surface in the meantime.
6. **i18n parity green** — `pnpm --filter @a-conversa/i18n-catalogs run check` passes with the new `audience.replay.*` keys present in all three catalogs and `.review.json` companions added for `pt-BR` / `es-419`.
7. **Accessibility** — the existing axe-playwright pass ([ADR 0040](../../../docs/adr/0040-automated-accessibility-checks-axe-playwright.md)) over the audience surface stays clean for the new route (no new violations on the graph or CTA states).
8. **`make test` green end-to-end**, and `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the closer adds `complete 100`.
9. The exact before/after Vitest and Playwright totals are recorded in the `## Status` block on completion (per the [README ritual](../README.md#task-completion-ritual)); this refinement does not hard-code baselines that drift between authoring and implementation.

### Named follow-up (closer registers in WBS)

- **`backend.replay_endpoints.anonymous_public_session_log`** — "Anonymous read of a public session's event log (replay surface)." Effort ~1d, backend, in the **same milestone as the other `backend.replay_endpoints` leaves** (the family already shipping `get_session_log` / `get_at_position` / `list_snapshots` / `get_snapshot` in `tasks/20-backend.tji:385–403`). Relaxes `GET /sessions/:id/events` to **two auth postures** (anonymous → new `canReplaySessionAnonymously` predicate `privacy = 'public'`, ended-agnostic; authenticated → unchanged `canSeeSession`), preserving the existence-non-leak rule and the same-origin/no-ticket posture, constrained by [ADR 0045](../../../docs/adr/0045-audience-replay-surface-visibility-gating.md). It crosses the HTTP/replay protocol seam, so it scopes the **Cucumber** scenarios (anonymous + public-ended → 200; anonymous + public-live → 200; anonymous + private → 404; authenticated paths unchanged) **and** the deferred anonymous-public-replay Playwright spec from criterion 5. Suggested dependency: `depends data_and_methodology` visibility seam is already settled; no new upstream needed.

## Decisions

- **§1 — Mount the shared `@a-conversa/graph-view` renderer directly; do not reuse or branch the live `AudienceGraphView` adapter.** Per ADR 0039 the *renderer* is the package; `AudienceGraphView` is explicitly "the single audience-specific coupling — the WS/session data source" (`apps/audience/src/graph/GraphView.tsx:1–25`). "Same renderer as live audience" (the `.tji` note) therefore means the package component, fed a replay-sourced `events` prop — exactly what test-mode already does (`TimelineScrubber.tsx:99`). *Alternatives:* (a) make `useAudienceSession()` / `AudienceGraphView` mode-aware so the live adapter transparently sources WS-or-replay — rejected: it couples the broadcast-clean live path to replay concerns and adds a branch to a hot, well-tested surface for no reuse gain (the package component is already the reuse point); (b) fork a replay-specific renderer — rejected: ADR 0039 exists precisely to avoid a second renderer.

- **§2 — Reuse `useSessionEventLog` from `@a-conversa/shell` as the replay data source.** It is the shipped, tested log loader test-mode already consumes; it pages to a full ascending log and exposes the `loading | ready | not-found | error` union the load-state UI needs. *Alternative:* a bespoke audience-side fetch/paging loop — rejected: duplicates a shipped seam and diverges the two replay consumers.

- **§3 — Render at the log head (complete session); position/playback are downstream.** The surface task delivers a single, informative frame; scrubbing/playback are separate `.tji` leaves chained off this one. *Alternative:* render at position 0 (empty graph) — rejected (also in ADR 0045): an empty graph is a confusing default for a surface with no scrubber yet; the head shows the whole session.

- **§4 — Routes live inside the existing public audience app, above the wildcard.** The audience app is already `requiredAuthLevel: 'public'` with URL-locale negotiation and an axe/Playwright harness; replay reuses all of it. The placeholder comment at `App.tsx:177` already reserved `/a/replay/...`. *Alternative:* a separate replay micro-frontend (the way test-mode got its own `/t` bundle) — rejected: test-mode is a distinct authenticated operator surface; replay is, by the task's own framing, a *variant of the audience surface* (same renderer, same public posture, same locale convention) and belongs in the same bundle. No new backend static-frontend registration is needed (unlike `test_mode_app`).

- **§5 — Reuse `PrivateSessionCta` for the unauthenticated / not-visible state.** It already encodes the right behavior (renders only for `unauthenticated` / `needs-screen-name`, hidden when `authenticated` / `loading`) and the sign-in copy. *Alternative:* a replay-specific CTA — rejected: identical intent to the live route; reuse keeps one source of truth for the sign-in wall.

- **§6 — v1 is visibility-gated via the authenticated endpoint; anonymous public-session replay is a named backend follow-up (ADR 0045).** The events endpoint is authenticated-only by design; the live anonymous predicate (`canSeeSessionAnonymously`) excludes *ended* sessions, which are replay's primary target. Rather than fold a protocol-seam backend change into this frontend variant, the anonymous-public path is scoped as `backend.replay_endpoints.anonymous_public_session_log` with a new `canReplaySessionAnonymously` predicate (`privacy = 'public'`, ended-agnostic) and its own Cucumber pin. *Alternatives:* (a) fold the backend relaxation into this task — rejected as default scope: it inflates a 2d frontend task with a Cucumber-pinned protocol change and couples two review surfaces; the split keeps each clean and gives the backend change a home in the family where its siblings live; (b) authenticated-only replay — rejected: contradicts the public, URL-locale framing and forecloses the shareable public-replay link. Full rationale and the rejected single-vs-parallel-endpoint sub-choice are in ADR 0045.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Shipped `apps/audience/src/routes/AudienceReplayRoute.tsx` — loads log via `useSessionEventLog`, mounts `@a-conversa/graph-view` `GraphView` at head; loading/ready/not-found/error states with `PrivateSessionCta` reuse.
- Added `/replay/:sessionId` and `/:locale/replay/:sessionId` routes to `apps/audience/src/App.tsx` above the wildcard.
- Vitest: `apps/audience/src/routes/AudienceReplayRoute.test.tsx` (load-state matrix) and `apps/audience/src/App.test.tsx` (routing table).
- Playwright: new `chromium-audience-replay` project in `playwright.config.ts`; `tests/e2e/audience-replay.spec.ts` covers authenticated→graph renders, anon→CTA, and `/a/pt-BR/replay/<id>`→pt-BR string.
- `audience.replay.*` i18n keys added to `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; `.review.json` companions for `pt-BR` and `es-419`.
- ADR 0045 (`docs/adr/0045-audience-replay-surface-visibility-gating.md`) updated/finalized.
- Follow-up registered in WBS: `backend.replay_endpoints.anonymous_public_session_log` — anonymous read of a public session's event log (the deferred anonymous-public-replay path per ADR 0045 criterion 5).
