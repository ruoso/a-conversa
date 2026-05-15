# Create-session form (topic, privacy) — moderator entry point to a new debate

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_session_setup.mod_create_session_form`
**Effort estimate**: 1d
**Inherited dependencies**:

- `moderator_ui.mod_shell.mod_app_skeleton` — settled (router, i18n bootstrap, `BrowserRouter` mount in `main.tsx`).
- `moderator_ui.mod_shell.mod_auth_flow` — settled (`useAuth()`, login button, screen-name form scaffolding, the `auth.*` i18n namespace under `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`).
- `moderator_ui.mod_shell.mod_screen_name_setup` — settled (a11y patterns this task mirrors: `aria-invalid` / `aria-describedby` / `aria-live="polite"` + `role="alert"`, ref-driven focus management, ICU-interpolated helper text, client-side validation mirror of the backend).
- `moderator_ui.mod_shell.mod_route_auth_gate` — settled (`<RequireAuth mode="authenticated-only">` wrapper; this task wraps the new route the same way).
- `backend.session_management.create_session_endpoint` — settled. `POST /sessions` accepts `{ topic: string (1..256), privacy?: 'public'|'private' }`, returns 201 with `{ id, hostUserId, privacy, topic, createdAt, endedAt }`. Authenticated via the platform session cookie (`preHandler: app.authenticate`). Validation failures land as 400 `validation-failed`; missing auth as 401 `auth-required`.
- `backend.backend_tests.be_e2e_tests.auth_flow_integration` — settled (the WBS Playwright gate). The new Playwright spec runs under the same compose stack and reuses `tests/e2e/fixtures/auth.ts`'s `loginAs(page, { username: 'alice' })`.

## What this task is

The form-and-submit flow that turns the moderator console from "authenticate" into "actually run a debate." After this lands, a logged-in moderator can:

1. `make up`.
2. Log in at `http://localhost:3000/login` as `alice` / `aconversa-dev` (any of the six seeded dev users from ADR 0017).
3. Land on `/sessions/new` (a new route added in this task).
4. Fill in a debate topic, pick public / private, submit.
5. Land on `/sessions/<id>/operate` with the existing graph canvas mounted.

The deliverable is **one new route** (`/sessions/new`, gated `authenticated-only` via `RequireAuth`), **one new component** (`apps/moderator/src/routes/CreateSession.tsx`), the corresponding **Vitest cases** in `apps/moderator/src/App.test.tsx` (or a sibling `CreateSession.test.tsx`), the **i18n keys** under `moderator.createSession.*`, and **one new Playwright spec** (`tests/e2e/create-session-flow.spec.ts`) that drives the whole flow (login → form → POST → navigation → canvas mount).

Out of scope: invite-participants (`mod_invite_participants` — next sibling), lobby (`mod_session_lobby`), session lookup / listing UI (no "open existing session" surface in this task).

## Why it needs to be done

The moderator console today is half-built from the user's perspective. Auth works, the screen-name form works, the graph canvas renders, the WS client connects — but there's no way to **start a session from the browser**. `POST /sessions` is API-only; getting a session id requires `curl -b cookies.txt -X POST /sessions -d '{"topic":"..."}'`. This task closes that gap.

It's also a direct M4 (`m_moderator_mvp`) dependency. The TaskJuggler graph has six subgroups under M4 — `mod_shell` (done), `mod_session_setup` (in flight, this task is the first sibling), `mod_capture_flow`, `mod_decompose_flow`, `mod_diagnostic_flow`, `mod_pending_proposals_pane`. The session-setup subgroup blocks every downstream subgroup that operates on a session row, because there is no other origin for that row.

Three downstream consumers wait on this:

- **`mod_invite_participants`** (next sibling) — needs a created session id to address its participant-assignment POSTs to `POST /sessions/:id/participants`.
- **`mod_session_lobby`** — renders the pre-debate waiting room for `/sessions/:id/lobby`; the session has to exist first.
- **The user, manually**. Per the orchestrator brief: the user wants this UI to test sessions in the browser end-to-end. The Playwright whole-flow spec scoped under Acceptance criteria is the regression-class proof that the whole moderator stack (auth → form → POST → navigation → canvas mount) holds; it's the most valuable e2e in the moderator stream so far.

## Inputs / context

### Server endpoint contract (frozen)

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) (the predecessor `backend.session_management.create_session_endpoint` deliverable):

- **Request body schema** at `createSessionBodySchema` (lines 609–628):

  ```json
  {
    "type": "object",
    "required": ["topic"],
    "additionalProperties": false,
    "properties": {
      "topic": { "type": "string", "minLength": 1, "maxLength": 256 },
      "privacy": { "type": "string", "enum": ["public", "private"] }
    }
  }
  ```

  `topic` required, **1..256 characters** (1 rejects empty; 256 is the API-layer cap). `privacy` optional; server-side default `'public'` (handler reads `body.privacy ?? 'public'` at line ~1178).

- **Response 201 body** at `sessionResponseSchema` (lines 300–340):

  ```ts
  {
    id: string;          // uuid (server-generated)
    hostUserId: string;  // uuid (from request.authUser.id)
    privacy: 'public' | 'private';
    topic: string;
    createdAt: string;   // ISO-8601
    endedAt: null;       // always null on creation
  }
  ```

  All fields camelCase. The client navigates to `/sessions/${response.id}/operate` on success.

- **Error codes**: 400 `validation-failed` (Fastify body-schema rejection — empty topic, > 256 topic, invalid privacy enum, extra properties), 401 `auth-required` (missing/invalid session cookie). Envelope shape (from `apps/server/src/errors.ts`): `{ error: { code, message, issues? } }`.

### Existing routing + auth gate

From [`apps/moderator/src/App.tsx`](../../../apps/moderator/src/App.tsx):

- Five routes today: `/login`, `/screen-name` (`needs-screen-name-only`), `/sessions/:id/lobby` (`authenticated-only`), `/sessions/:id/operate` (`authenticated-only`), wildcard → `/login`.
- This task adds `/sessions/new` between `/screen-name` and `/sessions/:id/lobby`, wrapped in `<RequireAuth mode="authenticated-only">`. The wrapper's contract per `mod_route_auth_gate.md`: redirects `'unauthenticated'` → `/login`, `'needs-screen-name'` → `/screen-name`, renders the placeholder DOM (`route-login` testid + `auth.login.title`/`auth.login.checking`) on `'loading'`, renders `children` only on `'authenticated'`.

### Precedent for the form component

The form's shape mirrors [`apps/moderator/src/routes/ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) (lines 181–335) deliberately — same patterns for client-side validation, server-error-code mapping, a11y wiring, focus management. The precedent is fresh (shipped 2026-05-15 per `mod_screen_name_setup`'s Status block) and the orchestrator brief calls it the template for future moderator forms.

Specific reuses:

- `useState<string>('')` for the field value; `useState<boolean>(false)` for `submitting`; `useState<string | undefined>(undefined)` for `errorKey`.
- A `useRef<HTMLInputElement | null>(null)` + one-shot `useEffect` to focus the topic input on mount (per `mod_screen_name_setup` Decisions — React `autoFocus` has StrictMode double-mount issues).
- `useNavigate()` from `react-router-dom` for the post-submit redirect.
- `aria-invalid={errorKey !== undefined}` + `aria-describedby="create-session-helper create-session-error"`.
- Error region: `<p ... role="alert" aria-live="polite" aria-atomic="true">{t(errorKey)}</p>`, conditionally rendered.
- Helper text: `<p id="create-session-helper" data-testid="create-session-helper">{t('moderator.createSession.helper', { used, max })}</p>`, ICU-interpolated.
- Submit-disabled rule: `submitting || value.trim().length === 0` (other rejects surface as inline errors when the user actually submits — same UX choice the screen-name form made).

### HTTP client seam

The moderator app has no dedicated `apps/moderator/src/api/` directory today. Existing seams:

- `apps/moderator/src/auth/useAuth.ts:122-181` — the `refresh()` call: `fetch('/auth/me', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } })`.
- `apps/moderator/src/routes/ScreenName.tsx:220-232` — the screen-name submit: `fetch('/auth/screen-name', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ screenName: result.value }) })`.

Both call `fetch` directly with inline options. No `apiClient` abstraction has emerged yet. This task continues the pattern — the form's submit handler calls `fetch('/sessions', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ topic, privacy }) })` inline. If/when a third `fetch` call site lands a third copy of the same headers/credentials boilerplate, extracting a tiny helper (`apps/moderator/src/api/postJson.ts`) becomes the natural next refinement — but two call sites isn't enough surface to justify the abstraction yet.

### WS client connect timing

From [`apps/moderator/src/ws/WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx) (lines 57–84): the provider runs `client.connect()` on mount when `auth.status === 'authenticated'`. It is NOT scoped per-session — the WS client connects once for the moderator app and the per-session subscription happens later (handled by the graph canvas's downstream consumers via `useWsClient()`).

Implication for this task: nothing. The form does NOT need to trigger a WS connection; navigating to `/sessions/<id>/operate` after submit mounts `<GraphCanvasPane sessionId={id}>` which handles its own subscription via the existing wiring. The form is pure HTTP POST + React Router `useNavigate`.

### i18n catalog precedent

From [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the existing structure:

```jsonc
{
  "chrome": { "hello": "hello, world" },
  "auth": {
    "login": { "title": ..., "button": ..., "checking": ..., "welcome": ..., "logout": ... },
    "screenName": { "title": ..., "label": ..., "submit": ..., "helper": ..., "errors": { ... } }
  },
  "methodology": { ... },
  ...
}
```

This task adds a new top-level namespace `moderator` with one child namespace `createSession`. New keys (see Constraints / requirements below). The parity-check script (`pnpm --filter @a-conversa/i18n-catalogs run check`) enforces that every en-US key has pt-BR and es-419 counterparts; the catalog edits MUST land all three locales together.

### Playwright e2e seed

From [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts):

- `loginAs(page, { username: 'alice' })` — drives the full OIDC handshake against compose-stack Authelia. Handles both the new-user branch (POSTs `/auth/screen-name` directly via the cookie-jar-bearing request context) and the returning-user branch (cookie set by the callback's 302). Returns `{ userId, screenName }`.
- The helper leaves the browser on `/login` with `aconversa-session` set as an HttpOnly cookie. The next `page.goto('/sessions/new')` inherits the session via the same cookie jar.

From [`tests/e2e/auth-flow.spec.ts`](../../../tests/e2e/auth-flow.spec.ts) (lines 56–100): the `loginAs` + `expect(me.screenName).toBe('alice')` template.

From [`apps/moderator/src/graph/GraphCanvasPane.tsx:782`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx): the post-navigation assertion target — `<div data-testid="graph-canvas-root" className="h-full w-full">`. After the form submit, the spec asserts `page.getByTestId('graph-canvas-root').toBeVisible()`.

### ADR pin

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of the new behavior is a committed test. The Vitest cases + the Playwright whole-flow spec ARE the probes. No throwaway `console.log` debugging; no manual smoke that doesn't land as a committed regression.

## Constraints / requirements

### Route + wiring

- **Route path**: `/sessions/new`. Justified under Decisions below. Wrapped with `<RequireAuth mode="authenticated-only">`.
- **`App.tsx` edits**: add one `<Route>` between the existing `/screen-name` route and the existing `/sessions/:id/lobby` route. Update the header-comment route listing to include `/sessions/new`. Leave the wildcard route untouched.

### Form component (`apps/moderator/src/routes/CreateSession.tsx`)

- **Exports**: `function CreateSessionRoute(): ReactElement` — named export, no default.
- **Root DOM**: `<main data-testid="route-create-session">`.
- **Heading**: `<h1 data-testid="route-title">{t('moderator.createSession.title')}</h1>` — reusing `route-title` for consistency with every other moderator route (Login, ScreenName, Lobby, Operate all carry the same testid on their h1; the e2e smoke specs key off it).
- **Form**: `<form data-testid="create-session-form" onSubmit={...}>` — calls `event.preventDefault()` then `void submit()`.

#### Topic field

- `<label htmlFor="create-session-topic" data-testid="create-session-topic-label">{t('moderator.createSession.topic.label')}</label>`
- `<input id="create-session-topic" data-testid="create-session-topic-input" type="text" value={topic} maxLength={256} autoComplete="off" inputMode="text" aria-invalid={topicHasError} aria-describedby="create-session-helper create-session-error" ref={topicRef} onChange={...}>`
- The `maxLength={256}` matches the backend cap exactly (NOT 257, NOT 255). This is a hard ceiling at the input boundary; the user physically cannot type more than 256 chars.
- A placeholder via `placeholder={t('moderator.createSession.topic.placeholder')}` for UX. The placeholder is NOT load-bearing — the label is the accessible name; the placeholder is hint text.

#### Privacy field

- A fieldset with a legend (the accessible group name) and two radio inputs:

  ```tsx
  <fieldset data-testid="create-session-privacy-fieldset">
    <legend data-testid="create-session-privacy-legend">{t('moderator.createSession.privacy.label')}</legend>
    <label>
      <input type="radio" name="privacy" value="public" data-testid="create-session-privacy-public" checked={privacy === 'public'} onChange={() => setPrivacy('public')} />
      <span data-testid="create-session-privacy-public-label">{t('moderator.createSession.privacy.public')}</span>
    </label>
    <label>
      <input type="radio" name="privacy" value="private" data-testid="create-session-privacy-private" checked={privacy === 'private'} onChange={() => setPrivacy('private')} />
      <span data-testid="create-session-privacy-private-label">{t('moderator.createSession.privacy.private')}</span>
    </label>
  </fieldset>
  ```

- Default state: `privacy = 'public'`. Justified under Decisions below.
- Radios share `name="privacy"` so keyboard navigation between them follows the native arrow-key behavior; the implicit `tab`-focus-on-fieldset-then-arrow-between-radios contract is what screen readers expect.

#### Helper text

- `<p id="create-session-helper" data-testid="create-session-helper">{t('moderator.createSession.helper', { used: topic.trim().length, max: 256 })}</p>` — always rendered, ICU-interpolated (mirrors the screen-name helper).

#### Error region

- `<p id="create-session-error" data-testid="create-session-error" role="alert" aria-live="polite" aria-atomic="true">{t(errorKey)}</p>` — conditionally rendered only when `errorKey !== undefined`. Same shape as the screen-name error region.

#### Submit button

- `<button type="submit" data-testid="create-session-submit" disabled={submitting || topic.trim().length === 0}>{t('moderator.createSession.submit')}</button>` — disabled rule matches the screen-name form (empty-after-trim OR in-flight).

### Client-side validation

The client mirrors the backend's body-schema validation:

- **`topic` empty after trim** → set `errorKey = 'moderator.createSession.errors.topicRequired'`. Do NOT POST.
- **`topic` length > 256 after trim** → set `errorKey = 'moderator.createSession.errors.topicTooLong'`. Do NOT POST. (Unreachable from typing thanks to `maxLength={256}` on the input, but reachable from paste — `maxLength` truncates on paste in some browsers and not in others, so the check is defensive.)
- **`privacy` not in `['public', 'private']`** — not reachable from the UI (only the two radios exist), but the submit handler asserts the discriminator anyway so a future refactor that introduces a third value gets caught here. If somehow violated, `errorKey = 'moderator.createSession.errors.privacyInvalid'`.

### POST behavior

```ts
async function submit(): Promise<void> {
  setErrorKey(undefined);
  const trimmedTopic = topic.trim();
  if (trimmedTopic.length === 0) {
    setErrorKey('moderator.createSession.errors.topicRequired');
    return;
  }
  if (trimmedTopic.length > 256) {
    setErrorKey('moderator.createSession.errors.topicTooLong');
    return;
  }
  setSubmitting(true);
  try {
    const response = await fetch('/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ topic: trimmedTopic, privacy }),
    });
    if (response.status === 201) {
      const body = (await response.json()) as { id: string };
      // SessionResponse#id is the server-generated UUID; narrow at the boundary.
      if (typeof body.id !== 'string' || body.id.length === 0) {
        setErrorKey('moderator.createSession.errors.generic');
        topicRef.current?.focus();
        return;
      }
      void navigate(`/sessions/${body.id}/operate`, { replace: false });
      return;
    }
    // Non-201. Read the envelope's error.code if present, map to i18n key.
    let code = 'unknown';
    try {
      const errBody: unknown = await response.json();
      if (errBody !== null && typeof errBody === 'object' && 'error' in errBody) {
        const err = (errBody as { error: unknown }).error;
        if (err !== null && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string') {
          code = (err as { code: string }).code;
        }
      }
    } catch {
      // Body wasn't JSON. Fall through to generic.
    }
    setErrorKey(errorCodeToI18nKey(code, response.status));
    topicRef.current?.focus();
  } catch {
    setErrorKey('moderator.createSession.errors.network');
    topicRef.current?.focus();
  } finally {
    setSubmitting(false);
  }
}
```

The error-code mapping table:

| Server `error.code` (or status) | i18n key |
| --- | --- |
| `validation-failed` (400) | `moderator.createSession.errors.validation` |
| `auth-required` (401) | `moderator.createSession.errors.unauthenticated` |
| any other code | `moderator.createSession.errors.generic` |
| `fetch` threw (network) | `moderator.createSession.errors.network` |

**Why `replace: false` on the navigate.** The `/sessions/new` route is a deliberate user destination — the user typed it (or clicked an entry-point button) to get there. After creating a session and landing on `/sessions/<id>/operate`, the back button should take them back to `/sessions/new` (a "create another" affordance) rather than skipping over it. `replace: true` would erase the history entry and skip past the form on back-navigate, which is the wrong UX for a form-then-result flow. (The `mod_auth_flow` screen-name form uses `replace: true` because the screen-name route should NOT be reachable post-submit — it's a one-time first-login surface.)

### Focus management

- **On mount**: focus the topic input (`useRef` + one-shot `useEffect`, per the `mod_screen_name_setup` pattern).
- **After a server-side error**: re-focus the topic input. A screen-reader user hears the `aria-live` announcement and lands ready to retry.
- **NOT re-focus on a client-side reject**: the user just pressed submit from the input; focus is still on the form somewhere; re-focusing on a client-side reject would be a no-op or worse (could yank focus from the submit button mid-click). Same rationale as the screen-name form.

### i18n catalog keys

New keys under `moderator.createSession.*`. **All three catalogs** (`en-US.json`, `pt-BR.json`, `es-419.json`) get the same key set; the parity-check script enforces this.

| Key | en-US | pt-BR | es-419 |
| --- | --- | --- | --- |
| `moderator.createSession.title` | "Create a session" | "Criar uma sessão" | "Crear una sesión" |
| `moderator.createSession.topic.label` | "Debate topic" | "Tópico do debate" | "Tema del debate" |
| `moderator.createSession.topic.placeholder` | "What will be debated?" | "O que será debatido?" | "¿Qué se debatirá?" |
| `moderator.createSession.privacy.label` | "Privacy" | "Privacidade" | "Privacidad" |
| `moderator.createSession.privacy.public` | "Public — allow cross-session reference" | "Pública — permite referência entre sessões" | "Pública — permite referencias entre sesiones" |
| `moderator.createSession.privacy.private` | "Private — restrict to invited participants" | "Privada — restrita aos participantes convidados" | "Privada — restringida a participantes invitados" |
| `moderator.createSession.helper` | "{used}/{max} characters" | "{used}/{max} caracteres" | "{used}/{max} caracteres" |
| `moderator.createSession.submit` | "Create session" | "Criar sessão" | "Crear sesión" |
| `moderator.createSession.errors.topicRequired` | "Please enter a debate topic." | "Por favor, informe um tópico de debate." | "Por favor, ingresa un tema de debate." |
| `moderator.createSession.errors.topicTooLong` | "Debate topic must be at most 256 characters." | "O tópico do debate deve ter no máximo 256 caracteres." | "El tema del debate debe tener como máximo 256 caracteres." |
| `moderator.createSession.errors.privacyInvalid` | "Please choose either public or private." | "Escolha pública ou privada." | "Elige pública o privada." |
| `moderator.createSession.errors.validation` | "The session could not be created. Please check your input." | "Não foi possível criar a sessão. Verifique os dados." | "No se pudo crear la sesión. Revisa los datos." |
| `moderator.createSession.errors.unauthenticated` | "Your session expired. Please sign in again." | "Sua sessão expirou. Entre novamente." | "Tu sesión expiró. Vuelve a iniciar sesión." |
| `moderator.createSession.errors.network` | "Could not reach the server. Please try again." | "Não foi possível alcançar o servidor. Tente novamente." | "No se pudo conectar con el servidor. Inténtalo de nuevo." |
| `moderator.createSession.errors.generic` | "Something went wrong. Please try again." | "Algo deu errado. Tente novamente." | "Algo salió mal. Inténtalo de nuevo." |

**Count: 15 keys × 3 locales = 45 catalog entries**.

### Files this task touches (the explicit allowlist)

- `apps/moderator/src/routes/CreateSession.tsx` (new).
- `apps/moderator/src/routes/CreateSession.test.tsx` (new — Vitest cases; sibling layout per the `mod_route_auth_gate` precedent that split the suite to keep `App.test.tsx` from growing unboundedly).
- `apps/moderator/src/App.tsx` (modified — add the `/sessions/new` route + header-comment update).
- `apps/moderator/src/App.test.tsx` (modified — one `'/sessions/new'` router case asserting the route mounts the form behind `<RequireAuth mode="authenticated-only">`; mirrors the existing lobby + operate router cases).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add `moderator.createSession.*` namespace).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `tests/e2e/create-session-flow.spec.ts` (new — Playwright whole-flow spec).

### Files this task does NOT touch

- `.tji` files — the WBS file is not edited here; `complete 100` lands at task-completion time, not at refinement-write time.
- `docs/adr/` — no new ADR is needed (see "no new dependencies" below).
- `apps/server/src/sessions/routes.ts` — the endpoint is frozen; no server-side change is required to make this work end-to-end.
- Any existing route component (`Login.tsx`, `ScreenName.tsx`, `Lobby.tsx`, `Operate.tsx`) — the form is a new route, not a modification of an existing one.

### a11y requirements (the testable list)

- Topic input has a programmatic label (`<label htmlFor="create-session-topic">`); `aria-invalid` flips to `true` when an error is set; `aria-describedby` points at both the helper and the error region.
- Privacy radios live inside a `<fieldset>` with a `<legend>` — the legend is the group's accessible name.
- Error region has `role="alert"` AND `aria-live="polite"` AND `aria-atomic="true"`. The two `aria-live` mechanisms coexist (some screen readers honor `role`, some honor `aria-live`; both costs nothing).
- Submit button has a readable name from its `t('moderator.createSession.submit')` text content; it's a `<button type="submit">` so Enter inside the form triggers submit per native HTML semantics.
- Focus lands on the topic input on mount; returns to the topic input after a server error.
- No keyboard trap: the user can Tab from topic → public radio → private radio → submit. Shift-Tab works in reverse.

### Test layers per ADR 0022

#### Vitest (in `apps/moderator/src/routes/CreateSession.test.tsx`)

Minimum case set:

1. **Renders the form** — title, topic input, privacy fieldset with two radios (public is the initial checked state), helper text reads `"0/256 characters"`, submit button is initially disabled (empty topic).
2. **Submit enables on non-empty topic** — typing into the topic input enables the submit button; clearing it disables again.
3. **Submit disabled while submitting** — a `fetch` stub that returns a pending promise leaves the button disabled and `aria-busy`-ish; the test asserts `disabled={true}` on the submit during the in-flight frame.
4. **Helper text counts trimmed length** — `"  hello  "` → helper reads `"5/256 characters"`.
5. **Client-side reject: empty topic on submit** — the topic-required error renders; no POST happens (the `fetch` stub assert).
6. **Client-side reject: too-long topic on submit** — type 257 chars (bypassing `maxLength` by setting state directly in the test); the too-long error renders; no POST happens.
7. **Successful POST: 201 → navigate** — `fetch` stub returns `201` with `{ id: 'session-uuid-xyz' }`; assert `useNavigate` was called with `/sessions/session-uuid-xyz/operate` and `{ replace: false }`.
8. **Server error: 400 validation-failed → localized error** — `fetch` stub returns `400 { error: { code: 'validation-failed', ... } }`; assert the validation error key is rendered.
9. **Server error: 401 auth-required → localized error** — `fetch` stub returns `401 { error: { code: 'auth-required', ... } }`; assert the unauthenticated error key.
10. **Server error: unknown code → generic** — `fetch` stub returns `500 { error: { code: 'internal-error', ... } }`; assert the generic error key.
11. **Network error: fetch rejects → network error key** — `fetch` stub throws; assert the network error key.
12. **a11y: aria-invalid wired** — without an error, `aria-invalid="false"` on the topic input; with an error, `aria-invalid="true"`.
13. **a11y: aria-describedby wired** — `aria-describedby` includes both `create-session-helper` and `create-session-error`.
14. **a11y: focus on mount** — the topic input has focus after the component mounts.
15. **a11y: focus returns after server error** — fire a submit, the stub returns 400, assert focus is back on the topic input (call `expect(topicInput).toHaveFocus()`).
16. **Privacy toggle: clicking the private radio updates state and the POSTed body** — set up a `fetch` stub that captures the body; click public → private; submit; assert the body has `privacy: 'private'`.
17. **i18n: every key resolves in en-US** — render with en-US, walk every `data-testid="..."` element, assert no `[t-missing]` or raw key string is visible. (The catalog parity-check covers pt-BR / es-419 at the package level.)

Minimum **17 cases** in the new file. Adjust upward as needed during implementation; lower bound is "every requirement bullet has a probe."

#### Vitest (in `apps/moderator/src/App.test.tsx` — extension)

One new case:

18. **Route mounts behind `RequireAuth`** — `MemoryRouter initialEntries={['/sessions/new']}` + a `/auth/me` stub returning `'authenticated'` → assert `route-create-session` testid rendered. Same stub returning `'unauthenticated'` → assert `route-login` testid rendered (the wrapper redirected). Same stub returning `'needs-screen-name'` → assert `route-screen-name` testid rendered.

Three sub-assertions in one `describe` block, mirroring the existing lobby + operate router-gate cases.

#### Playwright (the whole-flow spec — `tests/e2e/create-session-flow.spec.ts`)

This is **the** load-bearing test for this task. Per ORCHESTRATOR.md `28a71f9`, the UI stream is gated on Playwright passing in compose; the scoped spec is the regression-class proof of the auth + form + POST + navigation + canvas-mount chain.

```ts
// Pseudocode for the spec — concrete code lands at implementation time.

import { expect, test } from '@playwright/test';
import { loginAs } from './fixtures/auth';

test.describe('Create-session flow — moderator creates a session and lands on the operate canvas', () => {
  test('alice logs in, navigates to /sessions/new, submits topic + privacy, lands on /sessions/<id>/operate with the canvas mounted', async ({ page }) => {
    // 1. Login.
    await loginAs(page, { username: 'alice' });

    // 2. Navigate to the form route.
    await page.goto('/sessions/new');
    await expect(page.getByTestId('route-create-session')).toBeVisible();
    await expect(page.getByTestId('route-title')).toHaveText(/Create a session/);

    // 3. Fill in a topic.
    const topic = 'Should universal basic income replace existing welfare programs?';
    await page.getByTestId('create-session-topic-input').fill(topic);

    // 4. Select private (exercising the non-default path).
    await page.getByTestId('create-session-privacy-private').click();
    await expect(page.getByTestId('create-session-privacy-private')).toBeChecked();

    // 5. Submit.
    await page.getByTestId('create-session-submit').click();

    // 6. Assert navigation to /sessions/<id>/operate. The id is a UUID
    //    we don't know in advance; match the URL pattern.
    await page.waitForURL(/\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 10_000 });

    // 7. Assert the operate route mounted with the graph canvas.
    await expect(page.getByTestId('route-operate')).toBeVisible();
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible();
  });

  test('client-side validation: empty topic surfaces inline error without POSTing', async ({ page }) => {
    await loginAs(page, { username: 'alice' });
    await page.goto('/sessions/new');

    // Submit with empty topic. The submit button is disabled when empty,
    // so we focus + press Enter to bypass the disabled-button path; OR
    // we type a single space + submit (whitespace-only path).
    await page.getByTestId('create-session-topic-input').fill('   ');
    // The button stays disabled because trimmed-length is zero, so this
    // exercises the button-disabled invariant directly.
    await expect(page.getByTestId('create-session-submit')).toBeDisabled();
  });
});
```

**Scope**: 2 scenarios (happy path + a button-disabled-on-empty invariant). The happy-path scenario IS the whole-flow proof and the regression-class safety net the orchestrator brief calls out.

**Locale matrix**: this spec runs in en-US only by default. The locale-parameterized smoke (per `i18n_testing.md`) covers the title / button text in pt-BR + es-419 at the catalog level; the whole-flow spec is too expensive to run 3x and the regression class it protects (auth + form + POST + navigation + canvas-mount) is locale-independent.

**WBS gate**: the spec MUST run under `make up` + `pnpm run test:e2e` and pass before the task can claim `complete 100`. This is the ORCHESTRATOR.md `28a71f9` invariant for UI streams.

## Acceptance criteria

1. **`pnpm install` clean** — no new dependencies (this task introduces no new npm packages; see "no new deps" below).
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the new files in place.
3. **`pnpm run test:smoke` (Vitest) green**. New tests add ≥ 18 cases to the moderator suite (17 in `CreateSession.test.tsx` + 1 in `App.test.tsx`). Use the post-`mod_route_auth_gate` baseline (2380) — the new total floors at 2398.
4. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (the parity-check) green after the catalog edits — every `moderator.createSession.*` key present in en-US is present in pt-BR and es-419.
5. **`pnpm -F @a-conversa/moderator build`** produces `apps/moderator/dist/index.html` + assets without new bundle warnings beyond the pre-existing chunk-size note.
6. **`pnpm run test:e2e`** under `make up` runs the new `tests/e2e/create-session-flow.spec.ts` green. The happy-path scenario completes the whole auth → form → POST → navigation → canvas-mount chain in < 60s under the default Playwright timeout. The button-disabled-on-empty scenario completes in < 10s.
7. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `mod_create_session_form`.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".

## Decisions

### 1. Route path: `/sessions/new`

Three options surveyed:

- **`/sessions/new`** (chosen). The path explicitly conveys "I am about to create a new session." Self-documenting in the URL bar; matches REST convention for "new-resource-form" routes; leaves room for sibling routes like `/sessions/:id/edit` (none planned) or `/sessions` (a future listing UI per `backend.session_management.list_sessions_endpoint`).
- **`/` (the root)**. Loses self-documentation — the user lands here and has to figure out what the page is. Also collides with a future "dashboard" surface that almost certainly grows: a list of open sessions, recent debates, quick actions. The dashboard's home is `/`; the create-form's home should not be.
- **`/dashboard`** or **`/home`**. Same "what is this page?" problem as `/`, plus an arbitrary name choice the codebase doesn't otherwise use. The "create" affordance is one of several things a dashboard would surface, not the dashboard itself.

The `App.tsx` wildcard route stays `<Navigate to="/login" replace />` — an unauthed user typing `/sessions/new` hits the `<RequireAuth>` wrapper, which redirects them to `/login` (the canonical entry point); after login, they re-navigate to `/sessions/new` manually. A future "redirect-to-original-destination" affordance is out of scope (deferred to whatever task lifts the URL-preservation pattern into `RequireAuth`).

### 2. Default privacy: `'public'`

Three options surveyed:

- **`'public'`** (chosen). Matches the server-side default (`body.privacy ?? 'public'` in `apps/server/src/sessions/routes.ts:1178`) AND the DB column default (`privacy TEXT NOT NULL DEFAULT 'public'` in `migrations/0002_sessions.sql`). Matches the platform's stated architecture per `tasks/refinements/backend/create_session_endpoint.md` Decisions: "public by default; the host may mark a session private." Consistency end-to-end — the moderator sees the same default the backend would apply if they omitted the field.
- **`'private'`**. Would make every session private unless explicitly opened. Inconsistent with the backend default; would confuse moderators who skim the form, accept the defaults, and expect "what the backend would do without me." Also wrong-defaults-wrong-direction for the platform's "public by default" stance.
- **Required (no default; user must choose before submit)**. Forces every moderator to think about privacy on every session creation. Reasonable in some privacy-first designs, but the platform's architecture is explicitly the opposite — the asymmetry "public by default; host may mark private" should be expressed by allowing the field to be omitted (or, in the UI, to be pre-checked to public).

The chosen `'public'` default is rendered as the pre-checked radio. Switching to private is a single click. The cost of the default being wrong for a specific debate (the moderator forgot to switch) is small — `PATCH /sessions/:id/privacy` exists and can be exercised by the host post-creation (per `tasks/refinements/backend/session_privacy_toggle.md`). The cost of the default being inconsistent with the backend (a private-by-default UI on top of a public-by-default backend) is large — surprise behavior at every session creation.

### 3. HTTP client seam: inline `fetch`, no new abstraction

Two options surveyed:

- **Inline `fetch` calls in the component** (chosen). Matches the existing two call sites (`useAuth.ts`'s `refresh()` and `ScreenName.tsx`'s submit). The boilerplate (`credentials: 'include'`, `Content-Type: application/json`, `Accept: application/json`) is duplicated three times, which is small enough to live with. The cost of an early abstraction is N callers locked into the abstraction's contract; the savings is "three lines of boilerplate." The math doesn't favor abstraction yet.
- **New helper `apps/moderator/src/api/postJson.ts`** (rejected for this task). Three callers IS the threshold where an abstraction starts paying back, but the third caller's needs (POST + form data + 201-then-narrow + error-envelope-then-localize) introduce concerns the first two callers don't have (the screen-name form does its own envelope reading; the auth `refresh` is GET-only and doesn't read an envelope). Trying to unify all three behind one helper at the moment-of-third-caller risks designing the helper around the third caller's specific needs and leaving the first two callers worse off. Defer. The fourth caller (likely the invite-participants form in `mod_invite_participants`) is where the abstraction earns its keep — at that point a 4-caller refactor with concrete shapes is cheap.

Documented as a follow-up under Open questions (none — see below; the decision is settled, just the eventual extraction is deferred).

### 4. i18n key namespace: `moderator.createSession.*`

Three options surveyed:

- **`moderator.createSession.*`** (chosen). Mirrors the existing `auth.login.*` / `auth.screenName.*` shape — top-level area (`auth` / `moderator` / `methodology` / `chrome`), sub-area (`login` / `createSession` / `kind` / etc.), then the actual key. Self-documenting; collision-free with future moderator-scoped surfaces (`moderator.inviteParticipants.*`, `moderator.lobby.*`, `moderator.operate.*`).
- **`chrome.createSession.*`**. The `chrome` namespace is for generic UI labels (buttons, dialog titles) — the create-session form is moderator-specific, not generic. Putting it in `chrome` would dilute the namespace and break the "chrome = cross-surface" invariant.
- **`session.create.*`** (top-level `session`). Would suggest the namespace is for everything-about-a-session, which collides with future audience-surface or participant-surface session strings. Scoping under `moderator.*` makes the audience-of-the-keys explicit.

### 5. Form state: simple controlled inputs with `useState`

Three options surveyed:

- **Simple controlled state via `useState`** (chosen). One `useState<string>('')` for topic, one `useState<'public' | 'private'>('public')` for privacy, one `useState<boolean>(false)` for `submitting`, one `useState<string | undefined>(undefined)` for `errorKey`. Total: four `useState` calls. The component is ~120 lines of code; this is well within the "no abstraction needed" threshold. Matches the precedent: `ScreenName.tsx` uses the same shape.
- **React Hook Form** (rejected — ADR-worthy). A new runtime dependency (`react-hook-form`); would require an ADR per the project's "no new dependencies without ADR" rule (DESIGN.md / ADR convention). The library buys us very little for a two-field form — uncontrolled inputs with built-in validation + submit handling. The screen-name form (also a single-field controlled-state form) didn't reach for it; this task with two fields doesn't have meaningfully more complexity.
- **Formik** (rejected — same reason). New dependency, ADR-worthy, overkill for the form's surface area.
- **Zod for schema validation** (rejected — same reason). The validation is two checks (empty-after-trim, length > 256) plus a discriminated enum. A `validate()` function 8 lines long doesn't justify a runtime schema library.

The decision-class "no new deps without ADR" is the active constraint here. If a future moderator form (capture entry, methodology probes) introduces enough field complexity to need a form library, the ADR conversation happens then — not now.

### 6. Radio buttons vs toggle for privacy

Two options surveyed:

- **Two radio buttons** (chosen). The privacy choice is a discrete enum (`'public' | 'private'`) with semantically distinct meanings (not "more vs less" of a quantity). Radios are the native HTML control for "pick one from a small set"; screen readers announce them with their group name (the fieldset's legend) and the individual radio's label. Keyboard navigation between radios uses arrow keys (native); the tab order treats the group as one tab stop.
- **A toggle switch** (rejected). Toggles imply on/off — a binary state. Public-vs-private is two named states, both meaningful; framing it as "public on/off" or "private on/off" loses the semantic equivalence. Also, toggles are visually heavier and harder to read accessibly (the toggle's label often loses connection to the toggle's state for screen-reader users in some implementations).
- **A `<select>` dropdown** (rejected). Adds a click-and-pick step for a two-option choice that fits inline.

### 7. Post-submit navigation: immediate `useNavigate`, `replace: false`

Three sub-decisions:

- **Immediate navigation (no confirmation step / no delay)** (chosen). The form's success criterion IS "I successfully created a session"; landing on `/sessions/<id>/operate` is the user's expected next step. A "session created — click here to enter" intermediate page would add a click for no gain. The moderator can still abandon the operate route (back-navigate or close the tab) if they realize they made a mistake; the session row stays in the DB as a record.
- **`replace: false`** (chosen). Rationale in the Constraints section above: a back-button from `/sessions/<id>/operate` should land on `/sessions/new` so the user can create another session if they realize they had a typo. `replace: true` would skip the form on back-navigate (back jumps straight to `/login`), which is the wrong UX for a form-then-result flow.
- **`useNavigate` (React Router) not `window.location.assign`** (chosen). A React-Router navigation preserves the SPA's in-memory state (the auth hook's state, the WS provider's connection, the i18n instance) — no bundle re-fetch, no React tree re-mount. `window.location.assign` would do a full-page reload and lose all of that. The cookie persistence is HttpOnly so a reload would re-bootstrap auth from `/auth/me`, but the cost is round-trip latency + a flash of the loading placeholder.

### 8. No ADR needed

This task introduces no new architectural choices that go beyond the existing precedents. Every decision above is either:

- **A direct application of an existing convention** — i18n key namespacing, focus management, ARIA attributes, error-code → i18n-key mapping (all per `mod_screen_name_setup`'s template).
- **A scoped UI policy that doesn't constrain other tasks** — route path, default privacy radio, immediate-navigate behavior.
- **A deferral of a future refactor** — the HTTP client seam.

The "no new dependencies" rule means no ADR is triggered by anything in this task. If a future implementer wants to introduce React Hook Form / Zod / Formik when picking up this task, that decision becomes ADR-worthy and the implementer should write the ADR before pulling the dep in.

## Open questions

(none — all decided)

## Status

- End-to-end create-session flow is reachable in the browser: log in as one of the dev OIDC users, navigate to `/sessions/new/setup`, fill in topic + privacy, submit, and land on `/sessions/<id>/operate` with the live graph canvas mounted. The whole-flow Playwright spec (`tests/e2e/create-session-flow.spec.ts`, 2 scenarios) pins this chain in CI compose.
- **Route deviation from the refinement (Decisions §1 said `/sessions/new`; shipped at `/sessions/new/setup`).** The 2-segment path `/sessions/new` collides with Fastify's `GET /sessions/:id` API route — `new` fails the UUID params-validation BEFORE the static-frontends SPA fallback can fire (Fastify returns 400 instead of falling through to the SPA index.html handler). The 3-segment path `/sessions/new/setup` does not match any registered backend route, so the SPA fallback fires correctly. Workaround is documented inline at `apps/moderator/src/App.tsx`, `apps/moderator/src/routes/CreateSession.tsx`, and the Playwright spec. The root-cause fix is registered as the new backend task `serve_static_frontends_path_collision_fix` (see below).
- New route component at `apps/moderator/src/routes/CreateSession.tsx`: four `useState` slots (topic / privacy / submitting / errorKey), inline `fetch('/sessions', { method: 'POST', credentials: 'include', ... })` mirroring the `ScreenName.tsx` seam (per Decisions §3 — no premature `apiClient` abstraction); `useNavigate` to `/sessions/${id}/operate` with `replace: false` on 201. 19 Vitest cases cover the form behaviors (rendering, submit-enable rules, helper count, client-side rejects, 201-navigate, 400/401/unknown/network mapping, a11y wiring, focus management, privacy POSTed-body capture, key resolution).
- Route registration at `/sessions/new/setup` in `apps/moderator/src/App.tsx` wrapped in `<RequireAuth mode="authenticated-only">`; `App.test.tsx` extended with a 3-case `RequireAuth` gate block (authenticated → form; unauthenticated → login; needs-screen-name → screen-name).
- 15 new i18n keys under `moderator.createSession.*` (title; topic.label/placeholder; privacy.label/public/private; helper; submit; 6 error keys: topicRequired / topicTooLong / privacyInvalid / validation / unauthenticated / network / generic) landed in en-US.json, pt-BR.json, es-419.json. pt-BR + es-419 drafts flagged PENDING via the `*.review.json` lifecycle. Parity coverage: 163 keys × 3 locales (was 148; +15); a dedicated `packages/i18n-catalogs/src/moderator-create-session.test.ts` adds a 50-case parity round-trip on the new keys.
- Whole-flow Playwright spec at `tests/e2e/create-session-flow.spec.ts` under a new `chromium-create-session` Playwright project: 2 scenarios pass (happy path: alice logs in → fills topic + private → submits → navigates → graph canvas visible; client-side invariant: whitespace-only topic keeps submit disabled).
- Verification: `pnpm run check` green; `pnpm run test:smoke` 2607 passing (was 2535; +72); moderator workspace App.test.tsx 41 / CreateSession.test.tsx 19 green; Playwright regressions (`auth-flow`, `moderator-hover-details`, `moderator-graph-layout`) clean.
- **Two follow-up tech-debt tasks registered in this same commit** (per ORCHESTRATOR.md `b7c5ff0`):
  - `frontend_i18n.i18n_create_session_form_native_review` (in `tasks/35-frontend-i18n.tji`) — pt-BR + es-419 native-speaker review of the 15 new keys.
  - `backend.api_skeleton.serve_static_frontends_path_collision_fix` (in `tasks/20-backend.tji`) — the root-cause fix for the `/sessions/new` vs `GET /sessions/:id` collision documented above; choose under refinement between (a) moving session API routes under `/api/sessions/*`, (b) gating the UUID validator on the Accept header, or (c) explicitly exempting named segments.

