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

### 2026-06-03 — Virtualization for change-history pane if event logs grow large

- **Source**: closer for `moderator_ui.mod_change_history_pane.mod_history_scroller` (Decision D5).
- **Question**: the change-history pane renders all events unvirtualized (matching `PendingProposalsPane`). Example-walkthrough logs are bounded (tens–low-hundreds of events), so the v1 decision is sound. If real sessions accumulate thousands of events, a windowed list (e.g. `@tanstack/virtual`) would be needed to avoid DOM size regressions.
- **Why parked**: "re-evaluate if perf degrades" is a judgment call, not an agent-implementable deliverable. No evidence of a real performance problem yet.
- **Suggested resolution**: if moderators report scroll jank or if logs routinely exceed ~500 events in practice, spec a `mod_history_scroller_virtualize` task covering virtual-list integration + scroll preservation.

### 2026-06-02 — Should annotations be disputable post-commit?

- **Source**: closer for `data_and_methodology.methodology_engine.annotation_facet_status_logic` (refinement Open questions).
- **Question**: whether annotations should be disputable post-commit at all is a methodology product call. The data model implies it (`substanceFacet: FacetState<'agreed' | 'disputed'>` in projection types.ts:250–261) and the `annotation_facet_vote_seam` tech-debt task was registered to build the missing vote surface — but no ADR records whether the methodology *intends* a participant to dispute an annotation's substance after it has been committed. Building the seam to the type's incidental shape rather than the intended methodology would be a mistake.
- **Why parked**: methodology owner decision — should annotations be append-only commentary (once committed, they stand) or first-class deliberation targets (post-commit disputes allowed)? Either answer is defensible; the implementer deferred to human confirmation.
- **Suggested resolution**: confirm the intended behavior before `annotation_facet_vote_seam` is implemented. If disputable: proceed with the registered task. If append-only: descope `annotation_facet_vote_seam` and `mod_annotation_dispute_e2e` from the WBS and remove them from M7's `depends`; the `substanceFacet` type may also warrant narrowing to `'agreed'` only.

### 2026-06-03 — Re-localize shared `summaryText` structural words for proposal change-history rows

- **Source**: closer for `moderator_ui.mod_change_history_pane.mod_history_event_summary` (Decision D3).
- **Question**: `proposalSummary.summaryText` (used by both `PendingProposalsPane` and the new change-history row for `kind === 'proposal'`) emits English structural words ("Set substance = …", "Decompose into N components") and id-prefix fallbacks. Re-localizing it would give proposal rows the same ICU-template treatment the 16 non-proposal kinds received in this task, but requires touching `PendingProposalsPane`, `proposalFilter.ts`, and `proposalSummary.ts` in a cross-cutting refactor.
- **Why parked**: the re-localization churn touches multiple panes and is a judgment call on whether the inconsistency is worth fixing. The refinement explicitly routes this to the parking lot (not a WBS task) because the value is uncertain given the scope and the risk of spawning a self-perpetuating audit chain.
- **Suggested resolution**: if native speakers or the methodology owner flag the hard-coded English structural words in the change-history proposal rows as a real UX issue, spec a `mod_proposal_summary_i18n` task covering `proposalSummary.ts` + `PendingProposalsPane` + `proposalFilter.ts` + catalog parity across all three locales.

### 2026-06-03 — Cross-event id→wording resolution for change-history row summaries

- **Source**: closer for `moderator_ui.mod_change_history_pane.mod_history_event_summary` (Decision D4).
- **Question**: `vote`, `commit`, `edge-created`, and `meta-disagreement-marked` rows show target ids (or id prefixes) rather than the referenced statement's wording. Resolvers exist (`selectNodeWordingById`, `selectEdgeLabelById`, `selectAnnotationContentById` in `apps/moderator/src/graph/selectors.ts`), but using them would break the single-event purity of `summarizeEvent` and add an O(n²) walk. The sibling `mod_history_click_to_flash` will make references navigable on the graph — a better affordance than inlining wordings into rows.
- **Why parked**: value is uncertain given click-to-flash; the enhancement is speculative and should not be registered as a WBS leaf until it is established that click-to-flash is insufficient for the audit use case.
- **Suggested resolution**: after `mod_history_click_to_flash` ships, assess whether id-prefix summaries are still a gap in practice. If yes, spec a `mod_history_row_summary_resolve_ids` task covering the multi-event summarizer variant (passing a log snapshot into the summary layer), extending `ChangeHistoryRow`, and updating the pane + tests.

### 2026-06-03 — Per-entity target picker for change-history filter (wording-resolved dropdown)

- **Source**: closer for `moderator_ui.mod_change_history_pane.mod_history_filtering` (Decision D3, implementer return summary).
- **Question**: should the target dimension of the history filter offer a per-entity picker that resolves entity ids to wordings via `selectNodeWordingById`/`selectEdgeLabelById`, rather than the shipped selection-coupled toggle?
- **Why parked**: value of the picker over the selection-coupled toggle is uncertain — the moderator typically already has the entity selected when asking "what happened to this?" — per the speculative-enhancement rule in Decision D3. Registered as a parking-lot item per that decision; not a WBS leaf.
- **Suggested resolution**: if walkthrough usage shows moderators frequently want to filter history for non-selected entities without clicking the canvas first, spec a `mod_history_target_picker` task covering a dropdown using `selectNodeWordingById`/`selectEdgeLabelById`, its i18n keys, Vitest + Playwright cover, and a migration from the toggle UI.

### 2026-06-03 — Intermittent V8 JIT/WASM teardown SIGABRT under Node 24 during workspace tsc -b

- **Source**: fixer sub-agent for `moderator_ui.mod_change_history_pane.mod_history_filtering` (attempt 1 return summary).
- **Question**: should we pin the Node version or add a build-process guard against the intermittent `Check failed: jit_page_->allocations_.erase(addr) == 1` SIGABRT / exit-133 that aborted `pnpm run build`'s `tsc -b` pass on Node v24.15.0 during one verification attempt?
- **Why parked**: the abort is non-deterministic (re-running the identical command produced exit 0); it is a V8 JIT/WASM teardown race rather than a code defect, so no source change can address it. The decision to pin Node or add a guard requires human judgment on whether the flake rate justifies the maintenance cost.
- **Suggested resolution**: if the SIGABRT recurs in CI or developer builds more than once or twice, consider pinning Node to a stable LTS (e.g. 22.x) or adding a `|| pnpm run build` retry in the CI chain. If it does not recur, close this item.

### 2026-06-03 — Decompose/interpretive-split parent visibility on moderator canvas

- **Source**: closer for `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_full_session_run` (fixer attempt 3/4 diagnosis).
- **Question**: should the moderator canvas (and participant canvas) honor `setNodeVisible(parent, false)` after a decompose or interpretive-split commit, hiding the parent node? Currently neither canvas wires `entity-removed` for these commits; the server sets visibility internally but never emits an `entity-removed` event on the wire, so both `projectNodes` projectors keep the parent rendered. AC-5 in the refinement asserted the parent disappears; the test was amended to drop that assertion because implementing the hide would regress `methodology-full-flow.spec.ts`, which deliberately right-clicks the split/decomposed N1 in 4 later phases.
- **Why parked**: resolving requires a product decision between Option A (wire `entity-removed` on decompose/split commit; rework `methodology-full-flow`'s subsequent phases to not operate on the now-hidden parent) and Option B (parents stay visible post-split/decompose by design; AC-5's original parent-removal assertion was a stale assumption). Either path requires confirming the intended methodology behavior and cross-cutting implementation; not agent-resolvable without that call.
- **Suggested resolution**: confirm with the methodology owner whether decomposed/split parents should remain interactive on-canvas (Option B) or should be hidden after the gesture completes (Option A). If Option A, spec a `frontend_decompose_split_parent_visibility` task covering `entity-removed` wire emission in the commit handler for decompose/split, frontend projector updates in both canvases, `methodology-full-flow` rework, and Playwright cover.

### 2026-06-03 — Lift locale switcher into `@a-conversa/shell` when a second call site emerges

- **Source**: closer for `landing_page.landing_opensource_and_cta` (Decision D3).
- **Question**: `apps/root/src/landing/LocaleSwitcher.tsx` was built landing-local (single call site). ADR 0024's negotiation comments anticipate a second consumer — "the locale-selector control at screen-name capture" (`packages/i18n-catalogs/src/negotiation.ts:236-237`). When that second call site materialises, should the switcher be extracted into `@a-conversa/shell`?
- **Why parked**: speculative generality for a call site that does not exist yet; the decision belongs at the moment a second consumer is being built, not before.
- **Suggested resolution**: when the screen-name capture locale selector is being designed, evaluate whether extracting `LocaleSwitcher` into `@a-conversa/shell` is the right boundary. If yes, do the extraction as part of that task rather than as a standalone refactor.

### 2026-06-03 — Interpretive-split edge inheritance (reading nodes do not inherit parent edges)

- **Source**: closer for `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_full_session_run` (fixer attempt 3 diagnosis; `interpretive_split_logic.md` open question).
- **Question**: when an interpretive split mints reading nodes (N16, N17), should they inherit the parent's existing edges (e.g. the pre-committed rebut edge to N11)? Currently `propose.ts` mints the reading nodes but emits zero `edge-created` events for inherited edges; the open question is flagged in `interpretive_split_logic.md`. The AC-5 assertion in the spec that "inherited rebut edge" renders passes only incidentally (AC-3b's N8→N6 rebut edge persists, not a true inherited edge).
- **Why parked**: edge inheritance semantics on interpretive-split are a methodology product decision — should reading nodes start with the parent's relational context or be blank? No ADR records the intended behavior. Implementing inheritance without that decision risks encoding the wrong product contract.
- **Suggested resolution**: confirm with the methodology owner whether reading nodes should inherit the parent's committed edges on split. If yes, spec a `methodology_interpretive_split_edge_inheritance` task covering the `propose.ts` edge-emission logic, `replay.ts` projection arm, frontend projectors in both canvases, and updated Playwright cover in `full-session-walkthrough.spec.ts` AC-5.

### 2026-06-05 — i18n native review — testMode.changes.* block (pt-BR, es-419)

- **Source**: closer for `replay_test.test_mode.test_mode_changed_highlights` (refinement Acceptance §4; implementer return summary parking-lot note).
- **Question**: the pt-BR and es-419 translations for the new `testMode.changes.*` catalog block (section heading, bucket labels for added/removed/changed nodes and edges, baseline/empty messages) were machine-drafted; they need native-speaker review for accuracy, register, and philosophical-methodology vocabulary.
- **Why parked**: native-speaker sign-off is inherently human work — the agent can draft translations but cannot approve fluency or methodology vocabulary accuracy. Per ADR 0024 the en-US copy is authoritative at land; pt-BR/es-419 ship as parity-complete drafts pending review.
- **Suggested resolution**: when the v1 surfaces are string-complete, review the `testMode.changes.*` block in `packages/i18n-catalogs/src/catalogs/pt-BR.json` and `es-419.json` as part of the single end-of-project locale review pass (see 2026-05-30 entry above); no separate WBS task needed.

### 2026-06-05 — Flaky pglite WASM JIT crash under Node 24.15.0 during cucumber init

- **Source**: fixer sub-agent for `replay_test.test_mode.test_mode_diagnostic_inspector_e2e_tracking` (attempt 1 return summary).
- **Question**: a transient `Check failed: jit_page_->allocations_.erase(addr) == 1` fatal V8 JIT/WASM crash aborted the cucumber run during pglite WASM init on Node 24.15.0 — same JIT/WASM teardown race as the 2026-06-03 entry (tsc -b context) but triggered in the cucumber runner. The re-run passed (317/317 scenarios). Should we pin Node to a stable LTS (e.g. 22.x) or add a cucumber retry wrapper to tolerate flakes?
- **Why parked**: the crash is non-deterministic and unrelated to any source change (identical code, different timing). The choice between pinning Node and adding a retry wrapper is a maintenance-cost trade-off requiring human judgment. See also the 2026-06-03 entry "Intermittent V8 JIT/WASM teardown SIGABRT under Node 24 during workspace tsc -b" — same root cause, different host process.
- **Suggested resolution**: if the JIT/WASM crash recurs more than once or twice in CI, pin Node to 22.x LTS or add `--retry 1` to the cucumber CLI config in the affected `package.json` scripts. If it does not recur, close this item.

### 2026-06-05 — i18n native review — testMode.diagnosticInspector.* block (pt-BR, es-419)

- **Source**: closer for `replay_test.test_mode.test_mode_diagnostic_inspector`.
- **Question**: the pt-BR and es-419 translations for the new `testMode.diagnosticInspector.*` catalog block (section heading, severity group labels, per-kind labels, loading/error/empty strings) were machine-drafted; they need native-speaker review for accuracy, register, and philosophical-methodology vocabulary.
- **Why parked**: native-speaker sign-off is inherently human work — the agent can draft translations but cannot approve fluency or methodology vocabulary accuracy. Per ADR 0024 the en-US copy is authoritative at land; pt-BR/es-419 ship as parity-complete drafts pending review, tracked in `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json`.
- **Suggested resolution**: when the v1 surfaces are string-complete, review the `testMode.diagnosticInspector.*` block in `pt-BR.json` and `es-419.json` as part of the single end-of-project locale review pass (see 2026-05-30 entry above); no separate WBS task needed.

### 2026-06-05 — Promote `WireCoherencyHint` shapes + `HintKind` to `@a-conversa/shared-types`?

- **Source**: closer for `shell_package.coherency_hint_wire_mirror_exhaustiveness` (Decision §3).
- **Question**: should the server's `HintKind` union and the matching `WireCoherencyHint` member interfaces be promoted to `@a-conversa/shared-types` so server and shell import one canonical union, making shell↔server drift structurally impossible (obsoleting both the exhaustiveness guard's residual gap and the `coherency_hint_server_kind_parity_test` leaf)?
- **Why parked**: this is a larger architectural refactor than a 0.5d task — it touches the server's diagnostics emission, requires a new `@a-conversa/shared-types` entry, and is exactly the shared-types promotion the predecessor's Decision §5 explicitly declined to pre-register (it warrants its own ADR). Not agent-resolvable without a deliberate architectural call.
- **Suggested resolution**: if and when the team decides to grow `@a-conversa/shared-types`, include `HintKind` + `WireCoherencyHint` in that scope. If the parity test (`coherency_hint_server_kind_parity_test`) proves insufficient (e.g. a second wire union drifts), revisit this decision. Until then the parity test is the cost-effective boundary.

### 2026-06-05 — i18n native review — audience.replay.playback.* block (pt-BR, es-419)

- **Source**: closer for `replay_test.replay_ui.replay_playback_controls` (Acceptance §4; implementer return summary).
- **Question**: the pt-BR and es-419 translations for the new `audience.replay.playback.*` catalog block (play / pause / step-back / step-forward labels and the position readout format) were machine-drafted; they need native-speaker review for accuracy and register.
- **Why parked**: native-speaker sign-off is inherently human work — the agent can draft translations but cannot approve fluency or register. Per ADR 0024 the en-US copy is authoritative at land; pt-BR/es-419 ship as parity-complete drafts pending review, tracked in `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json`.
- **Suggested resolution**: when the v1 surfaces are string-complete, review the `audience.replay.playback.*` block in `pt-BR.json` and `es-419.json` as part of the single end-of-project locale review pass (see 2026-05-30 entry above); no separate WBS task needed.

### 2026-06-05 — Real-time replay: timestamp-cadence playback toggle

- **Source**: closer for `replay_test.replay_ui.replay_playback_controls` (Decision §4; implementer return summary).
- **Question**: should the replay viewer eventually offer a "real-time" mode that schedules each event step by the delta between consecutive event timestamps (scaled by the speed multiplier), rather than the current constant per-event wall-clock interval?
- **Why parked**: not agent-implementable without a product call. Decision §4 explicitly rejected timestamp-delta cadence for v1 (dead-air from human think-time gaps; requires a new timestamp-delta seam). The per-event cadence is the correct v1 behavior; a real-time toggle is speculative future scope.
- **Suggested resolution**: if the methodology owner or show producers decide real-time pacing is wanted after seeing the per-event replay in action, spec a `replay_realtime_cadence_toggle` task covering the timestamp-delta scheduling logic in `useReplayPlayback`, a UI toggle, and updated Vitest/Playwright cover.

### 2026-06-05 — Reconcile ADR 0026's `replay-test` reservation with the `test-mode` / `replay_ui` split

- **Source**: closer for `replay_test.test_mode.test_mode_app` (Decision §1).
- **Question**: ADR 0026 reserved the name `replay-test` for a single combined surface (`apps/replay-test/`, `/_surfaces/replay-test/`). The WBS split the stream into two: replay lives as a variant of the audience surface (`replay_ui`), and the standalone operator tool is named `test-mode`. ADR 0026's §2/§4 wording still references the old `replay-test` name. Should an Amendment line be appended to ADR 0026 to record that the `replay-test` reservation is superseded?
- **Why parked**: doc-hygiene call — the split is correctly encoded in the WBS and in the refinement's Decision §1; the ADR amendment is a human authoring judgment (what the amendment should say, whether to update §2 and §4 or add a new §, etc.).
- **Suggested resolution**: append an Amendment to `docs/adr/0026-micro-frontend-root-app.md` noting that the `replay-test` reservation is superseded by the `test-mode` / audience-variant split, referencing Decision §1 of this refinement.

