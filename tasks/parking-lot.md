# Parking lot — items for human review

This file is the queue for decisions the automated WBS loop (orchestrator +
closer + refinement_writer) **must not** make on its own: judgment calls,
"should we revisit X later" questions, scope/descope decisions, and anything
that would otherwise be (mis)encoded as a self-perpetuating "audit" WBS task.

**Why this exists:** an open question encoded as a WBS task gets picked up by
the orchestrator, can't be closed by an implementer (the work is a human
call), and spawns a successor — the loop that produced the
`extract_pending_axiom_mark_projector` v1–v9 chain (removed 2026-05-30).
Instead of a task, the closer appends an entry here and moves on. The human
triages this file and either resolves the item, wires real *implementation*
work into a milestone, or deletes the entry.

**Who writes here:** the closer (`orchestrator/prompts/closer.md`, ritual
step 4) appends entries — both items it hits during the ritual and items the
implementer / refinement_writer flagged for human review in their return
summaries. The orchestrator's `human-intervention-needed` stop also points
here.

## Format

Append one `###` block per item, newest at the bottom:

```
### <YYYY-MM-DD> — <short title>
- **Source**: closer for `<task_id>` (commit `<sha>`), or the audit/run that surfaced it.
- **Question**: the decision the loop could not make.
- **Why parked**: judgment call / preconditions unmet / scope decision.
- **Suggested resolution**: options or a recommendation, if any.
```

When the human resolves an item, delete its block (git history preserves it).

---

### 2026-05-30 — Orphaned `backend.server_validation` tasks

- **Source**: WBS orphan audit (2026-05-30).
- **Question**: `backend.server_validation.{moderator_only_commit, proposer_authority, reject_invalid_event_payload, reject_orphan_references}` gate no milestone. Are these real gaps, or already covered inline by the validation that shipped with the WS-handler tasks?
- **Why parked**: needs a code check + design call on whether server-side authority/validation is already enforced.
- **Suggested resolution**: if already enforced inline, mark complete (or descope); if real, wire into M3-review / the relevant backend milestone.

### 2026-05-30 — `deployment.deployment_tests` anomaly

- **Source**: WBS orphan audit (2026-05-30).
- **Question**: `backup_restore_drill` looks like a duplicate of the milestone-wired `backup_and_export.backup_restore_test`; `load_test` is noted "M9 never required". `smoke_test_after_deploy` / `migration_dry_run` are operational deploy validations, not tests-alongside-impl.
- **Why parked**: deployment (M9) is out of scope for the current loop; duplicate/operational disposition is a human call.
- **Suggested resolution**: dedupe `backup_restore_drill` vs `backup_restore_test`; decide wire-to-M9 vs descope for the rest.

### 2026-05-30 — Orphaned `data_and_methodology.adr_0030_amendment_amend_node_structural`

- **Source**: WBS orphan audit (2026-05-30).
- **Question**: this ADR-0030 amendment task gates no milestone. Still needed?
- **Why parked**: requires reading the task + ADR 0030 to judge relevance.
- **Suggested resolution**: wire to the milestone whose scope it serves, or descope if the amendment already landed.

### 2026-05-30 — Native-speaker review of pt-BR + es-419 translations

- **Source**: WBS cleanup (2026-05-30) — removed the 33 `frontend_i18n.i18n_*_native_review` leaves (a serial chain gating no milestone).
- **Question**: every v1 string the surfaces ship has a drafted pt-BR + es-419 translation flagged `PENDING` in the `*.review.json` trackers; these need a native-speaker (+ philosophical-accuracy, for the methodology vocabulary) review pass per locale before a real show.
- **Why parked**: native-speaker sign-off is inherently human work — the agent can draft translations but cannot review/approve them, so it does not belong in the WBS (same reasoning as audit tasks). It was never a task for the orchestrator loop.
- **Suggested resolution**: when the v1 surfaces are string-complete, run one review pass per locale over the `packages/i18n-catalogs` `*.review.json` trackers and sign them off. Track it here (or in an external translation-ops tracker), not as WBS leaves. The catalog/review workflow itself is `frontend_i18n.i18n_catalog_workflow` (already complete).

### 2026-05-30 — Tasks that appear already-built but sit at 0%

- **Source**: WBS orphan audit (2026-05-30).
- **Question**: `mod_draw_edge_flow.phase_3_1_layout_race` (flake fix) and parts of `mod_annotation_ui` (badge/annotation rendering) appear implemented in code but are not `complete 100`.
- **Why parked**: marking complete requires verifying the code actually satisfies the task's acceptance criteria.
- **Suggested resolution**: verify, then run the completion ritual (or descope if superseded).
