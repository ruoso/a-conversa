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

### 2026-05-31 — Native-speaker review of annotation context menu labels in pt-BR + es-419

- **Source**: closer for `moderator_ui.mod_annotation_ui.mod_annotation_context_menu` (Open questions §1).
- **Question**: the two new annotation context menu labels — `moderator.contextMenu.annotation.annotate` ("Annotate this annotation") and `moderator.contextMenu.annotation.metaDisagree` ("Disagree with this annotation") — have placeholder pt-BR and es-419 translations. Are they idiomatic and contextually accurate?
- **Why parked**: native-speaker sign-off is human-only work; the agent drafted the strings as best-effort translations but cannot verify philosophical-accuracy fit for the debate-methodology vocabulary.
- **Suggested resolution**: have a native speaker (with methodology familiarity) verify the two labels per locale in `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.json` at the `moderator.contextMenu.annotation.*` keys and update if needed.

### 2026-05-31 — Should annotations be withdrawable post-commit?

- **Source**: closer for `moderator_ui.mod_annotation_ui.mod_annotation_context_menu` (Decision §3, Open questions §2).
- **Question**: do annotations need post-commit withdrawal semantics? Two defensible answers: (a) yes → new `withdraw-annotation` proposal kind + `annotation-withdrawn` event + visibility/projection integration; (b) no → annotations are append-only (a moderator who regrets an annotation must annotate it or live with it, matching the methodology spec's framing of annotations as commentary rather than first-class structural entities).
- **Why parked**: architectural decision with real implementation consequences either way; not an agent-implementable judgment call. The "Withdraw annotation" context menu item was explicitly deferred in Decision §3 pending this call.
- **Suggested resolution**: decide whether the methodology spec intends annotations to be retractable. If yes, spec a `mod_withdraw_annotation_action` task (new proposal kind + event + projection arm + UI gesture); if no, close this item and the "Withdraw annotation" menu item stays permanently out of scope.

### 2026-05-31 — Should `'meta-disagreement'` become a proper AnnotationKind variant?

- **Source**: closer for `moderator_ui.mod_annotation_ui.mod_annotation_context_menu` (implementer tech-debt proposal).
- **Question**: the "Disagree with this annotation" menu item pre-selects `annotation_kind: 'stance'` (the closest semantic match). The methodology facet-state `'meta-disagreement'` is not a valid `AnnotationKind` enum value (`note | reframe | scope-change | stance`). If the methodology truly wants a distinct `'meta-disagreement'` kind (rather than re-using the `'stance'` kind), the schema + badge rendering + catalog keys need widening.
- **Why parked**: architectural call — whether `meta-disagreement` is a KIND (warranting its own enum variant, badge color, i18n key) or a STANCE POSTURE (correctly expressed as `annotation_kind: 'stance'` with a facet pre-set) requires a methodology owner decision. The implementer chose `'stance'` as the conservative interpretation.
- **Suggested resolution**: if the methodology owner decides `'meta-disagreement'` is a distinct kind, create a `mod_annotation_kind_meta_disagreement` task to widen `annotationKindSchema`, add badge rendering, update catalog keys in all three locales, and change the disagree item to pre-select the new kind instead of `'stance'`.
