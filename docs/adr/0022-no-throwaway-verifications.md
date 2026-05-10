# 0022 — Empirical verifications must be committed tests, not throwaway probes

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` is in active foundation construction (the M0 / M1 work has been laying down schema, runners, and event-validation primitives). Every task creates new system behaviors — a migration's CHECK fires on bad input; a fixture loader is idempotent; a Zod schema rejects an unknown enum value. The discipline question this ADR settles is: **how does an agent (or contributor) verify that those behaviors work, and where does the verification live afterward?**

Two patterns surfaced during M1:

1. **The probe-and-forget pattern.** Each schema sub-agent verified its migration's constraint behavior by running ad-hoc psql probes against the live compose Postgres at commit time — `INSERT a duplicate, watch the unique constraint fire; INSERT bad enum, watch CHECK reject`. The probes succeeded, the agent reported "verified," the commit landed, and the probes vanished into terminal scrollback. The behavior was claimed to work but no committed test would catch a regression.

2. **The probe-while-building-the-replacement pattern.** When the integration-test backfill agent set out to replace pattern (1) with committed Cucumber scenarios, it first ran five `node -e` ad-hoc scripts against pglite to "check" feature support before committing anything. The framework being built to eliminate throwaway probes was being built using throwaway probes.

Both episodes share the same shape: an agent runs a verification, the verification works, the commit ships, and the verification is gone. The next change that breaks the verified behavior ships silently because no test re-runs the check.

The alternatives surveyed:

- **Allow ad-hoc probes; trust the agent's report.** The status quo when this ADR was written. Cheap per probe; catastrophic in aggregate as behaviors accumulate.
- **Allow ad-hoc probes but require a separate "probe → test" follow-up step.** A two-step discipline (verify, then write the regression). In practice the second step is skipped; the first step is psychologically "done" once the answer is known.
- **No ad-hoc probes — every empirical verification is a committed test from the start.** The probe IS the test. The test framework is the runner; the assertion is the answer to the question being asked. The first run of the test answers the question and pins the answer for every future run.

The third option keeps the cost of writing-as-you-probe roughly the same (a Cucumber scenario is ~10 lines; a `node -e` is ~5 lines; the gap is rounding error) and converts every verification into permanent infrastructure.

## Decision

**Every empirical verification of system behavior in `a-conversa` lands as a committed test in the appropriate test layer.** No `node -e`, no `psql -c`, no inline scripts that "check if X works" and disappear.

Layer routing follows the test stack ([ADR 0006](0006-unit-test-framework-vitest.md), [ADR 0007](0007-behavior-test-framework-cucumber.md), [ADR 0008](0008-e2e-framework-playwright.md)):

- **Pure logic** (no I/O, no network, no DB, no browser) → Vitest unit test under `packages/<ws>/src/*.test.ts` or `apps/<app>/src/**/*.test.ts`.
- **Database-touching** (schema constraints, migration runner, fixture loader, projection arithmetic against a real DB) → Cucumber scenario under `tests/behavior/<area>/` with step defs in `tests/behavior/steps/`. Runs against pglite per scenario.
- **Browser- or full-stack-touching** (UI behavior, real-time WebSocket flows, full-stack scenarios) → Playwright spec under `tests/e2e/` (or per-workspace E2E dirs once `dir_layout` is realized). Runs against the compose stack.

Agents — sub-agents and contributors alike — answer empirical questions by writing the test that asks the question, running it, and committing it. The first scenario in a new feature file IS allowed to be the probe; the probe is not allowed to be uncommitted.

## Consequences

- **Every behavior is regression-tested from the moment it's verified.** A migration's constraint that fires "as expected" today will be re-verified by CI on every change forever.
- **Probe cost ≈ test cost.** Writing a Cucumber scenario or a Vitest case takes the same order of magnitude as writing a `node -e` invocation. The "I'll just check quickly" temptation has nothing to recommend it.
- **CI surface grows linearly with system surface.** Each behavior added produces one or more committed tests; the suite reflects the system. This is the intended state, not bloat.
- **Reading-only Bash is fine.** `ls`, `cat`, `grep`, `find`, `git log`, `wc` against committed code are orientation, not verification — they don't run the system under test. The bar applies to Bash that *runs the system under test* (executes a query, applies a migration, opens a connection, fetches a URL, drives a browser): always committed, never interactive.
- **One-shot operational scripts are different from verification probes.** A debugging session's `psql` to look at live data isn't a verification. The distinction: "does this behave as expected" → committed test; "what's currently in the database right now" → fine ad-hoc.
- **Tooling-discovery probes are subject to the same rule.** "Does pglite support `gen_random_uuid()`" / "what does node-pg-migrate's API look like" — these are empirical questions about dependencies. Read the docs first; if you genuinely need to run code, run it as the first scenario of a feature file you commit.
- **Two prior memory files are superseded by this ADR** and were removed: `feedback_no_throwaway_verifications.md` (now this ADR) and the bulk of `feedback_integration_tests_via_cucumber.md` (the layer-mapping content already lives in ADRs 0006/0007/0008's amended Decisions).
- **This is a discipline ADR, not a tooling ADR.** No new dependency or build artifact lands here; the rule shapes how every future test-producing task is dispatched and reviewed.
