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
  - `session_id` — FK to `sessions`.
  - `user_id` — FK to `users`.
  - `role` — enum or string (`moderator` / `debater-A` / `debater-B`).
  - `joined_at` — timestamp.
  - `left_at` — nullable timestamp.
- Foreign-key constraints with appropriate ON DELETE behavior (likely RESTRICT, since event log references participants).
- An index on `session_id` for the most common query ("who's in this session right now?").
- A unique constraint that prevents two simultaneously-active participants in the same role on the same session (`session_id, role` unique where `left_at IS NULL`). PostgreSQL partial unique index supports this.
- A constraint or check that `role` is one of the allowed values.

## Open questions

- **Role enum vs. string.** Same trade-off as sessions.privacy. **Awaiting input.**
- **Can a single user occupy multiple roles in different sessions?** Yes obviously (a user could be moderator in one session and a debater in another). But within a single session, can a user occupy two roles concurrently or sequentially? V1 assumption: **no** (one role per user per session). Confirm.
- **What happens if a participant leaves and re-joins?** Two rows with different `joined_at` and `left_at`? Or update the existing row? **Awaiting input.** Cleaner under event-sourcing: each transition is a new row (more rows, but reconstructs cleanly from event log).
- **Future-proofing for spectators / observers / additional roles.** V1 is fixed at moderator + two debaters; should the role enum be designed to accommodate future expansion (e.g., adding "spectator" later)? **Awaiting input.** Suggested: yes, treat the enum as extendable.
