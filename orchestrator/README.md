# orchestrator/

Python driver that loops a planning Claude session ("the orchestrator") with a
sequence of working Claude sessions ("sub-agents"), replacing the
`ORCHESTRATOR.md`-as-startup-prompt approach.

Each iteration is two `claude -p` invocations:

1. **Orchestrator turn** — system prompt at `prompts/orchestrator_system.md`,
   plus the carried-over `context_summary` and the previous sub-agent's
   output. Final assistant message must be a JSON envelope:
   `{"next": {"template": "...", "vars": {...}}, "context_summary": "..."}`
   or `{"stop": "<reason>"}`.
2. **Sub-agent turn** — `prompts/<template>.md` rendered with `vars`, run as
   a fresh top-level Claude session (full freedom to spawn its own sub-agents
   via the `Task` tool — e.g. Explore on Haiku for log scanning).

Both invocations use `--output-format stream-json --verbose` so the driver
prints live event summaries (tool calls, assistant messages, results) as
they arrive. Full event streams are tee'd to `logs/iter-NNNN-<phase>.log`.

## Running

```
cd orchestrator
python3 driver.py
```

No dependencies beyond stdlib. The `.venv` is set up for future use (e.g.
`pytest`) but is not currently required.

Stop with Ctrl-C; in-flight sub-agent processes get SIGTERM'd cleanly.

## Prompts layout

- `prompts/orchestrator_system.md` — orchestrator system prompt (mission,
  read-only rule, pick heuristics, JSON envelope contract).
- `prompts/refinement_writer.md` — refinement-writer sub-agent brief.
  Vars: `$task_id`, `$refinement_path`.
- `prompts/implementer.md` — implementer sub-agent brief.
  Vars: `$refinement_path`.
- `prompts/closer.md` — closer sub-agent brief.
  Vars: `$task_id`, `$refinement_path`, `$implementer_summary`.

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
