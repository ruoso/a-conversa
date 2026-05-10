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

## Status

**Done** — 2026-05-10.

- [`Makefile`](../../../Makefile) now wraps the bare compose calls (added by `compose_file`) with friendlier UX: `make up` auto-creates `.env` from `.env.example` if missing (with a printed `[ensuring .env from .env.example]` line), runs `docker compose up -d --build postgres authelia`, sleeps a fixed 15 s (the typical Authelia warmup observed in [ADR 0018 verification](../../../docs/adr/0018-compose-file-three-service-dev-stack.md#verification) — simpler and more reliable than parsing JSON health output), then prints a 4-line URL banner naming `localhost:5432`, `http://localhost:9091`, and `http://localhost:3000` (with a note that the app target waits on `backend.api_skeleton`).
- **Up-vs-up-app split.** The refinement asks for "fresh clone + `make up` produces a working dev stack." That's not honest today: the application's stub entry point (per ADR 0015) exits 0 and `restart: unless-stopped` then re-launches it in a tight loop. So `make up` brings up the working subset — postgres + authelia, both reach `healthy` — and a separate `make up-app` brings up the app service for operators who want to exercise the loop on purpose. Once `backend.api_skeleton` lands, `make up` can fold the app back in without the operator-facing surface changing meaning. The split is also recorded as an Amendment to [ADR 0018](../../../docs/adr/0018-compose-file-three-service-dev-stack.md#amendments).
- **`make seed` is a stub.** The seed-data script doesn't exist yet (it lands with [`foundation.dev_env.seed_data_script`](seed_data_script.md)). Rather than wire a target to a missing script, `make seed` prints a one-line "not yet implemented; see foundation.dev_env.seed_data_script" message and exits 1. The Make target is in place so contributors can discover the eventual entry point; the script itself is deferred.
- **Targets unchanged from `compose_file`.** `down`, `down-v`, `logs`, `ps`, `install`, `test`, `clean` stayed as written; only `up` was wrapped, and `up-app` / `seed` were added. `help` was extended to cover all of them.
- **Verified end-to-end** (2026-05-10): from a state where `.env` did not exist, `make up` printed `[ensuring .env from .env.example]`, created `.env`, brought up postgres and authelia, both reported `healthy` after the 15 s wait (`docker compose ps` confirmed), and the URL banner printed cleanly. `make down-v` then tore the stack down (containers, network, both named volumes removed). `make seed` exits 1 with the documented message. README's "Local development" section now references the up/up-app split and the seed-stub deferral.
