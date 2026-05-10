# Add Development section to README

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.repo_skeleton.readme_dev_section`
**Effort estimate**: 0.25d
**Inherited dependencies**: `foundation.repo_skeleton.dir_layout` (settled)

## What this task is

Replace the current placeholder "Local development" section in `README.md` with concrete instructions: prerequisites, first-run setup, the one-command startup, where to find what.

## Why it needs to be done

The README is the front door of the repo. Currently the Local development section says "the dev environment runs entirely locally via Docker Compose — a single command brings up the application, PostgreSQL, and a local OAuth provider," which describes the *intent*. Once the dev compose stack actually works, this section needs to tell a contributor what to do.

## Inputs / context

By the time this task runs, the following are in place:

- `dir_layout` (R3): pnpm workspaces, apps and packages structure, Makefile at root.
- `editorconfig`, `gitignore`, `linter_config` (ESLint), `formatter_config` (Prettier), `typecheck_config` (strict TS with project references).
- `pre_commit_hooks` (Husky + lint-staged).

By the time `dev_env.compose_file` and `dev_env.one_command_script` land (downstream — round 5+ when foundation.dev_env opens up), the actual `make up` command will exist. This task may need a small revision then.

## Constraints / requirements

- Mentions concrete prerequisites (Docker, Node version, pnpm version).
- Documents the one-command startup story.
- Points to where each surface (moderator UI, participant tablet UI, audience surface) is served on localhost.
- Includes how to run tests (unit, behavior, e2e).
- Includes how to use the seeded fixture data for local testing.
- Stays terse — README is the front door, not the manual. Detailed contributor docs live elsewhere if they exist.

## Acceptance criteria

- README.md "Local development" section updated with:
  - Prerequisites (concrete: Docker, Node version, pnpm version).
  - One-command startup (`make up` or equivalent).
  - Where each surface is served on localhost.
  - How to run unit tests, behavior tests, and Playwright E2E.
  - How to load a seeded fixture for manual exploration.
  - Pointer to a `CONTRIBUTING.md` if/when one exists.

## Decisions

- **Lives in README.md** (not a separate `DEVELOPMENT.md`), following the repo's convention of keeping the front door rich.
- **Stays under ~30 lines.** README is for orientation; deep docs live elsewhere.

## Additional decisions

- **CONTRIBUTING.md is a separate future task** (R25). Not part of this work. The README's Development section is enough until contributor onboarding becomes a real concern.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10 — see the "Local development" section in [`README.md`](../../../README.md). Replaces the earlier intended-state placeholder and folds in the pre-commit paragraph that `pre_commit_hooks` had inserted with a forward-pointer to this task.

The new section follows the structure agreed in the spec: one-line intro, *Prerequisites*, *First-run setup*, *What works today*, *What's planned*, *Pre-commit hook*, plus pointers at the [Makefile](../../../Makefile) and [pnpm-workspace.yaml](../../../pnpm-workspace.yaml). It stays close to the ~30-line target.

**Carry-over — revisit when `dev_env.compose_file` lands** (and its sibling tasks `one_command_script` and `seed_data_script`): at that point `make up`, the seeded-fixture instructions, and the served-surface URLs (`/moderator`, `/participant`, `/audience`, `/replay`) move from "planned" to "what works today". `dev_env.dev_env_docs` is the natural place to do that pass; this refinement should be touched again then to flip the wording.
