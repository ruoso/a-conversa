#!/usr/bin/env bash
# Rollback rehearsal — prove the image-rollback path (ADR 0034)
# against the local compose stack.
#
# Refinement: tasks/refinements/deployment/rollback_strategy.md
# Strategy:   docs/rollback-strategy.md
# TaskJuggler: deployment.prod_migrations.rollback_strategy
#
# What it proves, end to end:
#   1. the CANDIDATE image (default: built from the working tree)
#      boots a fresh stack, applies every migration, reports
#      /readyz 200;
#   2. with a SYNTHETIC future row injected into pgmigrations
#      (simulating "the candidate applied a migration the previous
#      image does not ship" — the exact state a real rollback
#      produces), the PREVIOUS image boots against the same
#      database: the startup migration gate takes its
#      no-migrations-to-run path and the server reaches healthy.
#
# Usage:
#   make rehearse-rollback
#   PREVIOUS_IMAGE=ghcr.io/ruoso/aconversa-app:2026.06.01 make rehearse-rollback
#
# Knobs (env):
#   PREVIOUS_IMAGE       image to roll back TO. Default: the candidate
#                        itself (mechanics mode — the swap/boot path is
#                        image-content-agnostic). Run with the genuine
#                        previous release tag ahead of any release whose
#                        migration is not trivially additive.
#   CANDIDATE_IMAGE      skip the working-tree build and use this image.
#   REHEARSAL_HOST_PORT  host port for the app (default 3300 — a
#                        running dev stack on 3000 is untouched).
#
# The rehearsal runs in its own compose project with its own volumes
# and no published postgres/authelia ports; it tears everything down
# (down -v) on success and failure alike.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT=aconversa-rehearsal
HOST_PORT="${REHEARSAL_HOST_PORT:-3300}"
CANDIDATE_IMAGE="${CANDIDATE_IMAGE:-aconversa/app:rehearsal-candidate}"
PREVIOUS_IMAGE="${PREVIOUS_IMAGE:-$CANDIDATE_IMAGE}"
SYNTHETIC_ROW=9999_rollback_rehearsal_synthetic

WORKDIR="$(mktemp -d)"
OVERRIDE="$WORKDIR/override.yaml"
ENV_FILE="$WORKDIR/rehearsal.env"

log() { printf '\n[rehearse-rollback] %s\n' "$*"; }
fail() {
  printf '\n[rehearse-rollback] FAIL: %s\n' "$*" >&2
  exit 1
}

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" \
    -f compose.yaml -f "$OVERRIDE" "$@"
}

cleanup() {
  log 'cleaning up (down -v)'
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# --- Rehearsal env -----------------------------------------------------
# Same recipe ci.yml's e2e job uses: the committed template for the
# Postgres/Authelia/OIDC values, plus a strong SESSION_TOKEN_SECRET
# (the image runs NODE_ENV=production, whose boot gate rejects the
# committed dev placeholder) and an APP_BASE_URL matching the
# rehearsal port (the production CORS gate requires a valid URL).
TEMPLATE=.env
[ -f "$TEMPLATE" ] || TEMPLATE=.env.example
cp "$TEMPLATE" "$ENV_FILE"
{
  echo ''
  echo '# --- rehearse-rollback overrides ---'
  echo "SESSION_TOKEN_SECRET=$(od -vN 48 -An -tx1 /dev/urandom | tr -d ' \n')"
  echo "APP_BASE_URL=http://localhost:${HOST_PORT}"
} >>"$ENV_FILE"

# Read the Postgres credentials for the psql injection below.
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"

# --- Compose override --------------------------------------------------
# Pins the app service to an explicit image (no build), remaps the app
# host port, and unpublishes postgres/authelia so the rehearsal never
# collides with a running dev stack.
write_override() { # $1 = image to run as the app service
  cat >"$OVERRIDE" <<EOF
services:
  app:
    image: $1
    ports: !override
      - '${HOST_PORT}:3000'
  postgres:
    ports: !override []
  authelia:
    ports: !override []
EOF
}

http_code() { # $1 = path
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:${HOST_PORT}$1" || true
}

# --- 1. Candidate image ------------------------------------------------
if [ "$CANDIDATE_IMAGE" = 'aconversa/app:rehearsal-candidate' ]; then
  log "building candidate image from the working tree -> $CANDIDATE_IMAGE"
  docker build -t "$CANDIDATE_IMAGE" . >/dev/null
else
  log "using provided candidate image: $CANDIDATE_IMAGE"
fi

# --- 2. Fresh stack, candidate boots, migrations apply ------------------
write_override "$CANDIDATE_IMAGE"
log 'starting fresh postgres + authelia'
compose up -d --wait postgres authelia

log 'booting the candidate (applies all migrations)'
compose up -d --no-build --wait app

code="$(http_code /readyz)"
[ "$code" = '200' ] || fail "candidate /readyz returned $code (expected 200)"
log 'candidate healthy: /readyz 200, migrations applied'

# --- 3. Simulate the rolled-forward release ----------------------------
log "stopping candidate; injecting synthetic pgmigrations row ($SYNTHETIC_ROW)"
compose stop app >/dev/null
compose rm -f app >/dev/null
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "INSERT INTO pgmigrations (name, run_on) VALUES ('$SYNTHETIC_ROW', now());" >/dev/null

# --- 4. Roll back: previous image against the superset DB ---------------
if [ "$PREVIOUS_IMAGE" != "$CANDIDATE_IMAGE" ]; then
  log "pulling previous image: $PREVIOUS_IMAGE"
  docker pull "$PREVIOUS_IMAGE" >/dev/null
else
  log 'mechanics mode: previous image = candidate (set PREVIOUS_IMAGE for a real pair)'
fi

write_override "$PREVIOUS_IMAGE"
log "booting the previous image against the superset pgmigrations"
compose up -d --no-build --wait app

code="$(http_code /healthz)"
[ "$code" = '200' ] || fail "rolled-back /healthz returned $code (expected 200)"

code="$(http_code /readyz)"
case "$code" in
  200) log 'rolled-back image: /healthz 200, /readyz 200' ;;
  404) log 'rolled-back image: /healthz 200 (/readyz not in this image — pre-readyz release; OK)' ;;
  *) fail "rolled-back /readyz returned $code (expected 200, or 404 on pre-readyz images)" ;;
esac

# The gate must have taken the no-op path: every on-disk migration is
# already applied (plus the synthetic row it does not know about).
if ! compose logs app 2>/dev/null | grep -q 'No migrations to run'; then
  fail "rolled-back app log does not show the gate's 'No migrations to run' line"
fi
log "rolled-back gate took the no-migrations-to-run path"

log 'PASS: rollback rehearsal complete'
