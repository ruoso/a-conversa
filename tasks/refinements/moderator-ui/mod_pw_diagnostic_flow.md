# mod_pw_diagnostic_flow — Playwright: full F3/F7 enabled-state diagnostic flow

## TaskJuggler entry

- **Task:** `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow`
- **Definition:** [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) lines 889–898
- **Title:** "Playwright: full F3/F7 enabled-state diagnostic flow"
- `depends moderator_ui.mod_diagnostic_resolution_flow`

## Effort estimate

**2d** (per the `.tji` block). This is a test-authoring task — no production code changes. The budget covers writing one Playwright spec (or a small spec cluster) that pays down the **enabled-state** coverage debt accumulated by nine F3/F7 refinements, plus the seed-fixture composition each scenario needs.

## Inherited dependencies

**Settled (all `complete 100`):**

- `moderator_ui.mod_diagnostic_resolution_flow` (the direct dependency) — the F7 resolution-flow container. Its two leaves both shipped **2026-06-02**:
  - `mod_resolution_path_picker` — the resolution-path chips dispatch real proposals; inline e2e already pins single-actor chip-enabled + affordance-opens.
  - `mod_break_edge_resolution_action` — the `break-edge` chip opens an inline edge-chooser and dispatches `propose { kind: 'break-edge', edge_id }`; inline e2e already pins the single-actor chooser + focus.
- `mod_disputation_test_display` (chip + `disputationOutcome` helper), `mod_operationalization_mode`, `mod_warrant_elicitation_mode`, `mod_diagnostic_methodology_suggestions`, `mod_is_ought_prompt` — all done; each pinned its surface with Vitest and (for warrant-elicitation) a thin disabled-state Playwright spec, then deferred its **enabled-state** e2e here.
- `playwright_f6_substance_precommit_full_chain` (done) — extended `seedWsStore` to synthesize facet `proposals` / `votes` / `commits`. **This is the enabler that retires the original deferral blocker** (see Decisions §D1).

**Pending:** none. Every surface this spec exercises is route-rendered and reachable today via the dev-only `window.__aConversaWsStore` seam.

## What this task is

This is the **terminal catch-all e2e task** for the F3 (diagnostic-test) and F7 (diagnostic-resolution) moderator surfaces. It writes the Playwright spec(s) that exercise the **enabled-state** behavior that nine predecessor refinements deferred here because, at their ship time, no flow could drive a node's substance facet to a contested (`disputed` / `meta-disagreement`) state from a test — the gate `disputationOutcome(substance) === 'claim'` could never be satisfied without the facet-vote seed primitive, which had not yet landed.

That primitive landed with `playwright_f6_substance_precommit_full_chain`. The `seedWsStore` helper now synthesizes facet `votes` (`agree` | `dispute`) and `commits`, so a spec can put a node into `substance: 'disputed'` and reach every gated enabled-state affordance. This task cashes that in.

The spec covers, end to end against the seeded projection:

1. **Diagnostic suggestions panel (F3, `mod_diagnostic_methodology_suggestions` D10):** seed a node + a fired structural diagnostic via `applyDiagnostic`; assert the `'diagnostic-flags'` sidebar pane renders the suggestions panel keyed to the diagnostic kind with the canonical-order chip row.
2. **Disputation chip enabled-state (F3, `mod_disputation_test_display`):** seed substance `dispute` votes → chip renders `data-disputation-outcome="claim"`; seed `agree` votes + commit → chip renders `data-disputation-outcome="data"`.
3. **Operationalization-mode entry enabled-state (F3, `mod_operationalization_mode` AC #10):** with substance `disputed`, right-click → the `run-operationalization-test` item is **enabled** → clicking it mounts `<OperationalizationCapturePanel>`.
4. **Warrant-elicitation-mode entry enabled-state (F3, `mod_warrant_elicitation_mode` D8):** symmetric — `run-warrant-elicitation-test` enabled → mounts `<WarrantElicitationCapturePanel>` (the disabled-state is already pinned inline by that leaf; only the enabled-state is new here).
5. **Is-ought prompt path (F3, `mod_is_ought_prompt`):** entering operationalization mode surfaces the is-ought prompt at the right moment (per that refinement's seams).
6. **F7 resolution-lifecycle projection response (`mod_resolution_path_picker` / `mod_break_edge_resolution_action`):** seed a `cycle` diagnostic + its `supports` edges → suggestions panel + flag present → seed the `break-edge` proposal + agree votes + commit (edge hides) and `applyDiagnostic({ status: 'cleared' })` → assert the flag and suggestions panel disappear.

## Why it needs to be done

The UI-stream e2e policy (see `ORCHESTRATOR.md` and the brief) flags a single catch-all e2e task inheriting 2+ refinements' deferrals as a planning-debt time bomb — and the `.tji` note names this one as the sink for **nine** refinements. The policy's directive in that situation is **pay the debt down, do not defer further**. Because the seed primitive that blocked these scenarios now exists, the right move is to land the spec here rather than re-defer. After this task the F3/F7 moderator surfaces have behavior-level (not just unit/component-level) coverage of their enabled states, and the catch-all leaf closes instead of spawning successors.

## Inputs / context

**Test infrastructure (reuse, do not re-invent):**

- `tests/e2e/fixtures/wsStoreSeed.ts` — the seed helpers:
  - `seedWsStore(page, { sessionId, nodes, edges, proposals, votes, commits })` — `votes` accept `{ entityKind, entityId, facet: 'substance', participant, choice: 'dispute' | 'agree' }` ([`wsStoreSeed.ts:119-138`](../../../tests/e2e/fixtures/wsStoreSeed.ts), loop ordering nodes→…→votes→commits at [`:271-329`](../../../tests/e2e/fixtures/wsStoreSeed.ts)).
  - `applyDiagnostic(page, { sessionId, kind, severity, status, sequence, diagnostic })` — rides the `applyDiagnostic` reducer feeding `activeDiagnostics` ([`wsStoreSeed.ts:350-385`](../../../tests/e2e/fixtures/wsStoreSeed.ts)). `status: 'cleared'` retires a fired diagnostic.
  - `seedParticipants(page, …)` — opens the lobby gate so the operate canvas mounts ([`wsStoreSeed.ts:442-504`](../../../tests/e2e/fixtures/wsStoreSeed.ts)).
- `tests/e2e/moderator-warrant-elicitation-mode.spec.ts` — the closest sibling. Reuse its `moderatorReachOperate` create→invite→seed-gate→operate helper ([`:71-89`](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts)) and `proposeStatement` ([`:100-106`](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts)). It **already pins the disabled-state** of both diagnostic-test menu items ([`:108-160`](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts)) — do not duplicate; this task adds only the enabled-state.
- `tests/e2e/moderator-change-history.spec.ts`, `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` — reference specs for the seed → assert-on-rendered-pane shape.

**Production seams this spec asserts against (all verified in source):**

- `disputationOutcome(substanceStatus)` mapping ([`apps/moderator/src/graph/disputationOutcome.ts:64-103`](../../../apps/moderator/src/graph/disputationOutcome.ts)): `disputed` / `meta-disagreement` → `'claim'`; `agreed` / `committed` → `'data'`; `proposed` / `withdrawn` / `awaiting-proposal` → `'unsettled'`; `undefined` → `null`.
- The context-menu gate, identical for both F3 mode items today ([`apps/moderator/src/graph/GraphCanvasPane.tsx:1637`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) and [`:1644`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx)): `disabledRun{Operationalization,WarrantElicitation}Test = disputationOutcome(substanceStatus) !== 'claim'`.
- Menu-item test ids: `graph-context-menu-item-run-operationalization-test`, `graph-context-menu-item-run-warrant-elicitation-test` (`aria-disabled` reflects the gate) — confirmed at [`moderator-warrant-elicitation-mode.spec.ts:135,144-148`](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts).
- Capture-panel test ids: `operationalization-capture-panel` / `data-operationalization-target-node-id` ([`apps/moderator/src/layout/OperationalizationCapturePanel.tsx`](../../../apps/moderator/src/layout/OperationalizationCapturePanel.tsx)); `warrant-elicitation-capture-panel` / `data-warrant-elicitation-target-node-id` ([`apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx`](../../../apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx)).
- Disputation chip: `data-disputation-chip` + `data-disputation-outcome` ([`apps/moderator/src/graph/DisputationTestChip.tsx:81-82`](../../../apps/moderator/src/graph/DisputationTestChip.tsx)); the chip mounts when `disputationOutcome(...) !== null`.
- Suggestions panel: `diagnostic-suggestions-panel` + `data-diagnostic-kind` / `data-diagnostic-severity` / per-chip `data-suggestion-move` / `data-suggestion-diagnostic-kind` ([`apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx)).
- Node card: `statement-node-<id>` test id + `data-facet-status` (used by the sibling spec at [`moderator-warrant-elicitation-mode.spec.ts:125-128`](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts)).
- Is-ought prompt seams: see [`mod_is_ought_prompt.md`](mod_is_ought_prompt.md) (prompt mounts when capture `mode` is `operationalization` / `warrant-elicitation`).

**ADRs:** [`docs/adr/0008-e2e-framework-playwright.md`](../../../docs/adr/0008-e2e-framework-playwright.md) (Playwright + the `window.__aConversaWsStore` dev seam), [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) (committed automated checks only), [`docs/adr/0024-frontend-i18n-react-i18next-with-icu.md`](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) (en-US in e2e; cross-locale at catalog level), [`docs/adr/0030`](../../../docs/adr/) (capture-pane gesture is wording-only — `proposeStatement` fires `Cmd/Ctrl+Enter` with no classification pick).

## Constraints / requirements

1. **No production changes.** This is test-only. If a needed seam is genuinely missing (not the case per the audit above), stop and surface it — do not add `data-testid`s opportunistically inside this task.
2. **Seed-backdoor path, en-US locale.** Use `seedWsStore` / `applyDiagnostic` / `seedParticipants`; reach the operate canvas via the shared `moderatorReachOperate` helper. Do not stand up multi-browser-context live-backend flows — that is a different task (Decisions §D2).
3. **Reuse, don't fork, the sibling helpers.** Lift `moderatorReachOperate`, `proposeStatement`, and the gate-participant constants from `moderator-warrant-elicitation-mode.spec.ts` (extract to a shared fixture if duplication across the new spec warrants it; otherwise import/copy per the established per-spec pattern).
4. **Do not duplicate the disabled-state assertions** already landed inline by `mod_warrant_elicitation_mode`; cover only enabled-state transitions here.
5. **Honor the seed loop ordering** (structural entities before facet rounds; proposal → votes → commit within a round) — `seedWsStore` enforces this internally, so pass entities and facet data in one call.
6. **Each scenario must assert observable, route-rendered behavior** — a mounted panel, a chip outcome attribute, an enabled/disabled menu item, a vanished flag — not internal store state.

## Acceptance criteria

All criteria ship as committed Playwright specs under `tests/e2e/` per **ADR 0022** (no throwaway verifications). The build+test gate must pass before commit.

1. **Suggestions-panel presence (F3):** seed a node + `applyDiagnostic` for at least two diagnostic kinds (e.g. `contradiction` and `cycle`); assert the `'diagnostic-flags'` pane contains `diagnostic-suggestions-panel` with `data-diagnostic-kind` matching the fired kind and a chip row whose `data-suggestion-move` chips appear in the kind's canonical order.
2. **Disputation chip — claim:** seed a node + substance `dispute` votes from both debaters; assert the node's `data-disputation-chip` renders `data-disputation-outcome="claim"`.
3. **Disputation chip — data:** seed substance `agree` votes + a substance `commit`; assert `data-disputation-outcome="data"`.
4. **Operationalization enabled-state:** with substance `disputed`, right-click the node; assert `graph-context-menu-item-run-operationalization-test` is **not** `aria-disabled`; click it; assert `operationalization-capture-panel` mounts with `data-operationalization-target-node-id` equal to the node id.
5. **Warrant-elicitation enabled-state:** symmetric to #4 for `graph-context-menu-item-run-warrant-elicitation-test` → `warrant-elicitation-capture-panel`.
6. **Is-ought prompt:** after entering operationalization mode (from #4), assert the is-ought prompt surface renders (per `mod_is_ought_prompt` seams).
7. **F7 resolution-lifecycle projection response:** seed a `cycle` diagnostic plus its `supports` edges; assert flag + suggestions panel present; then seed the `break-edge` proposal + agree votes + commit and `applyDiagnostic({ status: 'cleared' })`; assert the cycle flag and its suggestions panel are gone and the broken edge is no longer rendered.
8. **No further deferral.** This spec closes the inherited debt of all nine predecessor refinements for their enabled-state behavior. The only F3/F7 coverage that legitimately lives elsewhere is the **live multi-browser full-backend walk**, which is the pre-existing remit of `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_full_session_run` (not a new task; see Decisions §D2). The closer registers **no new WBS task** from this refinement.

## Decisions

**D1 — Pay the debt down here via the facet-vote seed primitive; do not re-defer.**
The original blocker for every deferred scenario was that no test could put a node's substance facet into `disputed`/`meta-disagreement`, so `disputationOutcome(...) === 'claim'` (the gate on the operationalization item at `GraphCanvasPane.tsx:1637`, the warrant-elicitation item at `:1644`, and the chip's `claim` outcome) was unreachable. `playwright_f6_substance_precommit_full_chain` retired that blocker by teaching `seedWsStore` to synthesize facet `votes`/`commits` (`wsStoreSeed.ts:119-138, 290-329`). With the blocker gone and this leaf already inheriting nine refinements' debt, the e2e policy's debt-watch mandates paying down rather than deferring further. *Alternatives rejected:* (a) split into several smaller future `mod_pw_*` tasks — rejected because the surfaces are now reachable, so splitting would manufacture orphan leaves; (b) re-defer to a live-backend task — rejected because the seed backdoor already exercises the user-visible behavior, and re-deferral is exactly the self-perpetuating loop the policy forbids.

**D2 — Drive scenarios through the seed backdoor; leave the live multi-browser walk to the pre-existing `mod_pw_full_session_run`.**
This spec asserts the moderator UI's *response* to the F3/F7 state space (enabled affordances, mounted panels, chip outcomes, projection updates on resolution-commit + diagnostic-clear), all reachable via `seedWsStore` / `applyDiagnostic`. The genuinely-live concern — two real participant tablets agreeing, a real backend re-running diagnostics and broadcasting the `cleared` frame across connections — is a different test shape that `mod_pw_full_session_run` already owns ([`tasks/30-moderator-ui.tji:869-877`](../../30-moderator-ui.tji), "drives moderator + two participant tablets in parallel browser contexts"). This is **not a new deferral**: that task pre-exists and already scopes the full live walk; this refinement merely declines to duplicate it. *Alternative rejected:* building parallel-browser-context multi-actor live flows inside this task — rejected as redundant with `mod_pw_full_session_run` and disproportionate to a 2d enabled-state-coverage budget.

**D3 — Cover the two F3 mode entries (operationalization, warrant-elicitation) and the chip together, sharing one seeded-`disputed`-node setup.**
All three enabled-states gate on the same `disputationOutcome === 'claim'` predicate, so one `substance: disputed` seed satisfies all of them; structuring the spec to reuse that setup keeps the spec compact and pins that the *shared* gate behaves consistently across the three consumers. The `data` outcome (AC #3) needs its own `agreed`/`committed` seed. *Alternative rejected:* one spec file per consumer — rejected as needless fixture duplication given the shared gate; a single describe-block with focused `test()`s is the established pattern (cf. `moderator-change-history.spec.ts`).

**D4 — en-US only, matching the sibling specs.**
Per ADR 0024 and the note in `moderator-capture.spec.ts`, cross-locale parity is covered at the catalog level; the e2e layer pins behavior in en-US. The warrant-elicitation sibling spec follows this ([`:32-33`](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts)); this task matches.

**D5 — Assert the F7 resolution lifecycle as a projection response, not a live diagnostic re-run.**
AC #7 seeds the `break-edge` proposal+votes+commit and the `cleared` diagnostic frame separately, then asserts the UI hides the edge and drops the flag/panel. This pins the moderator projection's reaction to the resolution lifecycle without asserting that the *server* derived the clear — that derivation is exercised by methodology-engine Cucumber coverage and by `mod_pw_full_session_run`. *Alternative rejected:* asserting the server re-runs structural diagnostics after a real commit — out of scope for a UI e2e and already covered at the engine boundary.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Created `tests/e2e/moderator-diagnostic-enabled-flow.spec.ts` — catch-all F3/F7 enabled-state spec covering ACs #1a, #1b, #2, #3, #4+#6, #5, and #7.
- Edited `tests/e2e/fixtures/wsStoreSeed.ts` — added `SeedEntityRemoval` primitive (`entityRemovals` option) emitting `entity-removed` events with commit-time fan-out that hides broken edges (additive, test-infra only).
- 7 Playwright scenarios cover all ACs: suggestions-panel canonical chip order (contradiction + cycle), disputation chip `claim` and `data` outcomes, operationalization enabled-state (panel mounts), warrant-elicitation enabled-state (panel mounts), is-ought prompt in operationalization mode, F7 resolution lifecycle (break-edge `entity-removed` + cleared diagnostic → flag/panel/edge gone).
- Paid down enabled-state e2e debt accumulated by nine predecessor refinements (`mod_diagnostic_methodology_suggestions`, `mod_disputation_test_display`, `mod_operationalization_mode`, `mod_warrant_elicitation_mode`, `mod_is_ought_prompt`, and the four resolution-flow leaves).
- No production-code changes; no new WBS task registered (per AC #8 and Decisions §D1).
