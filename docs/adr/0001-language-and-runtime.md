# 0001 — Backend language and runtime: TypeScript on Node

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` needs a backend that can host a server-authoritative real-time debate platform. The architectural constraints recorded in [docs/architecture.md](../architecture.md) shape the language choice:

- First-class WebSocket server support — clients (moderator, debaters, audience) all connect over WebSockets and the server owns the canonical event log per session.
- Mature PostgreSQL bindings with prepared statements and connection pooling — Postgres is the only persistence layer.
- Sound static typing — the data model is built around explicit classifications (statement kinds, edge roles, per-facet states); the implementation language should be able to make those distinctions impossible to fudge at the type level.
- Single Docker image deployment, runs on standard Linux, no proprietary runtime.
- Open-source ethos — the language should be approachable to a wide pool of contributors so others can run and extend the platform.
- Frontend is already TypeScript (four browser surfaces sharing a TS codebase per the architecture doc).

The candidates surveyed were TypeScript on Node, Go, Elixir/Phoenix, and Rust. All four meet the hard constraints.

## Decision

The backend will be written in **TypeScript on Node.js**.

The web framework (Express, Fastify, Hono, or similar) is deliberately deferred to the repo-skeleton work; it is not load-bearing for any other foundation decision and is best chosen alongside the test-framework picks.

## Consequences

- **Shared types end-to-end.** Event payloads, node and edge shapes, and WebSocket message schemas can be defined once and consumed by both backend and the four frontend surfaces without a translation layer.
- **Large ecosystem.** Mature libraries exist for WebSockets (`ws`, framework-native upgrades), Postgres (`pg`, `postgres.js`), and OAuth — none of the foundation tasks need to invent low-level infrastructure.
- **Lower contributor barrier.** TypeScript and Node are widely known; an outside contributor cloning the repo is more likely to be productive immediately than with Elixir or Rust.
- **Concurrency model is single-threaded event loop.** Adequate for the v1 scale (a handful of concurrent sessions, tens to low hundreds of nodes each, in-memory projections), but a future scale-out story would lean on horizontal processes rather than in-process parallelism. This is accepted explicitly; v1 does not need it.
- **Runtime weight.** Node images are larger than a Go or Rust static binary. Acceptable given the single-image deployment target and the open-source-friendliness gain.
- **Downstream tasks now constrained to the TS/Node ecosystem**: linter (ESLint family), formatter (Prettier or Biome), typecheck (`tsc`), unit and behavior test frameworks, and the application Dockerfile.
