# Rollback runbook — the operator's image-rollback procedure

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.release_process.release_rollback_runbook`
**Effort estimate**: 1d
**Inherited dependencies**: `release_process.release_runbook` and `prod_migrations.rollback_strategy` (both settled in this M9-prep batch — the runbook it pairs with and the strategy it operationalizes).
**Executor**: implementation agent — repo-only documentation, part of milestone `m_predeploy_agent_work` (M9-prep). Exercised by the operator at/after M9.

## What this task is

Write the operator-facing procedure for rolling a bad production
release back, per
[ADR 0034](../../../docs/adr/0034-releases-calendar-versioning-tag-deploy.md):

> `release_process.release_rollback_runbook` — documents the
> one-click Railway image rollback, including the forward-only
> constraint and the migration-discipline invariant.

The engineering strategy (why image rollback, what the gate does,
the invariant, the rehearsal) is already documented in
[`docs/rollback-strategy.md`](../../../docs/rollback-strategy.md)
(`rollback_strategy` task); this runbook is the under-pressure
companion: decide, act, verify, follow up — with the strategy doc as
the "why" reference, not duplicated inline.

## Why it needs to be done

- ADR 0034's Verification section names this leaf; M9 gates on the
  `release_process` rollup. A rollback decided during a live show
  needs a checklist, not a design document.
- The WBS wires it after both the release runbook (it shares the
  verification steps and the "fix goes out as a new tag" tail) and
  the rollback strategy (it must not contradict the mechanics
  documented there).

## Inputs / context

- **ADR 0034** — rollback = redeploy previous image via Railway's
  Deployments tab; migrations stay applied; forward-only confirmed;
  re-cutting tags forbidden (the fix path is a new tag).
- **`docs/rollback-strategy.md`** — gate behavior on rollback
  (no-migrations-to-run boot), invariant + linter, two-tag dance,
  roll-forward recovery when the invariant was violated.
- **`docs/runbooks/release.md`** — the runbook genre conventions
  (one-time setup / preconditions / act / verify / failure handling)
  and the cut procedure the rollback's "follow up" step hands back
  to.
- **Observability surfaces** (`docs/observability.md`) — `/healthz`
  version stamp (which build is live), `/readyz` (deploy-health),
  Railway logs, Sentry — the decide and verify steps lean on these.

## Constraints / requirements

- **`docs/runbooks/rollback.md`**, covering:
  - **when to roll back vs. fix forward** — the decision rule (the
    timer: a fix tag through CI takes ~30+ minutes; a rollback takes
    ~2; mid-show, rollback first and diagnose after) and the cases
    where rollback is the WRONG move (the bad release's migration is
    destructive-and-marked, i.e. the previous image is a known
    non-tolerator — strategy doc's violation chapter);
  - **the act** — Railway dashboard: service → Deployments → the
    previous deployment → Redeploy; what "previous" means (the
    deployment whose tag is the last-known-good version per
    `/healthz` history / CHANGELOG); the explicit note that nothing
    git-side changes (no tag deletion, no revert commit needed to
    roll back);
  - **what happens under the hood** — one paragraph + a link to the
    strategy doc (gate no-op boot against the superset schema), so
    the operator is not surprised by migration log lines;
  - **verify** — `/healthz` version stamp shows the rolled-back
    version, `/readyz` 200, Sentry error rate subsides, the
    user-visible symptom is gone;
  - **follow up** — the rolled-back state is an interim: diagnose,
    fix on `main`, cut a NEW tag per the release runbook (never
    re-cut the bad one); record the incident in the CHANGELOG entry
    of the fix release;
  - **when the rollback itself misbehaves** — the strategy doc's
    roll-forward recovery, summarized as a decision list with the
    backup restore as the explicit last resort.
- Same genre conventions as `docs/runbooks/release.md`; references
  (never duplicates) the strategy doc and the release runbook.
- No secrets, no Railway provisioning detail (operator chain owns
  that).

## Acceptance criteria

- `docs/runbooks/rollback.md` exists and covers the six areas above;
  links to the strategy doc, release runbook, and observability doc
  resolve.
- The procedure is consistent with `docs/rollback-strategy.md`
  (same lever, same recovery ordering) — checked by reading both.
- `pnpm run format:check` green on the new file.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

## Decisions

- **Strategy and runbook stay two documents.** The temptation is to
  merge them; they serve different readers (designer-of-the-system
  vs. operator-at-2am). The runbook carries the minimum context to
  act safely and links down; the strategy doc owns every "why."
- **The decision rule leads the runbook.** The hardest part of a
  rollback is deciding to do it; putting the rollback-vs-fix-forward
  rule first (with the destructive-migration exception called out
  loudly) is worth more than any polish on the click-path.
- **"Previous" is defined by `/healthz` + CHANGELOG, not by memory.**
  The runbook tells the operator how to *determine* the
  last-known-good version rather than assuming they remember it —
  same spirit as the release runbook's "verify prod actually runs N"
  step.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12. Landed as:

- [`docs/runbooks/rollback.md`](../../../docs/runbooks/rollback.md) —
  decision rule (incl. the destructive-migration exception), the
  Railway redeploy click-path, under-the-hood pointer, verification
  checklist, fix-forward follow-up, and the rollback-misbehaves
  decision list.
- `complete 100` marker in [tasks/70-deployment.tji](../../70-deployment.tji); tj3 parse clean.
