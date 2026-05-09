# Architecture

> Status: Early architectural design phase. Foundational decisions made; specific tech-stack choices still open.

This document describes the engineering shape of `a-conversa` — how the data model and methodology defined in [data-model.md](data-model.md) and [methodology.md](methodology.md) get implemented as a working system. It is the engineering counterpart to those two design docs.

## Scope (v1)

V1 is the **live YouTube show format**: real-time debate with one moderator, two debaters, an audience watching the broadcast, and replay available afterward. Async prep ("debaters mapping their worldview before a show") is explicitly out of scope for v1; revisit if/when prep becomes a serious use case.

## Sessions and the global graph

A **session** is a single debate. Each session is independent — it has its own host, its own authenticated participants (moderator and debaters), its own event log, and its own state. Sessions are the unit of activity in the platform.

**Nodes and edges are global graph entities, related to sessions M-N.** A node (with its wording) and an edge (with its role and endpoints) exist independently of any session. A node may appear in many sessions; a session contains many nodes and edges. This lets one session **build on top of another** — a debate in session B can reference a node that was first introduced in session A, citing prior establishment without recreating it.

What's global vs. session-scoped:

- **Global (intrinsic to the graph entity):**
  - Node: `id`, `wording` (the statement text), creator, creation timestamp.
  - Edge: `id`, `role`, source/target node ids, creator, creation timestamp.
- **Session-scoped (in the session's event log):**
  - Node `classification` facet (the same statement may be read as `normative` in one debate and `value` in another).
  - `substance` facets (per-session — agreement on truth depends on participants).
  - Per-participant agreement state on every facet.
  - Axiom marks (per-participant by definition; participants are session-scoped).
  - Annotations.
  - All structural diagnostics computed against the session's view of the graph.

A node referenced in a new session **starts fresh** in v1: participants re-engage with classification, substance, axiom-marking, etc. State does not auto-inherit from prior sessions. Future versions may offer "import with prior state as starting proposal" as a courtesy, but inheritance-by-default would let one session implicitly bind another's participants.

Edges work the same way: the structural fact "edge E with role `supports` from N1 to N2 exists in the global graph" is global; whether a given session's participants agree the support holds is session-scoped.

### Cross-session reference permissions

Sessions are **public by default**; the host may mark a session **private**. Reference rules follow:

- **Public session** — any authenticated user can reference the session's nodes and edges in a new session.
- **Private session** — only participants of the original session (or the host) can reference its nodes and edges.

This aligns with the YouTube-show context (shows are public by their nature) while preserving the option for private debates that aren't meant to be cited externally.

## State model: event-sourced

The data model treats the change history as canonical and the current graph as a projection of it. The implementation follows directly:

- The **event log** is the source of truth: every per-facet status transition, every axiom mark, every decomposition / interpretive split / meta-move, every withdrawal of agreement, with proposer, per-participant agreement state, and timestamp.
- The **current graph** is a projection of the event log into an in-memory data structure for each active debate.
- **Snapshots** (segment breaks, end-of-show artifacts) are named immutable references to a position in the event log. Replay is "play the log up to position X."

This makes replay, withdrawal, audit, segment-snapshots, and post-debate analysis fall out of the same primitive instead of being bolted on.

## Concurrency: server-authoritative real-time

- A single server holds the canonical event log per active debate.
- Clients (moderator, debaters, audience) connect over **WebSockets**.
- The moderator's commit is the only operation that mutates the canonical state. The server validates and broadcasts.
- All clients see proposed changes (in `proposed` state) immediately; committed changes are broadcast as state-transition events.
- No CRDT, no operational transform — the live format doesn't need them.

## Storage

- **PostgreSQL** for everything. Boring, reliable, runs anywhere.
- **Global tables** (one row per entity, no session column): `nodes`, `edges`, `users`.
- **Session tables**: `sessions`, `session_participants`, `session_nodes` and `session_edges` (M-N joins recording which graph entities each session includes), and a per-session append-only `session_events` table — the event log.
- **In-memory graph projection per active session**, rebuilt from the session's event log (joined against the global node/edge tables) on session load and updated as events stream in. Cycle detection, multi-warrant detection, and contradiction detection all run against this in-memory representation — cheap for graphs of debate size (tens to low hundreds of nodes).
- **No graph database** in v1. The in-memory projection handles structural queries; the operational and conceptual cost of adding a graph DB isn't justified at this scale.

## Replay

Replay is a v1 feature. Given the event-sourced architecture, replay is essentially free at the data layer; the engineering work is in the **viewer**.

The audience-facing replay surface preserves the on-camera feel of the live show: animated reveals as nodes appear, classification proposals showing in `proposed` state and resolving as participants commit, segment snapshots as natural chapter markers, withdrawals visibly reverting.

The unified primitive across live and replay surfaces is **"render the graph at a position in the event log."** Live = position is "head" with auto-advance as events stream in. Replay = position is anywhere, advanced manually or auto-played.

## Frontend surfaces

V1 ships four distinct surfaces, sharing a TypeScript codebase and connecting to the same backend:

- **Moderator** — full operator UI. Capture text, propose classification, draw edges, propose decomposition / interpretive split / meta-move, commit, view change history, watch structural diagnostics fire.
- **Debaters (×2)** — agreement controls (agree / dispute / withdraw) on each pending proposal, plus a read-only graph view. Designed for a tablet held in the debater's hand or placed nearby.
- **Audience / broadcast** — read-only, designed for video. Animated reveals on commit, clean typography, distinct visual states for `proposed` / `agreed` / `disputed` / `meta-disagreement`. This is the show. Served at a stable URL that **mirrors session privacy** — public sessions have a public viewer URL (anyone can load); private sessions require auth.
- **Producer / director** — change-history scrubbing, segment-snapshot triggers, possibly OBS scene-switching cues. Useful for a polished broadcast; cuttable from v1 if the moderator surface plus OBS suffice.

### Test mode

A separate mode (no live participants) loads a saved debate's event log and presents the current graph state plus a **timeline scrubber** that walks backward (and forward) through the event history. Used for design iteration, debugging diagnostics, and demoing the system without three live participants.

The timeline is built on the same "render at log position" primitive as the audience view; test mode is the audience surface with a scrubber instead of live event streaming.

## Graph rendering

- **Cytoscape.js** for the audience view — strong layout algorithms, animation hooks, customizable styling for distinct facet/state rendering.
- **ReactFlow** likely for the moderator UI — better drag-to-create-edge ergonomics and direct-manipulation feel for the operator.
- One library if the cost of two is too high; revisit during prototyping.

## Identity

- **Federated identity** via OAuth — accept generic OAuth providers, with first-class wiring for the familiar ones (Google, GitHub, GitLab, etc.).
- **Do not read identity profile data.** OAuth is used purely as an authentication signal.
- **Ask each user a screen name** during the connect flow. The screen name is the only piece of user-supplied info the platform stores.
- **All session participants must be authenticated.** Moderator, debaters, and (for direct viewer pages) anyone joining a session in any role. The audience watching via the OBS broadcast does not authenticate against the platform — they're consuming the produced video and never touch the application.

This minimizes the PII surface, keeps the open-source story clean (no proprietary identity service required), and lets participants use the platform without revealing more than they want to.

## Broadcast integration

- Audience surface served at a stable URL.
- The producer points an **OBS browser source** at that URL.
- Most accessible for anyone wanting to adopt the format — OBS is the standard, browser sources are universal, no plugin compilation required.

## Deployment

- **Always-on cloud server**, multi-tenant from the start. Hosting cost is low; the live-show experience benefits from a stable URL and persistent state across sessions.
- **Single Docker image** for the application + a managed PostgreSQL.
- The whole stack reproducible by anyone running their own instance — that is part of the open-source story.

Each debate is its own event log; multi-tenancy is lightweight (no cross-debate queries on the live path).

## Open architectural questions

- **Backend language / framework.** TypeScript / Node, Go, Elixir (Phoenix has first-class real-time), Rust — all viable. Pick during prototyping based on team preference.
- **Frontend framework.** React, Svelte, Solid — pick during prototyping. Must play well with the chosen graph-rendering library.
- **One graph library or two.** Cytoscape for audience and ReactFlow for moderator vs. one library across surfaces. Resolve during UI prototyping.
- **Auth library / OAuth implementation.** Self-hosted (Keycloak, Authelia, hand-rolled OAuth client) vs. hosted (Auth0, Clerk). Self-hosted aligns with open-source values; hosted is faster to ship.
- **Producer / director surface in v1?** Probably yes for a polished first show, but cuttable if the moderator surface plus OBS does enough on its own.
- **Test-mode UX details.** Timeline scrubber granularity (per event vs. per moderator commit); whether scrubbing highlights what changed at each step.
- **Inheriting prior session state.** V1 says imported nodes start fresh in the new session. Should there be an opt-in "import the prior session's classification / axiom marks as starting proposals" that the new session's participants then accept or dispute? Interesting for series episodes; out of scope for v1 unless it becomes a clear need.
