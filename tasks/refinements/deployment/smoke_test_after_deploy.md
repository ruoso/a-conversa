# Post-deploy smoke test — health, login, simple session

**TaskJuggler entry**: [tasks/70-deployment.tji](../../70-deployment.tji) — task `deployment.deployment_tests.smoke_test_after_deploy`
**Effort estimate**: 1d
**Inherited dependencies**: `prod_compose`, `prod_secrets`, `prod_migrations` (the live stack the checklist exercises).
**Executor**: human operator (it validates the live environment; ~10 minutes per run).

## What this task is

Author the post-deploy smoke checklist and run it once against a live
production deploy. The checklist is the operator's structured answer
to "did this deploy actually work?" — pipeline green, platform
health (`/healthz`, `/readyz`, issuer discovery, migration gate in
the logs), a real Google sign-in, and a minimal live session
(moderator creates, audience view connects over WebSocket, one
statement propagates).

The checklist itself lives as a runbook —
[`docs/runbooks/post-deploy-smoke.md`](../../../docs/runbooks/post-deploy-smoke.md)
— referenced from the release runbook's post-deploy verification
step, so it is part of every release, not a one-time artifact.

## Why it needs to be done

CI's e2e suite proves the *code* against a disposable stack; nothing
proves the *live wiring* — DNS, TLS, Railway edge, Dex↔Google, the
production database — except exercising it. Every incident class hit
during bring-up (edge-binding propagation, env-name exclusions, the
config-render pipeline) was invisible to CI and caught only by a
person clicking through production. The checklist turns that
clicking-through into a repeatable gate.

## Constraints / requirements

- Runnable in ~10 minutes with a browser + terminal; no special
  tooling beyond `curl`, `jq`, `gh`.
- Failure routes to the [rollback runbook](../../../docs/runbooks/rollback.md),
  not to ad-hoc debugging under pressure.
- The checklist tracks the live hostname scheme (www-canonical per
  ADR 0031's amendment) and the `/readyz` deploy gate (ADR 0033,
  enforced from `railway.json`).
- Smoke sessions are cleaned up after the run.

## Acceptance criteria

- `docs/runbooks/post-deploy-smoke.md` exists and is linked from the
  release runbook's post-deploy step.
- The checklist has been executed once, in full, against a live
  production deploy, with every box passing.

## Decisions

- **Manual checklist at v1, no automation.** The functional depth is
  CI's job (e2e suite); the smoke run validates environment wiring,
  which changes rarely and fails in ways that need human judgment
  (e.g., distinguishing edge propagation from misconfiguration).
  Automating it (synthetic probe of the full OIDC walk) is real work
  with credential-handling implications — deferred until release
  frequency makes 10 manual minutes a real cost.
- **Checklist as a runbook document** (not embedded in the
  refinement) — it's an operational artifact consulted on every
  release; refinements record scope, not procedures.

## Open questions

- **Synthetic end-to-end probe post-v1** — if/when releases become
  frequent, fold steps 2–3 into an authenticated synthetic check
  (needs a dedicated test Google identity and secret handling for
  it; pairs naturally with `uptime_monitoring`'s probe story).
