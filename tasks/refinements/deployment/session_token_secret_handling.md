# Session-token signing secret handling — SESSION_TOKEN_SECRET

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.prod_secrets.session_token_secret_handling`
**Effort estimate**: 0.5d
**Inherited dependencies**: `secret_storage_choice` (settled — Railway Variables + the conventions in [`secret_storage_choice.md`](secret_storage_choice.md)).
**Executor**: human operator.

## What this task is

Generation, storage, and rotation rules for `SESSION_TOKEN_SECRET` —
the symmetric secret signing both the platform session JWT (HS256, 7-day
TTL) and the short-lived pending-auth cookie (see
[`tasks/refinements/backend/session_token_management.md`](../backend/session_token_management.md)).
Set on the `app` service in
[`prod_railway_app_service.md`](prod_railway_app_service.md).

## Why it needs to be done

Whoever holds this value can mint a valid session for **any user id**
— it's an authentication bypass in 64 characters. It's also the one
secret whose rotation has a user-visible cost (every session
invalidated), so the rotation policy needs deciding before the first
incident, not during it.

## Inputs / context

Server-side enforcement already in place
(`apps/server/src/auth/pending-cookie.ts`): minimum 32 bytes, and
under `NODE_ENV=production` a denylist rejects the known dev
placeholder values — the boot fails loudly rather than running with a
public secret. JWT claims are minimal (`{sub, iat, exp}`); there is no
denylist table, so **rotation is the only revocation lever** (the
session-token refinement's deferred denylist note).

## Constraints / requirements

- **Generation:** `openssl rand -base64 48` (64 chars ≈ 48 bytes of
  entropy; comfortably over the 32-byte floor). Generated at
  app-service setup; two-store rule applies.
- **No sharing or derivation:** not reused for, or derived from, any
  Dex secret — the app and Dex rotate independently.
- **Rotation policy:** no calendar-based rotation. Rotate on (a) any
  suspected exposure, (b) operator turnover, (c) opportunistically if
  the value was ever displayed in a screen-share/recording context.
  Calendar rotation buys nothing here (offline brute-force of a
  48-byte secret isn't the threat) and each rotation logs every user
  out mid-anything.
- **Rotation procedure:** update the Variable + password manager →
  restart `app` → every existing session and in-flight pending cookie
  is invalid (users silently re-OIDC via Dex, where the upstream
  Google session is typically still live — the UX is a redirect
  bounce, not a credential prompt). **Never during a live show**;
  sessions die mid-debate.
- If a "log everyone out" moderation lever is ever needed, this is
  it — but note it's all-or-nothing until the deferred denylist table
  lands.

## Acceptance criteria

- Production value set, ≥32 bytes, not a denylisted placeholder
  (implicitly proven by the app booting with `NODE_ENV=production`).
- Two-store rule satisfied; password-manager entry notes the
  generation date and the rotation policy above.
- One rotation drilled before launch (off-hours): rotate → confirm an
  existing browser session bounces through Dex/Google and recovers.

## Decisions

- **48-byte generated value** — headroom over the enforced floor at
  zero cost.
- **Event-driven rotation only** — rationale in Constraints; the
  user-facing cost of rotation is real and the calendar buys no
  security.

## Open questions

(none — all decided; the denylist table remains deferred per the
session-token refinement)
