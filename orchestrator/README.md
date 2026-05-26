# orchestrator/

Python driver that loops a planning Claude session ("the orchestrator") with a
sequence of working Claude sessions ("sub-agents"), replacing the
`ORCHESTRATOR.md`-as-startup-prompt approach.

Each iteration is at least two `claude -p` invocations, plus — after every
`implementer` dispatch — a deterministic verification + fixer + closer tail
that the driver owns:

1. **Orchestrator turn** — system prompt at `prompts/orchestrator_system.md`,
   plus the carried-over `context_summary` and the previous sub-agent's
   output. Final assistant message must be a JSON envelope:
   `{"next": {"template": "refinement_writer"|"implementer", "vars": {...}}, "context_summary": "..."}`
   or `{"stop": "<reason>"}`.
2. **Sub-agent turn** — `prompts/<template>.md` rendered with `vars`, run as
   a fresh top-level Claude session (full freedom to spawn its own sub-agents
   via the `Task` tool — e.g. Explore on Haiku for log scanning).
3. **(implementer only) deterministic tail** — the driver runs
   `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`,
   `make test:e2e:compose` (each output tee'd to
   `logs/iter-NNNN-verify-<suite>.log`). On any failure it dispatches the
   `fixer` sub-agent against the failing log and loops (cap:
   `MAX_FIXER_ATTEMPTS=5`). Once all four are green, the driver dispatches
   the `closer` sub-agent (on `CLOSER_MODEL`, default Sonnet) with the
   pass-block as `$test_results`. The closer's return is what feeds back
   into the next orchestrator turn.

All `claude -p` invocations use `--output-format stream-json --verbose` so the
driver prints live event summaries (tool calls, assistant messages, results)
as they arrive. Full event streams are tee'd to `logs/iter-NNNN-<phase>.log`.

## Persistent state

The orchestrator's `context_summary` field is persisted to
`state/context_summary.md` after every orchestrator turn and re-loaded on
the next driver startup, so the loop is resumable across runs (Ctrl-C,
crashes, manual stops). The contents of `state/` are gitignored.

If the verification chain exhausts `MAX_FIXER_ATTEMPTS`, the driver appends
a `## Verification chain exhausted at iter <N>` block to
`state/context_summary.md` and exits non-zero. The next driver run picks
that context back up and the orchestrator sees the failure block on its
first turn — its prompt directs it to `stop` with a `corrupted: ...` reason
so the human user can intervene.

## Running

```
cd orchestrator
python3 driver.py
```

No dependencies beyond stdlib. The `.venv` is set up for future use (e.g.
`pytest`) but is not currently required.

Stop with Ctrl-C; in-flight sub-agent processes get SIGTERM'd cleanly.

## Models

Per-template model selection lives in `TEMPLATE_MODELS` in `driver.py`:

- `ORCH_MODEL` (orchestrator) — Sonnet by default; structured meta-routing.
- `CLOSER_MODEL` (closer) — Sonnet by default; mechanical ritual + commit.
- `SUB_MODEL` (refinement_writer / implementer / fixer) — Opus by default;
  actual code work.

Override via env vars (`ORCH_MODEL`, `SUB_MODEL`, `CLOSER_MODEL`) when you
want to experiment.

## Prompts layout

- `prompts/orchestrator_system.md` — orchestrator system prompt (mission,
  read-only rule, pick heuristics, JSON envelope contract).
- `prompts/refinement_writer.md` — refinement-writer sub-agent brief.
  Vars: `$task_id`, `$refinement_path`.
- `prompts/implementer.md` — implementer sub-agent brief.
  Vars: `$refinement_path` (plus `$task_id` for log labelling).
- `prompts/closer.md` — closer sub-agent brief (driver-internal).
  Vars: `$task_id`, `$refinement_path`, `$implementer_summary`,
  `$test_results`.
- `prompts/fixer.md` — fixer sub-agent brief (driver-internal). Vars:
  `$task_id`, `$refinement_path`, `$implementer_summary`, `$failing_step`,
  `$failing_command`, `$failing_log`, `$prior_attempts`.

Vars are substituted via `string.Template.safe_substitute`, so `$var` is
the substitution syntax — escape literal dollar signs as `$$` (e.g. the
`$$(cat <<'EOF' ...)` HEREDOC in `closer.md`).

Cross-cutting policies (UI-stream e2e, tech-debt registration, test-output
handling, "what sub-agents must NOT do") are embedded into each template
that needs them, since sub-agents are fresh sessions with no shared state.

## Permissions

The driver passes no permission flags to `claude -p`. Whatever
`~/.claude/settings.json` provides as the default is what the sub-agents
get. If headless runs block on tool prompts, add e.g.
`--permission-mode acceptAll` to `CLAUDE_ARGS` in `driver.py`.
