# Locale detection + selection rules

**TaskJuggler entry**: [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji) — task `frontend_i18n.i18n_locale_negotiation`
**Effort estimate**: 0.5d
**Inherited dependencies**: `frontend_i18n.i18n_library_choice` (sibling — must land first)

## What this task is

Define and implement how each of the four frontend surfaces determines its active locale. The rules differ per surface: moderator and participant authenticate, so they get a user-preference + browser-detection chain; the public audience surface has no auth, so locale comes from a URL prefix the producer controls; replay inherits the audience pattern.

## Why it needs to be done

Locale resolution is the first decision the app makes on every page load — every `t(...)` call after that point reads from the resolved locale's catalog. Wrong resolution = wrong language for the whole session. The four surfaces have different operational contexts (logged-in user vs. anonymous broadcast viewer) so a single resolution strategy doesn't fit.

## Inputs / context

- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — Decision section: URL prefix for public audience + replay; browser-detector for moderator + participant + private audience.
- [docs/architecture.md](../../../docs/architecture.md) — audience surface "served at a stable URL that **mirrors session privacy**" — public sessions have a public viewer URL (anyone can load), private sessions require auth. The locale strategy mirrors this split.
- `audience.aud_no_auth_for_public` — the audience-side no-auth task; the locale-from-URL pattern lands alongside it.

## Constraints / requirements

- **Moderator + Participant + Private Audience** (authenticated surfaces): use `i18next-browser-languagedetector` with the detector chain:
  1. User-preference cookie (`aconversa_locale`), set via a small UI control next to the screen-name capture form.
  2. `navigator.languages` (browser's `Accept-Language`-equivalent).
  3. Fallback: `en-US`.
- **Public Audience + Replay**: use a **URL prefix** in the route, e.g., `/{locale}/sessions/{id}` (`/pt-BR/sessions/abc123`). Falls back to `/en-US/sessions/{id}` if the locale segment is missing or unrecognized. The producer pointing OBS at the URL chooses the locale explicitly. **No browser-detector and no cookie** for these surfaces — they may render inside an OBS browser source that does not represent a human user.
- **Fallback chain** (consistent across surfaces):
  - `pt-BR` -> `pt` -> `en-US`
  - `es-419` -> `es` -> `en-US`
  - `en-US` -> `en` -> (no further fallback)
- **No `Accept-Language` parsing on the backend**: the server does not parse `Accept-Language` in v1 (per ADR 0024 and ADR 0023). Locale is purely a frontend concern.
- **Locale cookie scope**: `Path=/`, `SameSite=Lax`, no `Secure` flag in dev / `Secure` flag in prod. Captured/set at the screen-name capture step on moderator + participant.
- **Locale switching at runtime**: supported via the locale-selector UI control (re-saves the cookie and reloads `i18next.changeLanguage(...)`); user state in memory is preserved.

## Acceptance criteria

- `packages/i18n-catalogs/src/negotiation.ts` (or similar) exports two helpers: `negotiateAuthenticatedLocale()` (uses `i18next-browser-languagedetector`) and `negotiateUrlLocale(pathname)` (parses the leading URL segment).
- Each `apps/*` workspace's `main.tsx` calls the appropriate helper before mounting the React root.
- Audience + replay route definitions include the locale prefix; the audience-shell tests exercise both a matching prefix (renders the right locale) and a missing prefix (falls back to `en-US`).
- Moderator + participant include a tiny locale selector control next to the screen-name input.
- The cookie name (`aconversa_locale`) is documented in `packages/i18n-catalogs/README.md`.
- Vitest unit tests cover the fallback chain for each input locale tag.

## Decisions

- **URL prefix for audience + replay.** Settled in ADR 0024.
- **Browser detector for moderator + participant + private audience.** Settled in ADR 0024.
- **Fallback chain.** As above; settled here.
- **Cookie name**: `aconversa_locale`. Cookie not shared with the backend; backend ignores it.
- **No mid-session locale broadcast.** A locale change is local to the client that triggered it; we do not broadcast it through the WebSocket. (Multiple participants in a single session may operate in different locales — see DESIGN doc on participant-utterance language vs. UI language mismatch.)

## Open questions

- **Locale-selector control placement on the audience surface.** The public-audience surface has no UI control surface in the usual sense (OBS browser source); the URL is the control. A small overlay control on the in-browser audience viewer (when not in OBS source mode) may be helpful — out of scope for this task; revisit if needed.
- **URL prefix vs. query param vs. subdomain.** The plan and ADR settled on URL prefix (`/pt-BR/...`). Query-param (`?locale=pt-BR`) was considered and rejected because it's easier for a producer to drop accidentally; subdomain (`pt-br.example.com`) was rejected because TLS and routing are simpler with a single hostname. Recorded so the alternative isn't relitigated.
