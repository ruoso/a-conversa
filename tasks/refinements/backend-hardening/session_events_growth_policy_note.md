# session_events_growth_policy_note

**Source**: [docs/security/m3-review/inputs.md](../../../docs/security/m3-review/inputs.md) F-011
**TaskJuggler**: `backend_hardening.documentation.session_events_growth_policy_note`
**Type**: Documentation-only follow-up.

## Goal

Document the deliberate v1 policy that `session_events` grows unboundedly — and the trigger conditions that would warrant a future archival task.

## Context

The `session_events` table is the canonical event log. Every event the methodology engine validates lands as a row; events are NEVER deleted (the log is append-only and replay-authoritative). With no archival policy, the table grows linearly with debate volume.

Per-event payload caps were added by [`user_text_length_caps`](./user_text_length_caps.md) (10 KiB methodology text, 256 topic, 128 snapshot label). With ~10 KiB worst-case per event and ~1000 events per long debate, a single session might emit ~10 MB. A platform hosting 1000 sessions/day would accumulate ~3.6 TB/year worst-case (more realistically: ~10× smaller given most events are short).

The current target audience (a single YouTube show producing a few sessions per week) is nowhere near this regime. v1 ships without archival, and the policy is intentional.

## Decisions

- **No code change today.** Storage at projected v1 volume is comfortably within a single Postgres instance.
- **Document the policy** with explicit trigger conditions for a future archival task:
  - **Triggers** (any one):
    - `session_events` exceeds 100 GB (~10⁷ rows at average ~10 KB).
    - The application's storage cost dominates the deployment monthly bill.
    - A regulatory / compliance constraint introduces a data-retention requirement.
  - **What archival looks like** (when triggered):
    - Per-session: when a session is `ended` AND older than N days, dump its event log to object storage (S3-shaped); leave a session-level "archived" marker in Postgres pointing at the dump location.
    - Replay: `backend.replay_endpoints` fetches the dump on first access; caches in process / a small Postgres mirror for hot sessions.
  - **Out of scope for v1**: implementing any of this. Just document the trigger.
- **Add a note in `docs/data-model.md`** (or wherever the data-model is documented) referencing this refinement.
- **Add a code comment** to the `session_events` migration file ([`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql) — or wherever the table is defined) naming the unbounded-growth policy + this refinement.

## Acceptance

- `docs/data-model.md` (or sibling) documents the policy + triggers.
- Comment added to the `session_events` migration / table-definition file.
- `complete 100` on `session_events_growth_policy_note` in `tasks/25-backend-hardening.tji`.

## Status

- [x] Refinement document landed.
- [x] Code comment added to the table-definition migration.
- [x] `docs/data-model.md` updated.
- [x] `complete 100` in tji.
