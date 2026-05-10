# `sessions` table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.sessions_table`
**Effort estimate (placeholder)**: 0.5d
**Inherited dependencies**: none — truly unblocked

## What this task is

Define and create the `sessions` table. A session is a single debate; it owns its own participants, event log, and state. Sessions are session-scoped — but the *table* of sessions is itself global to the platform.

## Why it needs to be done

`sessions` is the entry point to almost everything else: `session_participants`, `session_nodes`, `session_edges`, and `session_events` all reference a session. Session privacy (public vs. private) gates cross-session reference permissions and audience-page authentication.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Session tables: `sessions`, `session_participants`, `session_nodes` and `session_edges` (M-N joins recording which graph entities each session includes), and a per-session append-only `session_events` table — the event log.

From [docs/architecture.md — sessions and the global graph](../../../docs/architecture.md#sessions-and-the-global-graph):

> A session is a single debate. Each session is independent — it has its own host, its own authenticated participants (moderator and debaters), its own event log, and its own state.

From [docs/architecture.md — cross-session reference permissions](../../../docs/architecture.md#cross-session-reference-permissions):

> Sessions are public by default; the host may mark a session private.

From [docs/data-model.md — sessions and scope](../../../docs/data-model.md#sessions-and-scope) and the `session-created` event description:

> session-created — initializes a session. Payload: host, privacy (public/private), creation timestamp.

The TaskJuggler note already specifies the columns:

> id, host_user_id, privacy (public/private), created_at, ended_at.

## Constraints / requirements

- Each session has exactly one host (the user who created it).
- Privacy is binary: `public` or `private`. Default `public`.
- Sessions can be ended (`ended_at`) but the row stays for replay and history.

## Acceptance criteria

- A migration creating the `sessions` table with these columns:
  - `id` — primary key.
  - `host_user_id` — foreign key into `users`.
  - `privacy` — enum or string (`public` / `private`), default `public`.
  - `topic` — the debate topic string (added based on moderator-ui `mod_create_session_form`).
  - `created_at` — timestamp.
  - `ended_at` — nullable timestamp.
- Foreign-key constraint on `host_user_id`.
- An index on `host_user_id` for "list my sessions" queries.
- An index on `privacy` (or a partial index on public sessions, if the cross-session reference query is expected to be hot).

## Open questions

- **Topic field.** [docs/moderator-ui.md — F1](../../../docs/moderator-ui.md#f1-capture-a-new-statement) and the session-setup flow imply a topic is captured at session creation. Including it in `sessions` (above) seems right. Confirm.
- **Privacy values: enum vs. string.** Database-backed enums are more constrained but harder to evolve; string with a CHECK constraint is more flexible. **Awaiting input.**
- **Should there be an explicit `status` column?** ("scheduled" / "active" / "ended" / etc.) Or is `ended_at IS NULL` enough to mean "active"? **Awaiting input.**
