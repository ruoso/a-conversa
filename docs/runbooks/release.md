# Runbook: cutting a release

Operator procedure for shipping a production release. The design
behind every step is
[ADR 0034](../adr/0034-releases-calendar-versioning-tag-deploy.md)
(calendar versioning, tag-triggered deploy, immutable tags); the
workflow that enforces it is
[`.github/workflows/release.yml`](../../.github/workflows/release.yml).
Owned by `deployment.release_process.release_runbook`
([refinement](../../tasks/refinements/deployment/release_runbook.md)).

Pushing a `v*` tag is the **only** path to production. Direct pushes
to `main` never deploy.

## One-time setup (first release only)

- In the repo settings, add a **tag ruleset protecting `v*`**:
  restrict creations to maintainers, block deletions and
  non-fast-forward updates. This is the settings-layer half of the
  no-recut defense; the workflow's published-artifact check is the
  half that works even if this setting is lost.
- Confirm the Railway deploy job is wired in `release.yml` (operator
  chain, [`prod_railway_app_service`](../../tasks/refinements/deployment/prod_railway_app_service.md)
  step 6). Until it is, a tag cut ends at the ghcr publish — fine
  for rehearsing this runbook before production exists.

## Preconditions — check before every cut

1. **The target commit is on `main` with CI green.** The gate
   enforces ancestry mechanically; you're checking the *green* part
   (the gate's smoke re-run only covers skipped/cancelled CI runs).
2. **`CHANGELOG.md`'s `Unreleased` section is accurate** — it is
   about to become the release entry, and writing it is the
   pause-and-think moment ADR 0034 builds the process around.
3. **Migration checklist** (skip if the release contains no new
   migration):
   - `pnpm run lint:migrations` is clean — meaning every new
     migration is additive, or carries a justified
     `-- migration-safety: allow …` marker you have personally read.
   - If any new migration is **not trivially additive**: run the
     migration dry run against a prod-sized local stack —

     ```sh
     BASE_REF=v<current-prod-version> make migration-dry-run
     ```

     — and run the rollback rehearsal against the image currently in
     production:

     ```sh
     PREVIOUS_IMAGE=ghcr.io/ruoso/aconversa-app:<current-prod-version> make rehearse-rollback
     ```

     (see [docs/rollback-strategy.md](../rollback-strategy.md)).
   - If the linter pointed you at a destructive change: follow
     [the two-tag dance](#the-two-tag-dance-destructive-migrations)
     below — it changes what this release may contain.

## The cut

1. **Pick the version**: today's date, zero-padded — `2026.07.01`.
   Second release the same day: `2026.07.01.1`, then `.2`, etc.
   (Zero-padding is enforced by the gate; `v2026.7.1` is rejected.)
2. **Write the CHANGELOG entry in the commit that gets tagged**
   (same-commit rule — the gate checks the tag's tree, not `main`'s
   tip):
   - rename `## Unreleased` to `## 2026.07.01`;
   - add a fresh empty `## Unreleased` above it;
   - land that commit on `main` through the normal PR flow.
3. **Tag that exact commit and push the tag**:

   ```sh
   git fetch origin main
   git tag v2026.07.01 <sha-of-the-changelog-commit>
   git push origin v2026.07.01
   ```

## Watch and verify

The tag push runs the `Release` workflow; its stages, in order:

1. **Gate** — calver format, tag commit on `main`, CHANGELOG entry
   for this exact version, version not already published to ghcr.
   A gate failure names which check tripped; see
   [failure handling](#failure-handling).
2. **Tests** — unit + behavior smoke suites on the tagged commit.
3. **Publish** — image to `ghcr.io/ruoso/aconversa-app:<version>`
   (+ `:latest`).
4. **Deploy** — the Railway job (once wired) deploys the tagged
   commit; Railway's deploy-health gate is `/readyz`
   ([docs/observability.md](../observability.md)).

Post-deploy verification:

- `https://a-conversa.org/readyz` returns 200 with both checks `ok`;
- `https://a-conversa.org/healthz` reports the new version stamp;
- the Sentry releases page shows the new release string;
- run the post-deploy smoke checklist (owned by
  `deployment_tests.smoke_test_after_deploy`).

## The two-tag dance (destructive migrations)

When a schema change is one the previous image cannot tolerate
(column drop / rename, type change, new NOT NULL — i.e. the safety
linter flagged it), it ships across **two consecutive releases**:

1. **Release N — the additive half.** Migration adds the new shape
   (nullable or defaulted) and backfills; app code stops reading the
   old shape (writes both if needed). The linter passes with no
   markers. Cut release N per this runbook.
2. **Verify production actually runs N.** The dance is defined over
   *deployed* releases — if N is tagged but never deployed, N+1
   becomes a single-release destructive change with a broken
   rollback target. Check `/healthz`'s version stamp.
3. **Release N+1 — the destructive half.** Migration removes the
   old shape, carrying the marker:

   ```sql
   -- migration-safety: allow drop-column: release vN stopped reading <table.column>; N+1 half of the two-tag dance
   ```

   Before cutting: `PREVIOUS_IMAGE=<image of N> make rehearse-rollback`.
   Then cut N+1 per this runbook. Rolling back N+1 lands on N, which
   tolerates the post-N+1 schema by construction.

## Failure handling

- **Gate failure** — fix the cause (wrong branch, missing CHANGELOG
  entry, malformed version) and cut a **new** tag: same procedure,
  next free `.N` counter. Never delete, move, or force-push a tag —
  the ruleset and the workflow both refuse re-cuts, by design.
- **Test failure** — the tagged commit has a real problem; fix on
  `main`, then cut a new tag from the fix.
- **Publish/deploy failure** — infrastructure, not content: re-run
  the failed job from the Actions UI (the gate's no-recut check
  passes `docker manifest inspect` only for *published* versions, so
  a failed publish is re-runnable).
- **Deployed but broken** — switch to the
  [rollback runbook](rollback.md).
