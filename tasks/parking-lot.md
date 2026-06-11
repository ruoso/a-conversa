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
- **Triage 2026-06-10**: 12 per-key entries that closers had appended despite the instruction above were consolidated back into this one (git history preserves them — they spanned 2026-06-02 through 2026-06-10 and are all tracked in the `*.review.json` files anyway). Closers: do **not** append per-key i18n-review entries; this umbrella is the single record. One addition the trackers do NOT cover: the per-locale walkthrough content overlays at `apps/root/src/walkthrough/overlays/{pt-BR,es-419}.json` (26 translated texts each — node wordings, annotation contents, the N15 reword). The end-of-project review pass covers the trackers **plus those two overlay files**.
- **Triage 2026-06-11**: the review now has a non-technical-reviewer workflow. `packages/i18n-catalogs/review/{pt-BR,es-419}.review.md` are generated sheets (English original + draft translation + a Status field per entry, instructions at the top); reviewers edit them — typically in a PR — and `make sync-reviews` imports the edits (wording fixes → catalogs / walkthrough overlays, sign-offs → the trackers' `signed_off` lists) and regenerates the sheets. The sheets cover every en-US key not yet signed off **plus the walkthrough overlays** — deliberately more than the trackers' `pending` lists, which had drifted (294 shipped keys, including 14 `methodology.*`, were never appended). Remaining human work: send the sheets to the reviewers, merge their PRs, run `make sync-reviews`, and triage any FLAG entries it reports.

### 2026-05-31 — Should annotations be withdrawable post-commit?

- **Source**: closer for `moderator_ui.mod_annotation_ui.mod_annotation_context_menu` (Decision §3, Open questions §2).
- **Question**: do annotations need post-commit withdrawal semantics? Two defensible answers: (a) yes → new `withdraw-annotation` proposal kind + `annotation-withdrawn` event + visibility/projection integration; (b) no → annotations are append-only (a moderator who regrets an annotation must annotate it or live with it, matching the methodology spec's framing of annotations as commentary rather than first-class structural entities).
- **Why parked**: architectural decision with real implementation consequences either way; not an agent-implementable judgment call. The "Withdraw annotation" context menu item was explicitly deferred in Decision §3 pending this call.
- **Suggested resolution**: decide whether the methodology spec intends annotations to be retractable. If yes, spec a `mod_withdraw_annotation_action` task (new proposal kind + event + projection arm + UI gesture); if no, close this item and the "Withdraw annotation" menu item stays permanently out of scope.
- **Triage 2026-06-10**: deliberately **deferred until real-show feedback** — annotations stay append-only for now and the "Withdraw annotation" menu item stays out of scope, but the question is not closed: revisit after moderators have used annotations in a real session. Note the *dispute* half of this space is settled — ADR 0038 records that annotations ARE disputable post-commit via substance-facet votes (which also resolved the former 2026-06-02 "disputable post-commit?" entry; `annotation_facet_vote_seam` proceeds as registered).
