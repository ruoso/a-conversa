# Collapse `computeFacetStatuses` + the seven facet-state derivation rules into `@a-conversa/shell` (four-caller trigger fired by `apps/audience/src/graph/facetStatus.ts`)

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.extract_facet_status_rules` (lines 79-86).
**Effort estimate**: 1d

## Inherited dependencies

- `shell_package.extract_facet_pill` (settled — [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md)). The strict `!`-edge predecessor and the source-of-debt. Decision §2 there explicitly rejected lifting the rule-set in the FacetPill leaf and pre-registered this task: "wait for the audience's facet-rendering leaf to materialize as the fourth caller" ([`extract_facet_pill.md` lines 170-173](extract_facet_pill.md#L170)). Decision §1 there co-moved a *tiny* `packages/shell/src/facet-pill/types.ts` carrying just the `FacetName` + `FacetStatus` string-literal-union aliases — the shell's FacetPill needed them for its prop typing but the two large `facetStatus.ts` ports were left in place. The new shell-side `facet-status/` directory this leaf creates becomes the canonical home for those types; `facet-pill/types.ts` collapses to a re-export shim (Decision §3).
- `audience.aud_graph_rendering` (settled umbrella — [`tasks/refinements/audience/aud_graph_rendering.md`](../audience/aud_graph_rendering.md) and its decomposed leaves; the umbrella's state-styling + per-facet-visualization sub-leaves are all `complete 100`). The fourth-caller trigger. The audience's per-state styling leaves (`aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, `aud_meta_disagreement_split`, `aud_per_facet_visualization`) collectively required a verbatim port of the rule-set walker into [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts). The file's own header at lines 9-12 names this task as the consolidation that retires the four-copy duplication: "Decision §5 — fourth verbatim copy lands here; consolidation to `@a-conversa/shell` deferred to the named-future-task `shell_facet_status_extraction`." (The WBS task name is `extract_facet_status_rules`; the audience header's `shell_facet_status_extraction` is the earlier label — same task.)
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_cytoscape_projectors` (settled 2026-05-28 — [`tasks/refinements/shell-package/extract_cytoscape_projectors.md`](extract_cytoscape_projectors.md)). The immediate shape-precedent. Same kind of cross-client-mirror extraction (annotation projection trio); same atomic-transition + sibling-directory + root-re-export + consolidated-Vitest pattern. The key shape divergence: that leaf had two layers of carve-out (participant-local boolean+count helpers stayed; audience module fully deleted). This leaf has **no per-workspace carve-outs** — every public symbol in every workspace's `facetStatus.ts` is part of the lift (Decision §5).
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_axiom_marks_extraction` (settled 2026-05-28 — [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](shell_axiom_marks_extraction.md)). The parallel third-caller-fired entity-layer lift; same sibling-directory + barrel + root-export shape.
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md)). The foundational precedent for the `packages/shell/src/<area>/` directory layout and the root re-export convention via [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts).
- Prose-only context (NOT a `.tji` edge): `per_facet_refactor.pf_projection_facet_status_refactor` (settled). The canonical refinement that pinned the eight-rule derivation walk. Each client mirror's header comment links back to it. No re-architecting here — the lift moves the rules verbatim.
- Prose-only context (NOT a `.tji` edge): ADR 0030 (per-facet vote keying). The methodology authority for the seven-status union (`proposed` / `agreed` / `disputed` / `meta-disagreement` / `committed` / `withdrawn` / `awaiting-proposal`) and the rule-set semantics this lift carries.

## What this task is

The 1d mechanical refactor that lifts the **per-entity per-facet `FacetStatus` derivation walker** — the `FacetStatus` union (seven values), the `FacetName` union (four values), the `FacetStatusIndex` interface (two `Map`s, one per entity kind), the `computeFacetStatuses(events)` ~410-line pure walk that runs the eight derivation rules over a session event log, the `EMPTY_FACET_STATUSES` frozen empty-record reference, the `ROLLUP_PRIORITY` ordering and the `cardRollupStatus(facetStatuses)` helper — out of three client workspaces (`apps/moderator/`, `apps/participant/`, `apps/audience/`) into a single canonical home at `packages/shell/src/facet-status/`, then rewires every client-side caller to import from `@a-conversa/shell` and deletes the three local copies.

Today the rules exist as **four mirrors** in lockstep:

- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) (226 lines) — server-side authoritative source. Exposes `deriveFacetStatus(perParticipant, candidateValue, …)` — a **per-(entity, facet) single-pair** deriver, not a batch walker. The server's projection pipeline (`apps/server/src/projection/replay.ts`, `apps/server/src/methodology/handlers/*`, the WS broadcast `proposal-status` path) walks events itself and calls `deriveFacetStatus` per pair as part of its larger projection work. **Not in scope here.** The client-side `computeFacetStatuses(events)` is a different signature serving a different consumption pattern (one-shot batch walk of the full session log for client-side projection); the server-side deriver shares semantics but not signature.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) (692 lines) — first client mirror. Walks events, runs the eight rules, returns `FacetStatusIndex`. ~18 in-workspace consumers.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) (681 lines) — second client mirror. Verbatim port of the moderator's walker + adds `ROLLUP_PRIORITY` + `cardRollupStatus` (the per-card highest-priority rollup used by the participant's Cytoscape selector engine). ~20 in-workspace consumers.
- [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) (553 lines) — third client mirror (the fourth-caller trigger). Verbatim port of the participant's walker + the same `ROLLUP_PRIORITY` + `cardRollupStatus`. ~4 in-workspace consumers.

The moderator separately carries its own copy of `ROLLUP_PRIORITY` + `cardRollupStatus` embedded in [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) at lines 224-249, **not** in its `facetStatus.ts`. That's three implementations of the rollup helper (moderator + participant + audience) — the three-caller policy fires for the rollup pair the same way the four-caller policy fires for `computeFacetStatuses`. Both move to the shell in the same commit (Decision §1).

**Out of scope (kept where it is, or already settled):**

- **Server-side `deriveFacetStatus`** (single-pair deriver). Stays in [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts). Different signature; different consumption pattern (projection pipeline calls it per pair, not as a batch walk of an event log). The known dual-source-of-truth between server (authoritative) and client (mirrors) is documented in the moderator's `facetStatus.ts` header at lines 6-15 ("If a future refactor extracts a shared methodology types package, the duplication becomes the call site") and is a separate concern out of this leaf's scope (Decision §8).
- **The `FacetName` + `FacetStatus` types** that already live in [`packages/shell/src/facet-pill/types.ts`](../../../packages/shell/src/facet-pill/types.ts) (the tiny pair lifted in `extract_facet_pill`, Decision §1). These get reconciled: this leaf moves the canonical home to `packages/shell/src/facet-status/`, and `facet-pill/types.ts` is collapsed to a re-export shim so the FacetPill module's imports still resolve unchanged (Decision §3).
- **Methodology semantics** — the eight derivation rules stay byte-for-byte (`pf_projection_facet_status_refactor` is the canonical methodology refinement; this lift is a file-location refactor only, not a methodology change). ADR 0030 §10 unchanged.
- **Wire format / projection output** — `FacetStatusIndex` shape stays byte-identical (two `Map`s, `Partial<Record<FacetName, FacetStatus>>` values, the `index.nodes.get(id) ?? EMPTY_FACET_STATUSES` consumer convention).
- **Per-workspace projector outputs** — Cytoscape selector strings (`node[?rollupStatus = 'proposed']` etc.), ReactFlow `node.data.facetStatuses` field shape, and every cross-surface visual contract are unchanged. This is a pure file-location refactor.
- **Vote handling, withdraw-agreement event semantics, meta-disagreement escalation** — all live in the lifted rules; no rule edit; no event-handler edit.
- **The moderator's `StatementNode.tsx` rollup-rendering React component code.** Only the embedded `ROLLUP_PRIORITY` + `cardRollupStatus` declarations + the imports at the top of the file move; the rest of `StatementNode.tsx` (the React component tree, the per-facet pill row, the rollup-class composition) stays as-is.
- **Server-side methodology handlers / WS broadcast / replay projector**. All untouched.

After this leaf:

- A new directory `packages/shell/src/facet-status/` lands with: `facet-status.ts` (the lifted `FacetStatus` + `FacetName` + `FacetStatusIndex` + `computeFacetStatuses` + `EMPTY_FACET_STATUSES` + `ROLLUP_PRIORITY` + `cardRollupStatus`, sourced verbatim from the moderator's `facetStatus.ts` + the rollup pair from the moderator's `StatementNode.tsx`); `facet-status.test.ts` (the union Vitest coverage from the three predecessor suites); `index.ts` barrel.
- [`packages/shell/src/facet-pill/types.ts`](../../../packages/shell/src/facet-pill/types.ts) collapses to a re-export shim around the new shell-side types (no `FacetName` / `FacetStatus` redefinition; the facet-pill area imports from the new sibling).
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) adds a new `// ─── facet-status ───` re-export block alongside the existing nine sibling re-exports.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) is **deleted entirely** (no workspace-local helpers remain after the lift).
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) is **deleted entirely** (no workspace-local helpers; the cardRollupStatus + ROLLUP_PRIORITY both lift).
- [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) is **deleted entirely** (same — no workspace-local helpers).
- The three per-workspace `facetStatus.test.ts` files are **deleted entirely** (coverage moves to the consolidated shell suite; the union of the three suites becomes the canonical pin).
- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) loses the `ROLLUP_PRIORITY` declaration (lines 224-241) and the `cardRollupStatus` function (lines 243-249); the `import` block at the top adds `cardRollupStatus` from `@a-conversa/shell`. The component's `cardRollupStatus(facetStatuses)` call site at line 317 is unchanged in behavior.
- [`apps/moderator/src/graph/StatementNode.test.tsx`](../../../apps/moderator/src/graph/StatementNode.test.tsx) loses the `cardRollupStatus — rollup priority order` describe block (lines 854-907) — moved to the shell suite as part of the union coverage.
- Every in-workspace caller (~42 import sites across the three workspaces) rewires from the local relative path (`./facetStatus`, `../graph/facetStatus`, etc.) to `@a-conversa/shell`. No call site changes signature; the imports are the entire diff at each consumer site.

## Why it needs to be done

Three near-identical copies of the same ~400-500-line rule-set walker live in three workspaces today, plus the rollup pair (`ROLLUP_PRIORITY` + `cardRollupStatus`) duplicated in three different homes (moderator embedded in `StatementNode.tsx`; participant + audience in `facetStatus.ts`). The duplication is structural — every walker is a verbatim port of the moderator's first implementation; every rollup is verbatim of the moderator's `StatementNode.tsx` declaration; the three client mirrors all flow from a single source of methodology truth (the server's `deriveFacetStatus` per ADR 0030 §10).

The cost of leaving the four-copy duplication in place is the standard cross-surface drift risk — and it is uniquely high here because the rules are *methodology bedrock*:

- A widening of the rule set (a new facet kind, a new vote kind, a new short-circuit case, a new state value) has to be applied in **four** files in **three** different apps (plus the server) with **three** different test suites. Any update that lands in three of four sites silently desynchronizes the surfaces' rendering of which states they paint and how — a participant might see `'agreed'` for a card the moderator sees as `'proposed'` because the moderator's mirror grew an arm the participant's missed.
- The rollup pair (`ROLLUP_PRIORITY` + `cardRollupStatus`) drives Cytoscape and ReactFlow rollup-class composition across three surfaces. The participant's `facetStatus.ts` header at line 629 already explicitly pins itself to the moderator's copy in `StatementNode.tsx` ("Pinned to match the moderator's `ROLLUP_PRIORITY` in `apps/moderator/src/graph/StatementNode.tsx` verbatim so the two client surfaces don't drift"). Pinning-by-comment is a load-bearing prose contract; pinning-by-shell-extraction is a structural one.
- The duplication is dead weight in every client bundle. Each surface ships ~500 lines of the same rule walk; consolidating into shell collapses three copies into one chunk that participates in the shell's build output (the shell is already a runtime dependency of every UI surface per ADR 0026 / `shell_substrate_extraction`).

The four-caller policy (the rule-set's version of the three-caller policy applied by `extract_facet_pill` Decision §2 + `extract_cytoscape_projectors` Decision §2 to smaller primitives) was set at the moment the FacetPill leaf chose to defer this work: the rule set is large enough and load-bearing enough that two client mirrors weren't strong enough evidence the API shape was right; four implementations (server + three client mirrors) **are**. The audience's verbatim port of the participant's verbatim port of the moderator's original confirms that all the public symbols (`FacetStatus`, `FacetName`, `FacetStatusIndex`, `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus`) are what every client surface needs in exactly this shape.

The follow-on benefits:

- **One source of truth for client-side facet-state derivation.** A future methodology change (e.g. a new `FacetStatus` value per a future ADR; a refined dispute-resolution rule per a future iteration of the agreement walker) edits one `packages/shell/src/facet-status/` block instead of three workspaces. The next surface to land facet rendering (replay-test, OBS composite, future per-session per-edge timeline) imports from `@a-conversa/shell` directly — no cross-workspace port, no fifth-caller registration.
- **Test consolidation.** Three Vitest suites covering the same eight-rule walk + the same six-state rollup priority collapse into one. The participant's per-priority-pair coverage (`apps/participant/src/graph/facetStatus.test.ts` lines 550-565 — exhaustive `(higher, lower)` pair sweep) and the audience's equivalent at lines 521-530 are byte-identical; consolidating them eliminates the maintenance overhead of keeping three identical test files in lockstep.
- **Removes the moderator's prose-pinned cross-file invariant.** Today the participant's `facetStatus.ts` comment at line 629 says "Pinned to match the moderator's `ROLLUP_PRIORITY` in `apps/moderator/src/graph/StatementNode.tsx` verbatim." That's a structural invariant enforced only by comment + reviewer attention. After the lift the invariant is enforced by the type system — one definition, all surfaces import it.
- **Pattern continuity.** The leaf is the third of three rule-set / projector consolidations on the `aud_graph_rendering`-trigger cadence (`shell_axiom_marks_extraction` shipped 2026-05-28; `extract_cytoscape_projectors` shipped 2026-05-28; this leaf is next). Same recipe; consistency reduces review friction.

This leaf is registered against the trigger fired by the audience's facet-status mirror (and the rollup pair's third client implementation) per the orchestrator brief's tech-debt registration policy; the source-of-debt note in [`extract_facet_pill.md` line 226](extract_facet_pill.md#L226) named the future task explicitly, and the audience module's own header at [`apps/audience/src/graph/facetStatus.ts:9-12`](../../../apps/audience/src/graph/facetStatus.ts#L9) anticipates this consolidation.

## Inputs / context

### ADRs

- [ADR 0030 — Per-facet vote keying](../../../docs/adr/0030-per-facet-vote-keying.md) — the methodology authority for the seven-value `FacetStatus` union (§10) and the rule-set semantics. The lift preserves all rule semantics byte-for-byte; no §10 edit. The future `FacetStatus` widening (a new value, a refined narrowing) edits the shell-side rule walker once; this leaf is the consolidation that makes that future edit a single-site change.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest consolidation pins the rule walk + the rollup priority once, at the canonical home. The three client-tier integration test suites (`GraphCanvasPane.test.tsx`, `GraphView.test.tsx` × 2 for participant + audience, plus `ProposalFacetBreakdown.test.tsx`, `derivePersonalAgreements.test.ts`, etc.) continue passing against the lifted symbols; that is the regression pin for the import-path rewire.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the shell package is the canonical shared substrate for every UI surface; lifting the facet-status rule walker into the shell is the architecturally-correct destination per the ADR.
- [ADR 0027 — Entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — facet-state derivation is facet-layer vocabulary; the new `packages/shell/src/facet-status/` directory sits as a sibling to `packages/shell/src/facet-pill/` (facet layer — visual primitive) and `packages/shell/src/axiom-marks/` + `packages/shell/src/annotations/` (entity-disposition layer). The directory split makes the layer boundary visible at the file-system level.
- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md) — `computeFacetStatuses` narrows on the discriminated union of session events; the lift preserves the existing narrowing rules; no envelope-shape change.

No new ADR. The architectural seams (four-caller extraction policy, root-export shell convention, sibling-directory layout under `packages/shell/src/`, no-shim full-deletion pattern for workspaces with no local helpers) are all settled by prior shell-package refinements + ADR 0026.

### Sibling refinements

- [`tasks/refinements/shell-package/extract_cytoscape_projectors.md`](extract_cytoscape_projectors.md) — the direct shape-precedent (2026-05-28). Same atomic-transition + sibling-directory + root-re-export + consolidated-Vitest pattern. Divergence: it had per-workspace carve-outs (participant local helpers, moderator wrapper); this leaf doesn't (Decision §5).
- [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](shell_axiom_marks_extraction.md) — the parallel third-caller-fired entity-layer lift; same shape; settled.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md) — the foundational precedent for the `packages/shell/src/<area>/` directory layout and the root re-export convention via [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts).
- [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md) — Decision §2 codifies the four-caller deferral for this rule-set; Decision §1 explains the tiny `facet-pill/types.ts` co-move that this leaf reconciles (Decision §3).
- [`tasks/refinements/per-facet-refactor/pf_projection_facet_status_refactor.md`](../per-facet-refactor/pf_projection_facet_status_refactor.md) — the canonical methodology refinement for the rule walk; each client mirror's header links here. No re-architecting; this leaf is a file-location refactor only.
- [`tasks/refinements/audience/aud_proposed_styling.md`](../audience/aud_proposed_styling.md) Decision §3 + §5 — the audience's port refinement that fired the fourth-caller trigger; explicitly names this consolidation as the named-future-task.
- [`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](../moderator-ui/mod_proposed_state_styling.md) — the moderator's original rule-walker home; the canonical source.

### Live code the leaf modifies / creates / deletes

**Creates** (canonical home):

- `packages/shell/src/facet-status/facet-status.ts` — **NEW**. Verbatim lift of:
  - The `FacetStatus` union (7 values, from [`apps/moderator/src/graph/facetStatus.ts:80-123`](../../../apps/moderator/src/graph/facetStatus.ts#L80)).
  - The `FacetName` union (4 values, from [`apps/moderator/src/graph/facetStatus.ts:125`](../../../apps/moderator/src/graph/facetStatus.ts#L125)).
  - The `FacetStatusIndex` interface (from [`apps/moderator/src/graph/facetStatus.ts:141-153`](../../../apps/moderator/src/graph/facetStatus.ts#L141)).
  - The internal `InternalFacetState` accumulator + `PerParticipantVote` + `targetOf` + `getOrCreateFacetState` + `emptyFacetState` + the eight-rule walk in `computeFacetStatuses` (from [`apps/moderator/src/graph/facetStatus.ts:155-689`](../../../apps/moderator/src/graph/facetStatus.ts#L155)).
  - `EMPTY_FACET_STATUSES` frozen reference (from [`apps/moderator/src/graph/facetStatus.ts:691-692`](../../../apps/moderator/src/graph/facetStatus.ts#L691)).
  - `ROLLUP_PRIORITY` array (from [`apps/moderator/src/graph/StatementNode.tsx:224-241`](../../../apps/moderator/src/graph/StatementNode.tsx#L224); the participant's `apps/participant/src/graph/facetStatus.ts:647-662` and audience's `apps/audience/src/graph/facetStatus.ts:526-541` are verbatim copies — the moderator's is the canonical source by chronology).
  - `cardRollupStatus(facetStatuses)` function (from [`apps/moderator/src/graph/StatementNode.tsx:243-249`](../../../apps/moderator/src/graph/StatementNode.tsx#L243)).
  - Header docstring naming this as the four-caller consolidation, linking back to the three predecessor port refinements (moderator + participant + audience) + ADR 0030 §10 + `pf_projection_facet_status_refactor`. Imports `Event` + `ProposalPayload` from `@a-conversa/shared-types` (existing dependency of the shell package).

- `packages/shell/src/facet-status/index.ts` — **NEW**. Barrel re-export of the public surface:
  - `FacetStatus` (type), `FacetName` (type), `FacetStatusIndex` (type)
  - `computeFacetStatuses`
  - `EMPTY_FACET_STATUSES`
  - `ROLLUP_PRIORITY`
  - `cardRollupStatus`

- `packages/shell/src/facet-status/facet-status.test.ts` — **NEW**. Consolidates the moderator + participant + audience `facetStatus.test.ts` suites + the moderator's `StatementNode.test.tsx` `cardRollupStatus` describe block. Union coverage ≥ the sum of the three predecessors' projection rule coverage + the rollup priority coverage. Specific case-list shape:
  - **Rule (a) — Meta-disagreement short-circuit**: any `meta-disagreement` event on a facet returns `'meta-disagreement'` regardless of other state.
  - **Rule (b) — No candidate → `'awaiting-proposal'`**: classification + substance facets without a proposal surface `'awaiting-proposal'`; `wording` facet with inline `node-created` candidate does not.
  - **Rule (c) — Active-participant filter**: votes by participants who joined-then-left are excluded; current-joined participants are included.
  - **Rule (d) — `withdraw-agreement` against committed → `'withdrawn'`**: a withdraw-agreement event after commit sends the facet to `'withdrawn'`. The legacy `vote.choice = 'withdraw'` arm is retired per ADR 0030 §3.
  - **Rule (e) — Any `dispute` vote → `'disputed'`**: a single dispute vote, even with majority agree votes, surfaces `'disputed'`.
  - **Rule (f) — Committed (no dispute / withdraw) → `'committed'`**: a `commit` event with no dispute and no withdrawal pins the facet to `'committed'`.
  - **Rule (g) — All current participants `agree` → `'agreed'`**: unanimous agree among current participants surfaces `'agreed'`.
  - **Rule (h) — Default → `'proposed'`**: a candidate value with a non-unanimous, non-committed, non-withdrawn, non-disputed state surfaces `'proposed'`.
  - **`node-created` + `edge-created` populate inline candidates** per ADR 0030 §4 / §5: a node's `wording` facet enters life with the captured text as its candidate (no proposal needed); an edge's `shape` facet enters life with the inline carriage.
  - **A new facet-valued proposal clears prior votes** on that facet per ADR 0030 §7.
  - **`EMPTY_FACET_STATUSES`** is `Object.frozen` and referentially stable (same reference returned for empty records).
  - **`cardRollupStatus({})` returns `undefined`**.
  - **`cardRollupStatus` single-status pass-through**: for each of the seven `FacetStatus` values, `cardRollupStatus({ classification: status })` returns `status`.
  - **`cardRollupStatus` exhaustive `(higher, lower)` pair sweep**: for every ordered pair (i, j) where `ROLLUP_PRIORITY.indexOf(higher) < ROLLUP_PRIORITY.indexOf(lower)`, both `cardRollupStatus({ classification: higher, substance: lower })` and the reverse-ordered record return `higher`. Coverage parity with the participant's [`facetStatus.test.ts:550-565`](../../../apps/participant/src/graph/facetStatus.test.ts#L550) and the audience's [`facetStatus.test.ts:521-530`](../../../apps/audience/src/graph/facetStatus.test.ts#L521) — exhaustive proof the priority order is honored.
  - **Mixed-log fuzz cases**: complex multi-event sessions exercising the eight rules together (the three predecessor suites carry these — the consolidated suite is their union with duplicates de-duped).

**Modifies**:

- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — adds a new `// ─── facet-status ───────────────────────────────────────────────────────` block alongside the existing nine sibling re-exports (auth / screen-name / login-logout / i18n / ws / error-mapper / mount-contract / facet-pill / axiom-marks / annotations). The block re-exports `FacetStatus` (type), `FacetName` (type), `FacetStatusIndex` (type), `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus` from `./facet-status/index.js`.
- [`packages/shell/src/facet-pill/types.ts`](../../../packages/shell/src/facet-pill/types.ts) — collapses to a re-export shim. The two type aliases (`FacetName`, `FacetStatus`) that this file owns today were co-moved into the shell by `extract_facet_pill` Decision §1; this leaf reconciles by making them re-exports from the new sibling: `export type { FacetName, FacetStatus } from '../facet-status/facet-status.js';`. The FacetPill component (`packages/shell/src/facet-pill/FacetPill.tsx` and siblings) continues to `import type { FacetName, FacetStatus } from './types.js'` unchanged — the shim resolves to the new canonical home (Decision §3).
- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) — removes the `ROLLUP_PRIORITY` declaration (lines 224-241) and the `cardRollupStatus` function (lines 243-249). The component-internal call at line 317 (`const rollupStatus = cardRollupStatus(facetStatuses);`) stays; the import at the top of the file adds `cardRollupStatus` from `@a-conversa/shell`. The `FacetName` / `FacetStatus` import at line 67 (`import type { FacetName, FacetStatus } from './facetStatus.js';`) rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/StatementNode.test.tsx`](../../../apps/moderator/src/graph/StatementNode.test.tsx) — removes the `cardRollupStatus — rollup priority order` describe block (lines 854-907) (subsumed by the shell suite). The import at line 53 (`cardRollupStatus`) rewires to `@a-conversa/shell` for any cases that retain the import; or the import is dropped if the rollup describe block is the only consumer.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — line 112 (`import { computeFacetStatuses, EMPTY_FACET_STATUSES } from './facetStatus.js';`) rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) — line 48 import (`from './facetStatus.js'`) rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/proposalFilter.ts`](../../../apps/moderator/src/graph/proposalFilter.ts) — line 34 (`import type { FacetStatusIndex } from './facetStatus.js';`) rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/proposalFilter.test.ts`](../../../apps/moderator/src/graph/proposalFilter.test.ts) — line 36 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts) — line 42 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/proposalFacets.test.ts`](../../../apps/moderator/src/graph/proposalFacets.test.ts) — line 35 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/disputationOutcome.ts`](../../../apps/moderator/src/graph/disputationOutcome.ts) — line 37 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/disputationOutcome.test.ts`](../../../apps/moderator/src/graph/disputationOutcome.test.ts) — line 22 import rewires to `@a-conversa/shell`; the comment at line 25 referencing `facetStatus.ts L43-L49` is updated to point at `@a-conversa/shell` or removed.
- [`apps/moderator/src/graph/HoverPopover.tsx`](../../../apps/moderator/src/graph/HoverPopover.tsx) — line 70 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/graph/HoverPopover.test.tsx`](../../../apps/moderator/src/graph/HoverPopover.test.tsx) — line 34 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) — line 63 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/layout/PendingProposalsPane.test.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.test.tsx) — relevant facet-status imports rewire to `@a-conversa/shell`.
- [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx) — line 45 import rewires to `@a-conversa/shell`.
- [`apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx) — line 36 import rewires to `@a-conversa/shell`.
- All other moderator-side import sites identified by the closer-side grep (per Acceptance criteria) rewire to `@a-conversa/shell`.
- [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — line 111-116 import block (`cardRollupStatus`, `EMPTY_FACET_STATUSES`, `FacetName`, `FacetStatus`, `FacetStatusIndex`, etc. from `./facetStatus`) rewires to `@a-conversa/shell`.
- [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) — line 73 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) — line 201 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) — line 40 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) — line 45 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts) — line 71 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — line 64 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/detail/EntityDetailPanel.test.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx) — line 33 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — line 79 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/detail/ParticipantVoteButtons.test.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.test.tsx) — line 54 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/detail/lookupEntity.test.ts`](../../../apps/participant/src/detail/lookupEntity.test.ts) — line 11 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — line 31 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) — line(s) referencing `facetStatus` rewire to `@a-conversa/shell`.
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx) — relevant imports rewire.
- [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) — line 35 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx) — line 45 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/proposals/derivePersonalAgreements.ts`](../../../apps/participant/src/proposals/derivePersonalAgreements.ts) — line 69 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/proposals/derivePersonalAgreements.test.ts`](../../../apps/participant/src/proposals/derivePersonalAgreements.test.ts) — line 29 import rewires to `@a-conversa/shell`.
- [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) — relevant imports rewire to `@a-conversa/shell`.
- [`apps/participant/src/proposals/perProposalFacets.test.ts`](../../../apps/participant/src/proposals/perProposalFacets.test.ts) — line 28 import rewires.
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — lines 95-100 import block rewires to `@a-conversa/shell`.
- [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) — any direct `from './facetStatus'` imports rewire to `@a-conversa/shell`.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — relevant imports rewire.
- [`apps/audience/src/graph/PerFacetPillOverlay.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) — facet-status imports rewire.
- [`apps/audience/src/graph/PerFacetPillOverlay.test.tsx`](../../../apps/audience/src/graph/PerFacetPillOverlay.test.tsx) — facet-status imports rewire.
- [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) — line 154's comment reference to `./facetStatus.ts` is updated (or left as-is if comment-only).

**Deletes**:

- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) — entire 692-line file removed.
- [`apps/moderator/src/graph/facetStatus.test.ts`](../../../apps/moderator/src/graph/facetStatus.test.ts) — entire file removed (coverage moves to the consolidated shell suite).
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — entire 681-line file removed.
- [`apps/participant/src/graph/facetStatus.test.ts`](../../../apps/participant/src/graph/facetStatus.test.ts) — entire file removed.
- [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) — entire 553-line file removed.
- [`apps/audience/src/graph/facetStatus.test.ts`](../../../apps/audience/src/graph/facetStatus.test.ts) — entire file removed.

**Unchanged**:

- `packages/shell/src/{auth,screen-name,login-logout,i18n,ws,error-mapper,mount-contract,axiom-marks,annotations}/**` — UNCHANGED (sibling areas).
- `packages/shell/src/facet-pill/FacetPill.tsx`, `packages/shell/src/facet-pill/VoteIndicator.tsx`, `packages/shell/src/facet-pill/participant-color.ts`, etc. — UNCHANGED. Only `packages/shell/src/facet-pill/types.ts` collapses to a re-export shim per Decision §3.
- `packages/shared-types/**` — UNCHANGED. The `FacetStatus` + `FacetName` types continue to NOT live in shared-types (per the moderator's `facetStatus.ts:6-15` header note and `extract_facet_pill` Decision §1's rationale — they're client-side projection types, not wire types).
- `packages/i18n-catalogs/**` — UNCHANGED.
- `apps/server/**` — UNCHANGED. The server's `deriveFacetStatus` stays put (Decision §8).
- `apps/root/**` — UNCHANGED.
- `apps/moderator/src/graph/{StatementEdge.tsx, StatementEdge.test.tsx, layoutEngine.ts, layoutEngine.test.ts, diagnosticHighlights.ts, diagnosticSuggestions.ts, EdgeShapeCommitAffordance.tsx, EdgeCardSubstanceAffordance.tsx, PendingAxiomMarkBadge.tsx, DisputationTestChip.tsx, pendingProposals.ts}` and similar — non-facet-status code stays as-is; only the import-path rewires (where they import facet-status symbols) apply.
- All routes, providers, mount-effects, WS handlers, projector outputs at the system seam — UNCHANGED.
- `apps/{moderator,participant,audience}/package.json` — UNCHANGED (`@a-conversa/shell` already in each `dependencies`).
- `packages/shell/package.json` — UNCHANGED. The new `facet-status/` directory ships under the existing `"."` (root) export; no subpath export entry needed (Decision §6).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` / Cucumber feature files — UNCHANGED (Decision §7).
- `tasks/*.tji` at task-write time. The `complete 100` update lands at task-completion time per the [README ritual](../README.md).

### What this task MUST NOT do

- **No wire-schema change.** The `FacetStatus` / `FacetName` / `FacetStatusIndex` shapes lift byte-for-byte; the seven status values stay exactly as they are; the four facet names stay exactly as they are. No shared-types churn.
- **No methodology change.** `computeFacetStatuses` semantics are byte-for-byte preserved; the eight derivation rules stay as-is; the `commit` / `withdraw-agreement` / `vote` / `meta-disagreement` event-handling rules are not edited. ADR 0030 §10 is unchanged.
- **No rollup-priority change.** The seven-element `ROLLUP_PRIORITY` array lifts byte-for-byte; the priority order (`proposed` > `meta-disagreement` > `disputed` > `agreed` > `committed` > `withdrawn` > `awaiting-proposal`) stays exactly as the three current copies have it.
- **No new dependency.** `@a-conversa/shared-types` is already on `packages/shell`'s path; no other dependencies are added.
- **No new ADR.** Every architectural seam (four-caller extraction, root-export convention, sibling-directory layout, no-shim full-deletion) is settled.
- **No movement of server-side `deriveFacetStatus`.** Stays in [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts); different signature; different consumption pattern; out of scope here (Decision §8).
- **No subpath export entry in `packages/shell/package.json`** (e.g. `"./facet-status"`). Root-export only — Decision §6.
- **No partial deletion of any client `facetStatus.ts`.** Every workspace's copy fully deletes; no participant-shim and no audience-shim arrangement (Decision §5).
- **No edit to the eight-rule walk's internal structure.** The `targetOf` / `getOrCreateFacetState` / `emptyFacetState` private helpers + the eight-rule body lift verbatim. Refactoring the walk's internal shape is a separate concern.
- **No edit to React component rendering code.** Only the `ROLLUP_PRIORITY` declaration + `cardRollupStatus` function move out of `StatementNode.tsx`; the rest of the component (the rollup-class composition, the per-facet pill row, the JSX tree) stays as-is.
- **No movement of `FacetStatus` / `FacetName` into `@a-conversa/shared-types`.** Per `extract_facet_pill` Decision §1's reasoning — they're client-side projection types, not wire types — they stay in `packages/shell/`.
- **No edit to `apps/server/**`, `apps/root/**`, or any non-client / non-shell file.**
- **No Playwright / Cucumber scope.** Pure refactor — Decision §7.

## Constraints / requirements

### Files this task touches (explicit allowlist)

**Creates**:

- `packages/shell/src/facet-status/facet-status.ts` — **NEW**. The seven lifted symbols (`FacetStatus`, `FacetName`, `FacetStatusIndex`, `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus`) + the internal `targetOf` / `getOrCreateFacetState` / `emptyFacetState` / `InternalFacetState` / `PerParticipantVote` private helpers. Verbatim port of the moderator's `facetStatus.ts` rule walk + the moderator's `StatementNode.tsx` rollup pair. Header docstring links to the three predecessor port refinements + `pf_projection_facet_status_refactor` + ADR 0030.
- `packages/shell/src/facet-status/index.ts` — **NEW**. Barrel re-export.
- `packages/shell/src/facet-status/facet-status.test.ts` — **NEW**. Consolidated Vitest coverage — union of the three predecessor suites' projection cases + the moderator's `StatementNode.test.tsx` `cardRollupStatus` describe block. Case list under "Live code the leaf creates" above; coverage parity with the predecessors.

**Modifies**:

- `packages/shell/src/index.ts` — adds the `// ─── facet-status ───` re-export block.
- `packages/shell/src/facet-pill/types.ts` — collapses to a re-export shim (Decision §3).
- `apps/moderator/src/graph/StatementNode.tsx` — removes `ROLLUP_PRIORITY` + `cardRollupStatus` declarations; rewires top-of-file imports to `@a-conversa/shell`.
- `apps/moderator/src/graph/StatementNode.test.tsx` — removes the `cardRollupStatus — rollup priority order` describe block; rewires retained imports.
- Every other moderator + participant + audience consumer with a `from './facetStatus'` / `from '../graph/facetStatus'` / `from './facetStatus.js'` import (per the import-site list in the "Modifies" section above, ~40 files) — import path rewires to `@a-conversa/shell`. No call-site signature change.

**Deletes**:

- `apps/moderator/src/graph/facetStatus.ts`
- `apps/moderator/src/graph/facetStatus.test.ts`
- `apps/participant/src/graph/facetStatus.ts`
- `apps/participant/src/graph/facetStatus.test.ts`
- `apps/audience/src/graph/facetStatus.ts`
- `apps/audience/src/graph/facetStatus.test.ts`

### Files this task does NOT touch

- `apps/server/**`, `apps/root/**` — UNCHANGED.
- `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `packages/shell/src/{auth,screen-name,login-logout,i18n,ws,error-mapper,mount-contract,axiom-marks,annotations}/**` — UNCHANGED.
- `packages/shell/src/facet-pill/{FacetPill.tsx,VoteIndicator.tsx,participant-color.ts,*.test.tsx,index.ts}` — UNCHANGED (only `types.ts` collapses).
- All React component code outside the lifted rollup pair — UNCHANGED.
- All routes, providers, mount-effects, WS handlers, projector outputs — UNCHANGED.
- `apps/{moderator,participant,audience}/package.json`, `packages/shell/package.json` — UNCHANGED.
- `docs/adr/**` — UNCHANGED.
- `playwright.config.ts` / `tests/e2e/**` / Cucumber feature files — UNCHANGED.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md).

## Acceptance criteria

The check that says "done":

- `packages/shell/src/facet-status/facet-status.ts` exists and exports `FacetStatus` (type), `FacetName` (type), `FacetStatusIndex` (type), `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus`. The seven public symbols' shapes are byte-for-byte identical to the three predecessor `facetStatus.ts` copies + the moderator's `StatementNode.tsx` rollup pair (the moderator's `facetStatus.ts` is the canonical source for the walker; the moderator's `StatementNode.tsx:224-249` is the canonical source for the rollup pair). The internal `targetOf` / `getOrCreateFacetState` / `emptyFacetState` private helpers + the eight-rule walk preserve their existing structure byte-for-byte.
- `packages/shell/src/facet-status/index.ts` re-exports the public surface; `packages/shell/src/index.ts` adds a `// ─── facet-status ───` re-export block.
- `packages/shell/src/facet-pill/types.ts` is a re-export shim (`export type { FacetName, FacetStatus } from '../facet-status/facet-status.js';`); the FacetPill module's existing imports continue to resolve unchanged.
- `packages/shell/src/facet-status/facet-status.test.ts` exists with coverage parity to the union of the three predecessor `facetStatus.test.ts` suites + the moderator's `StatementNode.test.tsx` `cardRollupStatus` describe block.
- `apps/moderator/src/graph/facetStatus.ts`, `apps/moderator/src/graph/facetStatus.test.ts`, `apps/participant/src/graph/facetStatus.ts`, `apps/participant/src/graph/facetStatus.test.ts`, `apps/audience/src/graph/facetStatus.ts`, `apps/audience/src/graph/facetStatus.test.ts` are removed from the working tree.
- `apps/moderator/src/graph/StatementNode.tsx` no longer carries the `ROLLUP_PRIORITY` or `cardRollupStatus` declarations; the call site at line 317 (`cardRollupStatus(facetStatuses)`) continues to compile via an `@a-conversa/shell` import.
- `apps/moderator/src/graph/StatementNode.test.tsx` no longer carries the `cardRollupStatus — rollup priority order` describe block.
- Every client-side consumer of the seven lifted symbols imports from `@a-conversa/shell`. The closer runs `grep -rE "from '(\\.\\./)+graph/facetStatus|from '\\./facetStatus" apps/ packages/` and confirms no matches (every `from './facetStatus'` / `from '../graph/facetStatus'` import has been rewired to `@a-conversa/shell`).
- `grep -rE "(computeFacetStatuses|cardRollupStatus|ROLLUP_PRIORITY|EMPTY_FACET_STATUSES|FacetStatusIndex)" apps/ packages/` shows only:
  - Consumers (with `from '@a-conversa/shell'` import).
  - The shell's own definition + test file + barrel.
  - The `packages/shell/src/facet-pill/types.ts` shim (re-exports `FacetName` + `FacetStatus`).
  - Server-side files using these names internally (server's `FacetStatus` lives in `apps/server/src/projection/types.ts`; that copy is server-internal and not part of this lift).
  - No third-workspace local declaration (no `apps/{moderator,participant,audience}/src/graph/facetStatus.ts`).
- `grep -rE "(type|export type|export interface) (FacetStatus|FacetName|FacetStatusIndex)\\b" packages/shell apps/{moderator,participant,audience}` shows only the canonical shell-side definition (in `facet-status.ts`); no per-workspace duplicate type declaration; the `facet-pill/types.ts` shim shows up as a re-export, not a redefinition.
- `pnpm run check` clean (strict TS pass; no new dep declared; the lifted types match every client-tier consumer byte-for-byte).
- `pnpm run test:smoke` green. The Vitest count net-change: ≥ the union of the three predecessors' projection cases + the rollup pair cases lands in `packages/shell/src/facet-status/facet-status.test.ts`; the three per-workspace `facetStatus.test.ts` files are deleted (subsumed); the moderator's `StatementNode.test.tsx` rollup describe block is deleted (subsumed); the three client-tier integration tests (`GraphCanvasPane.test.tsx`, participant `GraphView.test.tsx`, audience `GraphView.test.tsx` + `projectGraph.test.ts` + `PerFacetPillOverlay.test.tsx`) continue passing against the lifted symbols.
- `pnpm -F @a-conversa/shell build` succeeds. `pnpm -F @a-conversa/moderator build`, `pnpm -F @a-conversa/participant build`, `pnpm -F @a-conversa/audience build` each succeed.
- `pnpm -F @a-conversa/server build` is unaffected (no server-side file edited).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/27-shell-package.tji` gets `complete 100` on `shell_package.extract_facet_status_rules` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer (consolidated at the canonical shell home) plus the client-tier integration test suites continuing to pass after the import-path rewire are the full regression pin. No new Playwright / Cucumber scope (Decision §7).
- **No new deferred-future-task registration is owed by this leaf.** Unlike `extract_cytoscape_projectors` (which registered two named-future-tasks for the not-yet-third-caller projectors), this leaf consumes the full rule-set surface — every public symbol in every client-side `facetStatus.ts` is in scope; no leftover code waits on a future caller. (The server-side `deriveFacetStatus` consolidation is not registered as a named-future-task at this time — Decision §8 explains why it's deliberately not in scope and not owed registration today.)

## Decisions

### §1 — `cardRollupStatus` + `ROLLUP_PRIORITY` are in scope (three-caller policy fires; co-located with the rule walker)

`cardRollupStatus(facetStatuses): FacetStatus | undefined` and the seven-element `ROLLUP_PRIORITY` array are duplicated across three client-side homes today:

- [`apps/moderator/src/graph/StatementNode.tsx:224-249`](../../../apps/moderator/src/graph/StatementNode.tsx#L224) — moderator's copy, embedded in the React component file.
- [`apps/participant/src/graph/facetStatus.ts:647-681`](../../../apps/participant/src/graph/facetStatus.ts#L647) — participant's copy, co-located with `computeFacetStatuses`; the in-file header at line 629 explicitly pins itself to the moderator's copy ("Pinned to match the moderator's `ROLLUP_PRIORITY` in `apps/moderator/src/graph/StatementNode.tsx` verbatim").
- [`apps/audience/src/graph/facetStatus.ts:526-553`](../../../apps/audience/src/graph/facetStatus.ts#L526) — audience's copy, verbatim port of the participant's.

Three options:

- **(A — chosen)** Lift `ROLLUP_PRIORITY` + `cardRollupStatus` into `packages/shell/src/facet-status/` alongside `computeFacetStatuses`. Three callers — the three-caller policy fires. The rollup helper consumes the per-card output shape (`Partial<Record<FacetName, FacetStatus>>`) that `computeFacetStatuses` writes; they're load-bearingly co-located in two of three current homes already. Eliminates the prose-pinned cross-file invariant the participant's header documents.
- **(B)** Lift only `computeFacetStatuses` + the rule walker; leave the rollup pair triplicated. Cost: leaves a known three-caller duplication in place; the participant's "pinned to match the moderator" header invariant stays prose-only; a future rollup-priority edit has to land in three files. The closer would owe a new named-future-task registration for the rollup pair, which is busywork given that this leaf already opens the shell-side `facet-status/` directory.
- **(C)** Lift the rollup pair into its own sibling directory `packages/shell/src/card-rollup/`. Cost: the rollup helper's only meaningful coupling is to `FacetStatus` + `FacetName` (which live in `facet-status/`); separating it from the rule walker would require a circular import or a downward `facet-status/` → `card-rollup/` dependency for the priority enum. The two helpers are conceptually the *projection layer's* output formatting; co-location matches their semantics.

Chosen: (A). Same trigger condition (third-caller policy) as `extract_facet_pill` Decision §2 and `extract_cytoscape_projectors` Decision §3; same recipe (co-locate with the type union it consumes). The rollup pair retires the same prose-pinned invariant the participant's header documents.

### §2 — `packages/shell/src/facet-status/` sibling directory (not folded into `facet-pill/`)

The shell already carries a `packages/shell/src/facet-pill/` directory (the visual primitive lifted in `extract_facet_pill`). The two areas are conceptually adjacent — both are facet-layer code per ADR 0027 — but they sit at different abstraction levels: `facet-status/` is the *data layer* (the rule walker + the per-card rollup); `facet-pill/` is the *render layer* (the visual primitive that paints one status row). Three options:

- **(A — chosen)** A new sibling directory `packages/shell/src/facet-status/` with the rule walker + types + rollup pair + barrel. Sibling to `facet-pill/`, `axiom-marks/`, `annotations/`.
- **(B)** Fold the lifted code into `packages/shell/src/facet-pill/`. Cost: blurs the data-vs-render-layer split; the FacetPill module's directory name (`facet-pill/`) reads as the visual-primitive container; conflating the rule-set walker (~400 lines, no JSX) with the visual primitive (~150 lines, JSX-heavy) hides the layer boundary and makes the FacetPill module harder to scan. The shell's convention to date (per `shell_axiom_marks_extraction` Decision §2, `extract_cytoscape_projectors` Decision §2) is one-directory-per-vocabulary.
- **(C)** Fold the rule walker into a hypothetical `packages/shell/src/methodology/` directory. Cost: there's no other methodology-layer code in the shell today; introducing a new umbrella directory for a single occupant is premature; the future "shared methodology types package" idea the moderator's `facetStatus.ts` header at line 14 raises would relocate the shell's facet-status code anyway, so introducing the umbrella now would be a name we'd reshape later.

Chosen: (A). Same sibling-directory rationale every prior shell extraction has used; the file-tree layout makes the per-vocabulary grouping visible at the directory level; the data-vs-render-layer split is enforced by directory adjacency rather than by directory name.

### §3 — Reconcile the canonical home for `FacetName` + `FacetStatus` types: move them to `facet-status/`, collapse `facet-pill/types.ts` to a re-export shim

`extract_facet_pill` Decision §1 co-moved a small `packages/shell/src/facet-pill/types.ts` carrying `FacetName` + `FacetStatus` type aliases — they were needed for the FacetPill component's prop typing, and the two `facetStatus.ts` files in the moderator + participant were still in place. Now that this leaf creates a real `packages/shell/src/facet-status/` directory, the canonical home for those types should move there. Three options:

- **(A — chosen)** Move the canonical `FacetName` + `FacetStatus` type declarations into `packages/shell/src/facet-status/facet-status.ts`; collapse `packages/shell/src/facet-pill/types.ts` to a re-export shim (`export type { FacetName, FacetStatus } from '../facet-status/facet-status.js';`). The FacetPill module's internal imports continue to resolve unchanged; the shell's root barrel re-exports both `FacetName` + `FacetStatus` (which the `facet-pill` barrel already does today) via the new `facet-status` re-export block. Net: types live where the rules live; the FacetPill shim is six lines.
- **(B)** Keep the canonical declarations in `packages/shell/src/facet-pill/types.ts`; have the new `facet-status/facet-status.ts` import them from there. Cost: the rule walker depends on the FacetPill module for its core type vocabulary — an upward arrow from a 400-line data-layer module to a 150-line render-layer module. That's inverted from the natural dependency direction; future readers expect data-layer types to live in the data-layer module.
- **(C)** Duplicate the type declarations in both `facet-status/` and `facet-pill/`; have neither import the other. Cost: same kind of cross-module duplication the lift exists to retire. TypeScript's structural typing would let the two type aliases stay in lockstep without an import, but the prose contract ("these two declarations must stay byte-identical") is exactly what `shell_axiom_marks_extraction` and `extract_cytoscape_projectors` retired by consolidating at the canonical home.

Chosen: (A). Honors the dependency direction (render layer imports from data layer, not vice versa); minimizes the FacetPill module's diff blast radius (one file collapses to a six-line shim); leaves consumers' import paths unchanged (everyone keeps importing `FacetName` / `FacetStatus` from `@a-conversa/shell` or from `./types` inside the FacetPill module — both resolve to the new canonical home).

### §4 — `cardRollupStatus` + `ROLLUP_PRIORITY` extract from the moderator's `StatementNode.tsx`, not from any `facetStatus.ts` copy

The rollup pair lives in three places today: the moderator's `StatementNode.tsx` (the canonical source, by chronology — the participant's header at line 629 explicitly pins itself to this copy), the participant's `facetStatus.ts`, and the audience's `facetStatus.ts`. Two options for where to lift from:

- **(A — chosen)** Source the lift from the moderator's `StatementNode.tsx:224-249`. It's the canonical source by chronology and by the participant's own prose pin. The participant + audience copies are verbatim ports of it; lifting from the canonical source maintains the chain.
- **(B)** Source the lift from the participant's `facetStatus.ts:647-681` (which is co-located with the rule walker, matching the destination structure). Cost: the participant's header at line 629 already says the canonical source is the moderator's `StatementNode.tsx`; sourcing from the port would invert the pinning prose. Either source is byte-identical, so the choice is informational/historical only, but matching the prose pin keeps the historical chain readable.

Chosen: (A). The lift is byte-identical from either source (all three copies are verbatim); sourcing from the moderator preserves the historical pinning chain.

### §5 — No participant-shim or audience-shim arrangement; every workspace's `facetStatus.ts` fully deletes

`extract_cytoscape_projectors` had per-workspace carve-outs (participant kept three local boolean+count helpers via a re-export shim; moderator kept a thin `selectAnnotations` wrapper; audience fully deleted). This leaf's surface is different — three workspaces, **zero** workspace-local helpers in any `facetStatus.ts`. Every public symbol in every `facetStatus.ts` (`FacetStatus`, `FacetName`, `FacetStatusIndex`, `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus`) is in scope for the lift.

Three options:

- **(A — chosen)** Fully delete all three workspaces' `facetStatus.ts` + `facetStatus.test.ts`; rewire every consumer's import path from the local relative path to `@a-conversa/shell`. ~40 import sites get a one-line edit; no shim files; the shell becomes the only home for facet-status code.
- **(B)** Leave thin re-export shims in each workspace (the participant + audience could carry shim files; the moderator's `facetStatus.ts` would shrink to a re-export). Cost: introduces three files that exist solely to forward imports the consumer would just as easily reach via `@a-conversa/shell`. Future readers ask "why does the participant have a `facetStatus.ts` that just re-exports?" and the answer is "to minimize the diff blast radius of an extraction that's been done for months." That's a code smell.
- **(C)** Leave the participant's `facetStatus.ts` as a re-export shim (parallel with `extract_cytoscape_projectors` Decision §5) but fully delete the moderator's and audience's. Cost: asymmetric for no reason (the participant has no workspace-local helpers that justify the shim, unlike `extract_cytoscape_projectors`'s three boolean+count helpers); the asymmetry would confuse future readers.

Chosen: (A). The shim arrangement in `extract_cytoscape_projectors` was motivated by genuine workspace-local helpers worth preserving; here there are none. Full deletion is the cleaner outcome — three fewer files in the working tree, ~1900 lines of duplication retired, every consumer's import path uniformly points at the canonical shell home.

### §6 — Root re-export from `@a-conversa/shell`, not a subpath export

Same call as `shell_axiom_marks_extraction` Decision §4, `extract_cytoscape_projectors` Decision §6, and every prior shell extraction. Two options:

- **(A — chosen)** Re-export `FacetStatus`, `FacetName`, `FacetStatusIndex`, `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus` from `packages/shell/src/index.ts`. Consumers import via `import { computeFacetStatuses, cardRollupStatus } from '@a-conversa/shell'`.
- **(B)** Add a subpath export entry `"./facet-status"` to `packages/shell/package.json`'s `exports` map. Cost: introduces a manifest-maintenance edge that no prior shell extraction needed; the consumer's import path becomes verbose for no offsetting benefit.

Chosen: (A). Honors the convention every prior shell extraction established; keeps the consumer import path uniform across all shell-provided symbols.

### §7 — No new Playwright / Cucumber coverage (Vitest + existing integration tests are sufficient)

Same call as `shell_axiom_marks_extraction` Decision §6 and `extract_cytoscape_projectors` Decision §7. Three observations frame this:

1. This task is a pure file-location refactor. No user-visible behavior changes; no protocol seam crossed; no projector output shifts; no rule semantics edited. The client-tier integration test suites that exercise the rule walker and the rollup (`apps/moderator/src/graph/GraphCanvasPane.test.tsx`, `apps/moderator/src/graph/StatementNode.test.tsx` non-rollup cases, `apps/participant/src/graph/GraphView.test.tsx`, `apps/participant/src/graph/projectGraph.test.ts`, `apps/audience/src/graph/GraphView.test.tsx`, `apps/audience/src/graph/projectGraph.test.ts`, `apps/audience/src/graph/PerFacetPillOverlay.test.tsx`, and every per-facet vote-button / proposal-breakdown test in the participant) continue passing against the lifted symbols — that is the structural regression pin for the import-path rewire.
2. The task lives under `shell_package.*`, not under any of the UI-stream groups that the orchestrator brief's UI-stream e2e policy applies to. No reachability change for any surface; no new route, no new event surface.
3. The cross-surface Cucumber rule applies to wire / broadcast / projector changes observable at the system seam. `computeFacetStatuses` is an internal client-side projector consumed by graph-renderers, not a wire / broadcast surface. The server-side counterpart (`deriveFacetStatus`) — which IS observable at the wire seam via the `proposal-status` broadcast — is not touched here. Vitest is the architecturally-correct pin.

Three options:

- **(A — chosen)** Vitest at the canonical home (`packages/shell/src/facet-status/**`) plus the existing client-tier integration tests continuing to pass. No new Playwright. No new Cucumber.
- **(B)** Scope a Playwright spec that renders all three surfaces' canvas with a representative session log + asserts per-card rollup classes. Cost: redundant with the predecessor refinements' own Playwright + visual-regression coverage; the lift does not change the rollup-class visual contract.
- **(C)** Scope a Cucumber scenario for the rule-set walk. Cost: Cucumber pins wire/broadcast/projector-system-seam behavior per ADR 0021 + ADR 0030; `computeFacetStatuses` is an internal client-side projector, not a wire/broadcast surface. The server's `deriveFacetStatus` is already pinned by Cucumber at the wire seam; the client mirrors' Vitest coverage pins the client surfaces' replay of the same rules.

Chosen: (A). The Vitest layer is already at union coverage from the three predecessor suites; consolidating it at the shell home preserves coverage and centralizes future-maintenance work. The client-tier integration tests continuing to pass post-rewire is the structural regression pin; no new e2e scope is owed.

### §8 — Server-side `deriveFacetStatus` stays in `apps/server/src/projection/facet-status.ts`; no named-future-task registered for cross-server consolidation

The four-mirror duplication today spans three client-side `facetStatus.ts` files + the server-side [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts). This leaf consolidates the three client mirrors into the shell. The server side intentionally stays out of scope. Three options:

- **(A — chosen)** Lift only the three client mirrors; leave the server's `deriveFacetStatus` in `apps/server/src/projection/facet-status.ts` untouched; do NOT register a named-future-task for a future server↔shell consolidation. The moderator's `facetStatus.ts` header at lines 12-15 already documented this scope boundary: "If a future refactor extracts a shared methodology types package, the duplication becomes the call site." That future refactor — if it ever happens — is methodology-engine-layer work, not shell-package-layer work; registering a named-future-task today would presuppose a decision that hasn't been made.
- **(B)** Lift the server's `deriveFacetStatus` into the shell alongside the client walker. Cost: the server is a Node-side module with no React / browser dependencies; `packages/shell` is a browser-targeted library with React/jsx imports in many sibling areas. The build configuration would have to grow a "server-safe subpath" to let `apps/server/` consume the shell-side `facet-status/` module without pulling in the browser-side machinery. That's a methodology-types-package decision (option C below) wearing a shell-extraction disguise.
- **(C — explicitly deferred without WBS registration)** Introduce a new `@a-conversa/methodology-types` package as a third home for the rule-set walk; have both the server and the shell import from it. Cost: a new package; cross-package build configuration; a decision about whether `@a-conversa/methodology-types` becomes a peer of `@a-conversa/shared-types` or sits inside it. None of those decisions belong in this leaf. The moderator's `facetStatus.ts` header at line 14 already anticipates this option; if and when the cross-server duplication cost becomes load-bearing, the methodology-types package becomes its own ADR + refinement.

Chosen: (A). The four-caller rule that triggered this leaf is satisfied by the three client mirrors converging to the shell. The fourth implementation (server-side `deriveFacetStatus`) sits at a different consumption tier (server's projection pipeline, single-pair signature) and warrants its own architectural decision — not a tacked-on named-future-task. The orchestrator brief's tech-debt registration policy says "name the future task crisply"; "future server↔shell convergence via a new methodology-types package" is too speculative to register today.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-28.

- Created `packages/shell/src/facet-status/facet-status.ts` — lifted 7 public symbols (`FacetStatus`, `FacetName`, `FacetStatusIndex`, `computeFacetStatuses`, `EMPTY_FACET_STATUSES`, `ROLLUP_PRIORITY`, `cardRollupStatus`) verbatim from moderator `facetStatus.ts` + `StatementNode.tsx` rollup pair.
- Created `packages/shell/src/facet-status/index.ts` — barrel re-export of the 7 public symbols.
- Created `packages/shell/src/facet-status/facet-status.test.ts` — consolidated Vitest suite (union of 3 predecessor suites + moderator `StatementNode.test.tsx` `cardRollupStatus` describe block).
- Modified `packages/shell/src/index.ts` — added `// ─── facet-status ───` re-export block.
- Modified `packages/shell/src/facet-pill/types.ts` — collapsed to re-export shim per Decision §3.
- Modified `apps/moderator/src/graph/StatementNode.tsx` — removed embedded `ROLLUP_PRIORITY` + `cardRollupStatus`; rewired imports to `@a-conversa/shell`.
- Modified `apps/moderator/src/graph/StatementNode.test.tsx` — removed `cardRollupStatus — rollup priority order` describe block (subsumed by shell suite).
- Rewired ~32 other consumer files across `apps/moderator/`, `apps/participant/`, `apps/audience/` from local `./facetStatus` paths to `@a-conversa/shell`.
- Deleted `apps/{moderator,participant,audience}/src/graph/facetStatus.{ts,test.ts}` — 6 files, ~3254 lines of cross-workspace duplication retired.
