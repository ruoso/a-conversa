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

### 2026-06-02 — i18n native review — diagnostic focusAria (pt-BR, es-419)

- **Source**: closer for `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_focus_action`.
- **Question**: the pt-BR and es-419 values for `moderator.diagnostic.flags.focusAria` were machine-drafted; they need native-speaker review for fluency, register, and philosophical-methodology accuracy.
- **Why parked**: native-speaker sign-off is inherently human work. Per ADR 0024 the en-US copy is authoritative at land; non-English drafts ship as parity-complete pending review, tracked in `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json`.
- **Suggested resolution**: review `moderator.diagnostic.flags.focusAria` in `pt-BR.json` and `es-419.json`; accept or correct and remove from the `*.review.json` pending lists.

### 2026-06-02 — i18n native review — diagnostic banner message + reviewAria (pt-BR, es-419)

- **Source**: closer for `moderator_ui.mod_diagnostic_resolution_flow.mod_blocking_diagnostic_banner`.
- **Question**: the pt-BR and es-419 values for `moderator.diagnostic.banner.message` (ICU plural) and `moderator.diagnostic.banner.reviewAria` were machine-drafted; they need native-speaker review for fluency, register, and philosophical-methodology accuracy.
- **Why parked**: native-speaker sign-off is inherently human work. Per ADR 0024 the en-US copy is authoritative at land; non-English drafts ship as parity-complete pending review.
- **Suggested resolution**: review the two keys in `pt-BR.json` and `es-419.json`; accept or correct in place and close this item.

### 2026-06-02 — Durable semantics for advisory diagnostic moves (mark-conceded, review-/repair-configuration, leave-as-intentional)

- **Source**: closer for `moderator_ui.mod_diagnostic_resolution_flow.mod_resolution_path_picker` (Decision §D5, named follow-up tasks).
- **Question**: should `mark-conceded` (dangling-claim) and the coherency moves `review-configuration`, `repair-configuration`, `leave-as-intentional` gain durable structural or acknowledge/dismiss semantics, or remain focus-only conversational prompts? Currently these chips focus the affected region but emit no proposal.
- **Why parked**: a methodology/product decision — what does it mean to "concede" a dangling claim, or mark a coherency hint as "intentional"? These carry no existing engine proposal kind and no precondition that recomputes away. Giving them durable semantics requires deciding what state they record (a new event kind, an annotation, a flag dismiss) and what the methodology intends. Not agent-implementable without that call.
- **Suggested resolution**: if the methodology owner decides any of these should be actionable, spec a WBS task per move naming the proposal kind, event, projection arm, and UI gesture. Until then, focus-only is the faithful behavior.

### 2026-06-02 — Reconsider dynamic round-robin auth helper before a v3 pool expansion

- **Source**: closer for `participant_ui.part_graph_view.part_e2e_user_pool_expansion_v2` (implementer return summary + refinement Decision §1, §"Out of scope").
- **Question**: v2 is the second static expansion of the Authelia dev user pool (6→12 in v1, 12→18 in v2). The role-swap doubling trick (N pairs → 2N block-slots) is also being fully exploited. If a v3 expansion is contemplated (e.g., to cover future `mod_*` Playwright blocks that need their own OIDC dance), should the team build a principled dynamic round-robin allocator (`fixtures/userPool.ts` freelist that hands out `{ creator, debater }` pairs and blocks on contention) rather than a mechanical 18→24 static bump?
- **Why parked**: architectural/scope decision with real seam impact (rewrites how every spec acquires users). Not a pure config rotation like v1/v2 — requires a human call on the right trade-off before an agent refines and implements.
- **Suggested resolution**: when the next pool-expansion need is identified, decide whether a v3 static bump or the dynamic allocator is the right path. If the dynamic allocator, spec a `part_e2e_user_pool_allocator` task covering the `userPool.ts` freelist design, migration of existing specs, and the updated smoke pin.

### 2026-06-02 — `users.yml` ↔ `DEV_USER_POOL` drift cross-check test

- **Source**: closer for `participant_ui.part_graph_view.part_e2e_user_pool_expansion_v2` (implementer return summary + refinement Decision §6).
- **Question**: `tests/smoke/dev-user-pool.test.ts` asserts the TS array's shape but never reads `infra/authelia/users.yml`, so a user added to one file but not the other won't be caught until a Playwright login fails. A drift cross-check test that parses `users.yml` and asserts its keys equal `DEV_USER_POOL` would close that gap.
- **Why parked**: adding YAML parsing (and likely a parser dependency) into a smoke test is scope beyond a 0.5d config rotation; the dependency addition itself is an ADR-adjacent decision. Deliberately out of scope for v2 per Decision §6. Drift risk grows with each expansion.
- **Suggested resolution**: if a third expansion is undertaken, add the cross-check as part of that leaf (or as a standalone hardening task). The test would live in `tests/smoke/`, parse `infra/authelia/users.yml` with a lightweight YAML parser, and assert `Object.keys(parsed.users).sort()` equals `[...DEV_USER_POOL].sort()`.

### 2026-06-02 — Should annotations be disputable post-commit?

- **Source**: closer for `data_and_methodology.methodology_engine.annotation_facet_status_logic` (refinement Open questions).
- **Question**: whether annotations should be disputable post-commit at all is a methodology product call. The data model implies it (`substanceFacet: FacetState<'agreed' | 'disputed'>` in projection types.ts:250–261) and the `annotation_facet_vote_seam` tech-debt task was registered to build the missing vote surface — but no ADR records whether the methodology *intends* a participant to dispute an annotation's substance after it has been committed. Building the seam to the type's incidental shape rather than the intended methodology would be a mistake.
- **Why parked**: methodology owner decision — should annotations be append-only commentary (once committed, they stand) or first-class deliberation targets (post-commit disputes allowed)? Either answer is defensible; the implementer deferred to human confirmation.
- **Suggested resolution**: confirm the intended behavior before `annotation_facet_vote_seam` is implemented. If disputable: proceed with the registered task. If append-only: descope `annotation_facet_vote_seam` and `mod_annotation_dispute_e2e` from the WBS and remove them from M7's `depends`; the `substanceFacet` type may also warrant narrowing to `'agreed'` only.

