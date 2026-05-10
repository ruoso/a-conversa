# `session_participants` table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.session_participants_table`
**Effort estimate (placeholder)**: 0.5d
**Inherited dependencies**: none — truly unblocked

## What this task is

Define and create the `session_participants` table — an M-N join between `sessions` and `users` that records each participant's role in a given session.

## Why it needs to be done

Session participation is the basis for the agreement rule: every commit requires "all current participants voting agree." Per-participant agreement tracking, axiom-mark attribution, vote attribution, and auth-on-WebSocket-connect all depend on resolving "is this user a participant in this session, and if so what role?"

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Session tables: `sessions`, `session_participants`, `session_nodes` and `session_edges` ...

From [docs/data-model.md — sessions and scope](../../../docs/data-model.md#sessions-and-scope):

> A debate is conducted within a session. Each session is independent and has its own authenticated participants.

From [docs/data-model.md — event types — session lifecycle](../../../docs/data-model.md#session-lifecycle):

> participant-joined — participant joins. Payload: participant id, role (`moderator` / `debater-A` / `debater-B`), screen name, timestamp.
> participant-left — participant leaves. Affects derivation of "all current participants have agreed" for in-flight proposals.

The TaskJuggler note already specifies the columns:

> session_id, user_id, role (moderator/debater-A/debater-B), joined_at, left_at.

## Constraints / requirements

- Roles are a fixed enum: `moderator`, `debater-A`, `debater-B`.
- A session has exactly one moderator and exactly two debaters at v1.
- A user can only have one active role per session (`left_at IS NULL`).
- Historical participants (with `left_at` set) are preserved for replay.

## Acceptance criteria

- A migration creating the `session_participants` table with these columns:
  - `id` — primary key, **UUID**.
  - `session_id` — FK to `sessions`.
  - `user_id` — FK to `users`.
  - `role` — `TEXT` with `CHECK (role IN ('moderator', 'debater-A', 'debater-B'))` (extensibility under F6).
  - `joined_at` — timestamp.
  - `left_at` — nullable timestamp.
- Foreign-key constraints with appropriate ON DELETE behavior (likely RESTRICT, since event log references participants).
- An index on `session_id` for the most common query ("who's in this session right now?").
- A unique partial index that prevents two simultaneously-active participants in the same role on the same session (`session_id, role` unique where `left_at IS NULL`).
- A unique partial index that prevents a single user from holding two simultaneous roles in the same session (`session_id, user_id` unique where `left_at IS NULL`) — encoding C2.

## Decisions

- **Primary key type: UUID** (CC1).
- **Role column: `TEXT` with `CHECK` constraint** (CC2).
- **Single role per user per session** (C2). Encoded as a partial unique index.
- **Leave-and-rejoin: multiple rows** (F5). Each join-leave pair is its own row. The current "is this user in the session right now?" query is `WHERE session_id = ? AND user_id = ? AND left_at IS NULL`. Full join-leave history is reconstructible from the table.
- **Role enum extensibility: extend the CHECK constraint when needed** (F6). No separate `roles` reference table for v1. Adding a future role (e.g., `spectator`) is a one-line migration to alter the CHECK.

## Open questions

(none — all decided)
