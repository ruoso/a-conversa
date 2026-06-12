# Post-deploy smoke checklist

Run after **every** production deploy (each `v*` tag), immediately —
~10 minutes, a browser and a terminal. Owned by
`deployment_tests.smoke_test_after_deploy`
([refinement](../../tasks/refinements/deployment/smoke_test_after_deploy.md)).
If any step fails, stop and follow the
[rollback runbook](rollback.md).

Production hostnames: the app is canonical at
`https://www.a-conversa.org` (ADR 0031, hostname-scheme amendment);
the OIDC issuer is `https://auth.a-conversa.org`.

## 1. Pipeline + platform health (terminal)

- [ ] The release run is green end-to-end — gate → test → publish →
      deploy: `gh run list --workflow=release.yml --limit 1`
- [ ] Liveness and readiness (readiness covers DB connectivity +
      applied migrations):

      ```sh
      curl -sSf https://www.a-conversa.org/healthz
      curl -sSf https://www.a-conversa.org/readyz
      ```

- [ ] Issuer answers with the right identity:

      ```sh
      curl -sSf https://auth.a-conversa.org/.well-known/openid-configuration | jq -r .issuer
      # → https://auth.a-conversa.org
      ```

- [ ] Deploy logs (Railway `app` service): the startup migration gate
      reports migrations applied, then the listen line; no error-level
      log entries during boot.

## 2. Login (fresh browser profile / incognito)

- [ ] `https://www.a-conversa.org` loads the landing page.
- [ ] "Sign in with SSO" → Google account picker → consent → lands
      back authenticated (screen-name prompt only on a first-ever
      login for that account).
- [ ] Session survives a page reload; `GET /api/auth/me` (devtools or
      `curl` with the cookie) returns the screen name.

## 3. Simple session (same browser)

- [ ] Create a session from the moderator console (`/m/*`); the lobby
      renders.
- [ ] Open the audience view (`/a/<session-id>`) in another tab: it
      loads, and devtools → Network shows the WebSocket connected
      (status 101, frames flowing).
- [ ] Add one statement through the moderator flow; it appears on the
      audience graph without a manual refresh.
- [ ] Clean up: end/discard the smoke session so it doesn't linger in
      listings.

## Record

Note the date, version, and outcome (one line) in the deploy's
release notes or the operator log. A failed step that required
rollback gets a line in the admin runbook's incident notes.
