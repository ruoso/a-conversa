# host_moderator_role_note

**Source**: [docs/security/m3-review/auth.md](../../../docs/security/m3-review/auth.md) F-014
**TaskJuggler**: `backend_hardening.documentation.host_moderator_role_note`
**Type**: Documentation-only follow-up.

## Goal

Document the load-bearing v1 simplification that the session host IS the moderator — there's no separation today — and pin the contract a future "moderator role separable from host" task will need to honor.

## Context

[`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) (around lines 1659-1661, 1856-1862, 2028-2033, 2277-…) treats `host_user_id === caller.id` as the moderator gate. The methodology engine ([`apps/server/src/methodology/handlers/commit.ts`](../../../apps/server/src/methodology/handlers/commit.ts)) emits `not-a-moderator` for any non-host caller, which is the right code today given the conflation.

The event-payload vocabulary in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) ALREADY distinguishes `actor` from `host` on per-event payloads — the data model anticipates a future split.

## Decisions

- **No code change today.** The conflation is intentional for v1: a single moderator runs each debate; no admin/host-but-not-moderator role exists.
- **Add a code comment** to each authority-check site in `apps/server/src/sessions/routes.ts` that explicitly names the conflation + the future task. The comment is the audit trail.
- **Document the future-separation contract**:
  - When the split lands, every authority check in `routes.ts` MUST route through a single `isModerator(session, userId)` helper, NOT re-derive `host_user_id === caller.id` per site.
  - The data-model `actor` field already lets a future "moderator delegate" workflow distinguish actions taken on the host's behalf vs. actions the host took directly.
  - The wire-error code `not-a-moderator` stays — what changes is the predicate behind it.
- **Note in `docs/architecture.md`** under the session-management section: "v1 simplification: the session host is also the session moderator. A future task may separate these roles; see `tasks/refinements/backend-hardening/host_moderator_role_note.md`."

## Acceptance

- Code comments added to each `host_user_id === request.authUser.id` call site in `apps/server/src/sessions/routes.ts`.
- `docs/architecture.md` carries the v1-simplification note.
- `complete 100` on `host_moderator_role_note` in `tasks/25-backend-hardening.tji`.

## Status

- [x] Refinement document landed.
- [x] Code comments added at authority-check sites in `routes.ts`.
- [x] `docs/architecture.md` updated.
- [x] `complete 100` in tji.
