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

### 2026-05-30 — Native-speaker review of pt-BR + es-419 translations

- **Source**: WBS cleanup (2026-05-30) — removed the 33 `frontend_i18n.i18n_*_native_review` leaves (a serial chain gating no milestone).
- **Question**: every v1 string the surfaces ship has a drafted pt-BR + es-419 translation flagged `PENDING` in the `*.review.json` trackers; these need a native-speaker (+ philosophical-accuracy, for the methodology vocabulary) review pass per locale before a real show.
- **Why parked**: native-speaker sign-off is inherently human work — the agent can draft translations but cannot review/approve them, so it does not belong in the WBS (same reasoning as audit tasks). It was never a task for the orchestrator loop.
- **Suggested resolution**: when the v1 surfaces are string-complete, run one review pass per locale over the `packages/i18n-catalogs` `*.review.json` trackers and sign them off. Track it here (or in an external translation-ops tracker), not as WBS leaves. The catalog/review workflow itself is `frontend_i18n.i18n_catalog_workflow` (already complete).

### 2026-05-30 — Native-speaker review of endpoint-kind labels in pt-BR + es-419

- **Source**: closer for `moderator_ui.mod_annotation_ui.mod_hover_popover_endpoint_kind_disambiguation`.
- **Question**: the new endpoint-kind labels drafted for the edge-hover popover (`anotação` / `nó` for pt-BR, `anotación` / `nodo` for es-419) are short nouns — are they idiomatic and contextually accurate for a debate-methodology UI?
- **Why parked**: native-speaker sign-off is human-only work; the agent drafted the labels per the closest equivalent nouns but cannot verify cultural/idiomatic fit. Per Decision §5 of the refinement, a native-speaker reviewer may flag a more idiomatic Portuguese or Spanish form.
- **Suggested resolution**: have a native speaker verify the four labels (`anotação`, `nó`, `anotación`, `nodo`) in context (the popover renders them as `<uuid> (anotação)` / `<uuid> (nó)` etc.). If a more idiomatic term is preferred, update the ICU templates in `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.json` at the `moderator.hoverPopover.edgeEndpointsReference` key.
