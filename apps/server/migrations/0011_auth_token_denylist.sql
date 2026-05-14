-- Auth token denylist — per-session JWT revocation surface.
--
-- Refinement: tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md
-- TaskJuggler: backend_hardening.auth_hardening.jwt_revocation_jti_denylist
-- Forward-only per ADR 0020 (no down migration).
--
-- Closes docs/security/m3-review/auth.md F-001 + F-006 and
-- docs/security/m3-review/coverage.md G-005.
--
-- Before this table, the platform session JWT was a 7-day stateless
-- bearer credential: `POST /auth/logout` cleared the browser cookie
-- but the JWT itself remained structurally valid until its `exp`. Any
-- party who copied the cookie value before logout (extension capture,
-- shared workstation, leaked syslog) retained full access for up to a
-- week.
--
-- With this table:
--   * Every JWT carries a `jti` (v4 UUID) claim.
--   * `POST /auth/logout` writes `(jti, user_id, expires_at)` here.
--   * `verifySessionToken` (or the auth middleware that wraps it)
--     consults the table on every verify; a hit collapses to the
--     existing `auth-required` 401 envelope. No new error code, no
--     information leak about "revoked vs. expired vs. invalid."
--   * A periodic sweeper removes rows where `expires_at <= NOW()` —
--     by which point the JWT has expired by its own `exp` claim and
--     the verifier rejects it on the `exp` check anyway. The row's
--     job is to bound the JWT's effective lifetime to the moment of
--     revocation, not past its natural expiry.
--
-- **Why a denylist, not an allowlist.** An allowlist (one row per
-- live session) requires an INSERT on every successful sign + a
-- DELETE on every logout / expiry. A denylist requires writes only on
-- revocation; the row count is bounded above by (peak revocation rate
-- * JWT TTL). At v1 volumes (a moderator running a multi-hour debate
-- session occasionally logging out), the denylist is dramatically
-- smaller than the allowlist; the hot read path (`SELECT 1 WHERE jti
-- = $1`) is a B-tree probe whose miss is the overwhelmingly common
-- case — bloom-filter-friendly if the verify volume ever justifies it.
--
-- **`gen_random_uuid()` policy.** The `jti` is minted server-side at
-- JWT sign time via Node's `crypto.randomUUID()` (RFC 4122 v4). The
-- column has no DB-side DEFAULT — writers must always supply the
-- value. A bare INSERT with a missing `jti` is a programmer error,
-- not a recoverable case.

CREATE TABLE IF NOT EXISTS auth_token_denylist (
    -- Primary key on the JWT's `jti` claim. UUID — the surface the
    -- verifier's denylist consult queries by. Server-side B-tree
    -- gives O(log N) lookup; the column is the natural cluster key.
    jti             UUID            PRIMARY KEY,

    -- Owning user. NOT NULL — every denylist entry is for a known
    -- user. ON DELETE RESTRICT mirrors the soft-delete convention of
    -- the surrounding tables: a soft-deleted user's denylist rows
    -- live to their natural expiry, so a force-revoked token of a
    -- soft-deleted user cannot be re-mounted before its `expires_at`.
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Server-clock moment the revocation landed. DEFAULT NOW() so
    -- callers writing `(jti, user_id, expires_at)` get the
    -- revocation timestamp filled automatically. Used by audit
    -- queries; not consulted on the hot read path.
    revoked_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Mirror of the JWT's `exp` claim, in TIMESTAMPTZ form. The
    -- periodic sweeper DELETEs rows where `expires_at <= NOW()` —
    -- the corresponding JWT has expired by its own `exp` check at
    -- that point, so the row's job is done. Indexed below for the
    -- sweeper's range scan.
    expires_at      TIMESTAMPTZ     NOT NULL
);

-- Periodic-sweeper index. The DELETE statement
--
--   DELETE FROM auth_token_denylist WHERE expires_at <= NOW();
--
-- uses this index to find the cutoff range cheaply rather than full-
-- scanning the table on every sweep. The B-tree on `expires_at` also
-- supports any future "show me every revocation from the last 24h"
-- audit query.
CREATE INDEX IF NOT EXISTS auth_token_denylist_expires_at_idx
    ON auth_token_denylist (expires_at);
