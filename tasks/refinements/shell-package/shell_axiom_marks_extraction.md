# Lift `AxiomMark` + projection helpers + `<AxiomMarkBadge>` into `@a-conversa/shell` (third-caller trigger fired by audience)

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.shell_axiom_marks_extraction` (lines 110-126).
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration` (settled 2026-05-11 — [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](../moderator-ui/mod_axiom_mark_decoration.md)). The first caller. Established the cross-surface vocabulary: `AxiomMark` interface, `EMPTY_AXIOM_MARKS` frozen empty array, `projectAxiomMarks(events)` pure walk, `groupAxiomMarksByNode(marks)` bucketer (originally defined inline in [`apps/moderator/src/graph/selectors.ts:270-359`](../../../apps/moderator/src/graph/selectors.ts#L270)); per-participant chromatic palette via `axiomMarkColorFor` (already in `packages/shell/src/facet-pill/participant-color.ts` and re-exported via `@a-conversa/shell`); rounded-square badge with centered "A" Latin-anchor glyph + `methodology.axiomMark.{tooltip,srLabel}` i18n keys (en-US / pt-BR / es-419 catalogs already populated).
- `participant_ui.part_graph_view.part_axiom_mark_decoration` (settled 2026-05-17 — [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](../participant-ui/part_axiom_mark_decoration.md)). The second caller. Verbatim port of the four names into [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts) plus a participant-local `nodeHasAxiomMark(grouped, nodeId): boolean` helper that the boolean-overlay decoration consumes. Decision §2 there explicitly named the audience leaf as the third caller that would trigger this extraction. The participant ALSO ships a separate per-mark badge in the detail panel at [`apps/participant/src/detail/AxiomMarkBadge.tsx`](../../../apps/participant/src/detail/AxiomMarkBadge.tsx) (memoized default export, props `{ readonly mark: AxiomMark }`, structurally identical to the moderator + audience badges).
- `audience.aud_graph_rendering.aud_axiom_mark_decoration` (settled 2026-05-28 — [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](../audience/aud_axiom_mark_decoration.md)). The third caller — the trigger. Decision §3 there is the source-of-debt: "the closer registers `shell_axiom_marks_extraction` (~0.5d) at task close. Description: 'Lift `AxiomMark` + `EMPTY_AXIOM_MARKS` + `projectAxiomMarks` + `groupAxiomMarksByNode` from `apps/{moderator,participant,audience}/src/graph/` into `packages/shell/src/axiom-marks/`; consolidate the three client copies as `@a-conversa/shell` imports; lift the moderator+audience `<AxiomMarkBadge>` component (and the participant tablet's future panel consumer) as a sibling cross-surface lift.'" Ports [`apps/audience/src/graph/axiomMarks.ts`](../../../apps/audience/src/graph/axiomMarks.ts) (minus `nodeHasAxiomMark`) and [`apps/audience/src/graph/AxiomMarkBadge.tsx`](../../../apps/audience/src/graph/AxiomMarkBadge.tsx) as the third and final client-side copies that this leaf consolidates.
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md)). Established the `packages/shell/src/<area>/` directory layout (`auth/`, `error-mapper/`, `facet-pill/`, `i18n/`, `login-logout/`, `mount-contract/`, `screen-name/`, `ws/`), the root re-export convention via [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts), and the Vitest-coverage posture for lifted helpers.
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_facet_pill` (settled — [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md)). The shape-precedent for this leaf: a deferred-until-third-caller cross-surface lift of a small React primitive + its underlying vocabulary into `packages/shell/src/<area>/`, replacing N client-local copies with `@a-conversa/shell` imports. Decision §2 there established the "two-callers-then-extract risks ossifying the wrong shape; three callers gives confidence the API is right" rationale this leaf inherits. Decision §8 there pre-registered the projector-extraction sibling (`extract_cytoscape_projectors`) for `projectAnnotations` + siblings — the axiom-mark projection helpers consolidated here are a parallel cross-surface lift on the same `aud_graph_rendering`-third-caller cadence.

## What this task is

The 0.5d mechanical refactor that lifts the axiom-mark vocabulary — the `AxiomMark` interface, the `EMPTY_AXIOM_MARKS` frozen empty array, the `projectAxiomMarks(events)` pure walk, the `groupAxiomMarksByNode(marks)` bucketer, and the `<AxiomMarkBadge>` React component — out of three client workspaces (`apps/moderator/`, `apps/participant/`, `apps/audience/`) into a single canonical home at `packages/shell/src/axiom-marks/`, then rewires every client-side caller to import from `@a-conversa/shell` and deletes the three local copies. The participant's `nodeHasAxiomMark(grouped, nodeId): boolean` helper stays participant-local (one call site, collapse-to-boolean shape that neither the moderator nor the audience consumes — per the WBS scope line).

The trigger is the **third-caller policy** documented in [`extract_facet_pill.md`](extract_facet_pill.md) Decision §2 and re-invoked by [`part_axiom_mark_decoration.md`](../participant-ui/part_axiom_mark_decoration.md) Decision §2 and [`aud_axiom_mark_decoration.md`](../audience/aud_axiom_mark_decoration.md) Decision §3: extracting a primitive with only two callers risks ossifying the wrong shape; at three callers the API surface has had enough independent eyes on it that the convergence point is clear. The audience's `aud_axiom_mark_decoration` landed 2026-05-28 with a verbatim port of `axiomMarks.ts` (minus `nodeHasAxiomMark`) and an inline port of the moderator's `<AxiomMarkBadge>` — the third copy of each — which is the explicit trigger documented in the source-of-debt refinement.

After this leaf:

- A new directory `packages/shell/src/axiom-marks/` lands with: `axiom-marks.ts` (the canonical `AxiomMark` interface + `EMPTY_AXIOM_MARKS` + `projectAxiomMarks` + `groupAxiomMarksByNode` from the moderator's `selectors.ts:270-359` block, lifted verbatim with the participant's `axiomMarks.ts` header comment as the docstring); `AxiomMarkBadge.tsx` (a single canonical React badge with props `{ readonly mark: AxiomMark }`, memoized default export, consuming `axiomMarkColorFor` from the existing sibling `packages/shell/src/facet-pill/participant-color.ts` via relative import); `axiom-marks.test.ts` (the 7-case Vitest suite the participant + audience already pin against, consolidated into one suite); `AxiomMarkBadge.test.tsx` (the badge Vitest suite consolidating the moderator's 5-locale matrix + the audience's en-US smoke). The directory ships an `index.ts` that re-exports the public surface.
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) re-exports the new symbols (`AxiomMark`, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`, `groupAxiomMarksByNode`, `AxiomMarkBadge`) alongside the existing `axiomMarkColorFor` / `AxiomMarkColor` / `AXIOM_MARK_PALETTE` exports, preserving the root-import convention every prior shell extract established.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) loses the axiom-mark block (lines ~270-359 plus the `EMPTY_AXIOM_MARKS` line at 304) and the file's remaining exports stay untouched; existing callers (`GraphCanvasPane.tsx`, `StatementNode.tsx`, the moderator's `selectors.test.ts` block) re-import the symbols from `@a-conversa/shell`.
- [`apps/moderator/src/graph/AxiomMarkBadge.tsx`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx) is deleted; [`apps/moderator/src/graph/StatementNode.tsx:52`](../../../apps/moderator/src/graph/StatementNode.tsx#L52) (and any other moderator caller) imports `AxiomMarkBadge` from `@a-conversa/shell`.
- [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts) collapses to a thin re-export shim: the four lifted names re-exported from `@a-conversa/shell`; the participant-local `nodeHasAxiomMark(grouped, nodeId): boolean` helper stays defined in this file (its single call site at [`apps/participant/src/graph/projectGraph.ts:108`](../../../apps/participant/src/graph/projectGraph.ts#L108) is unchanged). Alternatively (Decision §5), the participant's `axiomMarks.ts` is deleted and `nodeHasAxiomMark` moves alongside its single call site or to a thin sibling file. The chosen shape is the re-export shim — preserves the existing import paths inside `apps/participant/` and keeps the participant's helper colocated with the shell-lifted vocabulary it depends on.
- [`apps/participant/src/detail/AxiomMarkBadge.tsx`](../../../apps/participant/src/detail/AxiomMarkBadge.tsx) is deleted; [`apps/participant/src/detail/EntityDetailPanel.tsx:65`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L65) imports `AxiomMarkBadge` from `@a-conversa/shell` (the participant's panel badge is structurally identical — props `{ readonly mark: AxiomMark }`, memoized default — so the third-caller consolidation captures this copy too; Decision §3).
- [`apps/audience/src/graph/axiomMarks.ts`](../../../apps/audience/src/graph/axiomMarks.ts) is deleted; [`apps/audience/src/graph/projectGraph.ts:76-78`](../../../apps/audience/src/graph/projectGraph.ts#L76) re-imports the four names from `@a-conversa/shell`.
- [`apps/audience/src/graph/AxiomMarkBadge.tsx`](../../../apps/audience/src/graph/AxiomMarkBadge.tsx) is deleted; [`apps/audience/src/graph/AxiomMarkOverlay.tsx:44`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx#L44) imports `AxiomMarkBadge` from `@a-conversa/shell` (the audience-local `AudienceAxiomMarkBadge` name is dropped in favor of the canonical `AxiomMarkBadge`; the overlay's own `data-testid` prefix at the overlay layer is independent of the badge's component name — Decision §4).
- The three client-side test suites covering the lifted symbols (`apps/moderator/src/graph/selectors.test.ts` axiom-mark block, `apps/participant/src/graph/axiomMarks.test.ts`, `apps/audience/src/graph/axiomMarks.test.ts`) are deleted; the consolidated `packages/shell/src/axiom-marks/axiom-marks.test.ts` carries the union coverage. The three client-side badge tests (`apps/moderator/src/graph/AxiomMarkBadge.test.tsx`, the audience's `AxiomMarkBadge.test.tsx`, and the participant's panel-badge test if present) collapse into `packages/shell/src/axiom-marks/AxiomMarkBadge.test.tsx` — the moderator's full cross-locale matrix is the upstream coverage, the audience + participant smoke cases are subsumed.

Out of scope (kept local; deferred; or already settled):

- **`nodeHasAxiomMark`.** Stays in [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts) (after that file collapses to a re-export shim around the lifted symbols, the helper remains defined locally). Single call site, boolean-collapse shape neither the moderator nor the audience consumes (the moderator's `StatementNode` consumes the full `AxiomMark[]` to render per-participant badges; the audience's overlay consumes the full list to render the chip row). Lifting it would force the moderator and audience to take a helper they don't call. The WBS task description names this exclusion explicitly: "keep `nodeHasAxiomMark` participant-local (one call site, collapse-to-boolean shape the audience doesn't need)."
- **`axiomMarkColorFor` / `AXIOM_MARK_PALETTE` / `AxiomMarkColor`.** Already in `packages/shell/src/facet-pill/participant-color.ts` since `mod_axiom_mark_decoration` shipped (2026-05-11). Re-exported via [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) and consumed by all three current badge copies. No work here.
- **i18n catalog keys (`methodology.axiomMark.label` / `tooltip` / `srLabel`).** Already populated for en-US / pt-BR / es-419 by `mod_axiom_mark_decoration`. The lifted badge consumes them via `useTranslation()` exactly as the moderator + audience copies do today. No catalog change.
- **Wire format / projection output / methodology semantics.** This is a pure file-location refactor. `AxiomMark` interface fields stay byte-identical (`nodeId` / `participantId` / `committedAt`); `projectAxiomMarks` walks the same `proposal` + `commit` arms of the discriminated union per ADR 0021 / ADR 0030 §9; `groupAxiomMarksByNode` produces the same `Map<nodeId, AxiomMark[]>` bucketing. No shared-types change. No projector output change.
- **Cross-surface `<AxiomMarkBadge>` chrome unification beyond memoized default-export shape.** The moderator's badge is rendered inside a ReactFlow node subtree; the audience's badge is rendered inside a DOM-overlay sibling row; the participant's panel badge is rendered inside a detail-panel React tree. All three call sites consume `{ mark: AxiomMark }` and produce the same visual contract (`rounded-sm` shape, centered "A" glyph, per-participant chromatic via `axiomMarkColorFor`, `methodology.axiomMark.srLabel` aria-label) — the lift consolidates that shared shape. Any surface-specific positioning / outer wrapping stays at the call site (the overlay row's flex layout, the node card's badge-row container, the panel's badge-list grouping).
- **Per-participant screen-name lookup in `aria-label`.** All three badges carry the participant UUID via ICU substitution today; swapping the UUID for a resolved screen name is a future task on the `participants` projection, not this leaf. The lifted badge inherits the same `participantId`-keyed ICU shape; the catalog key stays stable.
- **Subpath export entries in `packages/shell/package.json` (`"./axiom-marks"`).** Not required — every prior shell substrate re-exports from `index.ts` root (per Decision §4); the consumers import `{ AxiomMarkBadge, projectAxiomMarks } from '@a-conversa/shell'` directly. A subpath export adds a manifest-maintenance cost without a corresponding caller need.
- **Audience routing / placeholder unwiring.** Unchanged. The audience surface remains placeholder-routed at [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx); `aud_session_url` is the future task that lights up the per-session route. This leaf does not change reachability for any surface.
- **Playwright / Cucumber coverage.** This is a pure refactor with no user-visible behavior change, no protocol seam crossed, no projector output shift. Per ADR 0022 the Vitest layer (consolidated into the shell) plus the existing client-tier integration tests (continuing to pass after the import-path rewire) are the regression pin. Decision §6 documents why no new e2e is scoped.

## Why it needs to be done

Three near-identical copies of the same ~90-line projection block (`projectAxiomMarks` + `groupAxiomMarksByNode` + the `AxiomMark` interface + `EMPTY_AXIOM_MARKS`) and three near-identical copies of the same ~70-line React badge component (moderator graph, audience overlay, participant detail panel) live in three workspaces today. The duplication is not load-bearing — every copy is structurally byte-identical for the lifted symbols (the participant adds `nodeHasAxiomMark` as an outlier helper; the audience drops it). The cost of leaving the duplication in place is the standard cross-surface drift risk: a methodology change to axiom-mark semantics (e.g. adding a new commit arm, changing the `AxiomMark` interface shape, refining the badge's aria-label prose) has to be applied in three files in three different apps with three different test suites, and any update that fails to land in all three sites silently desynchronizes the surfaces' rendering of bedrock — exactly the failure mode the methodology's "surfacing axioms is a primary success state" rule cannot tolerate.

The third-caller policy (from [`extract_facet_pill.md`](extract_facet_pill.md) Decision §2) exists for this case: at two callers the API shape is still under negotiation (the participant's `nodeHasAxiomMark` is an example of one caller introducing an inflection that the other doesn't share); at three callers the convergence point is empirical, not speculative. The audience's `aud_axiom_mark_decoration` shipped 2026-05-28 with a verbatim port that confirmed the four-name surface (interface + frozen empty + projection walk + bucketer) is exactly what every caller needs. The badge component's prop shape `{ mark: AxiomMark }` is empirically the same across the moderator's ReactFlow node, the audience's DOM overlay row, and the participant's detail panel.

The follow-on benefits:

- **One source of truth for axiom-mark methodology surfacing.** A future ADR or refinement that touches axiom-mark semantics edits one `packages/shell/src/axiom-marks/` block instead of three workspaces. The next surface to land axiom-mark rendering (replay-test, OBS composite, any future surface) imports from `@a-conversa/shell` directly — no cross-workspace ports, no fourth-caller-extraction registration.
- **Reduced client-side bundle work.** The shell package is already a runtime dependency of every UI surface (per ADR 0026 / `shell_substrate_extraction`); moving the axiom-mark code there does not add a new dependency edge — it consolidates code that's already shipped to every client into a single chunk that participates in the shell's build output.
- **Test consolidation.** Three Vitest suites covering the same projection rules + three suites covering the same badge contract collapse into one each. Cross-surface contract regressions (e.g. the audience and participant both reading a different `committedAt` semantics from the moderator) become structurally impossible because there is only one implementation to test against.
- **Surfaces the next debt mechanically.** The same pattern catches `projectAnnotations` + siblings via the already-registered `extract_cytoscape_projectors` task ([`tasks/27-shell-package.tji:101-108`](../../27-shell-package.tji#L101)) and `mergeSlots` + `deriveSlotOccupants` via `shared_shell_extract_merge_slots_and_derive_slot_occupants` ([`tasks/27-shell-package.tji:128-141`](../../27-shell-package.tji#L128)). Each follows the same third-caller-fires-the-extract recipe this leaf instantiates.

This leaf is registered as the closer's follow-up to `audience.aud_graph_rendering.aud_axiom_mark_decoration` (2026-05-28) per the orchestrator brief's tech-debt registration policy; the source-of-debt refinement explicitly named it.

## Inputs / context

### ADRs

- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md) — `projectAxiomMarks` walks the discriminated union; the lift preserves the existing narrowing on `proposal` events whose inner kind is `axiom-mark`. No envelope-shape change.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest consolidation pins both the projection logic and the badge component's render contract once, at the canonical home. The three client-tier integration test suites continue to pass against the lifted symbols; that is the regression pin for the import-path rewire.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the shell package is the canonical shared substrate for every UI surface; lifting the axiom-mark vocabulary here is the architecturally-correct destination per the ADR.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — axiom-marks are per-participant **disposition** decorations on the node **entity**, not facet state. The `packages/shell/src/axiom-marks/` directory sits as a sibling to `packages/shell/src/facet-pill/` (which carries the facet/agreement-layer vocabulary) — the directory split makes the layer boundary visible at the file system level.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — §9 confirms axiom-mark commits ride the **proposal-keyed** arm of the commit-payload discriminated union; the lifted `projectAxiomMarks` honors this exactly as the three current copies do.

No new ADR. The architectural seams (third-caller extraction policy, root-export shell convention, sibling-directory layout under `packages/shell/src/`) are all settled by prior shell-package refinements + ADR 0026.

### Sibling refinements

- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md) — the canonical precedent for a shell-side extraction with full Vitest coverage; established the `packages/shell/src/<area>/` directory layout and the root-export convention via `packages/shell/src/index.ts`.
- [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md) — Decision §2 there codified the "two-callers-then-extract risks ossifying the wrong shape; three callers gives confidence" rule this leaf inherits. The shape-precedent for a small React primitive lifted out of three workspaces with full Vitest pinning.
- [`tasks/refinements/audience/aud_axiom_mark_decoration.md`](../audience/aud_axiom_mark_decoration.md) — Decision §3 there is the explicit source-of-debt: this leaf executes the registration that decision created.
- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](../participant-ui/part_axiom_mark_decoration.md) — Decision §2 there named the audience leaf as the third-caller trigger; Decision §1 there documented why `nodeHasAxiomMark` was added as a participant-local helper (the boolean overlay collapses the per-participant list before consuming it) and is the precedent for leaving the helper out of the shell lift.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](../moderator-ui/mod_axiom_mark_decoration.md) — established the canonical `AxiomMark` interface shape + the badge's prop / visual / i18n contract that all three current copies mirror.

### Live code the leaf modifies / creates / deletes

**Creates** (canonical home):

- `packages/shell/src/axiom-marks/axiom-marks.ts` — **NEW**. Verbatim lift of the axiom-mark block from [`apps/moderator/src/graph/selectors.ts:270-359`](../../../apps/moderator/src/graph/selectors.ts#L270) (including `AxiomMark` interface, `EMPTY_AXIOM_MARKS = Object.freeze<readonly AxiomMark[]>([])`, `projectAxiomMarks(events: SessionEvent[]): readonly AxiomMark[]`, `groupAxiomMarksByNode(marks: readonly AxiomMark[]): Map<string, readonly AxiomMark[]>`). Header comment names this as the third-caller consolidation, links back to the three predecessor refinements, and links to [`docs/methodology.md`](../../../docs/methodology.md) §"Axioms / terminal values" for methodology context.
- `packages/shell/src/axiom-marks/AxiomMarkBadge.tsx` — **NEW**. Single canonical React badge. Memoized default export `AxiomMarkBadge` with props `{ readonly mark: AxiomMark }`. Imports `axiomMarkColorFor` from `../facet-pill/participant-color.js` (relative — intra-package import, NOT via `@a-conversa/shell`). Renders the documented visual contract: `<span role="img" data-testid={`axiom-mark-badge-${mark.nodeId}-${mark.participantId}`} data-participant-id={mark.participantId} title={...} aria-label={...} className="inline-flex h-5 w-5 items-center justify-center rounded-sm ... text-[11px] font-semibold leading-none">A</span>`. Resolves `title` + `aria-label` via `useTranslation()` against `methodology.axiomMark.tooltip` / `methodology.axiomMark.srLabel`.
- `packages/shell/src/axiom-marks/index.ts` — **NEW**. Barrel re-export: `AxiomMark`, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`, `groupAxiomMarksByNode`, `AxiomMarkBadge` (default).
- `packages/shell/src/axiom-marks/axiom-marks.test.ts` — **NEW**. Consolidates the moderator + participant + audience projection coverage. ≥7 Vitest cases (matching the union of the three predecessor suites): empty log → `[]`; `axiom-mark` proposal without commit → `[]`; one (proposal + commit) pair → one `AxiomMark` with the right `nodeId` / `participantId` / `committedAt`; two participants marking the same node → two records (per-participant multiplicity); emission order matches commit-arrival order; mixed log — non-axiom-mark proposals + unrelated event kinds are ignored; `groupAxiomMarksByNode` bucketing.
- `packages/shell/src/axiom-marks/AxiomMarkBadge.test.tsx` — **NEW**. Consolidates the moderator + audience + participant-panel badge coverage. ≥6 Vitest cases (matching the union of the predecessor suites): badge renders the literal "A" glyph; `data-testid` matches `axiom-mark-badge-{nodeId}-{participantId}`; `data-participant-id` matches the prop; same `participantId` across two renders produces the same Tailwind background class (deterministic chromatic); memoization re-render skip (identical props → no inner DOM update); full cross-locale matrix from the moderator's predecessor suite (en-US / pt-BR / es-419 each resolve `methodology.axiomMark.srLabel` with the participant id ICU substitution).

**Modifies**:

- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — adds `export * from './axiom-marks/index.js';` (or the equivalent named re-exports — match the prevailing pattern in the file). The existing `axiomMarkColorFor` / `AXIOM_MARK_PALETTE` / `AxiomMarkColor` re-exports from `facet-pill/` stay in place.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) — the axiom-mark block (~lines 270-359, including `EMPTY_AXIOM_MARKS` at line 304) is deleted. Existing in-file imports / exports that referenced these symbols are removed. The remaining `selectors.ts` content stays untouched.
- [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) — the axiom-mark Vitest block is deleted; the consolidated suite at `packages/shell/src/axiom-marks/axiom-marks.test.ts` carries the coverage. Other (non-axiom-mark) cases in this file stay untouched.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — the existing imports at lines 116 and 539 (referencing `EMPTY_AXIOM_MARKS`, `groupAxiomMarksByNode`, `projectAxiomMarks`) are rewritten to import from `@a-conversa/shell`.
- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx) — line 52's import of `AxiomMarkBadge` is rewritten to import from `@a-conversa/shell`.
- [`apps/participant/src/graph/axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts) — collapses to a re-export shim. Re-exports `AxiomMark` / `EMPTY_AXIOM_MARKS` / `projectAxiomMarks` / `groupAxiomMarksByNode` from `@a-conversa/shell`; the participant-local `nodeHasAxiomMark(grouped: Map<string, readonly AxiomMark[]>, nodeId: string): boolean` helper stays defined here (single call site at `projectGraph.ts:108`). Decision §5 documents why the shim shape is preferred over deletion + scattering.
- [`apps/participant/src/graph/axiomMarks.test.ts`](../../../apps/participant/src/graph/axiomMarks.test.ts) — the projection cases are deleted (subsumed by `packages/shell/src/axiom-marks/axiom-marks.test.ts`); the `nodeHasAxiomMark` cases stay in this file.
- [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — line 108's import of `AxiomMark` is preserved (still resolves through the shim); no code change needed unless the implementer prefers to retarget directly at `@a-conversa/shell`.
- [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — line 65's import of `AxiomMarkBadge` is rewritten to import from `@a-conversa/shell`.
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — lines 76-78's imports of `EMPTY_AXIOM_MARKS` / `groupAxiomMarksByNode` / `projectAxiomMarks` are rewritten to import from `@a-conversa/shell`. The local-file import of `AxiomMark` type (if separate) is similarly rewritten.
- [`apps/audience/src/graph/AxiomMarkOverlay.tsx`](../../../apps/audience/src/graph/AxiomMarkOverlay.tsx) — line 44's import of `AudienceAxiomMarkBadge` from `./AxiomMarkBadge.js` is rewritten to `import AxiomMarkBadge from '@a-conversa/shell'` (the local `AudienceAxiomMarkBadge` name is dropped in favor of the canonical `AxiomMarkBadge` — Decision §4); the overlay's JSX `<AudienceAxiomMarkBadge mark={mark} />` renames to `<AxiomMarkBadge mark={mark} />`.

**Deletes**:

- [`apps/moderator/src/graph/AxiomMarkBadge.tsx`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx).
- [`apps/moderator/src/graph/AxiomMarkBadge.test.tsx`](../../../apps/moderator/src/graph/AxiomMarkBadge.test.tsx) (assuming present; coverage is moved to the shell suite).
- [`apps/participant/src/detail/AxiomMarkBadge.tsx`](../../../apps/participant/src/detail/AxiomMarkBadge.tsx).
- The participant's panel-badge Vitest suite, if present (coverage is moved to the shell suite).
- [`apps/audience/src/graph/axiomMarks.ts`](../../../apps/audience/src/graph/axiomMarks.ts).
- [`apps/audience/src/graph/axiomMarks.test.ts`](../../../apps/audience/src/graph/axiomMarks.test.ts).
- [`apps/audience/src/graph/AxiomMarkBadge.tsx`](../../../apps/audience/src/graph/AxiomMarkBadge.tsx).
- [`apps/audience/src/graph/AxiomMarkBadge.test.tsx`](../../../apps/audience/src/graph/AxiomMarkBadge.test.tsx).

**Unchanged**:

- `packages/shell/src/facet-pill/participant-color.ts` — `axiomMarkColorFor` / palette stay where they are; the lifted badge consumes them via intra-package relative import.
- `packages/shared-types/**` — no wire-format change.
- `packages/i18n-catalogs/**` — i18n keys already in place.
- `apps/server/**`, `apps/root/**` — no server / root change.
- `apps/audience/src/graph/AxiomMarkOverlay.test.tsx`, `apps/audience/src/graph/projectGraph.test.ts`, `apps/audience/src/graph/GraphView.test.tsx` — continue passing against the lifted symbols (regression pin for the import-path rewire); existing assertions match the shell-sourced types byte-for-byte because the lifted types are byte-identical to the audience's local copies.
- Moderator + participant integration tests (the surface-level rendering tests that exercise the badge inside the node / panel) — continue passing against the lifted symbols.
- All routes, providers, mount-effects — unchanged.

### What this task MUST NOT do

- **No wire-schema change.** The `AxiomMark` interface shape lifts byte-for-byte; the field set (`nodeId`, `participantId`, `committedAt`) stays exactly as it is across all three current copies. No shared-types churn.
- **No methodology change.** `projectAxiomMarks` semantics are byte-for-byte preserved; commit-arm narrowing per ADR 0030 §9 stays exactly as it is. No event-handling rule change.
- **No new i18n key.** The lifted badge consumes existing `methodology.axiomMark.{tooltip,srLabel}` keys verbatim.
- **No new dependency.** `react`, `react-i18next`, `@a-conversa/shared-types`, and the shell-internal `participant-color` module are all already on `packages/shell`'s path.
- **No new ADR.** Every architectural seam (third-caller extraction, root-export convention, sibling-directory layout) is settled.
- **No participant `nodeHasAxiomMark` lift.** Stays participant-local per the WBS scope line + Decision §1.
- **No badge-prop-shape divergence.** The single lifted `<AxiomMarkBadge>` takes `{ mark: AxiomMark }` exactly as all three current copies do. No surface-specific prop bleed (e.g. an audience-only `nodeId` prop or a participant-only `screenName` prop) — the call sites continue to compose surface-specific outer-wrapping around the unified inner badge.
- **No subpath export entry in `packages/shell/package.json`** (e.g. `"./axiom-marks"`). Root-export only — Decision §4.
- **No deletion of `apps/participant/src/graph/axiomMarks.ts`.** The file collapses to a re-export shim + the participant-local helper; full deletion is rejected per Decision §5.
- **No retargeting of the existing `axiomMarkColorFor` exports.** Already in the shell since 2026-05-11; this leaf does not move them.
- **No Playwright / Cucumber scope.** Pure refactor — Decision §6.
- **No edit to `apps/server/**`, `apps/root/**`, or any non-client / non-shell file.**

## Constraints / requirements

### Files this task touches (explicit allowlist)

**Creates**:

- `packages/shell/src/axiom-marks/axiom-marks.ts` — **NEW**. The four lifted names verbatim from `apps/moderator/src/graph/selectors.ts:270-359`. Header docstring links to the three predecessor refinements + `docs/methodology.md` §"Axioms / terminal values".
- `packages/shell/src/axiom-marks/AxiomMarkBadge.tsx` — **NEW**. Memoized default export `AxiomMarkBadge`. Props `{ readonly mark: AxiomMark }`. Renders the unified visual contract per "Live code the leaf modifies / creates" above. Intra-package import of `axiomMarkColorFor` from `../facet-pill/participant-color.js`. `useTranslation()` against `methodology.axiomMark.{tooltip,srLabel}`.
- `packages/shell/src/axiom-marks/index.ts` — **NEW**. Barrel re-export of the public surface.
- `packages/shell/src/axiom-marks/axiom-marks.test.ts` — **NEW**. ≥7 Vitest cases (union coverage of moderator + participant + audience projection suites; specific case list under "Live code the leaf modifies / creates" above).
- `packages/shell/src/axiom-marks/AxiomMarkBadge.test.tsx` — **NEW**. ≥6 Vitest cases (union coverage of moderator + audience + participant-panel badge suites; specific case list under "Live code the leaf modifies / creates" above).

**Modifies**:

- `packages/shell/src/index.ts` — adds the re-export.
- `apps/moderator/src/graph/selectors.ts` — deletes the axiom-mark block.
- `apps/moderator/src/graph/selectors.test.ts` — deletes the axiom-mark cases.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — rewires axiom-mark imports to `@a-conversa/shell`.
- `apps/moderator/src/graph/StatementNode.tsx` — rewires `AxiomMarkBadge` import to `@a-conversa/shell`.
- `apps/participant/src/graph/axiomMarks.ts` — collapses to re-export shim + the participant-local `nodeHasAxiomMark` helper.
- `apps/participant/src/graph/axiomMarks.test.ts` — deletes the projection cases; keeps the `nodeHasAxiomMark` cases.
- `apps/participant/src/detail/EntityDetailPanel.tsx` — rewires `AxiomMarkBadge` import to `@a-conversa/shell`.
- `apps/audience/src/graph/projectGraph.ts` — rewires axiom-mark imports to `@a-conversa/shell`.
- `apps/audience/src/graph/AxiomMarkOverlay.tsx` — rewires `AxiomMarkBadge` import to `@a-conversa/shell`; renames in-file references from `AudienceAxiomMarkBadge` to `AxiomMarkBadge`.

**Deletes**:

- `apps/moderator/src/graph/AxiomMarkBadge.tsx`
- `apps/moderator/src/graph/AxiomMarkBadge.test.tsx` (if present)
- `apps/participant/src/detail/AxiomMarkBadge.tsx`
- The participant's panel-badge Vitest file (if separately present)
- `apps/audience/src/graph/axiomMarks.ts`
- `apps/audience/src/graph/axiomMarks.test.ts`
- `apps/audience/src/graph/AxiomMarkBadge.tsx`
- `apps/audience/src/graph/AxiomMarkBadge.test.tsx`

### Files this task does NOT touch

- `apps/server/**`, `apps/root/**` — UNCHANGED.
- `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED (no wire change, no catalog change).
- `packages/shell/src/facet-pill/**`, `packages/shell/src/auth/**`, `packages/shell/src/i18n/**`, etc. — UNCHANGED (sibling shell substrates).
- `apps/moderator/src/graph/AxiomMarkOverlay.*` (if present), `apps/participant/src/graph/projectGraph.test.ts` other cases, `apps/audience/src/graph/AxiomMarkOverlay.test.tsx` — UNCHANGED (continue passing against the lifted symbols; regression pin for the import-path rewire).
- All routes, providers, mount-effects, WS handlers, projector outputs — UNCHANGED.
- `apps/moderator/package.json`, `apps/participant/package.json`, `apps/audience/package.json` — UNCHANGED (`@a-conversa/shell` is already in each `dependencies`).
- `packages/shell/package.json` — UNCHANGED. The new `axiom-marks/` directory ships under the existing `"."` (root) export; no subpath export entry needed (Decision §4).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` / Cucumber feature files — UNCHANGED (Decision §6).
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md).

## Acceptance criteria

The check that says "done":

- `packages/shell/src/axiom-marks/axiom-marks.ts` exists and exports `AxiomMark`, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`, `groupAxiomMarksByNode`. The interface field set, the frozen-empty array reference, the projection-walk semantics, and the bucketer behavior are byte-for-byte identical to the three predecessor copies (the moderator's `selectors.ts:270-359` block is the canonical source; the participant + audience copies were verbatim ports of it).
- `packages/shell/src/axiom-marks/AxiomMarkBadge.tsx` exists and default-exports a memoized `AxiomMarkBadge` consuming `{ readonly mark: AxiomMark }`. The rendered DOM matches the documented contract (`role="img"`, `data-testid="axiom-mark-badge-{nodeId}-{participantId}"`, `data-participant-id={participantId}`, `title` + `aria-label` via `useTranslation()`, per-participant chromatic via `axiomMarkColorFor`, rounded-square shape, centered "A" glyph).
- `packages/shell/src/axiom-marks/index.ts` re-exports the public surface; `packages/shell/src/index.ts` re-exports `* from './axiom-marks/index.js'` (or equivalent named re-exports).
- `packages/shell/src/axiom-marks/axiom-marks.test.ts` exists with ≥7 cases as listed above.
- `packages/shell/src/axiom-marks/AxiomMarkBadge.test.tsx` exists with ≥6 cases as listed above (including the full en-US / pt-BR / es-419 cross-locale matrix subsumed from the moderator's predecessor suite).
- The three deleted client-local copies (moderator badge file, audience `axiomMarks.ts` + badge file, participant panel badge file) are removed from the working tree.
- `apps/moderator/src/graph/selectors.ts` no longer carries the axiom-mark block (the four names are absent); the file's remaining (non-axiom-mark) content is byte-identical to before.
- `apps/participant/src/graph/axiomMarks.ts` is a re-export shim for the four lifted names + the local `nodeHasAxiomMark` helper definition; the helper's single call site at `projectGraph.ts:108` continues to compile.
- Every client-side consumer of the lifted symbols (moderator `GraphCanvasPane.tsx` + `StatementNode.tsx`; participant `projectGraph.ts` + `EntityDetailPanel.tsx`; audience `projectGraph.ts` + `AxiomMarkOverlay.tsx`) imports from `@a-conversa/shell`.
- `grep -rE "(projectAxiomMarks|groupAxiomMarksByNode|EMPTY_AXIOM_MARKS)" apps/ packages/` shows only:
  - Consumers (with `from '@a-conversa/shell'` import).
  - The participant shim re-exporting them from `@a-conversa/shell`.
  - The shell's own definition + test files + barrel.
  - No third-workspace local definition.
- `grep -rE "AxiomMarkBadge" apps/ packages/` shows only:
  - Consumers (with `from '@a-conversa/shell'` import).
  - The shell's own definition + test file + barrel.
  - No client-workspace local component file.
- `pnpm run check` clean (strict TS pass; no new dep declared; the lifted types match the three client-tier consumers byte-for-byte).
- `pnpm run test:smoke` green. The Vitest count net-change: ≥7 + ≥6 new cases land in `packages/shell/src/axiom-marks/**`; the three moderator + participant + audience projection suites lose their axiom-mark cases (subsumed); the three moderator + participant + audience badge suites lose their cases (subsumed); the participant `nodeHasAxiomMark` cases stay. The net Vitest count should not regress (the consolidated suite is the union of the predecessor coverage).
- `pnpm -F @a-conversa/shell build` succeeds. `pnpm -F @a-conversa/moderator build`, `pnpm -F @a-conversa/participant build`, `pnpm -F @a-conversa/audience build` each succeed.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/27-shell-package.tji` gets `complete 100` on `shell_axiom_marks_extraction` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer (consolidated at the canonical shell home) plus the three client-tier integration test suites continuing to pass after the import-path rewire are the full regression pin. No new Playwright / Cucumber scope (Decision §6).

## Decisions

### §1 — `nodeHasAxiomMark` stays participant-local; not lifted

The participant's [`axiomMarks.ts`](../../../apps/participant/src/graph/axiomMarks.ts) defines a boolean-collapse helper `nodeHasAxiomMark(grouped: Map<string, readonly AxiomMark[]>, nodeId: string): boolean` with a single call site at [`apps/participant/src/graph/projectGraph.ts:108`](../../../apps/participant/src/graph/projectGraph.ts#L108). Neither the moderator nor the audience consumes this helper — both surfaces render the full per-participant `AxiomMark[]` list (per-participant chromatic badges on each), so a boolean collapse would discard load-bearing data they need to keep.

Three options:

- **(A — chosen)** Leave `nodeHasAxiomMark` defined in the participant's local `axiomMarks.ts` (which collapses to a re-export shim around the four lifted names per Decision §5). Single call site, single workspace, single test.
- **(B)** Lift the helper into `packages/shell/src/axiom-marks/` alongside the four canonical symbols. Cost: introduces a shell symbol with one caller; future readers see it in the shell and may assume it's used cross-surface; the moderator and audience don't need it and their reviewers would have to justify why they don't call the apparent "correct" boolean-collapse helper. The orchestrator brief's "name the future task crisply" applies inversely here: don't introduce shell-side symbols that exist solely for one caller.
- **(C)** Inline the boolean collapse at the call site (`if (axiomMarkIndex.get(nodeId)?.length ?? 0 > 0)`); delete the helper entirely. Cost: the participant's test suite loses a small dedicated coverage block; the call site grows a one-liner that the named helper already abstracts. Marginal cost both ways — the helper is a small thing — but the existing helper isn't broken, so this is a refactor we don't owe.

Chosen: (A). Honors the WBS scope line ("keep `nodeHasAxiomMark` participant-local — one call site, collapse-to-boolean shape the audience doesn't need"). The helper has one caller; the third-caller policy that triggers shell-extraction does not fire for one-caller helpers.

### §2 — `packages/shell/src/axiom-marks/` sibling directory (not folded into `facet-pill/` or `participant-color`)

The shell already carries axiom-mark adjacent code: `axiomMarkColorFor` lives in [`packages/shell/src/facet-pill/participant-color.ts`](../../../packages/shell/src/facet-pill/participant-color.ts) and is re-exported from the root. Two options for where the lifted axiom-mark code lands:

- **(A — chosen)** A new sibling directory `packages/shell/src/axiom-marks/` with the four projection names + the badge + the barrel. The `axiomMarkColorFor` import inside `AxiomMarkBadge.tsx` is an intra-package relative import (`../facet-pill/participant-color.js`).
- **(B)** Fold the lifted code into `packages/shell/src/facet-pill/` since the per-participant color hash already lives there. Cost: the directory's name (`facet-pill`) reads as a facet/agreement-layer container (`<FacetPill>` is the canonical surface there); putting axiom-mark code there blurs the layer boundary that ADR 0027 ("entity and facet layers are strictly separate") explicitly draws — axiom-marks are an entity-layer disposition decoration, not facet vocabulary.
- **(C)** Co-locate the lifted code with the existing `participant-color.ts` file (rename `facet-pill/` to something more generic like `chromatic/` or `per-participant/`). Cost: a directory rename ripples through every existing consumer of `<FacetPill>` + `axiomMarkColorFor`; the shell's existing layout was settled by `shell_substrate_extraction` + `extract_facet_pill` and is referenced in their refinements; renaming for one new sibling directory is a planning-debt move.

Chosen: (A). The sibling-directory layout makes the layer boundary visible in the file tree (the `facet-pill/` directory holds facet-layer code; the `axiom-marks/` directory holds entity-disposition code; the `participant-color.ts` palette utility is a shared primitive that both consume). Future shell extractions on the same layering principle (e.g. `annotations/`, `votes/`) will follow the same sibling-directory shape.

The relative intra-package import (`../facet-pill/participant-color.js`) is the orthodox pattern inside `packages/shell/src/**`; importing from `@a-conversa/shell` inside the shell itself would introduce a self-circular dependency.

### §3 — Lift all three badge copies (moderator + audience + participant detail panel); not just moderator + audience

The WBS task description names "the moderator+audience `<AxiomMarkBadge>` component" as the extraction scope, but the source-of-debt refinement ([`aud_axiom_mark_decoration.md`](../audience/aud_axiom_mark_decoration.md) Decision §3) explicitly notes the participant's detail-panel badge as a consumer: "lift the moderator+audience `<AxiomMarkBadge>` component (and the participant tablet's future panel consumer) as a sibling cross-surface lift." The participant's [`detail/AxiomMarkBadge.tsx`](../../../apps/participant/src/detail/AxiomMarkBadge.tsx) is structurally identical to the moderator's and audience's copies: memoized default export, props `{ readonly mark: AxiomMark }`, same visual contract.

Three options:

- **(A — chosen)** Lift all three copies. Replace the moderator's `apps/moderator/src/graph/AxiomMarkBadge.tsx`, the audience's `apps/audience/src/graph/AxiomMarkBadge.tsx`, AND the participant's `apps/participant/src/detail/AxiomMarkBadge.tsx` with imports of the single canonical `AxiomMarkBadge` from `@a-conversa/shell`. The third caller is the participant's panel; the badge has three callers today.
- **(B)** Lift only the moderator + audience copies; leave the participant's panel badge in place. Cost: the panel badge is structurally identical; leaving it would set up a fourth-caller-extraction registration cycle that the third-caller policy is meant to avoid. The participant tablet would carry a local component with the exact prop shape and visual contract as the shell-side canonical, which is a code-smell that future reviewers would surface as debt.
- **(C)** Defer the participant panel badge's consolidation to a future "panel badge lift" leaf. Cost: planning-debt for no architectural reason; the participant panel badge already converges with the moderator + audience visual contract (same prop shape, same memoization, same `axiomMarkColorFor` chromatic, same `methodology.axiomMark.srLabel` aria-label). Deferring would create a follow-up named-future-task with zero discovery work left.

Chosen: (A). The third-caller policy fires across all three; the WBS description's "moderator+audience" phrasing is a description of where the canonical chromatic badge currently lives (the participant's graph view uses a boolean overlay, not a per-participant badge), but the participant detail panel — a different surface within the same workspace — IS the third badge caller. The source-of-debt refinement's parenthetical ("and the participant tablet's future panel consumer") confirms the intent.

### §4 — Root re-export from `@a-conversa/shell`, not a subpath export

The shell's `packages/shell/src/index.ts` is the canonical re-export hub; every prior shell extraction (`shell_substrate_extraction`'s auth / screen-name / login-logout / i18n / WS / error-mapper; `extract_facet_pill`'s `<FacetPill>` + palette) re-exports from the root and consumers import from `@a-conversa/shell` directly. Two options:

- **(A — chosen)** Re-export `AxiomMark`, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`, `groupAxiomMarksByNode`, and `AxiomMarkBadge` from `packages/shell/src/index.ts`. Consumers import via `import { projectAxiomMarks, AxiomMarkBadge } from '@a-conversa/shell'`.
- **(B)** Add a subpath export entry `"./axiom-marks"` to `packages/shell/package.json`'s `exports` map; consumers import via `from '@a-conversa/shell/axiom-marks'`. Cost: introduces a manifest-maintenance edge that no prior shell extraction needed; the consumer's import path becomes verbose for no offsetting benefit (tree-shaking is bundler-level work on the consumer side and doesn't require subpath exports for the consumer to drop unused symbols).

Chosen: (A). Honors the convention every prior shell extraction established; keeps the consumer import path uniform across all shell-provided symbols. The single line in `packages/shell/src/index.ts` is the canonical wiring step.

### §5 — Participant `axiomMarks.ts` collapses to a re-export shim (not deleted; `nodeHasAxiomMark` is not scattered elsewhere)

The participant's `axiomMarks.ts` carries five symbols today: the four canonical projection names (which lift to the shell) plus the participant-local `nodeHasAxiomMark` helper. Three options for what happens to the file:

- **(A — chosen)** Collapse to a re-export shim: the file re-exports the four lifted names from `@a-conversa/shell` and continues to define `nodeHasAxiomMark` locally. Existing imports across the participant workspace (e.g. `import { AxiomMark, nodeHasAxiomMark } from './axiomMarks.js'`) continue to resolve through the shim without rewiring.
- **(B)** Delete the file; move `nodeHasAxiomMark` next to its single call site (e.g. inline into `projectGraph.ts` or into a new sibling file). Cost: every call site that currently imports from `axiomMarks.ts` needs rewriting; the helper's test file (`apps/participant/src/graph/axiomMarks.test.ts`) needs relocation or merging into a sibling test file; the cleanup is mechanical but its blast radius (file moves, import-path churn) is larger than the shim option's zero churn outside the lifted-block deletion.
- **(C)** Delete the file; rewrite every participant-side caller to import the four lifted names from `@a-conversa/shell` directly; collapse `nodeHasAxiomMark` to an inline boolean check at its single call site. Cost: drops the helper entirely (option (C) of Decision §1, applied at the same time); broader import-path rewrite than necessary.

Chosen: (A). Preserves the participant's existing import paths inside the workspace; keeps `nodeHasAxiomMark` colocated with the axiom-mark vocabulary it depends on; minimizes the diff blast radius. The shim is two lines (`export { ... } from '@a-conversa/shell';` plus the existing `nodeHasAxiomMark` definition); no future reader is misled because the file's purpose remains "participant-local axiom-mark utilities, sourced from shell where canonical".

This is also the pattern the participant's predecessor refinements established for similar inline-then-shim transitions; consistency with the participant's conventions reduces review friction.

### §6 — No new Playwright / Cucumber coverage (Vitest + existing integration tests are sufficient)

Three observations frame this:

1. This task is a pure file-location refactor. No user-visible behavior changes; no protocol seam crossed; no projector output shifts. The three client-tier integration test suites that exercise the badges and projection helpers continue passing against the lifted symbols — that is the structural regression pin for the import-path rewire.
2. The task lives under `shell_package.*`, not under any of the UI-stream groups (`moderator_ui.*`, `participant_ui.*`, `audience.*`, `replay_test.*`) that the orchestrator brief's UI-stream e2e policy applies to. The shell-package extraction does not change reachability for any surface; no new route lights up, no new event surface fires.
3. The cross-surface Cucumber rule applies to wire / broadcast / projector changes observable at the system seam. None apply here.

Three options:

- **(A — chosen)** Vitest at the canonical home (`packages/shell/src/axiom-marks/**`) plus the existing client-tier integration tests continuing to pass. No new Playwright. No new Cucumber.
- **(B)** Scope a Playwright spec that renders the moderator / audience badge in the browser to pin the visual contract post-lift. Cost: redundant with the predecessor refinements' own Playwright + visual-regression deferrals (`aud_visual_regression` already covers the audience badge; the moderator's predecessor task pinned its own pixel-stability). The lift does not change the badge's visual contract; the existing client-tier pixel pins are sufficient.
- **(C)** Scope a Cucumber scenario for the projection logic. Cost: Cucumber is the wire/broadcast seam pin per ADR 0021 + ADR 0030; `projectAxiomMarks` is an internal client-side projector consumed by graph-renderers, not a wire / broadcast surface. Vitest is the architecturally-correct pin here.

Chosen: (A). The Vitest layer is already at full coverage from the three predecessor suites' union; consolidating it at the shell home preserves coverage and centralizes future-maintenance work. The client-tier integration tests continuing to pass post-rewire is the structural regression pin; no new e2e scope is owed.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-28.

- Lifted `AxiomMark` interface, `EMPTY_AXIOM_MARKS`, `projectAxiomMarks`, and `groupAxiomMarksByNode` from three client workspaces into `packages/shell/src/axiom-marks/axiom-marks.ts`.
- Added canonical `<AxiomMarkBadge>` component at `packages/shell/src/axiom-marks/AxiomMarkBadge.tsx` (props `{ readonly mark: AxiomMark }`, memoized default export, intra-package import of `axiomMarkColorFor` from `../facet-pill/participant-color.js`).
- Created barrel `packages/shell/src/axiom-marks/index.ts`; re-exported all five public symbols from `packages/shell/src/index.ts`.
- Consolidated projection coverage into `packages/shell/src/axiom-marks/axiom-marks.test.ts` (7 cases) and badge coverage into `packages/shell/src/axiom-marks/AxiomMarkBadge.test.tsx` (13 cases: 9 localized + 2 data-attribute + 2 chromatic).
- Deleted client-local copies: `apps/moderator/src/graph/AxiomMarkBadge.{tsx,test.tsx}`, `apps/audience/src/graph/axiomMarks.{ts,test.ts}`, `apps/audience/src/graph/AxiomMarkBadge.{tsx,test.tsx}`.
- Rewired consumers to `@a-conversa/shell`: `apps/moderator/src/graph/GraphCanvasPane.tsx`, `apps/moderator/src/graph/StatementNode.tsx`, `apps/audience/src/graph/projectGraph.ts`, `apps/audience/src/graph/AxiomMarkOverlay.tsx`.
- Collapsed `apps/participant/src/graph/axiomMarks.ts` to re-export shim + retained participant-local `nodeHasAxiomMark`; pruned `apps/participant/src/graph/axiomMarks.test.ts` to `nodeHasAxiomMark` cases only.
- Tech-debt: `apps/participant/src/detail/AxiomMarkBadge.tsx` NOT consolidated — takes `{participantId, screenName}` (not `{mark: AxiomMark}`), uses `participant.detailPanel.axiomMarkBadge.srLabel` (not `methodology.axiomMark.srLabel`), and testid prefix `participant-detail-panel-axiom-mark-badge-`; unification requires behavior change. Registered as `shell_package.shell_axiom_mark_panel_badge_consolidation` in `tasks/27-shell-package.tji`.
