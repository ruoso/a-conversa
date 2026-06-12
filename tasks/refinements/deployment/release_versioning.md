# Release versioning — calendar versioning, CHANGELOG seed, tag-gate workflow

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.release_process.release_versioning`
**Effort estimate**: 0.5d
**Inherited dependencies**: none in the WBS. Practically builds on `foundation.ci.ci_image_publish` (the existing `release.yml` this task extends).
**Executor**: implementation agent — repo-only work, part of milestone `m_predeploy_agent_work` (M9-prep). The operator's half (actually cutting tags) is the runbook's territory (`release_runbook`).

## What this task is

Adopt the release-versioning scheme fixed by
[ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md)
and make the repo enforce it:

1. **Seed `CHANGELOG.md`** at the repo root — header documenting the
   calendar-versioning format (`vYYYY.MM.DD`, same-day suffix `.N`),
   one entry per tag, updated in the same commit that gets tagged.
2. **Tag-gate the release workflow.** `release.yml` currently builds
   and publishes on any `v*` push, no questions asked. ADR 0034
   requires the workflow to verify, before anything publishes:
   (a) the tag matches the calendar format, (b) the tagged commit is
   on `main`, (c) tests pass on that commit, (d) the tag's CHANGELOG
   entry exists, and (e) the tag is not re-cutting an already
   published release.

## Why it needs to be done

- The tag push is the **only** path to production (ADR 0034 — no
  deploys from `main`); an ungated tag workflow means a typo'd or
  off-branch tag ships an image. The gate is the mechanical safety
  the one-person release process relies on.
- `release_runbook` (gates on this leaf) documents the procedure the
  gate enforces; landing the gate first means the runbook describes
  reality rather than intention.
- M9-prep (`m_predeploy_agent_work`) lists this leaf; the Railway
  deploy job that `prod_railway_app_service` appends to this same
  workflow (operator-supplied token) slots in after the gate.

## Inputs / context

From ADR 0034 (Decision):

> **Versioning** — `YYYY.MM.DD`, e.g., `2026.06.01`. Two releases in
> the same day suffix `.1`, `.2`, etc. Tags are prefixed with `v`.
> No semver. No pre-release suffixes.
>
> **CHANGELOG.md** at the repo root, updated in the same commit that
> creates the tag. One entry per tag. Format: a short list of
> user-visible changes; PR / commit hashes for traceability.
>
> **Tag-triggered deploy.** Pushing a tag matching `v*` runs a GitHub
> Actions workflow that (a) verifies the tag was made from a commit
> on `main`, (b) verifies tests pass on that commit, (c) emits a
> build artifact and signals Railway to deploy the tagged commit.
>
> **Re-cutting a tag is forbidden.** Once `v2026.06.01` is pushed, it
> points at one commit forever. A fix gets a new tag, not an amended
> tag. Force-pushing tags is blocked by the workflow.

Existing artifacts:

- **`.github/workflows/release.yml`** — fires on `v*`, single
  `publish` job (build + ghcr push). Its image-tag mapping uses
  `type=semver,pattern={{version}}`, which does **not** parse
  calendar tags (`2026.06.12` has leading zeros — invalid semver), so
  the mapping needs to move to a `match` pattern anyway.
- **`.github/workflows/ci.yml`** — the per-merge gate on `main`:
  lint / format / typecheck / unit smoke / behavior smoke / Playwright
  e2e / build. Every commit that lands on `main` has passed it.
- **ghcr.io publish stays** (decision recorded in
  [`prod_railway_app_service.md`](prod_railway_app_service.md)):
  Railway ignores it; it remains the public artifact.

## Constraints / requirements

- **`CHANGELOG.md`** seeded with: format documentation (calver shape,
  one-entry-per-tag, same-commit rule, traceability hashes) and an
  `Unreleased` section ready for the first cut. No retroactive
  back-fill of pre-release history (the git log is that record).
- **Gate job** in `release.yml`, running before (and required by) the
  publish job:
  - tag format: `^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$` — anything else
    fails with a message pointing at ADR 0034. The legacy `v0.x`
    foundation tags predate the scheme and are not re-triggered, so
    no carve-out is needed.
  - `main` ancestry: `git merge-base --is-ancestor <tag-commit> origin/main`
    on a full-history checkout.
  - CHANGELOG entry: the file contains a heading for the exact
    version being tagged.
  - no re-cut: the gate fails if the ghcr image tag for this version
    already exists (the practical "force-push is blocked" mechanism —
    a re-pushed tag cannot overwrite the published artifact).
- **Test verification**: the workflow re-runs the smoke suites
  (`test:smoke`, `test:behavior:smoke`) against the tagged commit.
  The full Playwright e2e suite is NOT re-run here — see Decisions.
- **Image-tag mapping** switches from `type=semver` to a `match`
  pattern that strips the `v` (calver-compatible); `:latest`
  continues to track the newest release tag.
- The workflow keeps building/publishing from the same Dockerfile
  with the same caches; no Railway wiring here (that lands with
  `prod_railway_app_service`, operator-side, appended after the
  gate).

## Acceptance criteria

- `CHANGELOG.md` exists at the repo root with the documented format
  and an `Unreleased` section.
- `release.yml` has a `gate` job enforcing format / ancestry /
  CHANGELOG / no-recut, a `test` job running the smoke suites, and
  `publish` requiring both; image-tag mapping handles calver tags.
- `pnpm exec prettier --check` passes on changed files; workflow YAML
  is valid (`actionlint` if available, else careful review +
  format-check).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Smoke suites re-run in the gate; the e2e suite is not.** The
  ancestry check guarantees the tagged commit landed on `main`
  through CI, which includes the full Playwright e2e job — re-running
  ~40 minutes of compose-stack e2e on the same SHA buys no new
  information. The smoke re-run (~5 min) exists to catch the one gap
  ancestry can't: a `main` commit whose CI run was skipped/cancelled.
  ADR 0034's "(b) verifies tests pass on that commit" is satisfied by
  the combination.
- **No-recut enforcement = published-artifact existence check.** A
  workflow cannot literally block a `git push --force` to a tag ref
  (that's a server-side setting); what it CAN do is refuse to
  overwrite the published image, which makes a re-cut tag inert. The
  operator additionally enables GitHub tag protection for `v*`
  (one-time repo setting, recorded in the runbook) — the workflow
  check is the layer that doesn't depend on anyone remembering the
  setting.
- **Calendar format enforced strictly, including zero-padding**
  (`v2026.06.01`, not `v2026.6.1`). Lexicographic order then equals
  chronological order — useful everywhere tags get sorted ASCII-wise
  (ghcr tag list, `git tag | sort`).
- **No CHANGELOG back-fill.** The changelog starts at adoption;
  earlier history is in `git log` and the WBS. Retroactive entries
  would be guesswork with no operational value.
- **`Unreleased` section convention.** Notable changes accumulate
  under `Unreleased` as they merge; the tag-cut commit renames the
  section to the version. This makes the same-commit rule cheap to
  follow and the gate's CHANGELOG check meaningful.

## Open questions

(none — all decided; automated CHANGELOG generation is ADR 0034's
deferred question)

## Status

**Done** — 2026-06-12. Landed as:

- [`CHANGELOG.md`](../../../CHANGELOG.md) — seeded with the ADR 0034
  format documentation + `Unreleased` section.
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) —
  new `gate` job (calver format, `main` ancestry, CHANGELOG entry,
  ghcr no-recut check) + `test` job (unit + behavior smoke on the
  tagged commit); `publish` now `needs: [gate, test]`; image-tag
  mapping switched from `type=semver` to calver-compatible
  `type=match`.
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
