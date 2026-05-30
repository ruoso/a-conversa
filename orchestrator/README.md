# orchestrator/

Python driver that loops a planning agent session ("the orchestrator") with a
sequence of working agent sessions ("sub-agents"), replacing the
`ORCHESTRATOR.md`-as-startup-prompt approach.

Each iteration is at least two agent CLI invocations, plus — after every
`implementer` dispatch — a deterministic verification + fixer + closer tail
that the driver owns:

1. **Orchestrator turn** — system prompt at `prompts/orchestrator_system.md`,
   plus the carried-over `context_summary` and the previous sub-agent's
   output. Final assistant message must be a JSON envelope:
   `{"next": {"template": "refinement_writer"|"implementer", "vars": {...}}, "context_summary": "..."}`
   or `{"stop": "<reason>"}`.
2. **Sub-agent turn** — `prompts/<template>.md` rendered with `vars`, run as
   a fresh top-level agent session.
3. **(implementer only) deterministic tail** — the driver runs
   `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`,
   `make test:e2e:compose` (each output tee'd to
   `logs/iter-NNNN-verify-<suite>.log`). On any failure it dispatches the
   `fixer` sub-agent against the failing log and loops (cap:
   `MAX_FIXER_ATTEMPTS=5`). Once all four are green, the driver dispatches
   the `closer` sub-agent (on `CLOSER_MODEL`, default Sonnet) with the
   pass-block as `$test_results`. The closer's return is what feeds back
   into the next orchestrator turn.

All invocations stream JSON so the driver prints live event summaries as they
arrive. Full event streams are tee'd to `logs/iter-NNNN-<phase>.log`.

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

The default CLI is Claude Code. Use Codex CLI with:

```
AGENT_CLI=codex python3 driver.py
```

No dependencies beyond stdlib. The `.venv` is set up for future use (e.g.
`pytest`) but is not currently required.

Stop with Ctrl-C; in-flight sub-agent processes get SIGTERM'd cleanly.
Prompt files are loaded immediately before each dispatch, so edits under
`prompts/` take effect on the next agent turn without restarting the driver.

Before every orchestrator turn, the driver also injects persisted
`orchestrator/state/context_summary.md` snapshots from all registered git
worktrees. The orchestrator uses those snapshots to avoid assigning sibling
worktrees overlapping tasks or workstreams.

## Models

Per-template model selection lives in the selected `AgentCli` adapter:

- Claude uses Sonnet for `orchestrator` / `closer` and Opus for working agents.
- Codex uses `gpt-5.4-mini` for `orchestrator` / `closer` and `gpt-5.4` for
  working agents.

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

For Claude, the driver passes no permission flags to `claude -p`. Whatever
`~/.claude/settings.json` provides as the default is what the sub-agents
get. If headless runs block on tool prompts, add e.g.
`--permission-mode acceptAll` in `ClaudeCli.command()`.

For Codex, the adapter runs
`codex -a never exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true`.
Enabling sandbox network access lets sub-agents reach the local Docker daemon
for compose-based verification without disabling the filesystem sandbox. This
also permits general network access from sandboxed commands; it is not a
Docker-socket-only grant.
