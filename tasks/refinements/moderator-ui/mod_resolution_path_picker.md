# mod_resolution_path_picker — UI to pick a structural-diagnostic resolution path

## TaskJuggler entry

- WBS leaf: `moderator_ui.mod_diagnostic_resolution_flow.mod_resolution_path_picker`
- Definition: [`tasks/30-moderator-ui.tji` L588–593](../../30-moderator-ui.tji#L588)
- Title: _"UI to pick resolution path (decompose / amend / break-edge / accept-as-bedrock)"_

## Effort estimate

`2d` (per the `.tji` block). Most of the budget is wiring five already-shipped
resolution affordances to the chip row and pinning the observable behavior in
tests — not new engine, store, or wire surface.

## Inherited dependencies

`depends !mod_diagnostic_focus_action` (parent `mod_diagnostic_resolution_flow`
also depends on `mod_diagnostic_flow`, `root_app.root_moderator_cutover`,
`data_and_methodology.diagnostics.blocking_vs_advisory_classification`,
`frontend_i18n.i18n_diagnostic_descriptions`).

**Settled by predecessors (all shipped):**

- **The disabled chip row + its seams** — `mod_diagnostic_methodology_suggestions`
  shipped `<DiagnosticSuggestionsPanel>` with one disabled-placeholder
  `<button>` per methodology move, carrying the stable
  `data-suggestion-move` / `data-suggestion-diagnostic-kind` seams. Decision §D3
  of that refinement explicitly handed chip-wiring to **this** task: _"the F7
  picker will turn them on"_, and _"the picker can `disabled={false}` + add the
  `onClick` handler in one diff, not refactor the markup."_
  ([`apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx:137-152`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx))
- **The move catalog** — `suggestionsForDiagnostic(payload)` maps each
  diagnostic kind to its ordered move list; the `SuggestionMove` union is the
  locked vocabulary this picker switches on
  ([`apps/moderator/src/graph/diagnosticSuggestions.ts:66-142`](../../../apps/moderator/src/graph/diagnosticSuggestions.ts)).
- **The affected-entity helper** — `affectedEntities(payload)` returns
  `{ nodes, edges }` per diagnostic kind; already used by the flag pane to
  compute focus targets
  ([`packages/shell/src/diagnostics/diagnostic-highlights.ts:247-284`](../../../packages/shell/src/diagnostics/diagnostic-highlights.ts)).
- **The canvas-focus seam** — `mod_diagnostic_focus_action` shipped
  `requestCanvasFocus({ nodeIds, edgeIds })` on `uiStore`
  ([`apps/moderator/src/stores/uiStore.ts:74-81`](../../../apps/moderator/src/stores/uiStore.ts))
  and the consuming `useCanvasFocusEffect`
  ([`apps/moderator/src/graph/useCanvasFocusEffect.ts:34-62`](../../../apps/moderator/src/graph/useCanvasFocusEffect.ts)).
- **The resolution affordances themselves** — every structural move this picker
  routes to is already a shipped, end-to-end-working action (see Inputs).

**Pending / out of this task's hands:** the multi-actor
propose→agree→commit→diagnostic-clear Playwright walk (owned by the registered
`mod_pw_diagnostic_flow`); `break-edge` UI dispatch and the open methodology
question on advisory-move semantics (see Decisions §D5 and Open questions).

## What this task is

Turn the inert methodology-suggestion chips into a working **resolution-path
picker**: clicking a chip selects a resolution move and launches the existing
moderator affordance for that move, seeded from the focused diagnostic's
affected entities, with the canvas focused on the affected region. This is the
"pick a path and run through the lifecycle" step of the F7 flow
([`docs/moderator-ui.md` § F7](../../../docs/moderator-ui.md)).

Concretely the picker:

1. Flips the chips from `disabled` to live `<button>`s with `onClick` handlers
   (no markup refactor — same DOM, same seams).
2. Owns a pure router `resolutionPlanForMove(move, payload)` that maps a
   `(move, diagnostic)` pair to a concrete action descriptor: which capture
   mode to enter or which proposal affordance to open, and the candidate target
   entity / entities.
3. Dispatches by **reusing the shipped affordance** for that move (capture-mode
   entry or proposal submenu), and reuses `requestCanvasFocus(...)` to frame the
   region.

## Why it needs to be done

`mod_diagnostic_methodology_suggestions` deliberately shipped the chips inert to
keep methodology-vocabulary pinning separate from resolution dispatch (its §D3).
Until this task lands, a moderator can _see_ the recommended moves and _focus_
the region (via the predecessor focus action) but cannot _act_ on a diagnostic
from the diagnostic surface — they must hunt for the affected node on the canvas
and use its context menu unaided. This task closes the F7 loop: from a flagged
blocking diagnostic to a dispatched resolution proposal. It is the last leaf of
`mod_diagnostic_resolution_flow` and the thing `mod_pw_diagnostic_flow` exists to
exercise end-to-end.

## Inputs / context

**The chip row to wire (the diff site):**

- [`apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx:137-152`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx) —
  the `moves.map(...)` loop renders one `<button disabled aria-disabled="true"
  data-suggestion-move={move} data-suggestion-diagnostic-kind={focused.kind}>`
  per move. `focused` is the single picked diagnostic (head of
  `orderActiveDiagnostics`); `moves` is `suggestionsForDiagnostic(focused)`.

**The move catalog and per-kind mapping:**

- [`apps/moderator/src/graph/diagnosticSuggestions.ts:66-142`](../../../apps/moderator/src/graph/diagnosticSuggestions.ts):
  - `cycle` → `['break-edge', 'decompose', 'axiom-mark']`
  - `contradiction` → `['decompose', 'amend', 'axiom-mark-both']`
  - `multi-warrant` → `['decompose']`
  - `dangling-claim` → `['prompt-for-support', 'mark-conceded']`
  - `coherency-hint` → `['review-configuration', 'repair-configuration', 'leave-as-intentional']`

**The shipped resolution affordances (what each wired move dispatches to):**

- **decompose** → `useCaptureStore.enterDecomposeMode(nodeId)`
  ([`apps/moderator/src/stores/captureStore.ts:708-735`](../../../apps/moderator/src/stores/captureStore.ts));
  the decompose capture panel renders when `mode === 'decompose'`.
- **axiom-mark** / **axiom-mark-both** → `useAxiomMarkAction(nodeId).markAxiom(participantId)`
  ([`apps/moderator/src/layout/useAxiomMarkAction.ts:165-248`](../../../apps/moderator/src/layout/useAxiomMarkAction.ts)),
  surfaced via `<AxiomMarkSubmenu>` (per-participant grid). Proposal payload
  `{ kind: 'axiom-mark', node_id, participant }`.
- **amend** → `useEditWordingAction(nodeId).propose(newWording, editKind)`
  ([`apps/moderator/src/layout/useEditWordingAction.ts:174-256`](../../../apps/moderator/src/layout/useEditWordingAction.ts)),
  surfaced via `<EditWordingSubmenu>`.
- **prompt-for-support** → `useCaptureStore.enterWarrantElicitationMode(nodeId)`
  ([`apps/moderator/src/stores/captureStore.ts:865-884`](../../../apps/moderator/src/stores/captureStore.ts)).

**The affected-entity / focus seams:**

- `affectedEntities(payload)` →
  [`packages/shell/src/diagnostics/diagnostic-highlights.ts:247-284`](../../../packages/shell/src/diagnostics/diagnostic-highlights.ts).
  Per kind: `cycle` → `{ nodes, edges: [] }`; `contradiction` →
  `{ nodes: [nodeA, nodeB], edges }`; `multi-warrant` →
  `{ nodes: [dataNode, claimNode, ...warrants], edges: [] }`; `dangling-claim`
  → `{ nodes: [nodeId], edges: [] }`; coherency sub-kinds → small node/edge sets.
- `requestCanvasFocus({ nodeIds, edgeIds })` →
  [`apps/moderator/src/stores/uiStore.ts:74-81`](../../../apps/moderator/src/stores/uiStore.ts)
  (nonce-bumping; consumed by `useCanvasFocusEffect`).

**Engine support (resolution is end-to-end today):**

- The commit projector handles every structural move's proposal kind:
  `decompose`, `axiom-mark`, `edit-wording`/`amend-node`, and **`break-edge`**
  (`projection.setEdgeVisible(edge_id, false)`) at
  [`apps/server/src/projection/replay.ts:1093-1345`](../../../apps/server/src/projection/replay.ts)
  (break-edge arm at L1291-1303). The `break-edge` wire schema
  (`{ kind: 'break-edge', edge_id }`) is at
  [`packages/shared-types/src/events/proposals.ts:429-432`](../../../packages/shared-types/src/events/proposals.ts).
- There is **no** engine proposal kind for `mark-conceded`,
  `review-configuration`, `repair-configuration`, or `leave-as-intentional` —
  these are advisory suggestion labels only.

**Methodology + product framing:**

- [`docs/methodology.md` "Resolution of structural diagnostics" L217-237](../../../docs/methodology.md):
  blocking diagnostics are resolved by _performing the structural change that
  eliminates them_ (break a `supports` edge, decompose, axiom-mark each side);
  advisory diagnostics ("multiple warrants", "dangling claim", coherency hints)
  carry **no required resolution** — the dangling-claim moves are a "soft
  prompt", coherency hints are "advisory only; no required resolution."
- The methodology treats diagnostics as **emergent projections of graph shape**,
  not durable state — there is no "mark resolved" record; the flag clears when
  the precondition is recomputed away.

**i18n:** chip labels already exist at
[`packages/i18n-catalogs/src/catalogs/en-US.json:636-647`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
(`moderator.diagnostic.suggestions.move.<move>`), with `pt-BR` / `es-419`
parity. Only target-chooser chrome keys (if added) are new.

## Constraints / requirements

1. **Diff shape, not refactor.** Keep the existing chip markup and the
   `data-suggestion-move` / `data-suggestion-diagnostic-kind` seams. Flip
   `disabled`/`aria-disabled` and add `onClick`. Do not re-shape the panel DOM
   (downstream consumers and the predecessor tests depend on the seams).
2. **Reuse shipped affordances.** No new capture mode, no new proposal hook for
   moves that already have one. Route through `enterDecomposeMode`,
   `useAxiomMarkAction`, `useEditWordingAction`, `enterWarrantElicitationMode`.
3. **No new engine / wire surface.** Resolution is emergent (Decision §D1):
   the picker emits only existing `propose` envelopes / enters existing modes;
   it never introduces a "resolve-diagnostic" event.
4. **Seed from the diagnostic.** Action targets are derived from
   `affectedEntities(payload)` — never hard-coded, never an arbitrary "first
   node" guess (Decision §D4).
5. **Focus on dispatch.** Every chip click reuses `requestCanvasFocus(...)` to
   frame the affected region (consistency with the flag-click focus action).
6. **Move routing is a pure, exhaustively-narrowed function.** The
   `(move, kind)` → plan map must be a pure module (mirrors
   `diagnosticSuggestions.ts` / `disputationOutcome.ts`), unit-tested per move,
   so an unrouted move is a compile/test break, not a silent dead chip.
7. **i18n via `useTranslation`** (ADR 0024) for any new chrome; reuse existing
   move labels.

## Acceptance criteria

Per ADR 0022, every empirical check below ships as a committed test — no
throwaway verification.

**Vitest — pure router (`resolutionPlanForMove`):**

1. Each `(diagnostic kind, move)` pair in the catalog returns the expected
   plan descriptor (mode-entry vs proposal-submenu vs focus-only) and the
   expected target entity ids derived from `affectedEntities`.
2. Exhaustiveness: the union is narrowed so an unmapped move fails to compile;
   a test pins one representative of each disposition class.
3. Single-target diagnostics (dangling-claim, multi-warrant→claim) yield a
   direct-dispatch plan; multi-candidate diagnostics (cycle, contradiction)
   yield a target-chooser plan listing the candidate node ids.

**Vitest — `<DiagnosticSuggestionsPanel>` wiring:**

4. Wired chips render enabled (`disabled` absent, `aria-disabled` absent/false);
   focus-only / deferred chips render in their documented state (Decision §D5).
5. Clicking `decompose` calls `enterDecomposeMode` with the resolved target
   node and dispatches `requestCanvasFocus` with the affected set.
6. Clicking `axiom-mark` / `amend` opens the corresponding submenu seeded with
   the target node; clicking `prompt-for-support` enters warrant-elicitation
   mode on the dangling claim node.
7. Clicking `axiom-mark-both` on a contradiction surfaces axiom-mark for **both**
   affected nodes.
8. Clicking a multi-candidate chip presents the inline target chooser; choosing
   a candidate dispatches the affordance for that candidate.
9. Advisory non-structural chips (`mark-conceded`, `review-configuration`,
   `repair-configuration`, `leave-as-intentional`) and `break-edge` focus the
   affected region and do not emit a structural proposal (Decision §D5).

**Playwright — observable picker behavior (in scope; extends
[`tests/e2e/moderator-diagnostic-flag-pane.spec.ts`](../../../tests/e2e/moderator-diagnostic-flag-pane.spec.ts)
using the `applyDiagnostic(page, payload)` backdoor at
[`tests/e2e/fixtures/wsStoreSeed.ts:369`](../../../tests/e2e/fixtures/wsStoreSeed.ts)):**

10. Seed a `contradiction` diagnostic → the `decompose`/`amend`/`axiom-mark-both`
    chips render enabled; clicking `amend` opens the edit-wording submenu and the
    canvas viewport transform changes (focus fired).
11. Seed a `dangling-claim` diagnostic → clicking `prompt-for-support` enters
    warrant-elicitation mode (its capture panel becomes visible).

These are reachable today — the panel is route-rendered in the operate console
and diagnostics are seedable via the shipped backdoor; e2e is therefore **in
scope, not deferred**.

**Deferred to `mod_pw_diagnostic_flow`** (already registered at
[`tasks/30-moderator-ui.tji` L862-865](../../30-moderator-ui.tji#L862),
`depends moderator_ui.mod_diagnostic_resolution_flow`): the full multi-actor
walk — propose a resolution, all participants agree, moderator commits, and the
diagnostic flag/banner _clears_. That requires multiple authenticated
connections and the agree/commit lifecycle, which is exactly that task's remit;
no new WBS task is created here. (Per the e2e policy's debt-watch: the cheap,
single-actor, observable behavior is paid inline above; only the genuinely
multi-actor end-state is left to the catch-all.)

## Decisions

**§D1 — Resolution is emergent; no new engine "resolution event."**
`mod_diagnostic_methodology_suggestions` §D3 anticipated a "yet-unbuilt
`resolution_events` engine surface." On inspection that surface is unnecessary:
the existing `propose`→agree→`commit` lifecycle for `decompose`, `axiom-mark`,
`amend`/`edit-wording`, and `break-edge` already performs every structural
change the methodology lists, and the projector recomputes diagnostics on the
committed graph so a flag clears the moment its precondition is gone
([`docs/methodology.md` L217-237](../../../docs/methodology.md);
engine arms at [`replay.ts:1093-1345`](../../../apps/server/src/projection/replay.ts)).
_Alternative rejected:_ a first-class `resolve-diagnostic` event — there is
nothing durable to mark resolved (diagnostics are projections, not state), so
such an event would be a write with no reader. This also matches the `.tji`
note's framing that the diff is "flipping `disabled={false}` + adding `onClick`
handlers … not a markup refactor."

**§D2 — Wire in place; preserve the chip seams.** The picker flips the existing
chips live rather than rendering a new control. Chosen because the predecessor
shipped the exact DOM the picker needs and pinned the `data-suggestion-move`
seams as the contract (mirrors `<IsOughtPrompt>`). _Alternative rejected:_ a
separate "resolution modal" — would duplicate the move catalog UI and orphan the
established seams.

**§D3 — Routing via a pure `resolutionPlanForMove(move, payload)` module.** The
`(move, kind)` → action-descriptor mapping is a pure, exhaustively-narrowed
function (same pattern as `diagnosticSuggestions.ts`), unit-tested per move; the
panel's `onClick` is a thin dispatcher over the descriptor. Chosen for
testability and to make an unrouted move a compile/test break. _Alternative
rejected:_ inline `switch` in the `onClick` — untestable in isolation and easy to
let a move fall through silently.

**§D4 — Target derivation: direct when unambiguous, inline chooser when not.**
Targets come from `affectedEntities(payload)`. When a diagnostic implicates a
single applicable node (dangling-claim; multi-warrant's claim node), the chip
dispatches directly. When it implicates several (cycle's N nodes,
contradiction's two), the chip focuses the region and presents a small **inline
target chooser** (the affected nodes by wording) before dispatching. _Alternatives
rejected:_ (a) auto-picking the "first" affected node — arbitrary and frequently
wrong for a cycle; (b) a new "armed canvas selection" interaction (click chip,
then click a node on the canvas) — more interaction surface than a 2d leaf
warrants, and the canvas already offers per-node context-menu dispatch for the
moderator who prefers that path.

**§D5 — Move dispositions for v1.** Every _blocking_ diagnostic gets at least
one fully-wired resolution path:

| Move | Disposition (v1) |
| --- | --- |
| `decompose` | **Wired** → `enterDecomposeMode` (cycle/contradiction via chooser; multi-warrant direct on claim). |
| `axiom-mark` | **Wired** → `useAxiomMarkAction` submenu, seeded node. |
| `axiom-mark-both` | **Wired** → axiom-mark for both contradiction nodes. |
| `amend` | **Wired** → `useEditWordingAction` submenu, seeded node. |
| `prompt-for-support` | **Wired** → `enterWarrantElicitationMode`, dangling claim node. |
| `break-edge` | **Focus-only in v1; full dispatch deferred** (see below). |
| `mark-conceded`, `review-configuration`, `repair-configuration`, `leave-as-intentional` | **Focus-only** — no committable proposal kind; methodology assigns no required structural resolution. |

_`break-edge` deferral rationale:_ the engine commits `break-edge` end-to-end,
but there is no `useBreakEdgeAction` hook and no edge-target affordance, and
`affectedEntities` for a `cycle` returns `edges: []` — the supports edges to
break are not enumerated in the payload, so the moderator needs an edge-pick
step that doesn't exist yet. That is concrete, agent-implementable, **and**
engine-ready follow-up work, deferred to a named task (below). Cycle remains
resolvable in v1 via `decompose` and `axiom-mark`.

_Advisory focus-only rationale:_ the methodology states these moves carry no
required resolution (dangling-claim is a "soft prompt"; coherency hints are
"advisory only"). Giving them durable structural or acknowledge/dismiss
semantics would require **new methodology/product decisions** about what (e.g.)
"concede" or "leave as intentional" durably mean — human judgment, not
implementable now (see Open questions / parking lot). Until then, focusing the
region so the moderator can discuss the prompt is the faithful behavior.

**§D6 — e2e split.** Single-actor observable behavior (chip enabled-state,
affordance-opens-on-click, focus fired) is paid inline as Playwright now,
because the surface is reachable today (route-rendered + `applyDiagnostic`
backdoor). The multi-actor resolve→agree→commit→flag-clears walk is left to the
already-registered `mod_pw_diagnostic_flow`. _Alternative rejected:_ deferring
the whole spec to `mod_pw_diagnostic_flow` — the panel is reachable, so under the
strict UI-stream policy full deferral is the wrong default, and that catch-all is
already debt-heavy.

**§D7 — i18n reuse.** Reuse the existing
`moderator.diagnostic.suggestions.move.<move>` labels; add only target-chooser
chrome keys if the chooser needs them, with `pt-BR` / `es-419` parity (ADR 0024).

**§D8 — No new ADR.** This task reuses existing seams, adds no dependency, and
opens no new architectural surface; the one non-obvious call (emergent
resolution, §D1) is a clarification of existing methodology, recorded here.

## Named follow-up tasks (closer registers in WBS)

- **`mod_break_edge_resolution_action`** — wire the `break-edge` chip to a real
  proposal. Adds a `useBreakEdgeAction` hook sending
  `propose { kind: 'break-edge', edge_id }` (engine commit handler at
  [`replay.ts:1291-1303`](../../../apps/server/src/projection/replay.ts) and
  schema at [`proposals.ts:429-432`](../../../packages/shared-types/src/events/proposals.ts)
  already exist) plus an edge-target selection affordance over the cycle's
  candidate `supports` edges (which `affectedEntities` does not enumerate).
  Effort ≈ `1d`. Milestone: same as `mod_diagnostic_resolution_flow` (F7
  moderator-ui). Depends on `mod_resolution_path_picker`.

(For the parking lot, not WBS — a methodology/product decision, not
agent-implementable: whether `mark-conceded` and the coherency moves
`review-/repair-configuration`, `leave-as-intentional` should gain durable
structural or acknowledge/dismiss semantics, or remain conversational
focus-only prompts. Surfaced in the return summary.)

## Open questions

(none — all decided; the advisory-move-semantics question is routed to the
parking lot, not left open here.)

## Status

**Done** — 2026-06-02.

- Created `apps/moderator/src/graph/resolutionPlan.ts` — pure `(move, diagnostic)` → plan router (`resolutionPlanForMove`), exhaustively narrows the `SuggestionMove` union; direct-dispatch for single-target diagnostics, inline target-chooser for multi-candidate (cycle, contradiction).
- Created `apps/moderator/src/graph/resolutionPlan.test.ts` — 39 Vitest tests covering all catalog pairs, disposition exhaustiveness, and single- vs multi-target routing.
- Edited `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx` — chips flipped live: `onClick` routes via `resolutionPlanForMove`, dispatches `enterDecomposeMode` / `enterWarrantElicitationMode` / `<AxiomMarkSubmenu>` / `<EditWordingSubmenu>` + inline target chooser; `requestCanvasFocus` fired on every click.
- Edited `apps/moderator/src/layout/DiagnosticSuggestionsPanel.test.tsx` — covers direct mode-entry, inline chooser → submenu, axiom-mark-both both nodes, focus-only advisory/break-edge.
- Edited `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — added `moderator.diagnostic.suggestions.chooser.{header,cancel}`; parity kept (557 keys × 3 locales).
- Edited `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` — two new Playwright scenarios: contradiction chips enabled + amend focuses region + opens edit-wording submenu; dangling-claim prompt-for-support enters warrant-elicitation mode.
- `break-edge` is focus-only in v1; full dispatch deferred to `mod_break_edge_resolution_action` (registered in WBS per §D5 deferral rationale).
- Advisory moves (`mark-conceded`, `review-configuration`, `repair-configuration`, `leave-as-intentional`) remain focus-only; durable semantics parked in `tasks/parking-lot.md` as a methodology/product decision.
