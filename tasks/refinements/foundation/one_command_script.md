# One-command startup script

**TaskJuggler entry**: `foundation.dev_env.one_command_script` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort**: 0.5d

## What and why

A `Makefile` target (`make up`) at the repo root that's the single entry point for "start the dev environment from a clean checkout."

## Decisions

- `make up`: ensures `.env` exists (copy from `.env.example` if not), runs `docker compose up --build`, waits for health, prints URLs.
- `make down`: tears down without deleting volumes.
- `make clean`: tears down and deletes volumes (full reset).
- `make logs`: tails compose logs.
- `make seed`: runs the seed-data script (separate task).
- `make test`: runs unit + behavior + e2e in sequence.

## Acceptance criteria

- Makefile at repo root with the targets above.
- A fresh clone + `make up` produces a working dev stack.
- README's Development section references these targets.
