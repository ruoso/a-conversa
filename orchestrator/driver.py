#!/usr/bin/env python3
"""Orchestrator driver — alternates one orchestrator turn with one sub-agent turn.

Each iteration:
  1. Spawn `claude -p` for the orchestrator with the system prompt + carried-over
     context_summary + last sub-agent return. Capture its final assistant message.
  2. Parse that message as a JSON envelope: `{"stop": "..."}` to exit, or
     `{"next": {"template": "...", "vars": {...}}, "context_summary": "..."}`.
  3. Load the named template from prompts/<template>.md, substitute vars,
     spawn `claude -p` for the sub-agent. Capture its final assistant message.
  4. Carry the sub-agent's output + the orchestrator's context_summary into
     the next iteration.

Each `claude -p` invocation runs with `--output-format stream-json --verbose` so
the driver can print live progress (tool calls, assistant text) as events arrive.
The full event stream is tee'd to `orchestrator/logs/iter-NNNN-<phase>.log` for
post-mortem.

No session resume: each invocation is a fresh top-level session. Sub-agents have
full Agent-tool freedom (can spawn their own Explore on Haiku for log scanning,
etc.) since they are real top-level sessions, not Claude Code sub-agents
constrained by the parent.

Permissions: this driver passes no permission flags to `claude -p`. Whatever
default mode `~/.claude/settings.json` provides is what sub-agents get. If
headless runs block on tool permissions, add the appropriate `--permission-mode`
flag in `CLAUDE_ARGS` below.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import string
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — py<3.9
    ZoneInfo = None  # type: ignore[assignment]

REPO_ROOT = Path(__file__).resolve().parent.parent
ORCH_DIR = Path(__file__).resolve().parent
PROMPTS_DIR = ORCH_DIR / "prompts"
LOG_DIR = ORCH_DIR / "logs"
STATE_DIR = ORCH_DIR / "state"
CONTEXT_FILE = STATE_DIR / "context_summary.md"
SYSTEM_PROMPT_PATH = PROMPTS_DIR / "orchestrator_system.md"

# Maximum number of fixer dispatches before the driver gives up on a
# failing verification chain. On exhaustion the driver appends a failure
# block to CONTEXT_FILE and exits non-zero — re-running the driver picks
# the persisted context back up so the orchestrator sees the failure on
# its next turn.
MAX_FIXER_ATTEMPTS = 5

# Verification chain run deterministically by the driver after every
# implementer dispatch. Each entry is (display_name, argv). The driver
# tees output to a per-iteration log file and short-circuits to the
# fixer the moment any step fails.
VERIFICATION_STEPS: list[tuple[str, list[str]]] = [
    ("check", ["pnpm", "run", "check"]),
    ("vitest", ["pnpm", "run", "test:smoke"]),
    ("cucumber", ["pnpm", "run", "test:behavior:smoke"]),
    ("playwright", ["make", "test:e2e:compose"]),
]

# Flags appended to every `claude -p` invocation. stream-json + verbose gives
# live event visibility; both are required together for headless mode.
CLAUDE_ARGS = ["--output-format", "stream-json", "--verbose"]

# Model split:
#  - Orchestrator and closer do structured meta-work (parse prior return,
#    emit envelope, append Status block, register WBS rows, write commit
#    message) — Sonnet handles both well at a fraction of the cost.
#  - Implementer / refinement_writer / fixer do actual code work and get Opus.
# Override at the command line via env vars when you want to experiment.
ORCH_MODEL = os.environ.get("ORCH_MODEL", "claude-sonnet-4-6")
SUB_MODEL = os.environ.get("SUB_MODEL", "claude-opus-4-7")
CLOSER_MODEL = os.environ.get("CLOSER_MODEL", "claude-sonnet-4-6")

# Per-template model selection. Anything not listed falls back to SUB_MODEL.
TEMPLATE_MODELS: dict[str, str] = {
    "closer": CLOSER_MODEL,
}


def model_for_template(name: str) -> str:
    return TEMPLATE_MODELS.get(name, SUB_MODEL)

# Max chars of a single assistant text block printed inline. Longer text is
# truncated with a "(+N more)" tail. The full text is always in the log file.
TEXT_PREVIEW_CHARS = 400

# Tool names that spawn sub-agents. The headless-mode tools list advertises
# "Task", but the model actually emits `tool_use` blocks with `name: "Agent"`
# — match either so chain registration catches sub-agent spawns regardless.
AGENT_TOOL_NAMES = {"Task", "Agent"}

# ---------------------------------------------------------------------------
# Pretty printer for streamed events
# ---------------------------------------------------------------------------

USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str) -> str:
    return code if USE_COLOR else ""


RESET = _c("\033[0m")
DIM = _c("\033[2m")
BOLD = _c("\033[1m")
RED = _c("\033[31m")
GREEN = _c("\033[32m")
YELLOW = _c("\033[33m")
BLUE = _c("\033[34m")
MAGENTA = _c("\033[35m")
CYAN = _c("\033[36m")
GRAY = _c("\033[90m")


ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def term_width() -> int:
    """Current terminal width (re-detected per call so it tracks resizes).
    Falls back to 80 when not a TTY (piped to file, etc.)."""
    return shutil.get_terminal_size((80, 24)).columns


def visible_len(s: str) -> int:
    """Length without ANSI escape sequences."""
    return len(ANSI_RE.sub("", s))


def _ansi_atoms(text: str) -> list[tuple[str, int]]:
    """Tokenize into (string, visible_width) atoms. ANSI sequences are
    zero-width; characters are width 1."""
    atoms: list[tuple[str, int]] = []
    i = 0
    while i < len(text):
        m = ANSI_RE.match(text, i)
        if m:
            atoms.append((m.group(0), 0))
            i = m.end()
        else:
            atoms.append((text[i], 1))
            i += 1
    return atoms


def _continuation_prefix(line: str) -> str:
    """For a line about to be wrapped, derive the prefix to repeat on
    continuation lines so they visually align under the original. Preserves
    leading whitespace and a `│ ` bar marker (the multi-line continuation
    pattern used by fmt_kv and chain_prefix), so wrapped content stays
    nested under its parent."""
    plain = ANSI_RE.sub("", line)
    n_lead = len(plain) - len(plain.lstrip(" \t"))
    indent = line[:n_lead]  # leading whitespace contains no ANSI in our output
    rest = plain[n_lead:]
    # Match any number of leading "│<label>? " markers (single or chained)
    # so that wrapped events under `│A `/`│A │B ` keep their full chain.
    bar_prefix = ""
    j = 0
    while True:
        if j >= len(rest) or rest[j] != "│":
            break
        # consume optional label chars (single letters) and the trailing space
        k = j + 1
        while k < len(rest) and rest[k].isalpha():
            k += 1
        if k >= len(rest) or rest[k] != " ":
            break
        bar_prefix += rest[j:k + 1]
        j = k + 1
    if bar_prefix:
        # Reconstruct with dim formatting consistent with chain_prefix/fmt_kv.
        return indent + bar_prefix
    return indent + "  "


def print_wrapped(line: str = "") -> None:
    """Print a line, word-wrapping to current terminal width (ANSI-aware).
    Continuation lines are prefixed with the leading whitespace + any `│ `
    bar marker(s) the original line started with, so nested content stays
    nested when wrapped."""
    width = term_width()
    if visible_len(line) <= width or width <= 20:
        print(line, flush=True)
        return

    # Continuation prefix is reconstructed in plain form (no extra ANSI) to
    # match what the original line had — the ANSI codes in the original
    # prefix are already in `line` itself.
    cont = _continuation_prefix(line)
    cont_visible = visible_len(cont)
    if width - cont_visible < 20:
        print(line, flush=True)
        return

    atoms = _ansi_atoms(line)
    cont_atoms = _ansi_atoms(cont)
    out: list[str] = []
    current: list[tuple[str, int]] = []
    current_width = 0
    last_space_idx = -1

    for atom in atoms:
        ch, w = atom
        if w == 0:
            current.append(atom)
            continue
        if current_width + w > width and current_width > cont_visible:
            # Wrap: cut at last space if we have one, else hard-break.
            if last_space_idx >= 0:
                line_part = current[:last_space_idx]
                remainder = current[last_space_idx + 1 :]  # drop the space
            else:
                line_part = current
                remainder = []
            out.append("".join(a[0] for a in line_part))
            current = cont_atoms + remainder
            current_width = sum(a[1] for a in current)
            # Re-scan for last_space_idx, but only within the remainder
            # portion — spaces inside the cont prefix itself are not valid
            # wrap points (cutting there would emit a half-prefix line).
            last_space_idx = -1
            for k in range(len(cont_atoms), len(current)):
                a = current[k]
                if a[1] == 1 and a[0] == " ":
                    last_space_idx = k
        current.append(atom)
        current_width += atom[1]
        if ch == " ":
            last_space_idx = len(current) - 1

    if current:
        out.append("".join(a[0] for a in current))

    for ln in out:
        print(ln, flush=True)


def banner(title: str) -> str:
    bar = "═" * max(4, 78 - len(title) - 4)
    return f"\n{BOLD}{YELLOW}═══ {title} {bar}{RESET}"


def label_for(n: int) -> str:
    """0→A, 1→B, ..., 25→Z, 26→AA, 27→AB, ..."""
    if n < 26:
        return chr(ord("A") + n)
    return chr(ord("A") + (n // 26) - 1) + chr(ord("A") + n % 26)


def fmt_kv(key: str, value: Any, base_indent: int = 4) -> list[str]:
    """Render one key-value pair. Short single-line values render inline
    (`key: value`); long or multi-line values get a `│ `-prefixed
    continuation block."""
    text = str(value).rstrip()
    base = " " * base_indent
    cont = " " * (base_indent + 2)
    if "\n" not in text and len(text) <= 100:
        return [f"{base}{DIM}{key}:{RESET} {text}"]
    out = [f"{base}{DIM}{key}:{RESET}"]
    for ln in text.split("\n"):
        out.append(f"{cont}{DIM}│{RESET} {ln}")
    return out


def fmt_vars_passed(vars: dict) -> list[str]:
    """Block shown right after a sub-agent banner — what the orchestrator
    actually filled into the template's `$var`s for this dispatch."""
    if not vars:
        return [f"  {DIM}↳ vars passed: (none){RESET}"]
    out = [f"  {DIM}↳ vars passed:{RESET}"]
    for key, value in vars.items():
        out.extend(fmt_kv(key, value, base_indent=4))
    return out


def fmt_envelope(env: dict) -> list[str]:
    """Block shown after the orchestrator's stream — the structured envelope
    it produced, parsed out of the trailing JSON. Distilled view alongside
    the raw JSON the orchestrator already emitted as its last assistant
    block."""
    out: list[str] = []
    if "stop" in env:
        out.append(f"  {DIM}↳{RESET} {BOLD}{RED}stop:{RESET} {env['stop']}")
    elif "next" in env:
        next_spec = env["next"]
        template = next_spec.get("template", "?")
        out.append(
            f"  {DIM}↳ envelope:{RESET} dispatch {BOLD}{CYAN}{template}{RESET}"
        )
        for key, value in (next_spec.get("vars") or {}).items():
            out.extend(fmt_kv(key, value, base_indent=4))
    cs = (env.get("context_summary") or "").rstrip()
    if cs:
        out.extend(fmt_kv("context_summary", cs, base_indent=2))
    return out


def fmt_returned(text: str) -> list[str]:
    """Block shown after a sub-agent's stream — the final assistant message
    that gets handed back to the orchestrator on the next turn."""
    return fmt_kv(
        "↳ returned to orchestrator",
        text.rstrip() or "(empty)",
        base_indent=2,
    )


def chain_prefix(chain: list[str]) -> str:
    """Visual prefix encoding the sub-agent path: empty chain → 2-space base
    indent; chain ["A"] → `  │A `; chain ["A","B"] → `  │A │B `. Each label
    identifies the specific sub-agent owning that depth level, so parallel
    sub-agents at the same depth (e.g. `│A` and `│B`) stay distinguishable
    in interleaved streams."""
    if not chain:
        return "  "
    parts = [f"{DIM}│{RESET}{BOLD}{YELLOW}{label}{RESET} " for label in chain]
    return "  " + "".join(parts)


def _shorten(text: str, limit: int) -> str:
    text = text.replace("\n", " ⏎ ")
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _block_text(text: str, limit: int = TEXT_PREVIEW_CHARS) -> str:
    """Multi-line aware text preview: keep first ~5 lines, count the rest."""
    text = text.rstrip()
    if not text:
        return ""
    lines = text.split("\n")
    if len(text) <= limit and len(lines) <= 8:
        return text
    head = "\n".join(lines[:6])
    if len(head) > limit:
        head = head[: limit - 1] + "…"
    extra_lines = len(lines) - 6 if len(lines) > 6 else 0
    extra_chars = len(text) - len(head)
    suffix = []
    if extra_lines > 0:
        suffix.append(f"+{extra_lines} more lines")
    elif extra_chars > 0:
        suffix.append(f"+{extra_chars} more chars")
    return head + (f" {DIM}({', '.join(suffix)}){RESET}" if suffix else "")


def fmt_tool_use(name: str, inp: dict, label: str = "") -> str:
    """One-line, tool-aware preview of a tool_use block. ``label`` (when set)
    is shown immediately after the tool name in `[X]` form — used for Task
    tool_uses so the spawning call and the eventual tool_result both carry
    the same identifier as the sub-agent's interleaved events."""
    label_tag = f"{BOLD}{YELLOW}[{label}]{RESET}" if label else ""
    head = f"{CYAN}→ {name}{RESET}{label_tag}"
    if name == "Bash":
        return f"{head} {DIM}${RESET} {_shorten(inp.get('command', ''), 120)}"
    if name == "Read":
        rng = ""
        if "offset" in inp or "limit" in inp:
            rng = f" {DIM}[L{inp.get('offset', '?')}+{inp.get('limit', '?')}]{RESET}"
        return f"{head} {inp.get('file_path', '?')}{rng}"
    if name in ("Edit", "Write", "NotebookEdit"):
        return f"{head} {inp.get('file_path', '?')}"
    if name == "Grep":
        pattern = _shorten(inp.get("pattern", "?"), 60)
        path = inp.get("path", "")
        return f"{head} /{pattern}/{(' ' + path) if path else ''}"
    if name == "Agent":
        st = inp.get("subagent_type", "?")
        desc = _shorten(inp.get("description", ""), 80)
        return f"{head}({st}) {DIM}{desc}{RESET}"
    if name == "WebFetch":
        return f"{head} {inp.get('url', '?')}"
    if name == "WebSearch":
        return f"{head} {_shorten(inp.get('query', '?'), 80)}"
    if name == "ToolSearch":
        return f"{head} {_shorten(inp.get('query', '?'), 80)}"
    if name == "TaskCreate":
        tasks = inp.get("tasks") or [inp]
        first = tasks[0] if tasks else {}
        desc = first.get("content") or first.get("description") or ""
        more = f" {DIM}(+{len(tasks) - 1} more){RESET}" if len(tasks) > 1 else ""
        return f"{head} {_shorten(desc, 80)}{more}"
    if name in ("TaskUpdate", "TaskGet", "TaskStop", "TaskOutput", "TaskList"):
        return f"{head} {_shorten(json.dumps(inp, ensure_ascii=False), 80)}"
    try:
        preview = _shorten(json.dumps(inp, ensure_ascii=False), 100)
    except (TypeError, ValueError):
        preview = _shorten(str(inp), 100)
    return f"{head} {DIM}{preview}{RESET}"


def fmt_tool_result(content: Any, is_error: bool, label: str = "") -> str:
    label_tag = f" {BOLD}{YELLOW}[{label}]{RESET}" if label else ""
    arrow = (
        f"{RED}← ERR{RESET}{label_tag}"
        if is_error
        else f"{GREEN}← ok{RESET}{label_tag}"
    )
    if isinstance(content, list):
        text = " ".join(
            c.get("text", "") if isinstance(c, dict) else str(c) for c in content
        )
    else:
        text = str(content)
    size = len(text)
    if size <= 100:
        body = _shorten(text, 100)
    else:
        first = text.strip().split("\n", 1)[0]
        body = f"{_shorten(first, 80)} {DIM}({size} chars){RESET}"
    return f"{arrow} {DIM}{body}{RESET}" if not is_error else f"{arrow} {body}"


def pretty_event(event: dict, block_labels: Optional[dict] = None) -> list[str]:
    """Return zero-or-more pretty lines for one stream-json event.

    ``block_labels`` (when set) maps tool_use_id → sub-agent label, so Task
    tool_use blocks and the eventual tool_result blocks both render with
    `[X]` tags matching the sub-agent's chain prefix on its interleaved
    events.
    """
    block_labels = block_labels or {}
    et = event.get("type")
    if et == "system":
        sub = event.get("subtype", "?")
        if sub == "init":
            model = event.get("model", "?")
            tools = event.get("tools") or []
            return [f"{DIM}● init{RESET} model={model} tools={len(tools)}"]
        if sub == "task_progress":
            # Sub-agent progress beacon — the parent emits these periodically
            # while a Task call is in flight. Caller renders this with the
            # sub-agent's chain prefix (looked up via event["tool_use_id"]).
            desc = event.get("description", "(no description)")
            last_tool = event.get("last_tool_name", "")
            usage = event.get("usage") or {}
            n_uses = usage.get("tool_uses")
            dur_ms = usage.get("duration_ms")
            stats = []
            if last_tool:
                stats.append(last_tool)
            if isinstance(n_uses, int):
                stats.append(f"{n_uses} call{'s' if n_uses != 1 else ''}")
            if isinstance(dur_ms, (int, float)):
                stats.append(f"{dur_ms / 1000:.1f}s")
            stats_s = f" {DIM}({', '.join(stats)}){RESET}" if stats else ""
            return [f"{CYAN}▸{RESET} {desc}{stats_s}"]
        return [f"{DIM}● {sub}{RESET}"]
    if et == "assistant":
        msg = event.get("message", {})
        out: list[str] = []
        for block in msg.get("content", []):
            bt = block.get("type")
            if bt == "text":
                txt = block.get("text", "")
                preview = _block_text(txt)
                if preview:
                    first, *rest = preview.split("\n")
                    out.append(f"{BOLD}◆{RESET} {first}")
                    for ln in rest:
                        out.append(f"  {ln}")
            elif bt == "tool_use":
                label = block_labels.get(block.get("id", ""), "")
                out.append(
                    fmt_tool_use(
                        block.get("name", "?"),
                        block.get("input", {}),
                        label=label,
                    )
                )
            elif bt == "thinking":
                txt = block.get("thinking", "")
                if txt.strip():
                    out.append(f"{MAGENTA}{DIM}(thinking) {_shorten(txt, 140)}{RESET}")
        return out
    if et == "user":
        msg = event.get("message", {})
        out = []
        for block in msg.get("content", []):
            if block.get("type") == "tool_result":
                label = block_labels.get(block.get("tool_use_id", ""), "")
                out.append(
                    fmt_tool_result(
                        block.get("content", ""),
                        block.get("is_error", False),
                        label=label,
                    )
                )
        return out
    if et == "result":
        sub = event.get("subtype", "?")
        err = bool(event.get("is_error"))
        dur_ms = event.get("duration_ms")
        cost = event.get("total_cost_usd")
        symbol = f"{RED}✗{RESET}" if err else f"{GREEN}✓{RESET}"
        dur = f"{dur_ms / 1000:.1f}s" if isinstance(dur_ms, (int, float)) else "?"
        cost_s = f" {DIM}${cost:.4f}{RESET}" if isinstance(cost, (int, float)) else ""
        return [f"{symbol} {sub} · {dur}{cost_s}"]
    return [f"{DIM}● event {et}{RESET}"]


# ---------------------------------------------------------------------------
# Templates + Claude invocation
# ---------------------------------------------------------------------------


def load_template(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(
            f"template '{name}' not found at {path} — port the brief from ORCHESTRATOR.md"
        )
    return path.read_text()


def render_template(template: str, vars: dict) -> str:
    # `additional_context` is optional — the orchestrator may set it in the
    # envelope's vars to pass situation-specific guidance ("the last sub-agent
    # flagged X as deferred debt, prioritize it", "watch for regression in
    # Y"). Default to `(none)` so the section renders cleanly when omitted.
    merged = {"additional_context": "(none)", **vars}
    return string.Template(template).safe_substitute(merged)


# `claude -p` reports a hit 5-hour or weekly session limit via:
#   • assistant text block "You've hit your session limit · resets 11:50pm (America/New_York)"
#   • a `result` event with `is_error: true` + `api_error_status: 429`
# We key off the 429 result event and parse the reset clock-time + IANA tz out
# of its `result` field so the driver can sleep until the window reopens.
SESSION_LIMIT_RE = re.compile(
    r"session limit.*?resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)",
    re.IGNORECASE,
)


class SessionLimitError(RuntimeError):
    """Raised when `claude -p` exits because the account's session limit was
    hit. Carries the parsed reset datetime so callers can sleep until then."""

    def __init__(self, reset_at: datetime, message: str):
        super().__init__(f"session limit hit; resets at {reset_at.isoformat()}")
        self.reset_at = reset_at
        self.message = message


def parse_session_limit_reset(text: str) -> Optional[datetime]:
    """Parse a 'resets 11:50pm (America/New_York)' phrase into the next future
    datetime matching that wall-clock time in that timezone. Returns None if
    no pattern matches or the timezone is unrecognized."""
    m = SESSION_LIMIT_RE.search(text)
    if not m or ZoneInfo is None:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    if m.group(3).lower() == "pm" and hour != 12:
        hour += 12
    elif m.group(3).lower() == "am" and hour == 12:
        hour = 0
    try:
        tz = ZoneInfo(m.group(4).strip())
    except Exception:
        return None
    now = datetime.now(tz)
    reset = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if reset <= now:
        reset += timedelta(days=1)
    return reset


def wait_until_reset(reset_at: datetime, buffer_seconds: int = 30) -> None:
    """Sleep until `reset_at` (plus a small buffer), printing one line on
    entry and one on resume. Interruptible via Ctrl-C."""
    now = datetime.now(reset_at.tzinfo)
    remaining = (reset_at - now).total_seconds() + buffer_seconds
    if remaining <= 0:
        return
    mins, secs = divmod(int(remaining), 60)
    hrs, mins = divmod(mins, 60)
    dur = (f"{hrs}h" if hrs else "") + f"{mins}m{secs}s"
    local_reset = reset_at.astimezone()
    print_wrapped(
        f"{YELLOW}⏸  session limit — sleeping {dur} until "
        f"{local_reset.strftime('%H:%M:%S %Z')} (+{buffer_seconds}s buffer){RESET}"
    )
    try:
        time.sleep(remaining)
    except KeyboardInterrupt:
        print_wrapped(f"{RED}⏵  wait interrupted{RESET}")
        raise
    print_wrapped(f"{GREEN}⏵  resuming{RESET}")


def run_claude_with_session_retry(prompt: str, log_path: Path, model: str) -> str:
    """Wrap run_claude with auto-retry on SessionLimitError. Failed-attempt
    logs are preserved with `.attempt-N` suffix so the post-mortem chain
    survives the retry."""
    attempt = 0
    while True:
        try:
            return run_claude(prompt, log_path, model)
        except SessionLimitError as e:
            attempt += 1
            failed = log_path.with_suffix(log_path.suffix + f".attempt-{attempt}")
            try:
                log_path.rename(failed)
            except OSError:
                pass
            wait_until_reset(e.reset_at)


def run_claude(prompt: str, log_path: Path, model: str) -> str:
    """Run `claude -p <prompt>` with streaming, tee events to log, return the final assistant text.

    Returns the `result` event's `result` field (the final assistant message). Raises
    RuntimeError if the process exits non-zero or no result event is seen.
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["claude", "-p", prompt, "--model", model, *CLAUDE_ARGS]
    final_text: Optional[str] = None
    # Set when a `result` event reports HTTP 429 (account session limit).
    # We let the process exit normally, then convert the rc!=0 into a
    # SessionLimitError so the outer wrapper can sleep + retry.
    session_reset: Optional[datetime] = None
    session_message: str = ""
    # Task tool_use_id -> chain of labels (e.g. ["A"], ["A", "B"] for nested).
    # When a Task tool_use is seen, we mint a new label (A, B, C, ...) and
    # register the entry. While the sub-agent runs, the parent emits
    # `system/task_progress` events whose `tool_use_id` matches the spawning
    # Task call — we look up the chain there to render each progress line
    # under the right `│A`/`│B` prefix. When the matching `tool_result`
    # comes back, we drop the entry.
    chains: dict[str, list[str]] = {}
    label_counter = 0
    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,  # merge so warnings show up in the same stream
        text=True,
        bufsize=1,
    )
    try:
        with log_path.open("w") as logf:
            logf.write(f"---PROMPT---\n{prompt}\n\n---STREAM---\n")
            logf.flush()
            assert proc.stdout is not None
            for raw in proc.stdout:
                logf.write(raw)
                logf.flush()
                line = raw.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    print_wrapped(f"  {DIM}[non-json] {_shorten(line, 200)}{RESET}")
                    continue
                # Sub-agent activity comes through the stream two ways:
                #   1. `system/task_progress` events (the high-level progress
                #      beacon) carry `tool_use_id` pointing at the spawning
                #      Agent call.
                #   2. The sub-agent's own `assistant` and `user` events
                #      (its real tool_use / tool_result blocks) carry
                #      `parent_tool_use_id` pointing at the same Agent call.
                # Look up the chain via whichever field is present so both
                # kinds render with the sub-agent's `│A ` prefix.
                chain: list[str] = []
                parent_ref: Optional[str] = event.get("parent_tool_use_id")
                if (
                    parent_ref is None
                    and event.get("type") == "system"
                    and event.get("subtype") == "task_progress"
                ):
                    parent_ref = event.get("tool_use_id")
                if parent_ref and parent_ref in chains:
                    chain = chains[parent_ref]

                # Pass 1: build block_labels so the Task call line carries
                # the new sub-agent's label, and tool_result lines carry the
                # returning sub-agent's label.
                block_labels: dict[str, str] = {}
                if event.get("type") == "assistant":
                    for block in event.get("message", {}).get("content", []):
                        if (
                            block.get("type") == "tool_use"
                            and block.get("name") in AGENT_TOOL_NAMES
                        ):
                            tid = block.get("id")
                            if tid:
                                new_label = label_for(label_counter)
                                label_counter += 1
                                chains[tid] = chain + [new_label]
                                block_labels[tid] = new_label
                elif event.get("type") == "user":
                    for block in event.get("message", {}).get("content", []):
                        if block.get("type") == "tool_result":
                            tid = block.get("tool_use_id")
                            if tid in chains:
                                block_labels[tid] = chains[tid][-1]

                prefix = chain_prefix(chain)
                for pretty_line in pretty_event(event, block_labels=block_labels):
                    print_wrapped(f"{prefix}{pretty_line}")

                # Pass 2: clean up sub-agent chains after printing (so the
                # tool_result line above still got the right label).
                if event.get("type") == "user":
                    for block in event.get("message", {}).get("content", []):
                        if block.get("type") == "tool_result":
                            chains.pop(block.get("tool_use_id", ""), None)

                # Only top-level result events feed back to the orchestrator —
                # sub-agent result events (if Claude ever streams them) would
                # carry parent_tool_use_id and shouldn't clobber final_text.
                if event.get("type") == "result" and not parent_ref:
                    final_text = event.get("result", "")
                    if (
                        event.get("is_error")
                        and event.get("api_error_status") == 429
                    ):
                        reset = parse_session_limit_reset(final_text or "")
                        if reset is not None:
                            session_reset = reset
                            session_message = (final_text or "").strip()
            rc = proc.wait()
            logf.write(f"\n---RC---\n{rc}\n")
    except KeyboardInterrupt:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        raise
    if rc != 0:
        if session_reset is not None:
            raise SessionLimitError(session_reset, session_message)
        raise RuntimeError(f"claude -p failed (rc={rc}); see {log_path}")
    if final_text is None:
        raise RuntimeError(f"claude -p produced no `result` event; see {log_path}")
    return final_text


def parse_envelope(text: str) -> dict:
    """Extract a JSON envelope from the orchestrator's final assistant message.

    Accepts either pure JSON or a fenced ```json block. If multiple fenced
    blocks are present, takes the last one (the trailing envelope).
    """
    body = text.strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        pass
    blocks = re.findall(r"```(?:json)?\s*\n(.*?)\n```", body, re.DOTALL)
    if not blocks:
        raise ValueError(
            f"no JSON envelope found in orchestrator output (tail):\n{body[-2000:]}"
        )
    return json.loads(blocks[-1])


def build_orchestrator_prompt(
    system_prompt: str,
    context_summary: str,
    last_subagent_output: Optional[str],
    iteration: int,
) -> str:
    parts = [system_prompt, "", "---", ""]
    if iteration == 0 and not context_summary and not last_subagent_output:
        parts.append("This is the first iteration. No prior context.")
    else:
        parts.append("## Context from prior iterations")
        parts.append("")
        parts.append(context_summary or "(none)")
        parts.append("")
        parts.append("## Sub-agent return from last iteration")
        parts.append("")
        parts.append(last_subagent_output or "(none)")
    parts.append("")
    parts.append(
        "Decide the next action and emit a single JSON envelope as your final response."
    )
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Persistent state — context_summary survives across driver invocations
# ---------------------------------------------------------------------------


def load_context_summary() -> str:
    """Read the persisted context_summary if any. The file is a free-form
    markdown blob the orchestrator owns turn-to-turn; the driver only reads
    it at startup and rewrites it after each orchestrator turn (plus appends
    a failure block when the verification chain exhausts its fixer budget)."""
    if not CONTEXT_FILE.exists():
        return ""
    return CONTEXT_FILE.read_text().rstrip()


def save_context_summary(text: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    CONTEXT_FILE.write_text(text.rstrip() + "\n")


def append_context_failure(block: str) -> None:
    """Append a failure section to CONTEXT_FILE so the next driver run
    surfaces it to the orchestrator. Used when MAX_FIXER_ATTEMPTS is hit."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    existing = CONTEXT_FILE.read_text() if CONTEXT_FILE.exists() else ""
    sep = "\n\n" if existing and not existing.endswith("\n\n") else ""
    CONTEXT_FILE.write_text(existing + sep + block.rstrip() + "\n")


# ---------------------------------------------------------------------------
# Deterministic verification + fixer + auto-closer chain
# ---------------------------------------------------------------------------


def run_verification_step(name: str, argv: list[str], log_path: Path) -> int:
    """Run one verification command, teeing stdout+stderr to log_path.
    Returns the process return code. Does not raise on non-zero rc."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    print_wrapped(
        f"  {CYAN}▸{RESET} verify[{BOLD}{name}{RESET}] "
        f"{DIM}${RESET} {' '.join(argv)} {DIM}→ {log_path}{RESET}"
    )
    with log_path.open("w") as logf:
        logf.write(f"---CMD---\n{' '.join(argv)}\n\n---OUTPUT---\n")
        logf.flush()
        proc = subprocess.run(
            argv,
            cwd=str(REPO_ROOT),
            stdout=logf,
            stderr=subprocess.STDOUT,
        )
        logf.write(f"\n---RC---\n{proc.returncode}\n")
    symbol = f"{GREEN}✓{RESET}" if proc.returncode == 0 else f"{RED}✗{RESET}"
    print_wrapped(f"    {symbol} {name} rc={proc.returncode}")
    return proc.returncode


def format_test_results(results: list[tuple[str, int, Path]]) -> str:
    lines = []
    for name, rc, log in results:
        status = "PASS" if rc == 0 else f"FAIL (rc={rc})"
        lines.append(f"- {name}: {status} (log: {log.relative_to(REPO_ROOT)})")
    return "\n".join(lines)


def run_post_implementer_chain(
    iteration: int,
    template_vars: dict,
    implementer_summary: str,
) -> str:
    """After the implementer returns, run the deterministic verification
    chain, dispatch the fixer on any failure (up to MAX_FIXER_ATTEMPTS), and
    finally dispatch the closer with a `$test_results` block confirming all
    suites green. Returns the closer's final assistant message so the
    orchestrator's next turn sees it as `last_subagent_output`.

    On fixer exhaustion: append a failure block to CONTEXT_FILE and
    sys.exit(1). The next driver run will re-load the appended context and
    the orchestrator will see the failure on its next turn."""
    task_id = template_vars.get("task_id", "")
    refinement_path = template_vars.get("refinement_path", "")
    combined_summary = implementer_summary
    fixer_attempts = 0
    fix_history: list[str] = []

    while True:
        # --- verification chain ----------------------------------------------
        print_wrapped(banner(f"iter {iteration} · verification"))
        results: list[tuple[str, int, Path]] = []
        failing: Optional[tuple[str, list[str], Path]] = None
        for name, argv in VERIFICATION_STEPS:
            log_path = LOG_DIR / f"iter-{iteration:04d}-verify-{name}.log"
            rc = run_verification_step(name, argv, log_path)
            results.append((name, rc, log_path))
            if rc != 0:
                failing = (name, argv, log_path)
                break

        if failing is None:
            # All four steps passed — proceed to closer.
            test_results_block = format_test_results(results)
            print_wrapped(
                f"  {GREEN}● verification green — dispatching closer{RESET}"
            )
            closer_vars = {
                "task_id": task_id,
                "refinement_path": refinement_path,
                "implementer_summary": combined_summary,
                "test_results": test_results_block,
            }
            closer_template = load_template("closer")
            closer_prompt = render_template(closer_template, closer_vars)
            closer_log = LOG_DIR / f"iter-{iteration:04d}-closer.log"
            closer_title = f"iter {iteration} · closer"
            if task_id:
                closer_title += f" · {task_id}"
            print_wrapped(banner(closer_title))
            print_wrapped(
                f"  {DIM}log: {closer_log} · model: {CLOSER_MODEL}{RESET}"
            )
            for line in fmt_vars_passed(closer_vars):
                print_wrapped(line)
            closer_out = run_claude_with_session_retry(
                closer_prompt, closer_log, CLOSER_MODEL
            )
            for line in fmt_returned(closer_out):
                print_wrapped(line)
            return closer_out

        # --- failure path: dispatch fixer ------------------------------------
        fixer_attempts += 1
        name, argv, log_path = failing
        print_wrapped(
            f"  {RED}● verification failed at [{name}] — "
            f"dispatching fixer (attempt {fixer_attempts}/{MAX_FIXER_ATTEMPTS}){RESET}"
        )

        if fixer_attempts > MAX_FIXER_ATTEMPTS:
            failure_block = (
                f"## Verification chain exhausted at iter {iteration}\n\n"
                f"- task_id: {task_id}\n"
                f"- refinement: {refinement_path}\n"
                f"- failing step: {name} ({' '.join(argv)})\n"
                f"- failing log: {log_path.relative_to(REPO_ROOT)}\n"
                f"- fixer attempts: {MAX_FIXER_ATTEMPTS} (cap)\n\n"
                f"### Implementer summary\n\n{implementer_summary}\n\n"
                f"### Fix history (most recent last)\n\n"
                + "\n\n".join(
                    f"#### attempt {i + 1}\n{fh}" for i, fh in enumerate(fix_history)
                )
                + "\n"
            )
            append_context_failure(failure_block)
            print_wrapped(
                f"{RED}!! fixer budget exhausted — failure appended to "
                f"{CONTEXT_FILE} and exiting{RESET}"
            )
            sys.exit(1)

        fixer_vars = {
            "task_id": task_id,
            "refinement_path": refinement_path,
            "implementer_summary": implementer_summary,
            "failing_step": name,
            "failing_command": " ".join(argv),
            "failing_log": str(log_path.relative_to(REPO_ROOT)),
            "prior_attempts": (
                "\n\n".join(
                    f"### attempt {i + 1}\n{fh}" for i, fh in enumerate(fix_history)
                )
                if fix_history
                else "(none — this is the first fix attempt)"
            ),
        }
        fixer_template = load_template("fixer")
        fixer_prompt = render_template(fixer_template, fixer_vars)
        fixer_log = (
            LOG_DIR / f"iter-{iteration:04d}-fixer-{fixer_attempts}.log"
        )
        fixer_title = f"iter {iteration} · fixer #{fixer_attempts}"
        if task_id:
            fixer_title += f" · {task_id}"
        print_wrapped(banner(fixer_title))
        fixer_model = model_for_template("fixer")
        print_wrapped(f"  {DIM}log: {fixer_log} · model: {fixer_model}{RESET}")
        for line in fmt_vars_passed(fixer_vars):
            print_wrapped(line)
        fixer_out = run_claude_with_session_retry(
            fixer_prompt, fixer_log, fixer_model
        )
        for line in fmt_returned(fixer_out):
            print_wrapped(line)
        fix_history.append(fixer_out.strip())
        # Append fix summary into the closer's seed so the eventual Status
        # block reflects everything that landed for this task.
        combined_summary = (
            implementer_summary
            + "\n\n## Follow-up fix(es) by fixer sub-agent\n\n"
            + "\n\n".join(
                f"### attempt {i + 1}\n{fh}" for i, fh in enumerate(fix_history)
            )
        )
        # Loop back: re-run the verification chain from the top.


def main() -> int:
    if not SYSTEM_PROMPT_PATH.exists():
        print(f"missing system prompt: {SYSTEM_PROMPT_PATH}", file=sys.stderr)
        return 2
    system_prompt = SYSTEM_PROMPT_PATH.read_text()

    context_summary = load_context_summary()
    if context_summary:
        print_wrapped(
            f"{DIM}● loaded context_summary from {CONTEXT_FILE} "
            f"({len(context_summary)} chars){RESET}"
        )
    last_output: Optional[str] = None
    iteration = 0

    while True:
        # 1. Orchestrator turn
        orch_prompt = build_orchestrator_prompt(
            system_prompt, context_summary, last_output, iteration
        )
        orch_log = LOG_DIR / f"iter-{iteration:04d}-orchestrator.log"
        print_wrapped(banner(f"iter {iteration} · orchestrator"))
        print_wrapped(f"  {DIM}log: {orch_log} · model: {ORCH_MODEL}{RESET}")
        orch_stdout = run_claude_with_session_retry(orch_prompt, orch_log, ORCH_MODEL)
        try:
            envelope = parse_envelope(orch_stdout)
        except ValueError as e:
            print(f"{RED}!! orchestrator produced no valid envelope: {e}{RESET}", file=sys.stderr)
            return 1
        for line in fmt_envelope(envelope):
            print_wrapped(line)

        # 2. Stop?
        if "stop" in envelope:
            print_wrapped(banner(f"orchestrator stopped: {envelope['stop']}"))
            return 0

        # 3. Spawn sub-agent
        next_spec = envelope["next"]
        template_name = next_spec["template"]
        template_vars = next_spec.get("vars", {})
        task_id = template_vars.get("task_id", "")
        template = load_template(template_name)
        sub_prompt = render_template(template, template_vars)
        sub_log = LOG_DIR / f"iter-{iteration:04d}-{template_name}.log"
        sub_title = f"iter {iteration} · {template_name}"
        if task_id:
            sub_title += f" · {task_id}"
        sub_model = model_for_template(template_name)
        print_wrapped(banner(sub_title))
        print_wrapped(f"  {DIM}log: {sub_log} · model: {sub_model}{RESET}")
        for line in fmt_vars_passed(template_vars):
            print_wrapped(line)
        sub_stdout = run_claude_with_session_retry(sub_prompt, sub_log, sub_model)
        for line in fmt_returned(sub_stdout):
            print_wrapped(line)

        # 3b. Post-implementer deterministic chain: verification → (fixer
        # loop) → closer. The orchestrator no longer dispatches closer
        # directly; the driver owns this whole tail so test-suite execution
        # is a deterministic Python step rather than an LLM-judged one.
        if template_name == "implementer":
            sub_stdout = run_post_implementer_chain(
                iteration, template_vars, sub_stdout
            )

        # 4. Carry forward
        context_summary = envelope.get("context_summary", "")
        save_context_summary(context_summary)
        last_output = sub_stdout
        iteration += 1


if __name__ == "__main__":
    sys.exit(main())
