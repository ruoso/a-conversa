#!/usr/bin/env bash
# Migration dry run — apply the working tree's pending migrations
# against an isolated, prod-sized-seeded Postgres (ADR 0034's
# reshaping of deployment_tests.migration_dry_run).
#
# Refinement: tasks/refinements/deployment/migration_dry_run.md
# Runbook:    docs/runbooks/release.md (migration checklist)
# TaskJuggler: deployment.deployment_tests.migration_dry_run
#
# Phases:
#   1. isolated postgres (own compose project/volume, alt host port);
#   2. BASELINE apply — the migrations as of BASE_REF, through the
#      real node-pg-migrate runner (same library the startup gate
#      uses);
#   3. prod-sized seed via generate_series (users / nodes / edges /
#      sessions / session_events; sizes env-tunable);
#   4. CANDIDATE apply — the working tree's migrations, timed; fails
#      on error or on exceeding DRYRUN_MAX_SECONDS;
#   5. sanity — seeded rows survived, pgmigrations ledger matches
#      the on-disk file count. down -v either way.
#
# Knobs (env):
#   BASE_REF            baseline ref (default origin/main; for a
#                       release drill: the tag currently in prod)
#   DRYRUN_HOST_PORT    host port for the isolated postgres (5499)
#   DRYRUN_USERS / DRYRUN_NODES / DRYRUN_SESSIONS / DRYRUN_EVENTS
#                       seed sizes (1000 / 50000 / 50 / 200000);
#                       edges are derived (the node chain, nodes-1)
#   DRYRUN_MAX_SECONDS  candidate-apply time budget (120)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_REF="${BASE_REF:-origin/main}"
HOST_PORT="${DRYRUN_HOST_PORT:-5499}"
USERS="${DRYRUN_USERS:-1000}"
NODES="${DRYRUN_NODES:-50000}"
SESSIONS="${DRYRUN_SESSIONS:-50}"
EVENTS="${DRYRUN_EVENTS:-200000}"
MAX_SECONDS="${DRYRUN_MAX_SECONDS:-120}"
PROJECT=aconversa-dryrun
MIGRATIONS_DIR="$ROOT/apps/server/migrations"

WORKDIR="$(mktemp -d)"
OVERRIDE="$WORKDIR/override.yaml"
ENV_FILE="$WORKDIR/dryrun.env"
BASELINE_DIR="$WORKDIR/baseline-migrations"

log() { printf '\n[migration-dry-run] %s\n' "$*"; }
fail() {
  printf '\n[migration-dry-run] FAIL: %s\n' "$*" >&2
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

# --- Env + override ----------------------------------------------------
TEMPLATE=.env
[ -f "$TEMPLATE" ] || TEMPLATE=.env.example
cp "$TEMPLATE" "$ENV_FILE"
PGUSER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
PGPASS="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
PGDB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
export DATABASE_URL="postgres://${PGUSER}:${PGPASS}@localhost:${HOST_PORT}/${PGDB}"

cat >"$OVERRIDE" <<EOF
services:
  postgres:
    ports: !override
      - '${HOST_PORT}:5432'
EOF

psql_run() {
  compose exec -T postgres psql -U "$PGUSER" -d "$PGDB" -tA -v ON_ERROR_STOP=1 "$@"
}

runner() { # $1 = migrations dir (absolute)
  # node-pg-migrate is a dependency of the server workspace, so the
  # exec is filtered there; the dir argument is absolute on purpose.
  pnpm --filter @a-conversa/server exec node-pg-migrate up \
    --migrations-dir "$1" \
    --migrations-table pgmigrations \
    --check-order
}

# --- 1. Isolated postgres ----------------------------------------------
log "starting isolated postgres (project ${PROJECT}, host port ${HOST_PORT})"
compose up -d --wait postgres

# --- 2. Baseline apply ---------------------------------------------------
mkdir -p "$BASELINE_DIR"
git ls-tree -r --name-only "$BASE_REF" apps/server/migrations | while read -r path; do
  git show "${BASE_REF}:${path}" >"$BASELINE_DIR/$(basename "$path")"
done
BASELINE_COUNT=$(find "$BASELINE_DIR" -name '*.sql' | wc -l | tr -d ' ')
CANDIDATE_COUNT=$(find "$MIGRATIONS_DIR" -name '*.sql' | wc -l | tr -d ' ')
PENDING=$((CANDIDATE_COUNT - BASELINE_COUNT))
log "baseline ${BASE_REF}: ${BASELINE_COUNT} migration(s); working tree: ${CANDIDATE_COUNT} (${PENDING} pending)"
[ "$PENDING" -ge 0 ] || fail "working tree has FEWER migrations than ${BASE_REF} — wrong BASE_REF?"

log 'applying baseline migrations through node-pg-migrate'
runner "$BASELINE_DIR" >/dev/null

# --- 3. Prod-sized seed --------------------------------------------------
PER_SESSION=$((EVENTS / SESSIONS))
log "seeding: ${USERS} users, ${NODES} nodes, $((NODES - 1)) edges, ${SESSIONS} sessions, $((PER_SESSION * SESSIONS)) events"
psql_run <<SQL >/dev/null
INSERT INTO users (oauth_subject, screen_name)
SELECT 'dryrun:' || g, 'dryrun-user-' || g
FROM generate_series(1, ${USERS}) g;

INSERT INTO nodes (wording, created_by)
SELECT 'Seeded statement ' || g, u.id
FROM generate_series(1, ${NODES}) g,
     (SELECT id FROM users LIMIT 1) u;

WITH ns AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM nodes)
INSERT INTO edges (role, source_node_id, target_node_id, created_by)
SELECT 'supports', a.id, b.id, u.id
FROM ns a
JOIN ns b ON b.rn = a.rn + 1,
     (SELECT id FROM users LIMIT 1) u;

INSERT INTO sessions (host_user_id, topic)
SELECT u.id, 'Dry-run session ' || g
FROM generate_series(1, ${SESSIONS}) g,
     (SELECT id FROM users LIMIT 1) u;

WITH ss AS (SELECT id FROM sessions)
INSERT INTO session_events (session_id, sequence, kind, actor, payload)
SELECT ss.id, g, 'node-created', u.id,
       jsonb_build_object('dryrun_seed', g)
FROM ss,
     generate_series(1, ${PER_SESSION}) g,
     (SELECT id FROM users LIMIT 1) u;
SQL

counts() {
  psql_run -c "SELECT (SELECT count(*) FROM users) || '/' ||
                      (SELECT count(*) FROM nodes) || '/' ||
                      (SELECT count(*) FROM edges) || '/' ||
                      (SELECT count(*) FROM sessions) || '/' ||
                      (SELECT count(*) FROM session_events);"
}
BEFORE_COUNTS=$(counts)
log "row counts (users/nodes/edges/sessions/events): ${BEFORE_COUNTS}"

# --- 4. Candidate apply, timed -------------------------------------------
log "applying candidate migrations (budget ${MAX_SECONDS}s)"
START=$SECONDS
runner "$MIGRATIONS_DIR"
ELAPSED=$((SECONDS - START))
log "candidate apply took ${ELAPSED}s (${PENDING} pending migration(s))"
[ "$ELAPSED" -le "$MAX_SECONDS" ] || fail "candidate apply exceeded the ${MAX_SECONDS}s budget (took ${ELAPSED}s)"

# --- 5. Sanity -------------------------------------------------------------
AFTER_COUNTS=$(counts)
[ "$AFTER_COUNTS" = "$BEFORE_COUNTS" ] || fail "row counts changed across the candidate apply: ${BEFORE_COUNTS} -> ${AFTER_COUNTS}"

LEDGER=$(psql_run -c 'SELECT count(*) FROM pgmigrations;')
[ "$LEDGER" = "$CANDIDATE_COUNT" ] || fail "pgmigrations has ${LEDGER} rows; expected ${CANDIDATE_COUNT}"

if [ "$PENDING" -eq 0 ]; then
  log "PASS (no pending migrations vs ${BASE_REF} — mechanism exercised end to end)"
else
  log "PASS: ${PENDING} pending migration(s) applied in ${ELAPSED}s against the seeded dataset"
fi
