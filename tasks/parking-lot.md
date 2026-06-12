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

### 2026-06-11 — OBS compositing smoothness for `cytoscape-node-html-label` at 1080p

- **Source**: closer for `post_implementation_audits.per_facet_step_pill` (Decision §11b).
- **Question**: does per-node HTML via `cytoscape-node-html-label` composite smoothly on real OBS streaming hardware at 1920×1080 under a live session with ~40 statement nodes? The agent-checkable half (Playwright dense-graph audit — no scrollbars, no console errors at 40 nodes) was recorded in `tests/e2e/audience-step-pill.spec.ts` scenario (d). The subjective compositing-smoothness half requires real OBS hardware.
- **Why parked**: subjective frame-rate / compositing perception is inherently a human checkpoint; Playwright cannot assert streaming quality. Frame-time assertions were considered and rejected as flaky-by-construction (Decision §11). The fallback if this fails is documented in Decision §0 (B): revert to Cytoscape canvas labels + DOM overlays.
- **Suggested resolution**: run the audience broadcast surface with ~40 statement nodes as an OBS browser source at 1920×1080 and verify compositing is smooth. If it fails, the Decision §0 (B) fallback is the documented path; if it passes, delete this entry.

### 2026-06-12 — Topic search: `pg_trgm` trigram index (future perf gate)

- **Source**: closer for `session_discovery.sd_schema` (Decision §D4).
- **Question**: at what session-count does `topic ILIKE '%q%'` become too slow for the public-sessions list, and should a `pg_trgm` GIN index be added at that point?
- **Why parked**: ADR 0016 bars Postgres extensions in v1 — enabling `pg_trgm` requires `CREATE EXTENSION` and a superseding ADR; deliberately not registered as a WBS task because the orchestrator would pick it up and force-enable the extension against Decision D4. Both lists bound their candidate set before the topic filter applies (public list via partial index; my-sessions via membership), so `ILIKE` over a small filtered set is adequate at v1 scale.
- **Suggested resolution**: revisit when real-show session volumes are known. If `ILIKE` is measured slow, write a superseding ADR to `pg_trgm`, add `CREATE EXTENSION pg_trgm` to a new migration, and register a `session_discovery.sd_topic_index` task in `tasks/75-session-discovery.tji` gated on M11.
