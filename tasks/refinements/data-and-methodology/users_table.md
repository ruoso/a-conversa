# `users` table

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.schema.users_table`
**Effort estimate (placeholder)**: 0.5d
**Inherited dependencies**: none — truly unblocked

## What this task is

Define and create the `users` table. This is one of three global (non-session-scoped) tables, holding the platform's minimal record per authenticated user.

## Why it needs to be done

`users` is a foundational table. `session_participants` references it (M-N join with `sessions`). Auth flow writes a row here on first OAuth login. Every node, edge, and annotation references a user as its `created_by`.

## Inputs / context

From [docs/architecture.md — storage](../../../docs/architecture.md#storage):

> Global tables (one row per entity, no session column): `nodes`, `edges`, `users`.

From [docs/architecture.md — identity](../../../docs/architecture.md#identity):

- Federated identity via OAuth.
- Do not read identity profile data.
- Ask each user a screen name. The screen name is the only piece of user-supplied info the platform stores.
- All session participants must be authenticated.

The TaskJuggler note for this task already specifies the columns:

> id, oauth_subject, screen_name, created_at.

## Constraints / requirements

- Minimal PII. Only the OAuth subject identifier (used to link future logins to the same account) and the user-chosen screen name.
- The OAuth subject must be unique per provider; needs to be stored in a way that avoids collision across providers (typically `provider:subject`).
- Screen names are user-provided strings. Need a sane length and character constraint.

## Acceptance criteria

- A migration creating the `users` table with these columns:
  - `id` — primary key, **UUID** (project-wide convention).
  - `oauth_subject` — composite identifier, unique. Format `provider:subject` recommended.
  - `screen_name` — user-supplied string (TBD on uniqueness, length cap — see open questions).
  - `created_at` — timestamp.
- A unique index on `oauth_subject`.
- Possibly a (non-unique) index on `screen_name` for lookups (open question).
- The migration runs cleanly in the local dev Compose stack.

## Decisions

- **Primary key type: UUID.** Project-wide convention (CC1).

## Open questions

- **Screen-name uniqueness (F1).** Should two users be allowed the same screen name? Display-name-style (duplicates allowed) or handle-style (globally unique)? **Awaiting input.**
- **Screen-name character set / length cap (F2).** **Awaiting input.** Default suggestion: UTF-8 + length 1–64.
- **User deletion behavior (F3).** Soft-delete (preserve row, mark deleted) vs. hard-delete (row removed). Strong instinct: soft-delete since the change history references users by id. **Awaiting input.**
