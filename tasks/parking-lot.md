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

- **Source**: Every new label added to the catalog needs human review
- **Question**: every string the surfaces ship has a drafted pt-BR + es-419 translation flagged `PENDING` in the `*.review.json` trackers; these need a native-speaker (+ philosophical-accuracy, for the methodology vocabulary) review pass per locale before a real show.
- **Why parked**: native-speaker sign-off is inherently human work — the agent can draft translations but cannot review/approve them, so it does not belong in the WBS (same reasoning as audit tasks). It was never a task for the orchestrator loop.
- **Suggested resolution**: when the v1 surfaces are string-complete, run one review pass per locale over the `packages/i18n-catalogs` `*.review.json` trackers and sign them off. There is no need to add detailed parking lot items for each one, nor WBS tasks. The review will be done in a single pass at the end.

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

### 2026-06-02 — i18n native review — meta-move targetMissing/targetKindInvalid (pt-BR, es-419)

- **Source**: closer for `moderator_ui.mod_meta_move_flow.mod_meta_move_annotation_target_gesture`.
- **Question**: the pt-BR and es-419 corrections to `reason.targetMissing` and `reason.targetKindInvalid` (now referencing "node or edge" rather than "node" only) were drafted by the agent; they need native-speaker review for accuracy and register.
- **Why parked**: native-speaker sign-off is inherently human work — the agent drafted the corrections to maintain catalog parity but cannot approve their fluency or register. Per ADR 0024 the en-US copy is authoritative at land; pt-BR/es-419 ship as parity-complete drafts pending review.
- **Suggested resolution**: a native-speaker review pass over `packages/i18n-catalogs/src/catalogs/pt-BR.json` and `es-419.json` for the two keys `reason.targetMissing` and `reason.targetKindInvalid` (lines ~555–556 in each catalog). Accept the drafts or correct them in place and close this item.

