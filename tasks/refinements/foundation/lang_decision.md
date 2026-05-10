# Pick backend language and framework

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.lang_decision`
**Effort estimate (placeholder)**: 1d
**Inherited dependencies**: none — truly unblocked

## What this task is

Decide which language and framework the backend will be implemented in. The choice gates several downstream foundation tasks (Dockerfile for the application, linter / formatter / typecheck configs, test-framework picks) and all of the backend, data-model, and event-log implementation.

## Why it needs to be done

This is the central tech-stack decision. Almost every implementation task downstream is shaped by it:

- `repo_skeleton.linter_config`, `formatter_config`, `typecheck_config` follow the language.
- `dev_env.dockerfile_app` builds the chosen runtime.
- `stack_decisions.test_unit_framework_decision` and `stack_decisions.test_behavior_framework_decision` choose tooling within the language ecosystem.
- The shape of the WebSocket server, event-log writer, and projection runtime all depend on it.

## Inputs / context

From [docs/architecture.md — open architectural questions](../../../docs/architecture.md#open-architectural-questions):

> Backend language / framework. TypeScript / Node, Go, Elixir (Phoenix has first-class real-time), Rust — all viable. Pick during prototyping based on team preference.

Architectural facts that constrain the choice (from [docs/architecture.md](../../../docs/architecture.md)):

- **Server-authoritative real-time over WebSockets** — first-class WebSocket support is essential.
- **Event-sourced state model** with an append-only event log in PostgreSQL — needs a mature Postgres client/driver.
- **In-memory graph projection per active session** — tens to low hundreds of nodes per session, but the language must handle dynamic graph data structures cleanly.
- **Single Docker image deployment** — must compile or run cleanly on Linux, no proprietary runtime.
- **Local development environment via Docker Compose** — single-command startup.
- **Open-source ethos** — the language should be approachable to a wide pool of contributors.
- **No reliance on cloud-managed services** in dev or production.

## Constraints / requirements

- First-class WebSocket server support (or strong, well-maintained library support).
- Mature PostgreSQL bindings, ideally with prepared-statement and connection-pool support.
- Reasonable concurrency primitives (the server multiplexes many sessions, each with its own event stream).
- Static typing or sound type-checking layer (matches the explicit-decisions ethos of the format).
- Compiles or runs on standard Linux without specialized hardware/runtimes.

## Acceptance criteria

- A language and framework chosen.
- Rationale recorded as the first entry of the ADR log (see `deployment.deployment_docs.adr_log`).
- Choice is reflected as a setting in `repo_skeleton.linter_config`, `formatter_config`, `typecheck_config` (downstream).
- A "hello, world" HTTP server in the chosen stack runs locally.

## Decisions

- **Language: TypeScript on Node.** Decided.
- **Web framework / runtime: TBD during repo setup.** The standard candidates for TS/Node are Express, Fastify, Hono, or similar. Pick during the repo-skeleton work; not blocking other decisions.

## Open questions

(none — task is decided pending the framework pick which is a downstream prototyping detail)
