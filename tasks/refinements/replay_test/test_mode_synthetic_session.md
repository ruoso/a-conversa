# Refinement — `replay_test.test_mode.test_mode_synthetic_session`

**Generate / load synthetic sessions for design iteration.**

## TaskJuggler entry

- Task: `test_mode_synthetic_session` — [`tasks/60-replay-and-test-mode.tji:83`](../../60-replay-and-test-mode.tji).
- Parent group: `test_mode` ([`tasks/60-replay-and-test-mode.tji:70`](../../60-replay-and-test-mode.tji)).
- Grandparent stream: `replay_test` ([`tasks/60-replay-and-test-mode.tji:22`](../../60-replay-and-test-mode.tji)).

## Effort estimate

**2d** ([`tasks/60-replay-and-test-mode.tji:84`](../../60-replay-and-test-mode.tji)). One server-side scenario-builder module + two thin gated routes + a route-registration guard + an app-local gallery view (superseding the root placeholder) + i18n keys + four test layers (Vitest builders, Vitest view, Cucumber wire seam, Playwright flow) + one ADR. No scrubber, no projection-at-position, no graph render — this task only *mints a persisted synthetic session and hands the operator off to the existing load route*; the scrubber and inspectors drive off the loaded log in downstream leaves.

## Inherited dependencies

`test_mode_synthetic_session` declares one direct edge and inherits the rest through its ancestors.

**Direct:**

- **`!test_mode_load_session`** — *settled (Done 2026-06-05)*. The session-load route ([`tasks/60-replay-and-test-mode.tji:86`](../../60-replay-and-test-mode.tji); refinement [`tasks/refinements/replay_test/test_mode_load_session.md`](test_mode_load_session.md)). It added the `/sessions/:sessionId` route inside the test-mode surface, the reusable `useSessionEventLog` paging hook in `@a-conversa/shell`, and the inert textual readout. **This task generates a session and navigates to that route** — it is the producer; load-session is the consumer it hands off to. It also relies on the surface scaffolding load-session inherited from `test_mode_app` (Done 2026-06-05): the `apps/test-mode/` bundle, the `/t/*` mount, the authenticated `SurfaceHost` gate, and the i18n bridge.

**Inherited through ancestors:**

- **`data_and_methodology.replay_primitive`** — *settled (Done)*. Inherited from the `test_mode` group ([`tasks/60-replay-and-test-mode.tji:71`](../../60-replay-and-test-mode.tji)). **Inherited but not consumed by this task.** Render-at-position projection is consumed by `test_mode_timeline_scrubber` and the inspectors; this task produces a persisted log and displays it through the existing inert readout — no projection.
- **`audience.aud_graph_rendering`** — *settled (Done)*. Inherited from the `test_mode` group. **Inherited but not consumed by this task.** The graph renderer engages once a scrubber drives a projected state into a viewport.
- **`backend.backend_tests.be_e2e_tests.auth_flow_integration`** — *settled (Done)*. Inherited from the `replay_test` stream (`complete 100` at [`tasks/20-backend.tji:447`](../../20-backend.tji)). The OIDC handshake the authenticated test-mode surface and the gated generator endpoint ride on.

All inherited edges are settled; nothing this task needs is pending.

## What this task is

Give the operator a **self-service way to conjure a synthetic session for design iteration** — without three live participants and without the role choreography the public write path enforces. Concretely:

1. **A non-production-gated backend seam** (new ADR 0041): a test-mode plugin `apps/server/src/test-mode/` registered in `createServer()` **only when `NODE_ENV !== 'production'`**, exposing:
   - `GET /api/test-mode/synthetic-scenarios` — lists the available scenario descriptors (`{ key, title, description }`), so the UI is data-driven.
   - `POST /api/test-mode/synthetic-sessions` — body `{ scenario: string }`; allocates a **fresh** session id + fresh entity ids, owns the session by the calling operator (`host_user_id = authUser.id`), runs the named scenario builder, validates + appends every event in one transaction, and returns `201 { sessionId }`.
2. **Server-side scenario builders** — pure functions `(sessionId, hostUserId, idFactory) -> Event[]` keyed by string, in a `synthetic/scenarios` module. Ship **two** to start: `empty` (the `session-created` + three `participant-joined` shape, mirroring the `empty` test-fixture) and one small **structured** scenario (a handful of `node-created` / `entity-included` / `proposal` / `vote` / `commit` events) so the scrubber has variety to exercise downstream. Builders produce only fresh-id, session-scoped events; synthetic debater users are inserted `ON CONFLICT DO NOTHING` (Decision §3).
3. **An app-local gallery view** in `apps/test-mode/src/synthetic/` that becomes the test-mode **root `/`** (superseding the placeholder, Decision §5): it fetches the scenario list, renders one "generate" affordance per scenario under a stable `data-testid`, and on click POSTs to the generator and **navigates to `/sessions/:newId`** (the existing load route). It renders observable loading / error+retry states for both the list fetch and the generate action.
4. **i18n keys** `testMode.synthetic.*` in all three catalogs ([`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/)) plus the `.review.json` companions. The `testMode.placeholder.*` keys may stay or be retired (the root now renders the gallery, not the placeholder — see Constraint §6).
5. **Test layers** (per ADR 0022): Vitest builder tests (validity + freshness + determinism), Vitest gallery-view tests, a Cucumber scenario pinning the wire seam (list shape + generate persists + auth) plus a unit test for the env-gate, and a Playwright generate→load e2e (new `chromium-*` project).

## Why it needs to be done

`test_mode_load_session` can display a persisted log, but the only way to *get* a non-trivial persisted log today is the live three-participant flow — the exact friction test mode removes. Design iteration (tuning the scrubber, the inspectors, the graph layout, the diagnostics) needs sessions to look at on demand. This task is the generator that feeds the rest of the `test_mode_*` stream: `test_mode_timeline_scrubber` ([`tji:88`](../../60-replay-and-test-mode.tji)) and the inspectors all drive off a loaded log keyed by session id, and a synthetic session is just a real persisted session minted without the live flow.

Crucially, because synthetic generation **persists real events through the production write path**, the generated session flows through the *same* `GET /api/sessions/:id/events` read path as a live one — so everything downstream consumes one data source, with no second in-memory code path (Decision §2). It also pays down a coverage gap load-session deferred: load-session's e2e could only show an *empty* persisted log (browser-store seed helpers hydrate the in-page WS store, not the DB), so it pinned the rich readout at the Vitest layer; **this task's e2e drives a genuinely non-empty persisted log through that same readout** (Decision §6).

## Inputs / context

- **Producer hand-off target (the dependency)** — the `/sessions/:sessionId` route in [`apps/test-mode/src/App.tsx`](../../../apps/test-mode/src/App.tsx) (route at line ~37, placeholder wildcard `*` at line ~38, placeholder `data-testid="route-test-mode-placeholder"` at line ~27) and the reusable hook [`packages/shell/src/session-log/useSessionEventLog.ts`](../../../packages/shell/src/session-log/useSessionEventLog.ts). This task adds the gallery at `/` and navigates to `/sessions/:newId` after generation; it does **not** touch the load readout.
- **Session creation precedent** — `POST /api/sessions` at [`apps/server/src/sessions/routes.ts:1246`](../../../apps/server/src/sessions/routes.ts): `preHandler: app.authenticate`, body `{ topic, privacy? }`, opens `withTransaction(ensurePool(), …)`, INSERTs the `sessions` row, builds + `validateEvent`s + appends a `session-created` event at `sequence 1` and a moderator `participant-joined` at `sequence 2`, COMMITs, returns `201` camelCase. `host_user_id` is the authenticated caller (`authUser.id`). The generator mirrors this transaction shape but appends a full scenario log instead of just the two bootstrap events.
- **Event-append helper** — `appendSessionEvent(client, event)` at [`apps/server/src/events/append.ts:88`](../../../apps/server/src/events/append.ts): runs the `INSERT INTO session_events (...)` inside the caller's transaction; **caller must `validateEvent` first** (schema-on-write) and **caller allocates the per-session `sequence`** (`MAX(sequence)+1`); the helper does **not** broadcast. The generator allocates sequences from `1` upward over its built event list.
- **Event validator + kinds** — `validateEvent(raw)` at [`apps/server/src/events`/…](../../../packages/shared-types/src/events.ts) (two-stage envelope + per-kind payload parse), and the `eventKinds` union at [`packages/shared-types/src/events.ts:132`](../../../packages/shared-types/src/events.ts) (`session-created`, `participant-joined`, `node-created`, `edge-created`, `annotation-created`, `entity-included`, `proposal`, `vote`, `commit`, `meta-disagreement-marked`, `snapshot-created`, `entity-removed`, `session-mode-changed`, `withdraw-agreement`, `proposal-withdrawn`). Governed by ADR 0021. Builders emit only validated `Event` envelopes — no ad-hoc shapes.
- **Destructive fixture loader (the rejected reuse)** — `loadFixture(name, client, { appendEvent })` at [`packages/test-fixtures/src/loader.ts:124`](../../../packages/test-fixtures/src/loader.ts) and `listFixtures()` at [`loader.ts:116`](../../../packages/test-fixtures/src/loader.ts). It issues `TRUNCATE TABLE ... CASCADE RESTART IDENTITY` then replays fixed-id events — a **test-harness primitive**, unsafe at runtime (Decision §1, ADR 0041). `@a-conversa/test-fixtures` is a **devDependency** of the server ([`apps/server/package.json`](../../../apps/server/package.json)), exercised by [`apps/server/src/events/fixture-append-mode.test.ts`](../../../apps/server/src/events/fixture-append-mode.test.ts) and Cucumber steps. The rich `walkthrough` fixture ([`packages/test-fixtures/src/fixtures/walkthrough/`](../../../packages/test-fixtures/src/fixtures/walkthrough/)) is reuse fodder for a follow-up (Decision §4), not this task.
- **Route registration + env gating** — routes are registered in `createServer()` in [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (route block ~370–720); CORS already branches on `NODE_ENV !== 'production'` at [`server.ts:320`](../../../apps/server/src/server.ts), and OIDC routes register conditionally on config presence. The synthetic plugin registers behind the same `NODE_ENV !== 'production'` guard (Decision §1).
- **Test-mode app surface** — [`apps/test-mode/src/main.tsx`](../../../apps/test-mode/src/main.tsx) mounts `<I18nProvider> → <AuthValueProvider> → <BrowserRouter basename={routerBasePath}> → <App/>`, `requiredAuthLevel: 'authenticated'`; **no `<WsClientProvider>`** (test mode is not a WS surface). Depends on `@a-conversa/shell`, `@a-conversa/shared-types`, `react-router-dom` already — no new runtime dependency.
- **Data-fetch convention** — plain `fetch` + `useState` with `credentials: 'include'`, `Accept: application/json`; the four-state machine and `cancelled`-flag pattern of [`packages/shell/src/session-log/useSessionEventLog.ts`](../../../packages/shell/src/session-log/useSessionEventLog.ts) and [`packages/shell/src/snapshot-list/useSessionSnapshots.ts:49`](../../../packages/shell/src/snapshot-list/useSessionSnapshots.ts). No React Query / SWR / central api-client exists.
- **Cucumber backend pattern** — feature files under [`tests/behavior/backend/`](../../../tests/behavior/backend/) (e.g. [`create-session.feature`](../../../tests/behavior/backend/create-session.feature)), steps under [`tests/behavior/steps/`](../../../tests/behavior/steps/) (e.g. `backend-create-session.steps.ts`), world at [`tests/behavior/support/world.ts`](../../../tests/behavior/support/world.ts) (fresh pglite + migrations per scenario), app built via `__buildTestSessionsApp(options)` at [`apps/server/src/sessions/routes.ts:3581`](../../../apps/server/src/sessions/routes.ts). The new scenario builds the app, injects the generator requests, and asserts both response shape and DB rows.
- **i18n catalogs** — [`packages/i18n-catalogs/src/catalogs/`](../../../packages/i18n-catalogs/src/catalogs/): `en-US.json` (source), `pt-BR.json` + `pt-BR.review.json`, `es-419.json` + `es-419.review.json`. Parity gate: `pnpm --filter @a-conversa/i18n-catalogs run check`.
- **Existing test-mode e2e** — [`tests/e2e/test-mode-load-session.spec.ts`](../../../tests/e2e/test-mode-load-session.spec.ts) (real-backend wiring) and [`tests/e2e/test-mode-skeleton-smoke.spec.ts`](../../../tests/e2e/test-mode-skeleton-smoke.spec.ts) (placeholder on `/t/` + auth deflection). **Moving the root `/` from placeholder to gallery changes what `/t/` renders** (Constraint §6) — the skeleton smoke spec must be updated. Playwright projects + `setup-auth` bootstrap in [`playwright.config.ts`](../../../playwright.config.ts); specs mint sessions via `POST /api/sessions` (no `make up` fixture seeding).
- **Related (not consumed)** — the seed-script stub [`scripts/seed.ts`](../../../scripts/seed.ts) (CLI dev-DB population, still a stub) and `tests/e2e/fixtures/wsStoreSeed.ts` (in-page WS-store seed). Both are distinct from this runtime operator-triggered generator; neither is reused here.
- **ADRs** — **0041 (this task's new ADR — synthetic generation is a non-production-gated seam)**, 0026 (micro-frontend mount), 0021 (event envelope), 0020 (sequence allocation), 0023 (Fastify), 0006 (Vitest), 0007 (Cucumber + pglite), 0008 (Playwright + compose), 0010 (pnpm workspaces), 0022 (no throwaway verification).

## Constraints / requirements

1. **Generation is gated to non-production.** The synthetic plugin registers **only when `NODE_ENV !== 'production'`**; in production the routes 404. This is the single enforcement of the authorization bypass (ADR 0041, Decision §1).
2. **Non-destructive and re-runnable.** Each generation allocates a **fresh** session id and fresh entity ids; repeated calls never collide and never truncate. Synthetic users are inserted `ON CONFLICT DO NOTHING`. No `loadFixture`/`TRUNCATE` at runtime, ever. (Decisions §1, §3.)
3. **Real events through the production write path.** Every generated event passes `validateEvent` and is appended via `appendSessionEvent` inside one `withTransaction`, with caller-allocated ascending `sequence` starting at `1`. The generated session is owned by the operator (`host_user_id = authUser.id`) so `canSeeSession` admits it and the existing load route can read it. (Decision §2.)
4. **Reuse the wire `Event` type.** Builders return `Event[]` from `@a-conversa/shared-types`; no ad-hoc event shape. Scenario descriptors `{ key, title, description }` are a small typed contract shared between the route and the gallery.
5. **One data source downstream.** Generation hands off to the existing `/sessions/:sessionId` route via navigation; it adds **no** alternate in-memory render path and does **not** modify `useSessionEventLog` or the load readout. (Decision §2.)
6. **Root `/` becomes the gallery.** The gallery supersedes the placeholder at the surface root. Update [`tests/e2e/test-mode-skeleton-smoke.spec.ts`](../../../tests/e2e/test-mode-skeleton-smoke.spec.ts): its `/t/` assertion targets the gallery container (not `route-test-mode-placeholder`), and its unauthenticated `/login`-deflection assertion is retained (route-independent). This is inherited wiring debt from the route-table change, paid in-task. (Decision §5.)
7. **Gallery fetch convention.** Plain `fetch` + `useState`, `credentials: 'include'`, `Accept: application/json`; observable loading / error+retry for both the list fetch and the generate POST. App-local (one consumer), not a shell hook. (Decision §7.)
8. **No new runtime dependencies.** The gallery uses `fetch` + React Router already present. The server already devDepends on `@a-conversa/test-fixtures` (not reused at runtime here); no new server dependency.
9. **Catalog parity stays green.** `testMode.synthetic.*` additions land in all three catalogs + the two `.review.json` companions; `pnpm --filter @a-conversa/i18n-catalogs run check` exits zero.
10. **Build + check green.** `pnpm -F @a-conversa/server build`, `pnpm -F @a-conversa/test-mode build`, and `pnpm run check` (lint + format + typecheck) all stay green.

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **Typecheck** — `pnpm -F @a-conversa/server typecheck` and `pnpm -F @a-conversa/test-mode typecheck` exit zero; the scenario-descriptor contract is exported once and consumed by both the route and the gallery.
2. **Vitest builder tests** (`apps/server/src/test-mode/synthetic/scenarios.test.ts`, real pglite + migrations like [`fixture-append-mode.test.ts`](../../../apps/server/src/events/fixture-append-mode.test.ts), or pure-function tests where DB isn't needed):
   - every event each builder emits passes `validateEvent` (pins ADR 0021 conformance);
   - sequences are contiguous ascending from `1`; the `empty` builder emits `session-created` + three `participant-joined`; the structured builder emits the declared `node-created`/`entity-included`/`proposal`/`vote`/`commit` shape;
   - two invocations with distinct fresh ids produce **disjoint** session/entity ids (pins non-destructive re-runnability, Constraint §2);
   - all events carry the passed-in `sessionId` and the structured builder's references resolve within its own emitted ids (no dangling reference).
3. **Vitest env-gate test** (`apps/server/src/test-mode/register.test.ts` or equivalent): the registration guard mounts the routes when `NODE_ENV !== 'production'` and **skips** them when `NODE_ENV === 'production'` (pins Constraint §1 without an e2e).
4. **Cucumber wire-seam scenario** (`tests/behavior/backend/synthetic-session.feature` + steps), against the pglite-backed app:
   - `GET /api/test-mode/synthetic-scenarios` returns `200` with at least the `empty` and structured descriptors (`{ key, title, description }`);
   - `POST /api/test-mode/synthetic-sessions { scenario: "empty" }` returns `201 { sessionId }`, **and** the DB then holds a `sessions` row owned by the caller plus the expected `session_events` rows in ascending `sequence` (real persisted log, the wire proof);
   - `POST` with an unknown `scenario` returns a `400`; unauthenticated `POST` returns `401`.
   - *(This crosses the protocol/replay seam — generation writes the event log other surfaces read — so Cucumber is the right pin per the backend test policy.)*
5. **Vitest gallery-view tests** (`apps/test-mode/src/synthetic/SyntheticGallery.test.tsx` or equivalent), mocking `fetch`: list `loading` / `ready` (one affordance per scenario under the stable `data-testid`, reading `testMode.synthetic.*` keys) / list `error`+retry; clicking generate POSTs and, on `201`, triggers navigation to `/sessions/:returnedId` (assert via a router spy/`MemoryRouter`); generate-error surfaces a retry affordance.
6. **`pnpm run test:smoke`** stays green; the unit/component smoke count grows by the new builder + view cases.
7. **Playwright generate→load e2e** (`tests/e2e/test-mode-synthetic-session.spec.ts`, new `chromium-test-mode-synthetic-session` project in `playwright.config.ts`, `dependencies: ['setup-auth']`) — **e2e is in scope, not deferred** (Decision §6). Under `make up` + `pnpm run test:e2e`, authenticated via the bootstrap storage state: navigate `/t/`, see the gallery, click generate on the **structured** scenario, and assert the browser lands on `/t/sessions/<id>` with the load readout showing the generated events (`> 0` rows) — real surface → real gated endpoint → real persisted log → real read path, end-to-end. One spec, en-US only, no fixture/mock. *(This is the non-empty persisted-log readout that [`test_mode_load_session.md`](test_mode_load_session.md) §6 deferred to Vitest because it had no way to persist a rich log in e2e; synthetic generation supplies exactly that.)*
8. **Skeleton smoke stays green** — [`tests/e2e/test-mode-skeleton-smoke.spec.ts`](../../../tests/e2e/test-mode-skeleton-smoke.spec.ts) updated per Constraint §6 (root `/t/` targets the gallery; auth-deflection retained) and passing.
9. **`pnpm --filter @a-conversa/i18n-catalogs run check`** green after the `testMode.synthetic.*` additions (all three catalogs + `.review.json` companions).
10. **`pnpm -F @a-conversa/server build` + `pnpm -F @a-conversa/test-mode build` + `pnpm run check`** all green.
11. **ADR 0041 present and referenced**; **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"`** silent after `complete 100` is added (closer step).
12. **No file modifications outside the task allowlist** — the new `apps/server/src/test-mode/` module, the `createServer()` registration line in `apps/server/src/server.ts`, the new `apps/test-mode/src/synthetic/` view, the `apps/test-mode/src/App.tsx` root route, the two i18n catalog dirs, the new Cucumber feature + steps, the new + updated e2e specs, `playwright.config.ts`, and ADR 0041. No change to `useSessionEventLog`, the load readout, or any other surface.

## Decisions

### §1 — Synthetic generation is a non-production-gated backend seam, not a `loadFixture` call (ADR 0041)

**Chosen:** a dedicated test-mode plugin registered only when `NODE_ENV !== 'production'`, minting fresh sessions non-destructively through the production write path. **Rejected — expose `loadFixture` at runtime:** it issues `TRUNCATE TABLE ... CASCADE` across every core table and replays fixed ids — it would wipe a shared backend and collide on re-run; it is a test-harness primitive by construction. **Rejected — drive the public gesture endpoints client-side:** they enforce participant-role authorization, so a single operator cannot author a multi-party debate (POST a proposal *as debater-A*, a counter *as debater-B*); that authorization is exactly what makes the live flow correct and exactly what makes it useless for fabrication. Generation inherently bypasses participant authorization, which is safe in dev/staging and unacceptable in production — so a `NODE_ENV` route gate (the simplest enforcement the server already uses, for CORS) is the right containment. This is a new architectural seam with a security-relevant trade-off, hence ADR 0041.

### §2 — Generation persists real events and hands off to the existing load route — one data source

**Chosen:** the generator writes a real `session_events` log via `validateEvent` + `appendSessionEvent` in one transaction and returns a `sessionId`; the UI navigates to `/sessions/:sessionId`, which the load-session task already renders (and the scrubber will later drive). **Rejected — generate an in-memory log client-side and render it without persistence:** that forks the data path — the scrubber and inspectors would need a second source beyond `useSessionEventLog`, the exact fragmentation load-session's Decision §1 fought to avoid. Persisting through the real write path means every downstream `test_mode_*` leaf consumes one source, and it gives the generated session real visibility/ownership semantics for free.

### §3 — Fresh ids per call; stable, clearly-marked synthetic users

**Chosen:** each generation allocates a fresh session id and fresh entity (node/edge/annotation) ids, owns the session by the calling operator, and inserts the synthetic debater users with `INSERT ... ON CONFLICT DO NOTHING` under stable ids (e.g. `oauth_subject` `synthetic:debater-a`). **Rejected — fresh users every call:** bloats the user table with throwaway rows for no benefit; stable synthetic users are reused and clearly identifiable. **Rejected — reuse the fixed fixture ids wholesale:** they collide on the second generation and tie the runtime path to the destructive loader's id scheme. Fresh session/entity ids + stable synthetic users is the non-destructive, re-runnable middle.

### §4 — Scenarios are server-side code builders; the rich `walkthrough` fixture is a deferred follow-up

**Chosen:** scenarios are pure builder functions registered under string keys, shipping `empty` + one small structured scenario. **Rejected — instantiate the rich `walkthrough` fixture (800+ events) at runtime now:** doing it non-destructively requires a **typed id-re-keyer** (remap session/user/node/edge/annotation/event ids across the discriminated payload union) — meaningful, risky work the destructive loader sidesteps precisely *because* re-keying is hard. Two small code builders deliver the generator and its tests within budget; richer reuse is registered as a follow-up: **`test_mode_synthetic_scenario_library`** — *"Add a non-destructive typed re-keyer that instantiates the `walkthrough` (and future) test-fixtures into a fresh synthetic session, registered as additional scenarios in the test-mode generator"*, ~2d, under the `test_mode` group / replay-test milestone (closer registers in WBS, `depends !test_mode_synthetic_session`).

### §5 — The root `/` becomes the scenario gallery, superseding the placeholder

**Chosen:** mount the gallery at the surface root `/`, retiring the placeholder there. Both [`test_mode_app.md`](test_mode_app.md) and [`test_mode_load_session.md`](test_mode_load_session.md) framed the root placeholder as scaffolding to be superseded "when the remaining downstream leaves land"; the synthetic-session gallery is the first natural landing for a test-mode operator ("what do you want to look at?"), so it earns the root. **Rejected — add a `/synthetic` route and keep the placeholder at `/`:** leaves the surface's front door a dead placeholder while burying the one entry point an operator needs; an extra route for no gain. Superseding the root is the in-task wiring debt this task owns (Constraint §6 updates the skeleton smoke spec accordingly).

### §6 — E2e is in scope and pays down load-session's deferred rich-readout coverage

**Chosen:** a Playwright spec drives gallery → generate (structured scenario) → land on `/sessions/:id` with a **non-empty** readout, proving the whole chain through the real gated endpoint and real persisted log. Per the UI-stream e2e policy the surface *is reachable* the moment the gallery route lands, so deferral does not apply. This also closes the gap [`test_mode_load_session.md`](test_mode_load_session.md) §6 left: load-session's e2e could only show an *empty* persisted log (the browser-store seed helpers hydrate the in-page WS store, not the DB), so the rich readout was pinned at Vitest; synthetic generation persists a rich log, so the e2e here exercises the non-empty readout end-to-end. **The builder validity/freshness and the env-gate are pinned at the Vitest + Cucumber layers** (deterministic, no browser), with the e2e proving reachability + real-backend wiring — the correct layering.

### §7 — The gallery fetch is app-local, not a shell hook

**Chosen:** the scenario-list fetch and the generate POST live in `apps/test-mode/src/synthetic/` (app-local), unlike `useSessionEventLog` which lives in shell. **Rejected — put it in `@a-conversa/shell`:** the synthetic generator is exclusively a test-mode concern (a non-production endpoint no other surface calls), so there is no second consumer to justify the shell seam. Load-session's hook earned shell because the scrubber and inspectors reuse it; synthetic generation has one call site. If a future surface ever needs it, promotion to shell is a mechanical move behind the same contract.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Descriptor contract `SyntheticScenarioDescriptor` exported from `packages/shared-types/src/synthetic-scenarios.ts` and re-exported via `packages/shared-types/src/index.ts`.
- Server-side scenario builders in `apps/server/src/test-mode/synthetic/scenarios.ts` (`empty` + structured); Vitest suite `scenarios.test.ts` pins validity/shape/determinism/disjointness.
- Test-mode plugin + routes in `apps/server/src/test-mode/routes.ts` (`GET /api/test-mode/synthetic-scenarios`, `POST /api/test-mode/synthetic-sessions`); env-gate registration in `apps/server/src/test-mode/register.ts` + `register.test.ts`; gated registration wired in `apps/server/src/server.ts`.
- Gallery view `apps/test-mode/src/synthetic/SyntheticGallery.tsx` now serves as the test-mode root `/` (superseding the placeholder); `apps/test-mode/src/App.tsx` and `apps/test-mode/src/mount.test.tsx` updated accordingly.
- i18n keys `testMode.synthetic.*` added to all three catalogs (`packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json`); parity gate passes (`.review.json` companions not updated — UI-chrome key precedent per `test_mode_load_session`/`snapshot_list_ui`).
- Cucumber wire-seam scenario `tests/behavior/backend/synthetic-session.feature` + steps `tests/behavior/steps/backend-synthetic-session.steps.ts` (list shape, generate-persists+owned, unknown→400, unauth→401); ESLint and query fixes applied by fixer.
- Playwright e2e `tests/e2e/test-mode-synthetic-session.spec.ts` (generate structured → land on `/t/sessions/<id>` with non-empty readout); new `chromium-test-mode-synthetic-session` project added to `playwright.config.ts`.
- Skeleton smoke spec `tests/e2e/test-mode-skeleton-smoke.spec.ts` updated: root `/t/` now asserts the gallery container instead of the retired placeholder.
- ADR 0041 `docs/adr/0041-synthetic-session-generation-dev-gated-seam.md` added.
- Tech-debt follow-up registered in WBS: `replay_test.test_mode.test_mode_synthetic_scenario_library` (non-destructive typed re-keyer for walkthrough fixture instantiation, ~2d, wired to M8).
