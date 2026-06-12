# Production OAuth — Google client in Cloud Console + end-to-end verification

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_compose.prod_oauth_config`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_compose_file` rollup for the verification half (the Dex service and DNS must be live before sign-in can be exercised). The Google Cloud Console half has no dependencies and can be done early — `prod_railway_dex_service` consumes its outputs.

> **Reworked 2026-06-12** for [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md)
> (Dex replaces Authelia as the production issuer; ADR 0032
> superseded). The Google-side mechanics are unchanged; the redirect
> URI and service names are not.
**Executor**: human operator (Google Cloud Console requires the operator's Google identity; the client secret is privileged material).

## What this task is

Two halves:

1. **Create the Google OAuth client** in Google Cloud Console — the
   upstream identity provider Dex federates to (a one-time dance,
   ~15 minutes).
2. **Verify the full chain end-to-end** once Dex and DNS are live:
   a fresh browser signs in via Google → Dex →
   `https://a-conversa.org`, lands authenticated, and gets the
   screen-name flow. This is the verification step ADR 0048 explicitly
   delegates to this task.

## Why it needs to be done

Without the Google client there is no way to sign in to production at
all — Google is the **sole** upstream at launch. The verification half
is the first time the entire auth stack (Google ↔ Dex ↔ app ↔
cookies on `a-conversa.org`) is exercised together; every earlier task
only proves its own slice.

## Inputs / context

From [ADR 0048](../../../docs/adr/0048-production-oauth-dex-identity-broker.md):

> **Google connector** — client created in Google Cloud Console; the
> redirect URI registered with Google is Dex's callback under the
> issuer (`https://auth.a-conversa.org/callback` by Dex convention —
> verify at execution). Scopes `openid email profile`.

The client ID and secret both reach Dex as Railway Variables,
expanded into the connector config at parse time
([`prod_railway_dex_service.md`](prod_railway_dex_service.md)).

The application side is already provider-agnostic (ADR 0002): the app
only ever talks to Dex. Nothing in this task touches app code or
app Variables.

## Execution steps (operator)

### Half 1 — Google Cloud Console

1. **Project.** In Google Cloud Console (operator's Google account),
   create a project `aconversa-prod` (any unused ID; the project is
   only a container for the OAuth client).
2. **Consent screen** ("Google Auth Platform / Branding" in current
   console): user type **External**; app name **A Conversa**; support
   email = operator's; app homepage `https://a-conversa.org`;
   authorized domain `a-conversa.org`. Add the operator as a test user
   for now.
3. **Scopes.** Only the non-sensitive identity scopes: `openid`,
   `email`, `profile` (matching ADR 0032). Requesting nothing
   sensitive keeps the app out of Google's verification process.
4. **Create the client.** Credentials → Create credentials → OAuth
   client ID → type **Web application**, name
   `aconversa-dex-prod`. Authorized redirect URI — exactly one:

   ```
   https://auth.a-conversa.org/callback
   ```

   No JavaScript origins needed (server-side code flow).
   *(If the client was already created during the Authelia attempt
   with the old `https://authelia.a-conversa.org/api/oidc/callback/google`
   URI, edit the existing client: replace the redirect URI; the
   display name is cosmetic and can stay or be renamed.)*
5. **Record the credentials.** Client ID → `GOOGLE_CLIENT_ID` Railway
   Variable (`dex` service) and the password manager. Client secret
   → `GOOGLE_CLIENT_SECRET` Railway Variable and the password manager,
   per [`oauth_credentials_handling.md`](oauth_credentials_handling.md).
   Do not download the JSON credentials file to disk; copy the two
   values directly.
6. **Publish the app** (consent screen → Publish to production) so
   arbitrary Google accounts — not just listed test users — can sign
   in. With only non-sensitive scopes this does not trigger Google's
   verification review; the consent screen may show as "unverified"
   metadata-wise, which is acceptable at launch.

### Half 2 — end-to-end verification (after `prod_tls_and_domain`)

7. In a fresh browser profile (no prior cookies), open
   `https://a-conversa.org` and start the sign-in flow.
8. Expect: redirect to `https://auth.a-conversa.org` → straight to the
   Google account picker (sole connector + `skipApprovalScreen`; if
   Dex interposes a connector-selection page, note it — cosmetic, not
   a failure) → consent → back to Dex → back to
   `https://a-conversa.org/api/auth/callback` → screen-name
   prompt (first login) → authenticated app shell.
9. Confirm the session survives a page reload (the `aconversa-session`
   cookie is set, `Secure`, on `a-conversa.org`), and `GET /api/auth/me`
   returns the screen name.
10. Sign in again from a second Google account to confirm the platform
    admits arbitrary accounts (intentionally open, per ADR 0048).

## Constraints / requirements

- The redirect URI registered with Google is **Dex's callback**,
  never the app's — the app's own callback
  (`https://a-conversa.org/api/auth/callback`) is registered only on
  the `aconversa-app-prod` static client inside the Dex config.
  Keeping these two layers straight is the main execution hazard of
  this task.
- Scopes stay at `openid email profile` — the platform stores only the
  OIDC subject + screen name (ADR 0002 / ADR 0048); requesting more
  would both violate that and drag the client into Google verification.
- The client secret follows
  [`oauth_credentials_handling.md`](oauth_credentials_handling.md):
  Railway Variable + password manager, nowhere else.
- If the domain ever changes, this Google client's redirect URI is one
  of the touchpoints — note it in the eventual admin runbook.

## Acceptance criteria

- Google client exists with exactly the one Dex callback redirect
  URI (no stale Authelia-era URI); consent screen published, External,
  non-sensitive scopes only.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` set on the `dex`
  service and recorded in the password manager.
- The step-7–10 browser walk passes end-to-end on two different Google
  accounts, including cookie persistence and `/api/auth/me`.
- No Google credential appears anywhere but the Railway Variables and
  the password manager.

## Decisions

- **Google as sole launch upstream** — settled by ADR 0032, carried
  forward by ADR 0048 (Microsoft / Facebook / GitHub post-v1, Apple
  never).
- **Publish-to-production with unverified branding** rather than
  staying in testing mode: testing mode caps sign-ins to enumerated
  test users, which contradicts an open platform. Verification-grade
  branding polish is deferred until Google requires it.
- **No credentials JSON download** — the file on disk is a leak vector
  with no benefit over copying two strings into the two stores.

## Open questions

- **Privacy-policy URL.** Google's consent screen asks for privacy
  policy / terms links; they're optional while unverified with
  non-sensitive scopes. If the console hard-requires one at execution
  time, the landing page needs a minimal privacy page first — surface
  that to the project rather than pointing at a placeholder URL.
- **Consent-screen logo.** Uploading a logo can itself trigger
  Google's verification flow; skip the logo at launch unless the
  flow is acceptable.

## Status

**Done — 2026-06-12.** Google client live with the Dex callback
(`https://auth.a-conversa.org/callback`), consent screen published
with non-sensitive scopes; the end-to-end verification walk passed
against production (Google → Dex → `a-conversa.org` callback →
screen-name flow → authenticated shell, session persistent across
reload). Executed against the ADR 0048 (Dex) rework of this task.
