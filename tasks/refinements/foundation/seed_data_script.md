# Seed-data script

**TaskJuggler entry**: `foundation.dev_env.seed_data_script` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort**: 1d

## What and why

A script (`make seed`) that loads the example walkthrough fixture from `packages/test-fixtures/` into the running dev database. Lets developers spin up an interesting state immediately to explore the app without running a debate manually.

## Decisions

- Wraps the `loadFixture` helper from `packages/test-fixtures/` (per `seed_data_for_tests.md`).
- Replays through the application's event-append API, exercising the same validation production uses.
- Idempotent: `make seed` can run multiple times safely (drops/recreates the test session each time).
- Default fixture: the example walkthrough.
- Optional flag: `make seed FIXTURE=<name>` for other fixtures.

## Acceptance criteria

- `make seed` populates the dev DB with the walkthrough scenario.
- Reload the dev app: the walkthrough's session is visible and projects to the expected state.
- Subsequent `make seed` runs reset cleanly.

## Status

**Done as a stub** — 2026-05-10.

- [`scripts/seed.ts`](../../../scripts/seed.ts) is the entry point. It parses `--fixture <name>`, `--fixture=<name>`, or the `FIXTURE` env var (default `walkthrough`) and prints the parsed value back. The body is a deferred-implementation stub: it prints a loud "NOT YET IMPLEMENTED" banner naming the two prerequisites and exits 1.
- [`package.json`](../../../package.json) gained a `"seed": "tsx scripts/seed.ts"` script alongside the existing `smoke:*` entries.
- The [`Makefile`](../../../Makefile) `seed:` target previously printed an inline placeholder (added by [`one_command_script`](one_command_script.md)). It now runs `pnpm run seed -- $(if $(FIXTURE),--fixture $(FIXTURE))`, so `make seed` and `make seed FIXTURE=alt` both work and forward the value through to the script. The forwarded `--` token shows up as a literal argument to `tsx`; the script ignores it.
- **Deferred prerequisites** (the real reason the body is stubbed):
  - `packages/test-fixtures/` and the `loadFixture` helper — owned by [`data_and_methodology.schema.seed_data_for_tests`](../data-and-methodology/seed_data_for_tests.md) (per its R22 + R23 decisions).
  - The application's event-append API — first lands with `backend.api_skeleton` (`tasks/20-backend.tji`), and the validation path through it is what R23 wants this script to exercise.
- **When the prerequisites land**, replace the stub body in `scripts/seed.ts` with a `loadFixture(name)` call that posts events through the event-append API, drop the file-header banner, and tighten this Status to a "Done" entry. The CLI / Makefile / package.json wiring stays as-is.
- **Verified** (2026-05-10): `make seed`, `make seed FIXTURE=alt`, and `pnpm run seed -- --fixture experiment` all print the deferred-prereqs banner with `walkthrough`, `alt`, and `experiment` respectively, and exit 1.
