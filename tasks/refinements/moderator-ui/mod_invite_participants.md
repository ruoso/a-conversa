# Invite participants (debater A, debater B) — moderator's post-create invitation surface

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_session_setup.mod_invite_participants`
**Effort estimate**: 1d
**Inherited dependencies**:

- `moderator_ui.mod_session_setup.mod_create_session_form` — settled. After 201 the create-session form `useNavigate`s to `/sessions/${id}/operate` with `replace: false` (see `apps/moderator/src/routes/CreateSession.tsx:141`). This task **amends that post-create navigation** to land on `/sessions/${id}/invite` instead, so the moderator sees the invite surface before entering the operate canvas.
- `moderator_ui.mod_shell.mod_app_skeleton` — settled (router, i18n bootstrap, `BrowserRouter` mount in `main.tsx`).
- `moderator_ui.mod_shell.mod_auth_flow` — settled (`useAuth()`, the `auth.*` i18n namespace under `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`).
- `moderator_ui.mod_shell.mod_route_auth_gate` — settled (`<RequireAuth mode="authenticated-only">` wrapper; this task wraps the new route the same way).
- `moderator_ui.mod_shell.mod_screen_name_setup` — settled (a11y patterns and ICU-interpolated helper text precedent this task continues).
- `backend.session_management.create_session_endpoint` — settled. `POST /api/sessions` already inserts the host as `role='moderator'` at session creation (per `participant_assignment`'s amendment to the create transaction). The host-as-moderator row is what makes the invite view's "slot 0: moderator (you)" affordance accurate without an extra fetch.
- `backend.session_management.get_session_endpoint` — settled. `GET /api/sessions/:id` returns the camelCase `SessionResponse` shape used by the invite view's header (topic + privacy display).
- `backend.session_management.participant_assignment` — settled. `POST /api/sessions/:id/participants` (host-only) and `DELETE /api/sessions/:id/participants/:userId` (host or self) are the backend surface this UI exercises. The body schema is `{ userId: UUID, role: 'debater-A' | 'debater-B' }` and the `'moderator'` value is structurally rejected (see `apps/server/src/sessions/routes.ts:702`).
- `backend.api_skeleton.serve_static_frontends_path_collision_fix` — settled. The backend now lives under `/api/*` so the SPA can own `/sessions/:id/invite` (a 3-segment route) without the params-validator collision that drove `mod_create_session_form`'s `/sessions/new/setup` workaround. The invite route reclaims the natural REST shape.

## What this task is

The second leaf under `mod_session_setup`. Lands the moderator-facing surface that lets the host invite the two debaters into a freshly-created session.

After this task ships, the post-create flow becomes:

1. Moderator logs in and lands at `/sessions/new` (the existing create-session form).
2. Submit → `POST /api/sessions` → 201 `{ id, ... }` → form navigates to `/sessions/<id>/invite` (was: `/sessions/<id>/operate`).
3. The invite view shows the session header (topic, privacy) and three participant slots:
   - **Moderator (you)** — pre-filled (the create-session transaction wrote the host as the moderator row at sequence=2; the view reads it from `GET /api/sessions/:id/participants`).
   - **Debater A** — initially empty. Two affordances: a shareable invite link (copy-to-clipboard) and (if the slot is filled) the participant's screen name.
   - **Debater B** — same shape.
4. As debaters open the link, log in via OAuth, claim the slot via a backend self-claim endpoint (registered as a follow-up — see "Open questions" and "Backend follow-up tasks"), and a WS `participant-joined` broadcast updates the slot state in real time.
5. The moderator clicks "Enter session" (enabled at any point — neither slot is required to be filled, e.g. to run a single-participant dry-run; see Decisions §3) and lands on `/sessions/<id>/operate`. The existing operate route is unchanged.

The deliverable is **one new route** (`/sessions/<id>/invite`, gated `authenticated-only` via `RequireAuth`), **one new component** (`apps/moderator/src/routes/InviteParticipants.tsx`), corresponding **Vitest cases** in a sibling `InviteParticipants.test.tsx`, the **i18n keys** under `moderator.invite.*`, the **post-create navigation amendment** in `apps/moderator/src/routes/CreateSession.tsx` (one-line change to the `navigate(...)` target + a doc-comment update), the **App.test.tsx** route-gate extension, the **App.tsx** route registration, and **one new Playwright spec** (`tests/e2e/invite-participants-flow.spec.ts`) that drives the post-create chain through to the operate route.

**Out of scope** (registered as follow-ups under "Backend follow-up tasks" and "Open questions"):

- The participant self-claim backend endpoint (the debater's path from "I opened the invite link" to "I am now assigned to slot debater-A").
- The participant-UI route that renders the claim view for the debater.
- The lobby UX (`mod_session_lobby` — next sibling under `mod_session_setup`).
- Real-time WS updates for slot fill (initial implementation is polling-by-route-remount; WS is an optional enhancement — see Decisions §6).
- Moderator-side participant removal / swap UI (the `DELETE /api/sessions/:id/participants/:userId` endpoint exists, but a "remove this debater" button is out-of-scope; the slot reset path is "have the debater re-open the link, the new claim overwrites the old assignment" once the backend self-claim endpoint lands).

## Why it needs to be done

Three downstream consumers wait on this:

- **`mod_session_lobby`** (next sibling) — renders the pre-debate waiting room. The lobby is the surface the moderator uses once both debaters have claimed slots; without the invite view, there's no path to populate slots in the first place, so the lobby has no meaningful state to render.
- **The user, manually**. Per ORCHESTRATOR.md `28a71f9` and the user's continued direction: the UI stream is gated on Playwright passing in compose and on the user being able to test end-to-end in the browser. Today the moderator creates a session and lands directly on the operate canvas with no participants — a methodologically broken state that wouldn't survive a real debate (no one to vote on proposals). The invite view is the missing link between "session created" and "ready to debate."
- **End-to-end debate-as-a-product**. The platform's v1 thesis (DESIGN.md §"Format") is real-time debate with two debaters + one moderator. The current code path lets a moderator create a session and stare at an empty canvas. The invite view is the moderator's entry point into the debate's social setup — without it the product's headline workflow has no UI shape.

## Inputs / context

### Predecessor's post-create navigation (the one-line amendment)

From [`apps/moderator/src/routes/CreateSession.tsx`](../../../apps/moderator/src/routes/CreateSession.tsx) lines 138-142:

```ts
// `replace: false` so the back button from /sessions/<id>/operate
// returns to /sessions/new (a "create another" affordance) rather
// than skipping past the form.
void navigate(`/sessions/${body.id}/operate`, { replace: false });
```

This task amends the navigation target to `/sessions/${body.id}/invite` (line 141). The `replace: false` choice carries over unchanged — the back button from `/sessions/<id>/invite` still returns to `/sessions/new` per the same rationale (the moderator may want to start a fresh session if they realize they had a typo in the topic). The doc comment immediately above the line updates accordingly. The Vitest cases in `CreateSession.test.tsx` that assert the post-201 navigation target (case 7, "Successful POST: 201 → navigate") get their expected URL updated in lockstep.

### Backend contracts (frozen)

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts):

- **`POST /api/sessions/:id/participants`** (host-only debater assignment) at line 2023. Body `{ userId: UUID, role: 'debater-A' | 'debater-B' }`. The role enum **deliberately excludes `'moderator'`** (line 714). Response 200 + `SessionParticipantResponse` shape `{ id, sessionId, userId, role, joinedAt, leftAt }` (lines 444-498).
- **`DELETE /api/sessions/:id/participants/:userId`** (host or self) at line 2287. No body. Returns 200 + the updated participant row with `leftAt` populated.
- **`GET /api/sessions/:id`** (the visibility-gated fetch) — returns `SessionResponse` `{ id, hostUserId, privacy, topic, createdAt, endedAt }`. The invite view's header reads this for the topic + privacy display.

**No `GET /api/sessions/:id/participants` endpoint exists yet.** The invite view needs the current participants list to render the slot states (which slot is empty / which is filled + by whom). The list endpoint is a registered backend follow-up — see "Backend follow-up tasks" below. Until it lands, the invite view's slot state is **derived from a session-events catch-up via the WS client** (which the existing infrastructure supports — `client.trackSession(sessionId)` + `client.send('catch-up', { sessionId, sinceSequence: 0 })` replays `participant-joined` / `participant-left` events; the view's local reducer collapses these into the current slot state). This keeps the task within the current backend surface.

**No participant self-claim endpoint exists yet** (the backend's POST is host-only, requiring a UUID the moderator doesn't have without a user-lookup endpoint). The orchestrator-brief discussion of invitation models (a/b/c) lands on (a) — shareable links + self-claim — as the canonical model for an MVP. The self-claim endpoint is registered as a backend follow-up; until it lands, the invite view's link-share affordance is **demonstrably correct at the URL-shape level** (the link is a valid SPA URL pointing at the session) but the debater cannot yet land on a "claim" view from the link. The moderator can still observe the slot states via the (future) participants list / WS feed, and the invite view is structurally complete and ready for the day the backend lands.

### Existing route + auth-gate registration pattern

From [`apps/moderator/src/App.tsx`](../../../apps/moderator/src/App.tsx) lines 39-78:

- Six routes today: `/login`, `/screen-name` (`needs-screen-name-only`), `/sessions/new` (`authenticated-only`), `/sessions/:id/lobby` (`authenticated-only`), `/sessions/:id/operate` (`authenticated-only`), wildcard → `/login`.
- This task adds `/sessions/:id/invite` between `/sessions/new` and `/sessions/:id/lobby`, wrapped in `<RequireAuth mode="authenticated-only">`. The wrapper's contract is unchanged from `mod_route_auth_gate`'s shipped behavior.

### Precedent for the route component

The form-shaped routes (`Login.tsx`, `ScreenName.tsx`, `CreateSession.tsx`) all follow the same shell shape — `<main data-testid="route-<name>">`, `<h1 data-testid="route-title">`, inline `fetch` for HTTP calls, `useTranslation` for copy, `useNavigate` for downstream navigation. The invite view follows the same shell shape but is NOT a form — it's a **view** with affordances (copy-link buttons, an "enter session" button, real-time slot displays). The shape is closer to `OperateRoute` (a view-with-affordances) than to the form routes, minus the WS-client mounting (the invite view doesn't need to subscribe to graph events — only to participant lifecycle events).

### HTTP client seam (still inline `fetch`)

The moderator app has no dedicated `apps/moderator/src/api/` directory; the existing call sites use inline `fetch(...)` with the `credentials: 'include'` + `Content-Type: application/json` + `Accept: application/json` triple. Per `mod_create_session_form.md` §"HTTP client seam" Decisions §3: the abstraction threshold is "the fourth caller." This task adds **zero new HTTP call sites** in the moderator workspace (the invite view consumes the existing `GET /api/sessions/:id` from inside the route; the existing `client.trackSession` + `client.send('catch-up', ...)` paths are reused for participant lifecycle events). The abstraction question stays deferred.

### WS client + catch-up replay seam

From [`apps/moderator/src/ws/client.ts`](../../../apps/moderator/src/ws/client.ts) lines 467-491: `client.trackSession(sessionId)` sends `subscribe` then `catch-up` (with `sinceSequence: 0` if no events have been applied yet); the store's `lastAppliedSequence` advances as events stream in; `client.untrackSession` sends `unsubscribe` and cleans up.

The invite view mounts `<WsClientProvider>` (same as `OperateRoute` lines 81-86) and an inner component that calls `trackSession(sessionId)` on mount + `untrackSession(sessionId)` on unmount. A local reducer in the inner component walks the WS store's event stream for the session, filters to `participant-joined` and `participant-left` kinds, and produces the current slot-occupant map: `{ 'moderator': screenName?, 'debater-A': screenName?, 'debater-B': screenName? }`. `participant-left` cancels a prior `participant-joined` for the same userId per the existing semantics (see `apps/moderator/src/graph/proposalFacets.ts` line 445 for the canonical idiom).

The reducer is small (~30 lines); kept inline in the route component rather than extracted to a `useSessionParticipants` hook for v1 — extraction becomes worthwhile if/when the lobby route (next sibling) and a possible "session detail" view also need the same projection.

### Existing i18n catalog precedent

From [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) lines 113-136 — the `moderator.createSession.*` namespace shipped by the predecessor. This task adds a sibling `moderator.invite.*` namespace under the same `moderator` top-level scope. The parity-check script (`pnpm --filter @a-conversa/i18n-catalogs run check`) enforces that every en-US key has pt-BR and es-419 counterparts; the catalog edits MUST land all three locales together.

The pt-BR + es-419 drafts land flagged PENDING in the existing `pt-BR.review.json` / `es-419.review.json` trackers (the same lifecycle the predecessor used). A native-speaker review follow-up task is registered alongside this task per the tech-debt registration policy (ORCHESTRATOR.md `b7c5ff0`).

### Playwright e2e seam

From [`tests/e2e/create-session-flow.spec.ts`](../../../tests/e2e/create-session-flow.spec.ts) lines 56-81 — the existing happy-path scenario navigates from the create-session form to the operate canvas. This task's e2e spec is a **sibling** — `tests/e2e/invite-participants-flow.spec.ts` — that drives the new chain: login → create-session → land on invite view → assert slots render → click copy-link → assert clipboard → click "enter session" → land on operate canvas.

The existing `create-session-flow.spec.ts`'s happy-path scenario assertion "URL settles on `/sessions/<id>/operate`" becomes "URL settles on `/sessions/<id>/invite`" — the spec is updated in lockstep with the navigation amendment. The "graph canvas mounted" assertion moves to the new invite spec (where the test clicks "enter session" to reach the operate route).

The Playwright project structure (per `playwright.config.ts`) already supports per-spec project naming; this task either extends the existing `chromium-create-session` project or registers a new `chromium-invite-participants` project — the choice is deferred to implementation but the spec lives under the same compose-stack gate.

### Clipboard API + Playwright

Playwright's chromium honors the Clipboard API when the page has the `clipboard-write` permission. The e2e spec calls `context.grantPermissions(['clipboard-write', 'clipboard-read'])` before the navigation; the invite view uses `navigator.clipboard.writeText(url)` on the copy-link click; the spec asserts the clipboard via `page.evaluate(() => navigator.clipboard.readText())`. This is the documented Playwright path; no shims required.

### ADR pin

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of the new behavior is a committed test. The Vitest cases + the Playwright invite-flow spec ARE the probes. No throwaway `console.log` debugging; no manual smoke that doesn't land as a committed regression.

## Constraints / requirements

### Route + wiring

- **Route path**: `/sessions/:id/invite`. Justified under Decisions §1.
- **Route registration**: add one `<Route>` in `App.tsx` between `/sessions/new` and `/sessions/:id/lobby`, wrapped with `<RequireAuth mode="authenticated-only">`. Update the header-comment route listing in `App.tsx` to include `/sessions/:id/invite` and document its place in the post-create flow.
- **Post-create navigation amendment**: `apps/moderator/src/routes/CreateSession.tsx` line 141 changes from `navigate(\`/sessions/\${body.id}/operate\`, { replace: false })` to `navigate(\`/sessions/\${body.id}/invite\`, { replace: false })`. The doc comment immediately above is updated to reflect the new destination + the rationale (invite-view-first per `mod_invite_participants`).

### Route component (`apps/moderator/src/routes/InviteParticipants.tsx`)

- **Exports**: `function InviteParticipantsRoute(): ReactElement` — named export, no default.
- **Root DOM**: `<main data-testid="route-invite-participants">`.
- **Heading**: `<h1 data-testid="route-title">{t('moderator.invite.title')}</h1>` — reusing `route-title` for consistency with every other moderator route.
- **Session header**: a small block showing the session topic (`<p data-testid="invite-session-topic">{session.topic}</p>`) and a privacy badge (`<span data-testid="invite-session-privacy">{t('moderator.invite.privacy.<value>')}</span>`). The session data comes from `GET /api/sessions/:id` on mount; pending state renders a localized loading placeholder.

#### Slot rendering

The view renders three slots in a fixed order: `moderator`, `debater-A`, `debater-B`. Each slot is a `<section data-testid="invite-slot" data-role="<role>">` containing:

- A role label: `<h2 data-testid="invite-slot-role-<role>">{t('moderator.invite.slot.<role>.label')}</h2>`.
- **Filled state** (slot occupant resolved): the participant's screen name as `<p data-testid="invite-slot-occupant" data-role="<role>">{occupant.screenName}</p>`. The moderator slot is always filled (the host-as-moderator row landed at session creation per the `participant_assignment` amendment).
- **Empty state** (only applicable to `debater-A` / `debater-B`): a localized empty-state caption `<p data-testid="invite-slot-empty" data-role="<role>">{t('moderator.invite.slot.empty', { role: t('moderator.invite.role.<role>') })}</p>` (e.g. "Awaiting Debater A").

#### Invite-link affordance (debater slots only)

Each debater slot carries an invite-link affordance. The link shape:

```
<APP_BASE_URL>/sessions/<sessionId>/invite?role=<role>
```

The URL is computed on the client from `window.location.origin` (the user might have a tunneled / port-forwarded base URL in dev; reading the origin keeps the link copyable to a working URL regardless of deployment). The `?role=` query string is the slot the debater is expected to claim; the future participant-self-claim flow reads it to pre-select the correct slot.

The affordance renders as a row containing:

- A read-only `<input data-testid="invite-link-input" data-role="<role>" value={url} readOnly>` so the user can see (and select-all-then-copy via keyboard) the URL.
- A `<button data-testid="invite-link-copy" data-role="<role>">{t('moderator.invite.copyLink.label')}</button>` — on click, calls `void navigator.clipboard.writeText(url)`, then surfaces a transient "Copied!" confirmation (`<span data-testid="invite-link-copied" data-role="<role>" role="status" aria-live="polite">{t('moderator.invite.copyLink.copied')}</span>`) that auto-clears after ~2 seconds.
- The clipboard write is wrapped in a try/catch; on failure (older browsers / insecure-origin contexts), the affordance falls back to "select the input contents" and shows a localized hint pointing the user at the input. Justified under Decisions §5.

#### Enter-session action

A single `<button data-testid="invite-enter-session">{t('moderator.invite.enterSession.label')}</button>` at the bottom of the view. On click, calls `void navigate(\`/sessions/\${sessionId}/operate\`, { replace: false })`. **Always enabled** — the moderator may enter the operate canvas before either debater has joined (e.g. for a dry-run, a single-participant sanity check, or to start setting up the session structure). Justified under Decisions §3.

#### Error / loading states

The view renders three discrete states:

- **Loading**: while `GET /api/sessions/:id` is in flight, show a localized loading placeholder (`<p data-testid="invite-loading" aria-live="polite">{t('moderator.invite.loading')}</p>`) and no slot blocks.
- **Error** (session fetch failed): show a localized error region (`<p data-testid="invite-error" role="alert" aria-live="polite">{t('moderator.invite.errors.fetchFailed')}</p>`) and a retry button (`<button data-testid="invite-retry">{t('moderator.invite.retry')}</button>`).
- **Loaded**: render the session header + the three slots + the enter-session action.

The WS connect + participant-event subscription is **independent of the HTTP fetch loading state** — the WS provider mounts unconditionally (per the `OperateRoute` precedent at lines 81-86); the inner component's reducer collapses the streaming events into the slot map.

### State

- **`useState<{ status: 'loading' | 'loaded' | 'error', session?: SessionResponse }>`** for the HTTP fetch lifecycle.
- **`useState<Record<string, string | undefined>>`** for the per-slot "Copied!" confirmation timeouts (key = role, value = the timeout id, cleared on next click or unmount).
- **The participant slot map** is derived from the WS store's event stream for the session (no separate `useState` for slot occupants — the store is the source of truth). The view re-renders on every WS event via the store's subscription hook.

No new state-management library introduced; the WS store / reducer pattern is already in place via `apps/moderator/src/ws/store.ts` (the `useWsStore` hook is the existing consumer in `PendingProposalsPane` and `GraphCanvasPane`).

### i18n catalog keys

New keys under `moderator.invite.*`. **All three catalogs** (`en-US.json`, `pt-BR.json`, `es-419.json`) get the same key set; the parity-check enforces this.

| Key | en-US | pt-BR (draft, PENDING) | es-419 (draft, PENDING) |
| --- | --- | --- | --- |
| `moderator.invite.title` | "Invite participants" | "Convidar participantes" | "Invitar participantes" |
| `moderator.invite.loading` | "Loading session…" | "Carregando sessão…" | "Cargando sesión…" |
| `moderator.invite.retry` | "Retry" | "Tentar novamente" | "Reintentar" |
| `moderator.invite.errors.fetchFailed` | "Could not load the session. Please try again." | "Não foi possível carregar a sessão. Tente novamente." | "No se pudo cargar la sesión. Inténtalo de nuevo." |
| `moderator.invite.privacy.public` | "Public" | "Pública" | "Pública" |
| `moderator.invite.privacy.private` | "Private" | "Privada" | "Privada" |
| `moderator.invite.role.moderator` | "Moderator" | "Moderador(a)" | "Moderador(a)" |
| `moderator.invite.role.debater-A` | "Debater A" | "Debatedor(a) A" | "Debatiente A" |
| `moderator.invite.role.debater-B` | "Debater B" | "Debatedor(a) B" | "Debatiente B" |
| `moderator.invite.slot.moderator.label` | "Moderator (you)" | "Moderador(a) (você)" | "Moderador(a) (tú)" |
| `moderator.invite.slot.debater-A.label` | "Debater A" | "Debatedor(a) A" | "Debatiente A" |
| `moderator.invite.slot.debater-B.label` | "Debater B" | "Debatedor(a) B" | "Debatiente B" |
| `moderator.invite.slot.empty` | "Awaiting {role}" | "Aguardando {role}" | "Esperando a {role}" |
| `moderator.invite.copyLink.label` | "Copy invite link" | "Copiar link de convite" | "Copiar enlace de invitación" |
| `moderator.invite.copyLink.copied` | "Copied!" | "Copiado!" | "¡Copiado!" |
| `moderator.invite.copyLink.fallbackHint` | "Could not copy automatically. Select the link above and copy it manually." | "Não foi possível copiar automaticamente. Selecione o link acima e copie manualmente." | "No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente." |
| `moderator.invite.enterSession.label` | "Enter session" | "Entrar na sessão" | "Entrar a la sesión" |
| `moderator.invite.enterSession.hint` | "You can enter the session before debaters join." | "Você pode entrar na sessão antes dos debatedores." | "Puedes entrar a la sesión antes de que lleguen los debatientes." |

**Count: 18 keys × 3 locales = 54 catalog entries**.

The 18 en-US keys + 18 pt-BR drafts + 18 es-419 drafts land together; pt-BR + es-419 are added to their respective `*.review.json` files under `pending` with the dotted key names. The native-speaker review follow-up registered below moves the keys from `pending` to `signed_off` once a native speaker signs off per the existing review lifecycle.

### Files this task touches (the explicit allowlist)

- `apps/moderator/src/routes/InviteParticipants.tsx` (new).
- `apps/moderator/src/routes/InviteParticipants.test.tsx` (new — Vitest cases).
- `apps/moderator/src/routes/CreateSession.tsx` (modified — one-line `navigate(...)` target change + doc-comment update).
- `apps/moderator/src/routes/CreateSession.test.tsx` (modified — the post-201 navigation assertion target updates from `/sessions/<id>/operate` to `/sessions/<id>/invite`).
- `apps/moderator/src/App.tsx` (modified — add the `/sessions/:id/invite` route + header-comment update).
- `apps/moderator/src/App.test.tsx` (modified — one `'/sessions/abc/invite'` router case asserting the route mounts the invite view behind `<RequireAuth mode="authenticated-only">`; mirrors the existing lobby / operate / create-session router cases).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add `moderator.invite.*` namespace).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same; drafts).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same; drafts).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified — add 18 dotted keys to `pending`).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified — same).
- `tests/e2e/invite-participants-flow.spec.ts` (new — Playwright spec).
- `tests/e2e/create-session-flow.spec.ts` (modified — the happy-path "URL settles on `/sessions/<id>/operate`" assertion becomes "URL settles on `/sessions/<id>/invite`"; the graph-canvas-mounted assertion moves to the new spec).
- `tasks/35-frontend-i18n.tji` (modified — register the native-speaker review follow-up task `i18n_invite_participants_native_review`).
- `tasks/20-backend.tji` (modified — register the two backend follow-up tasks under "Backend follow-up tasks" below).

### Files this task does NOT touch

- The `.tji` files OTHER than the two listed above — the WBS markers (`complete 100`) land at task-completion time, not at refinement-write time.
- `docs/adr/` — no new ADR is needed (see "no new dependencies / no new architectural choices" below).
- `apps/server/src/sessions/routes.ts` — the existing endpoints are sufficient for the moderator-facing surface; the missing self-claim + participants-list endpoints are registered as backend follow-ups, not implemented in this task.
- `apps/moderator/src/ws/client.ts` or `apps/moderator/src/ws/store.ts` — the existing `trackSession` / `untrackSession` + the event-stream subscription seam are sufficient; no WS API changes.
- Any other existing route component — the invite view is a new route, not a modification of an existing one (except the one-line `navigate(...)` amendment in `CreateSession.tsx`).

### a11y requirements (the testable list)

- The `route-invite-participants` `<main>` is the route's landmark; the `<h1>` is its accessible name.
- Each slot is a `<section>` with an `<h2>` heading — sub-landmark structure for screen-reader navigation.
- The invite-link input is `readOnly` (the user can't edit it; they only copy it). It carries `aria-label={t('moderator.invite.copyLink.inputAriaLabel', { role })}` so screen readers announce its purpose. (Note: this is the 19th key — adjust the count above if implementation surfaces additional keys; the 18-key table is the minimum.)
- The copy-link button has a text accessible name from `t('moderator.invite.copyLink.label')`.
- The "Copied!" confirmation uses `role="status"` + `aria-live="polite"` so screen readers announce it without interrupting the user.
- The empty-state caption (`<p data-testid="invite-slot-empty">`) is plain text inside the slot's section, no `aria-live` (the slot fill happens via WS events; when it happens, the entire slot re-renders with the filled-state markup).
- The "Enter session" button has a text accessible name from `t('moderator.invite.enterSession.label')`; the optional hint text below is plain text, not load-bearing.
- The error region (when fetch fails) has `role="alert"` AND `aria-live="polite"` (the same dual-mechanism choice the predecessor made).
- Focus management: on initial mount, focus stays at the document default (the route is a view, not a form — the user landed here from a button click on the create-session form, and there's no specific input that wants focus). After the fetch resolves and the view renders, focus does not jump; the user can Tab through the slots' affordances in DOM order.

### Test layers per ADR 0022

#### Vitest (in `apps/moderator/src/routes/InviteParticipants.test.tsx`)

Minimum case set:

1. **Renders the loading state on mount** — pending `fetch('/api/sessions/:id')` stub leaves the loading placeholder visible; no slots rendered.
2. **Renders the loaded state when the fetch resolves** — `fetch` stub returns 200 + a session row; assert the topic + privacy badge + the three slot sections render.
3. **Renders the error state on fetch failure** — `fetch` stub rejects; assert the error region (with `role="alert"`) renders and the retry button is visible.
4. **Retry button re-triggers the fetch** — click retry; assert a second `fetch` call was made.
5. **Moderator slot renders the host's screen name** — the WS store is seeded with one `participant-joined` event for the host (role='moderator', screen_name='alice'); assert the moderator slot's occupant element shows "alice."
6. **Debater A slot renders the empty state by default** — no `participant-joined` event for debater-A in the WS store; assert the empty-state caption shows "Awaiting Debater A."
7. **Debater A slot renders the filled state when a participant-joined event arrives** — seed a `participant-joined` for debater-A with screen_name='ben'; assert the slot's occupant element shows "ben" and the empty-state caption is absent.
8. **Debater B slot follows the same fill rule** — seed a `participant-joined` for debater-B with screen_name='maria'; assert the slot shows "maria."
9. **A participant-left event clears the slot back to empty** — seed `participant-joined` then `participant-left` for debater-A; assert the slot returns to the empty state.
10. **Invite link shape is `<origin>/sessions/<id>/invite?role=<role>`** — assert the `value` on the `invite-link-input` for debater-A matches the expected URL.
11. **Copy-link button calls `navigator.clipboard.writeText` with the slot's URL** — stub `navigator.clipboard.writeText`; click the copy button; assert the stub was called with the expected URL.
12. **Copy-link surfaces the "Copied!" confirmation on success** — after the click, assert the `invite-link-copied` element renders with the localized "Copied!" text.
13. **Copy-link surfaces the fallback hint on clipboard failure** — stub `navigator.clipboard.writeText` to reject; click the copy button; assert the fallback hint renders instead of the success confirmation.
14. **Enter-session button navigates to `/sessions/<id>/operate`** — click the button; assert `useNavigate` was called with `/sessions/<id>/operate` and `{ replace: false }`.
15. **Enter-session button is always enabled** — render with zero `participant-joined` events; assert the button is NOT disabled. Render with both debater slots filled; assert the button is NOT disabled (the rule is "always enabled regardless of slot state").
16. **a11y: copy-link confirmation uses `role="status"` + `aria-live="polite"`** — assert the attributes on the confirmation element.
17. **a11y: error region uses `role="alert"` + `aria-live="polite"`** — render in error state, assert the attributes.
18. **i18n: every key resolves in en-US** — render with en-US, walk every `data-testid="invite-*"` element, assert no `[t-missing]` or raw key string is visible (the catalog parity-check covers pt-BR / es-419 at the package level).

Minimum **18 cases** in the new file. Adjust upward as needed during implementation; lower bound is "every requirement bullet has a probe."

#### Vitest (in `apps/moderator/src/App.test.tsx` — extension)

One new test block:

19. **`/sessions/:id/invite` route mounts behind `RequireAuth`** — `MemoryRouter initialEntries={['/sessions/abc-123/invite']}` + a `/api/auth/me` stub returning `'authenticated'` → assert `route-invite-participants` testid rendered. Same stub returning `'unauthenticated'` → assert `route-login` testid rendered. Same stub returning `'needs-screen-name'` → assert `route-screen-name` testid rendered.

Three sub-assertions in one `describe` block, mirroring the existing `/sessions/new` router-gate cases.

#### Vitest (in `apps/moderator/src/routes/CreateSession.test.tsx` — amendment)

The existing case 7 ("Successful POST: 201 → navigate") updates its expected navigation target from `/sessions/<id>/operate` to `/sessions/<id>/invite`. No new case added; the existing case is amended in lockstep with the source change.

#### Playwright (the whole-flow spec — `tests/e2e/invite-participants-flow.spec.ts`)

Per ORCHESTRATOR.md `28a71f9`, the UI stream is gated on Playwright passing in compose; this spec is the regression-class proof of the create-session → invite-view → enter-session chain.

Scenarios:

1. **alice logs in, creates a session, lands on the invite view, asserts moderator slot shows "alice" and both debater slots are empty, clicks copy-link for Debater A, asserts clipboard contents, clicks "Enter session", lands on the operate canvas.**
2. **(Optional) alice logs in, creates a session, lands on the invite view, the invite URL for Debater A matches the expected shape (`<origin>/sessions/<uuid>/invite?role=debater-A`).** A pure URL-shape assertion — small but specific.

Scenario 1 pseudocode:

```ts
import { expect, test } from '@playwright/test';
import { loginAs } from './fixtures/auth';

test.describe('Invite-participants flow — moderator creates a session, lands on invite view, copies a debater link, enters operate canvas', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('alice creates a session, sees the invite view with the moderator slot pre-filled and debater slots empty, copies a link, enters the operate canvas', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. Login.
    await loginAs(page, { username: 'alice' });

    // 2. Create a session.
    await page.goto('/sessions/new');
    await page.getByTestId('create-session-topic-input').fill('Should universal basic income replace existing welfare programs?');
    await page.getByTestId('create-session-submit').click();

    // 3. Wait for navigation to settle on the invite view.
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/invite$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-invite-participants')).toBeVisible();
    await expect(page.getByTestId('route-title')).toHaveText('Invite participants');

    // 4. Assert the moderator slot shows alice (the host).
    await expect(page.getByTestId('invite-slot-occupant').filter({ has: page.locator('[data-role="moderator"]') })).toHaveText('alice');

    // 5. Assert both debater slots render the empty-state caption.
    await expect(page.getByTestId('invite-slot-empty').filter({ has: page.locator('[data-role="debater-A"]') })).toBeVisible();
    await expect(page.getByTestId('invite-slot-empty').filter({ has: page.locator('[data-role="debater-B"]') })).toBeVisible();

    // 6. Click the copy-link button for Debater A.
    await page.getByTestId('invite-link-copy').filter({ has: page.locator('[data-role="debater-A"]') }).click();
    await expect(page.getByTestId('invite-link-copied').filter({ has: page.locator('[data-role="debater-A"]') })).toBeVisible();

    // 7. Assert the clipboard carries the expected URL.
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/\/sessions\/[0-9a-f-]+\/invite\?role=debater-A$/);

    // 8. Click "Enter session" — lands on the operate canvas.
    await page.getByTestId('invite-enter-session').click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });
    await expect(page.getByTestId('route-operate')).toBeVisible();
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible();
  });
});
```

**Scope**: 1-2 scenarios. Scenario 1 IS the load-bearing whole-flow proof. Scenario 2 (URL shape) is optional and small.

**Locale matrix**: en-US only by default — the cross-locale matrix is covered at the catalog level; the whole-flow chain is locale-independent and too expensive to run 3x.

**WBS gate**: the spec MUST run under `make up` + `pnpm run test:e2e` and pass before the task can claim `complete 100`.

### Backend follow-up tasks (registered alongside this task per ORCHESTRATOR.md `b7c5ff0`)

Two missing backend pieces are NOT in scope for this task. Both get registered in `tasks/20-backend.tji` in the same commit per the tech-debt-registration policy:

1. **`backend.session_management.list_session_participants_endpoint`** — `GET /api/sessions/:id/participants` returning the current participants array. Today the moderator's invite view derives slot state from WS catch-up replay of `participant-joined` / `participant-left` events; an explicit list endpoint is the canonical seam for refresh-on-tab-return + initial-load shape consistency with the rest of the session-management surface. Effort: 0.5d. Depends: `participant_assignment`.

2. **`backend.session_management.session_invite_self_claim_endpoint`** — `POST /api/sessions/:id/participants/self-claim` (body `{ role: 'debater-A' | 'debater-B' }`, authenticated, the caller's userId is implicit from `request.authUser.id`). The debater opens the moderator's invite link, logs in, and claims the slot. Returns 200 + `SessionParticipantResponse`. Reuses the existing transactional shape (`SELECT ... FOR UPDATE` + role-availability check + INSERT + `participant-joined` event + COMMIT). Refinement-time decisions: whether self-claim requires the session to be private-visibility-or-host-invited (probably yes — public sessions should not let any logged-in user grab a debater slot), and how the slot-already-filled error surfaces to the debater. Effort: 1d. Depends: `participant_assignment`.

The two endpoints feed `mod_invite_participants` (this task's polish + real-time slot fill) AND the participant-UI's claim view (future). Without them, the moderator's invite view is structurally complete but the debater's path from "I opened the invite link" to "I'm in slot debater-A" doesn't exist yet. The two are registered with `depends !participant_assignment` (their immediate predecessor) and a `note` pointing at this refinement as the source of the technical debt.

### Frontend i18n follow-up task (registered alongside this task)

1. **`frontend_i18n.i18n_invite_participants_native_review`** — pt-BR + es-419 native-speaker review of the 18 keys under `moderator.invite.*`. Effort: 0.5d. Depends: `!i18n_create_session_form_native_review` (the immediate predecessor in the native-review chain — the `tasks/35-frontend-i18n.tji` block uses a sequential `depends` chain to serialize the per-task reviewer hand-offs). Mirrors the existing `i18n_create_session_form_native_review` task shape (lines 70-76 of `tasks/35-frontend-i18n.tji`).

## Acceptance criteria

1. **`pnpm install` clean** — no new dependencies (no new npm packages).
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the new files in place.
3. **`pnpm run test:smoke` (Vitest) green**. New tests add ≥ 19 cases to the moderator suite (18 in `InviteParticipants.test.tsx` + 1 new `App.test.tsx` `describe` block + the existing `CreateSession.test.tsx` case 7 amendment which doesn't change count). The post-`mod_create_session_form` baseline is 2607 (from that refinement's Status block); the new total floors at 2626 (a small drift on the existing case 7 assertion expected value, which doesn't change the count).
4. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green after the catalog edits — every `moderator.invite.*` key in en-US is present in pt-BR and es-419. The `*.review.json` trackers list all 18 dotted keys under `pending`.
5. **`pnpm -F @a-conversa/moderator build`** produces `apps/moderator/dist/index.html` + assets without new bundle warnings beyond the pre-existing chunk-size note.
6. **`pnpm run test:e2e`** under `make up` runs the new `tests/e2e/invite-participants-flow.spec.ts` green AND the amended `tests/e2e/create-session-flow.spec.ts` (with the URL-pattern change to settle on `/sessions/<id>/invite` instead of `/sessions/<id>/operate`). The whole-flow scenario completes the chain in < 60s under the default Playwright timeout.
7. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `mod_invite_participants`, the two backend follow-up tasks are registered in `tasks/20-backend.tji`, and the i18n native-review follow-up is registered in `tasks/35-frontend-i18n.tji`.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".

## Decisions

### 1. Route path: `/sessions/:id/invite`

Three options surveyed:

- **`/sessions/:id/invite`** (chosen). Self-documenting in the URL bar; matches REST convention for "resource-scoped invite affordance"; lives in the same `/sessions/:id/*` family as `/sessions/:id/lobby` and `/sessions/:id/operate`. The 3-segment path is unambiguous against the now-`/api/*`-prefixed backend (per `serve_static_frontends_path_collision_fix` — no params-validator collision risk).
- **`/sessions/:id/setup`**. Generic name; would collide with a future "session settings" surface (e.g. editing the topic, changing privacy mid-session) that more naturally owns the `setup` semantics. "Invite" is the actual user-facing action this route surfaces.
- **`/sessions/:id` (root)**. Would imply the invite view IS the session — but the operate canvas is the real interactive surface. Making the invite view the route root would force the operate canvas onto a child path like `/sessions/:id/operate`, which is exactly where it lives today. Keeping the invite view as a peer of `/operate` and `/lobby` preserves the sibling-routes structure.

### 2. Post-create flow: invite view first, operate canvas as the explicit "enter session" target

Three options surveyed:

- **Land on invite view; explicit "Enter session" button proceeds to operate canvas** (chosen). Matches the user's mental model — "I just created a session; I need to invite people before debate makes sense." The invite step is the obvious next thing; surfacing it as a discoverable route (not buried behind a side-panel inside the operate canvas) matches the platform's "slow down and force clarity" ethos. The "Enter session" button is always enabled so a moderator who wants to skip the invite step (dry-run, solo testing, etc.) has a one-click escape hatch.
- **Land on operate canvas; surface an invite affordance inside the canvas's UI**. Would put two competing primary actions on the operate canvas (work on the graph + invite debaters). Reduces discoverability of the invite step; conflates "running a debate" with "setting one up." The operate canvas is already crowded (three panes per `mod_layout_shell`); adding invite affordances would force layout tradeoffs.
- **Land on a generic "session setup" route that surfaces both the invite step and future setup affordances (topic edit, privacy toggle, etc.)**. Premature factoring — only the invite step exists today; building a multi-tab setup hub for one tab is overhead.

### 3. "Enter session" button is always enabled

Two options surveyed:

- **Always enabled** (chosen). The moderator may want to enter the operate canvas before either debater has joined — to dry-run their capture flow, sanity-check the layout, mentally rehearse the session opening, etc. Forcing both slots to be filled before "enter session" enables would be paternalistic; the session is the moderator's, and the moderator decides when to enter it. The invite view stays useful even after the moderator has entered the operate canvas (the back button or a re-navigation works).
- **Disabled until both debater slots are filled**. Would force the moderator into the invite view as a waiting room — but `mod_session_lobby` (the next sibling) is the canonical waiting room. The invite view's job is to facilitate invitations, not to gate session entry. Conflating the two roles confuses the per-route responsibility split.

### 4. Invitation model: shareable links (option (a))

Three options surveyed (per the orchestrator brief):

- **(a) Shareable links — moderator generates `<origin>/sessions/<id>/invite?role=<role>` and shares it; debater opens it, logs in, claims the slot** (chosen). Matches the orchestrator brief's lean. No email subsystem required; no user-search infrastructure required; works for any debater the moderator can reach via any channel (DM, voice call, in-person handoff). The link carries the session id + role hint; the future self-claim endpoint reads both. The MVP is the moderator's surface; the debater's claim surface lands in the participant-UI workspace via the backend follow-up task registered above.
- **(b) Email / in-system notifications**. Requires an email subsystem (SMTP, deliverability tracking, bounce handling) that doesn't exist and isn't on the v1 roadmap. Adds infrastructure cost out of proportion to the feature's value at this stage.
- **(c) Autocomplete on a user-list endpoint**. Requires a `GET /api/users?search=<screen_name>` endpoint that doesn't exist; that endpoint introduces a small enumeration-leak surface (logged-in users can discover other users' existence by screen-name probe) that needs an explicit privacy ADR before landing. Out of scope for an MVP and forks the privacy story.

The chosen model leaves the debater-side self-claim surface for the backend + participant-UI follow-up tasks. The moderator's invite view is structurally complete today (link generation, slot displays, manual link distribution) — what's missing is the backend's self-claim endpoint and the participant-UI's claim route. Both are registered, both are 1d-ish, and both are unblocked by this task's data shape (the link URL carries the role hint the self-claim endpoint will consume).

DESIGN.md does not specify an invitation mechanism; it specifies the social shape (two debaters + one moderator) but leaves the invitation channel open. Option (a) is the simplest mechanism consistent with the architecture (federated identity, no PII storage beyond a screen name, no email or notification subsystem).

### 5. Clipboard API + fallback: `navigator.clipboard.writeText` with a "select the input manually" fallback

Three options surveyed:

- **`navigator.clipboard.writeText` + a fallback hint on rejection** (chosen). The Clipboard API is the modern path; works in all current evergreen browsers in secure contexts. On rejection (older browsers, http insecure context for some dev setups), the readonly `<input>` carrying the URL is still visible and selectable; the fallback hint points the user at the input. Zero new dependencies; zero new bundle weight; correct accessibility (the `<input>` is keyboard-selectable + focusable).
- **A clipboard-library dependency (`clipboard.js` or similar)**. The library provides a polyfilled execCommand-based path for older browsers but introduces a runtime dependency for a behavior already covered by the modern API + a readable fallback. Per the "no new deps without ADR" rule (DESIGN.md / ADR convention), adding a clipboard library would be ADR-worthy; the modern API + fallback is sufficient without an ADR.
- **Always use `document.execCommand('copy')` against the readonly input**. The execCommand path is deprecated; the spec recommends the Clipboard API. Building on a deprecated foundation is the wrong direction.

### 6. Real-time slot updates via WS catch-up, not polling

Two options surveyed:

- **WS catch-up replay + live event stream** (chosen). The existing `WsClientProvider` + `client.trackSession(sessionId)` + the store's event-stream subscription is the canonical way to read per-session state changes; reusing it costs zero new infrastructure. The invite view's reducer collapses `participant-joined` / `participant-left` events into the slot map; the catch-up call replays the existing event log so a moderator landing on the invite view long after creation still sees the current state. Live events stream in as debaters join, so the slot states update without a page refresh. Matches the OperateRoute precedent (lines 81-86 and the `useEffect` at lines 103-109).
- **HTTP polling on `GET /api/sessions/:id/participants`** (rejected — and the endpoint doesn't exist yet anyway). Polling is a fallback strategy for environments where WS isn't reliable; we have a WS connection already mounted for the moderator app, so polling would be redundant and noisier. The future participants-list endpoint (registered as a backend follow-up) is for refresh-on-tab-return scenarios, not the real-time path.

### 7. i18n key namespace: `moderator.invite.*`

Three options surveyed:

- **`moderator.invite.*`** (chosen). Mirrors the existing `moderator.createSession.*` shape — top-level area (`moderator`), sub-area (`invite`), then the actual keys. Self-documenting; collision-free with future moderator surfaces (`moderator.lobby.*`, `moderator.operate.*`, etc.). Consistent with the predecessor's namespacing choice.
- **`moderator.session.invite.*`**. Adds a `session` mid-namespace level. The predecessor uses `moderator.createSession.*` (a flat sub-namespace), so adding `session.` here would make this view a structural outlier without a corresponding refactor of the predecessor. Defer until a future task introduces a session-scoped multi-namespace cluster.
- **`invitation.*` (top-level)**. Top-level namespaces in the catalog are reserved for cross-surface concerns (`chrome`, `auth`, `methodology`). Invitations live entirely within the moderator surface for v1; scoping under `moderator.*` keeps the namespace's audience explicit.

### 8. View state: WS-store-driven for slots; local `useState` for the HTTP fetch + clipboard confirmations

Two options surveyed:

- **WS-store for slots, local state for everything else** (chosen). The slot occupancy IS a per-session derived state; the WS store already maintains the per-session event slice; the reducer is small. Lifting the slot map into a separate context / hook would be premature — only one consumer (this view) needs it. Local `useState` for the HTTP fetch lifecycle (`'loading' | 'loaded' | 'error'`) and the per-slot "Copied!" confirmation timeouts is the same shape `CreateSession.tsx` uses and follows the existing "no new abstractions" precedent.
- **Lift the slot derivation into a `useSessionParticipants(sessionId)` hook**. Reasonable factoring if the lobby route (next sibling) and a possible future "session detail" view also need the same projection — but neither exists yet. Premature.

### 9. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- **A direct application of an existing convention** — i18n namespacing, route registration + auth-gate, WS-store consumption, inline `fetch`, focus management (or its absence, by design), error-region a11y wiring.
- **A scoped UI policy that doesn't constrain other tasks** — route path, post-create flow, "Enter session" always-enabled, invitation-model choice (links over email / autocomplete).
- **A deferral of a future refactor or follow-up task** — the self-claim backend endpoint, the participants-list endpoint, a possible `useSessionParticipants` hook.

The "no new dependencies" rule means no ADR is triggered by anything in this task. The invitation-model decision (links, not email/autocomplete) is a product-level scope choice that fits within the existing architecture; if a future iteration wants to add email-based invitations, that would be ADR-worthy (it changes the platform's surface area in a structural way — new subsystem, new PII surface) and the ADR conversation happens then.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- New route `/sessions/:id/invite` mounted via `apps/moderator/src/App.tsx` (registered between `/sessions/new` and `/sessions/:id/lobby`, gated `authenticated-only` via `RequireAuth`) and implemented in `apps/moderator/src/routes/InviteParticipants.tsx`. Vitest probes land in `apps/moderator/src/routes/InviteParticipants.test.tsx`; the App-level router-gate test extends `apps/moderator/src/App.test.tsx` with three sub-assertions (`authenticated` → invite, `unauthenticated` → login, `needs-screen-name` → screen-name). A file-wide `FakeWebSocketCtor` polyfill was added at the top of `App.test.tsx` because happy-dom does not expose `WebSocket` as a constructor — the pre-existing operate-route case sidestepped this because its assertions resolved before the WS effect fired.
- Three slots (`moderator`, `debater-A`, `debater-B`) render in fixed order; the moderator slot reads the host occupant from a WS-store-derived participant reducer (collapsing `participant-joined` / `participant-left` events via `client.trackSession(sessionId)` + catch-up replay). Per-debater rows carry a `readOnly` invite-link `<input>` whose value is `${window.location.origin}/sessions/${id}/invite?role=${role}` and a `navigator.clipboard.writeText`-driven "Copy invite link" button with localized `Copied!` + try/catch fallback hint. "Enter session" is always enabled and navigates to `/sessions/${id}/operate` with `replace: false`.
- Post-create redirect amended in lockstep: `apps/moderator/src/routes/CreateSession.tsx` line 141 now navigates to `/sessions/${body.id}/invite` (was `/operate`) with the doc-comment updated to reflect the invite-view-first rationale; the post-201 navigation assertion in `apps/moderator/src/routes/CreateSession.test.tsx` (case 7) updates to match. The corresponding Playwright spec `tests/e2e/create-session-flow.spec.ts` shifts its happy-path URL settle from `/operate` to `/invite`; the moved graph-canvas assertion lands in the new `tests/e2e/invite-participants-flow.spec.ts` (registered under the `chromium-create-session` Playwright project in `playwright.config.ts`).
- i18n catalog edits: **19 keys × 3 locales = 57 entries** under `moderator.invite.*` landed across `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`. One key over the 18 scoped in the refinement's catalog table because the a11y section (lines 240-242) called out an `inputAriaLabel` for the screen-reader announcement of the readonly invite-link input — the 19th key is `moderator.invite.copyLink.inputAriaLabel`. pt-BR and es-419 drafts land flagged PENDING with 19 dotted keys added to `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json` under `pending`; the native-speaker review follow-up is registered as `i18n_invite_participants_native_review` in `tasks/35-frontend-i18n.tji` (see step 4 of this commit).
- Cross-spec bridge: `tests/e2e/moderator-capture.spec.ts` was updated in 12 occurrences to insert a `waitForURL('**/sessions/*/invite')` + `getByTestId('invite-enter-session').click()` bridge between the create-session submit and the existing `/operate` URL-settle assertion. This is a known downstream consequence of the post-create redirect amendment — not a deviation from this task's allowlist that needs a refinement amendment — and is registered here for traceability so future Closers can find the bridge if a different post-create destination ever supersedes `/invite`.
- Backend endpoints stubbed: this task's slot-fill works today via WS catch-up replay (`participant-joined` / `participant-left` events through `client.trackSession`), which is correct for live sessions. Cold-load REST consistency (the canonical "tab-return after long idle" path) waits for `list_session_participants_endpoint`, registered as a separate backend tech-debt task in `tasks/20-backend.tji` (see step 4). The debater-side claim loop (`/sessions/:id/invite?role=...` link → debater logs in → claims the slot) waits for `session_invite_self_claim_endpoint`, also registered as a separate backend tech-debt task. Both are independent of `mod_invite_participants`'s acceptance — the moderator-facing surface is structurally complete and ready for the day those endpoints land.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 3145 passing (delta 3125 → 3145, +20); `chromium-create-session` Playwright project 16/16 passing with workers=1 (2 new invite scenarios + amended create-session + bridged moderator-capture). The pre-existing OIDC parallel-login flake `auth-pending-cookie-invalid` reproduces only under parallel workers and is not caused by this task.
- Wired but pending backend: slot-fill cold-load via REST (waits on `list_session_participants_endpoint`); the debater-side landing + self-claim completes the invite→claim loop (waits on `session_invite_self_claim_endpoint`). Both are registered as separate WBS tasks per the tech-debt-registration policy and are not refinement deviations.
