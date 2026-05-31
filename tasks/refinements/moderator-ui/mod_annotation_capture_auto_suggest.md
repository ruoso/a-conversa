# Widen capture-target auto-suggest to surface annotation nodes

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_annotation_capture_auto_suggest` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L751-L764). Embedded note: *"Source of debt: mod_propose_annotation_endpoint_gestures (2026-05-31) — auto-suggest stays node-scoped per Decision §5 of that task. A follow-up widens selectMostRecentlyActiveNodeId (or adds a sibling selector) so the auto-suggest considers the most-recently-active entity (node or annotation) when an annotation node is the last canvas click. Deferred because annotation-staging is rarer than node-staging and the explicit-stage path is honest about user intent; widen if walkthrough usage shows annotation-staging is common."*

## Effort estimate

**0.5d** (per the `.tji` allocation). Roughly:

- **Selector widening** (~0.1d). Widen [`selectMostRecentlyActiveNodeId` at `recentlyActiveNode.ts:31-35`](../../../apps/moderator/src/stores/recentlyActiveNode.ts#L31-L35) into a kind-aware `selectMostRecentlyActiveEntity(state): { kind: 'node' | 'annotation'; id: string } | null` (Decision §1). Edge selections continue to return `null`. Keep the file path; rename the export; update the only two callers (the chip and the test).
- **Chip effect unification** (~0.2d). Collapse the two separate effects in [`CaptureTargetChip.tsx:180-213` (node auto-suggest)](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L180-L213) and [`L234-L247` (annotation-staging bridge)](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L234-L247) into a single auto-suggest effect that consumes the widened selector. All four Case 0/1/2/3 semantics (re-engage after clear, no-stomp override, re-stage on selection change) extend to annotations. The bridge effect's `lastAnnotationStagedRef` folds into a single `lastAutoStagedRef` that tracks `{ kind, id } | null` (Decision §2).
- **Capture-store writer** (~0.05d). The auto-suggest path now writes via `setTargetEntity(kind, id)` instead of `setTargetEntityId(id)`. The legacy `setTargetEntityId` setter at [`captureStore.ts:548`](../../../apps/moderator/src/stores/captureStore.ts#L548) is preserved (other callers — keyboard handlers, test helpers — keep their contract; per Decision §3) but is no longer the auto-suggest writer.
- **Vitest cover** (~0.15d). Extend [`recentlyActiveNode.test.ts`](../../../apps/moderator/src/stores/recentlyActiveNode.test.ts) with annotation + edge cases; extend [`CaptureTargetChip.test.tsx`](../../../apps/moderator/src/layout/CaptureTargetChip.test.tsx) with the four-case matrix repeated for annotation selections (Case 1 stage-when-empty, Case 2 re-stage-on-active-change, Case 3 no-stomp-after-override, Case 0 re-engage-after-clear) plus the cross-kind transition cases (node→annotation, annotation→node) that the unified effect now spans.

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_annotation_ui.mod_propose_annotation_endpoint_gestures`](./mod_propose_annotation_endpoint_gestures.md) (done — 2026-05-31). Shipped the `targetEntityKind: 'node' | 'annotation'` slice on `useCaptureStore` (per [`captureStore.ts:530`](../../../apps/moderator/src/stores/captureStore.ts#L530), default `'node'`), the atomic `setTargetEntity(kind, id)` setter ([`captureStore.ts:549-550`](../../../apps/moderator/src/stores/captureStore.ts#L549-L550)), kind-aware selection wiring (`handleNodeClick` / `handleNodeContextMenu` dispatch `select({ kind: 'annotation', id })` on annotation-node clicks), the kind-branched chip wording lookup ([`CaptureTargetChip.tsx:256-261`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L256-L261), `selectAnnotationContentById` vs `selectNodeWordingById`), and the explicit-stage bridge effect ([`CaptureTargetChip.tsx:234-247`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L234-L247)) that this task supersedes.

- [`moderator_ui.mod_capture_flow.mod_target_auto_suggest`](./mod_target_auto_suggest.md) (done). Established the four-case auto-stage contract (Case 0 re-engage; Case 1 stage-when-empty; Case 2 re-stage-on-active-change; Case 3 do-not-stomp). The contract is repeated for annotations in this task — the file's existing case comments stay authoritative for the semantics; only the discriminator widens.

- [ADR 0006 — Vitest](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0011 — ESLint flat](../../../docs/adr/0011-eslint.md), [ADR 0013 — TypeScript strict](../../../docs/adr/0013-typescript-strict.md), [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md).

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

The capture-target auto-suggest currently has split behavior across two `useEffect`s in `<CaptureTargetChip>`:

1. The node auto-suggest effect at `CaptureTargetChip.tsx:180-213` runs the four-case contract (re-engage / stage-empty / re-stage-on-change / no-stomp-override) but only against `recentlyActiveNodeId` — the node-scoped selector `selectMostRecentlyActiveNodeId` that filters out annotation selections (per its L31-L35 guard `if (state.selected.kind !== 'node') return null`).

2. The annotation-staging bridge effect at `CaptureTargetChip.tsx:234-247` runs a one-shot stage when the moderator's selection is an annotation (Decision §4 of the predecessor): write via `setTargetEntity('annotation', id)`, track a separate `lastAnnotationStagedRef`. It honors a deliberate clear (don't re-fire on the same id) but does NOT participate in Case 2 (re-stage-on-active-change) — switching from annotation A1 to annotation A2 when neither has been cleared and A1 is the staged target relies on the bridge re-firing rather than the unified semantics.

This task collapses the two effects into one auto-suggest path keyed on a kind-aware selector. The four-case contract now spans both kinds, so:

- Clicking annotation A1 → Case 1 stages A1 with `kind: 'annotation'`.
- Clicking annotation A2 (no clear in between) → Case 2 re-stages A2 (the bridge already does this — but now via the same Case-2 code path as nodes).
- The moderator overrides by clicking a statement node N3 → Case 3 holds the override; subsequent annotation clicks do not stomp it.
- Clear (× button / Esc) bumps `userHasClearedRef`; subsequent annotation selection reads Case 0 and re-engages only when the selection-id differs from the just-cleared annotation id.

Out of scope:

- **Edge selections do not auto-stage.** Capture-target staging only makes sense for source/target endpoints (nodes or annotations); edges are not valid capture targets. The widened selector returns `null` for edge selections, preserving the existing exclusion.
- **No new ADR.** The seams (kind-discriminated `Selection`, the `targetEntityKind` slice, the atomic `setTargetEntity` setter) all landed in the predecessor. This task is a pure widening along those seams.
- **No schema, projection, validator, or methodology-engine change.**

## Why it needs to be done

**The predecessor explicitly registered this as deferred work** (Decision §5 of `mod_propose_annotation_endpoint_gestures.md`). The deferral reasoning was: annotation-staging is rarer than node-staging, and the explicit-stage path (bridge effect) is honest about user intent. The decision was: "widen if walkthrough usage shows annotation-staging is common."

**The bridge effect has subtly different semantics from the auto-suggest effect.** The asymmetry is observable: an annotation override does not survive subsequent annotation selections in the same way a node override survives subsequent node selections, because the bridge effect's re-engagement logic is a strict id-diff against `lastAnnotationStagedRef` rather than the auto-suggest's "previously-auto-staged vs override" branch. Two separate refs encoding the same idea is the kind of split that the unified four-case contract was written to avoid. Unifying removes the split.

**The chip's `overrideActive` marker is already cross-kind.** The marker at [`CaptureTargetChip.tsx:269-276`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L269-L276) compares `stagedTargetId` against `recentlyActiveNodeId` — when an annotation is staged, that comparison degenerates because `recentlyActiveNodeId` is `null` (the selection isn't a node), so the marker reads "no override" even when the staged annotation has been deliberately preserved across a subsequent node click. Widening the selector fixes the marker as a side effect: the override comparison becomes `stagedTargetKind/id` vs `selectMostRecentlyActiveEntity()` and lights up correctly across kinds.

**No participant / audience analogue is needed.** Those surfaces are read-only — they don't have a capture-pane or a target slice. Confirmed by the absence of `selectMostRecentlyActiveNodeId` consumers outside `apps/moderator/src`.

## Inputs / context

### The selector to widen

- [`apps/moderator/src/stores/recentlyActiveNode.ts:31-35`](../../../apps/moderator/src/stores/recentlyActiveNode.ts#L31-L35) — `selectMostRecentlyActiveNodeId`: returns `state.selected.id` only when `state.selected.kind === 'node'`. Widens to a kind-aware variant per Decision §1. The file's header comment names future capture-flow consumers (`mod_decompose_flow`, `mod_capture_defeater`, `mod_axiom_mark_flow`) — none of those have landed callers today (per grep — only the chip and its tests consume the selector), so a rename + widening costs nothing for forward consumers.
- [`apps/moderator/src/stores/recentlyActiveNode.test.ts`](../../../apps/moderator/src/stores/recentlyActiveNode.test.ts) — pinned cases for null / node-selection / edge-selection / annotation-selection. Extends with the widened semantics (annotation selections now return `{kind: 'annotation', id}`; edges still return `null`).

### The chip's two effects to unify

- [`apps/moderator/src/layout/CaptureTargetChip.tsx:130`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L130) — `recentlyActiveNodeId = useSelectionStore(selectMostRecentlyActiveNodeId)`. Becomes `recentlyActiveEntity = useSelectionStore(selectMostRecentlyActiveEntity)`.
- [`CaptureTargetChip.tsx:138`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L138) — `lastAutoStagedRef: useRef<string | null>(null)`. Becomes `useRef<{ kind: 'node' | 'annotation'; id: string } | null>(null)` per Decision §2.
- [`CaptureTargetChip.tsx:180-213`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L180-L213) — the node auto-suggest effect. Reworks to read `recentlyActiveEntity`, write via `setTargetEntity(kind, id)`, and compare `lastAutoStagedRef.current?.id` for the case-discrimination predicates.
- [`CaptureTargetChip.tsx:221`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L221) — `lastAnnotationStagedRef`. Deleted; folded into the unified `lastAutoStagedRef`.
- [`CaptureTargetChip.tsx:234-247`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L234-L247) — the annotation-staging bridge effect. Deleted; its semantics fold into the unified auto-suggest effect.
- [`CaptureTargetChip.tsx:148-160`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L148-L160) — `handleClear` already nulls the slice via `setTargetEntityId(null)`. Stays as-is — `setTargetEntityId(null)` sets `targetEntityId: null, targetEntityKind: 'node'` per [`captureStore.ts:548`](../../../apps/moderator/src/stores/captureStore.ts#L548); the cleared state's `targetEntityKind` defaulting back to `'node'` is correct (a cleared target has no kind).
- [`CaptureTargetChip.tsx:269-276`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L269-L276) — `overrideActive` marker. Updates to compare against the kind-aware recently-active entity per Decision §4.

### The capture-store contract this task respects

- [`apps/moderator/src/stores/captureStore.ts:530`](../../../apps/moderator/src/stores/captureStore.ts#L530) — `targetEntityKind: 'node'` default. Unchanged.
- [`captureStore.ts:548-550`](../../../apps/moderator/src/stores/captureStore.ts#L548-L550) — `setTargetEntityId(id)` (legacy, forces `kind: 'node'`) + `setTargetEntity(kind, id)` (atomic). The unified auto-suggest writes via `setTargetEntity`; `setTargetEntityId` stays for other callers (keyboard handlers, test helpers, future programmatic node-stage paths).
- [`captureStore.ts:556-573` etc.](../../../apps/moderator/src/stores/captureStore.ts) — the four mode-entry/reset sites that restore `targetEntityKind: 'node'`. Unchanged.

### The selection store

- [`apps/moderator/src/stores/selectionStore.ts:15-25`](../../../apps/moderator/src/stores/selectionStore.ts#L15-L25) — `Selection { kind: EntityKind; id: string }` where `EntityKind` is `'node' | 'edge' | 'annotation'`. No shape change.

### Existing test surface

- [`apps/moderator/src/layout/CaptureTargetChip.test.tsx`](../../../apps/moderator/src/layout/CaptureTargetChip.test.tsx) — the comprehensive Vitest suite for the chip. Already covers (per predecessor): empty / auto-suggested / override states, no-stomp contract, wording truncation and id fallback, annotation staging via click, clear semantics. Extends to repeat Case-0/1/2/3 for annotation selections and to add cross-kind transition cases.
- [`tests/e2e/annotation-endpoint-gestures.spec.ts`](../../../tests/e2e/annotation-endpoint-gestures.spec.ts) — the predecessor's Playwright spec drives the "click annotation → chip shows staged annotation" behavior via the bridge effect. After this task it'll drive the same behavior via the unified auto-suggest path — the spec keeps passing with no rewrite (per Decision §5).

### Sibling precedent

- [`tasks/refinements/moderator-ui/mod_target_auto_suggest.md`](./mod_target_auto_suggest.md) — the original auto-suggest refinement (Cases 0/1/2/3). The contract this task extends across kinds.
- [`tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md`](./mod_propose_annotation_endpoint_gestures.md) — Decisions §4 (explicit-bridge path) and §5 (auto-suggest stays node-scoped, register tech-debt). This task is the resolution of the tech-debt registration.

## Constraints / requirements

1. **The four-case contract is preserved verbatim** — Case 0 (re-engage after clear), Case 1 (stage when empty), Case 2 (re-stage when active changes and prior was auto-staged), Case 3 (do not stomp override). The widening adds kind awareness but does not change the predicates. Each case's existing in-source comment block (`CaptureTargetChip.tsx:182-184`, `194`, `200-203`, `209-212`) ports verbatim to the unified effect.

2. **Edge selections remain non-auto-staged.** The widened selector returns `null` for `state.selected.kind === 'edge'`. This preserves the existing exclusion (edges have never been valid capture-target auto-suggestions) and keeps the staged-target shape constrained to entities the proposal schema accepts as endpoints.

3. **`setTargetEntity(kind, id)` is the sole auto-suggest writer.** The legacy `setTargetEntityId(id)` setter stays for non-auto-suggest callers (its forced `targetEntityKind: 'node'` is the right contract for those callers — keyboard handlers, test seeds, etc.). The auto-suggest never calls `setTargetEntityId` because the kind it stages is selection-derived, not constant.

4. **Cross-kind transitions are first-class.** Clicking a statement node after clicking an annotation triggers Case 2 (re-stage to the node with `kind: 'node'`) when no override is active. Clicking an annotation after a statement node likewise triggers Case 2 (re-stage to the annotation with `kind: 'annotation'`). The `lastAutoStagedRef` comparison reads BOTH kind and id (so a same-id-different-kind transition is treated as a change — defensive but cheap).

5. **`userHasClearedRef` semantics extend across kinds.** A clear gesture followed by selecting a *different* entity (node or annotation, regardless of which kind was cleared) re-engages auto-suggest. Selecting the *same* entity (same kind + same id as the last-auto-staged) stays cleared. The ref carries `string | null` today (the just-cleared id); the cross-kind re-engagement read becomes `lastAutoStagedRef.current?.kind !== recentlyActiveEntity.kind || lastAutoStagedRef.current?.id !== recentlyActiveEntity.id`.

6. **No new ADR.** The selector-rename is a refactor along the existing kind-discriminator seam; no new architectural surface.

7. **No schema, projection, validator, methodology-engine, or wire change.** Pure moderator-UI internal refactor.

8. **TypeScript strict + ESLint flat config compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md), [ADR 0011](../../../docs/adr/0011-eslint.md)). The widened selector's return type is a structural `{ kind: 'node' | 'annotation'; id: string } | null` (matched against the existing `EntityKind` union narrowed to the two staging-eligible variants).

9. **i18n** ([ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)). No new strings — the chip's annotation-content wording lookup already shipped with the predecessor.

10. **Vitest discipline** ([ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Every new branch ships pinned cover. The cover doubles for the predecessor's split-effect cases and the unified-effect cases (the split-effect tests pin the *behavior*; this task keeps them passing while consolidating the *implementation* — failures here would indicate the unified rewrite changed observable behavior).

11. **Playwright cover stays as-is** ([`tests/e2e/annotation-endpoint-gestures.spec.ts`](../../../tests/e2e/annotation-endpoint-gestures.spec.ts)). The existing capture-staging scenario asserts the user-visible contract (click annotation → chip stages it with `data-target-kind="annotation"` → propose carries the annotation endpoint). That assertion holds verbatim against the unified auto-suggest. No new spec file or scenario is needed — see Decision §5.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/moderator/src/stores/recentlyActiveNode.ts`:
  - Replace `selectMostRecentlyActiveNodeId` with `selectMostRecentlyActiveEntity(state: SelectionState): { kind: 'node' | 'annotation'; id: string } | null`.
  - Returns `null` when `state.selected === null` OR `state.selected.kind === 'edge'`.
  - Returns `{ kind: 'node', id }` for node selections; `{ kind: 'annotation', id }` for annotation selections.
  - The file's header comment is updated to reflect the widened contract (annotations now count as "active"; edges still don't).
- [ ] `apps/moderator/src/stores/recentlyActiveNode.test.ts`:
  - Existing node + null + edge cases stay; the edge case asserts `null`.
  - New annotation case asserts `{ kind: 'annotation', id }`.
- [ ] `apps/moderator/src/layout/CaptureTargetChip.tsx`:
  - Replace `recentlyActiveNodeId = useSelectionStore(selectMostRecentlyActiveNodeId)` with `recentlyActiveEntity = useSelectionStore(selectMostRecentlyActiveEntity)`.
  - `lastAutoStagedRef` retypes to `useRef<{ kind: 'node' | 'annotation'; id: string } | null>(null)`.
  - Delete `lastAnnotationStagedRef` (folded into the unified ref).
  - Delete the annotation-staging bridge effect at L234-247.
  - Rewrite the auto-suggest effect at L180-213 against `recentlyActiveEntity`:
    - Case 0: `userHasClearedRef.current === true`. If `recentlyActiveEntity` differs (by kind OR id) from `lastAutoStagedRef.current`, de-bump and call `setTargetEntity(recentlyActiveEntity.kind, recentlyActiveEntity.id)`, then update `lastAutoStagedRef.current`.
    - Case 1: `stagedTargetId === null`. Call `setTargetEntity(recentlyActiveEntity.kind, recentlyActiveEntity.id)`; update `lastAutoStagedRef.current`.
    - Case 2: `stagedTargetId === lastAutoStagedRef.current?.id AND stagedTargetKind === lastAutoStagedRef.current?.kind AND (stagedTargetId !== recentlyActiveEntity.id OR stagedTargetKind !== recentlyActiveEntity.kind)`. Re-stage and update the ref.
    - Case 3: otherwise — staged target is an override; do not stomp.
  - `overrideActive` derivation at L269-276 widens: `stagedTargetId !== null && recentlyActiveEntity !== null && (stagedTargetId !== recentlyActiveEntity.id || stagedTargetKind !== recentlyActiveEntity.kind)`.
- [ ] `apps/moderator/src/layout/CaptureTargetChip.test.tsx`:
  - Existing node-side Case-0/1/2/3 cases stay passing (regression).
  - New cases for the annotation-side four-case matrix:
    - Case 1: empty state + annotation selection → chip stages with `kind: 'annotation'`.
    - Case 2: annotation A1 staged, no override, select annotation A2 → chip re-stages to A2 with `kind: 'annotation'`.
    - Case 3: annotation A1 staged then node N1 selected → if A1 was the auto-stage, Case 2 re-stages to N1; if A1 was an override (clicked after a node N0 was already auto-staged then overridden), the override survives.
    - Case 0: stage annotation A1, clear, select annotation A1 again → stays cleared; select annotation A2 → re-engages.
  - New cross-kind transition cases:
    - Empty → node N1 auto-staged → annotation A1 selected → Case 2 re-stages to A1 with `kind: 'annotation'`.
    - Empty → annotation A1 auto-staged → node N1 selected → Case 2 re-stages to N1 with `kind: 'node'`.
  - `overrideActive` marker is asserted across the new cases (only true when staged ≠ recently-active by kind OR id).

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/moderator/src/stores/recentlyActiveNode.test.ts` adds the annotation-selection case and asserts the edge case still returns `null`.
- [ ] `apps/moderator/src/layout/CaptureTargetChip.test.tsx` adds the four annotation-side Case-0/1/2/3 cases and the two cross-kind transition cases (~6 new cases).
- [ ] No new selector file or store file; the rename is mechanical and the renamed export is the only public surface change.

**Playwright coverage** — deferred to the existing predecessor spec; no new spec file

- [ ] `tests/e2e/annotation-endpoint-gestures.spec.ts` — the existing "capture-with-edge targeting an annotation" scenario continues to pass against the unified auto-suggest path. Per Decision §5: the user-visible contract (click annotation → chip stages → propose carries annotation endpoint) is unchanged; the internal-effect rewrite is invisible at the e2e layer. No new spec file or scenario is needed.

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green; Vitest case count rises by ~7 (1 selector + 6 chip).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L751-L764.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_annotation_capture_auto_suggest` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_annotation_capture_auto_suggest.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual.

## Decisions

### §1. **Widen the existing selector by renaming**, rather than adding a sibling that coexists.

The `.tji` note offered both options ("widens selectMostRecentlyActiveNodeId (or adds a sibling selector)"). The strongest alternative is **add a sibling**:

- Keep `selectMostRecentlyActiveNodeId` for node-only consumers.
- Add `selectMostRecentlyActiveEntity` for kind-aware consumers.

**Rejected** because:

- **There is exactly one consumer today** — `<CaptureTargetChip>` — and it migrates to the kind-aware variant wholesale. Keeping the node-only selector strands an export with no caller, which the next grep-and-clean pass would delete anyway.
- **The file's header comment names future capture-flow consumers** (`mod_decompose_flow`, `mod_capture_defeater`, `mod_axiom_mark_flow`). Those tasks haven't landed; when they do, they'll evaluate whether to consume the kind-aware variant or filter inline. Premature dual-export forecloses that choice without evidence.
- **The widened return type narrows cleanly with a destructure** at every call site (`const { kind, id } = recentlyActiveEntity ?? { kind: null, id: null }` or pattern-matching the null case). Today's caller already uses a `if (recentlyActiveNodeId === null) return` early-exit at L181; the widened caller writes the same shape against `recentlyActiveEntity`.
- **Filtering edges out of the selector keeps the discrimination centralized.** Putting the edge-filter at the call site would be duplicated across future consumers and easy to forget.

### §2. **Single unified auto-suggest effect**, not two parallel kind-specific effects.

The strongest alternative is to keep two effects — the existing node auto-suggest and the existing annotation bridge — but harmonize the annotation bridge's semantics with the Case-0/1/2/3 contract.

**Rejected** because:

- **The point of the contract is one consistent set of rules.** Two effects with the same rules is duplicated code that drifts; the four-case logic must be readable in one place to stay correct under future amendment.
- **The override-no-stomp predicate is cross-kind by nature** — an annotation override should survive a subsequent node selection and vice versa. Encoding that across two effects requires each to read the other's ref state, which is a brittle coupling. A unified effect with a single `lastAutoStagedRef: { kind, id } | null` carries the predicate in one branch.
- **The bridge effect's idempotent guard (L243-244) is subsumed by Case 3** — "staged target differs from previously auto-staged → do not stomp" covers "staged target equals selection but the selection didn't change" trivially. No new guard needed.

### §3. **`setTargetEntity(kind, id)` is the sole auto-suggest writer**; preserve `setTargetEntityId(id)` for legacy callers.

The strongest alternative is to delete `setTargetEntityId` entirely and replace all call sites with `setTargetEntity('node', id)` (since `setTargetEntityId` always forces `kind: 'node'`).

**Rejected** because:

- **`setTargetEntityId(null)` is the clear sink** — `handleClear` at [`CaptureTargetChip.tsx:149`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L149) calls `setTargetEntityId(null)` to null the slice + reset `targetEntityKind` to `'node'`. The setter's "null id forces default kind" contract is meaningful for the cleared state (a cleared slice has no kind in the user's mental model; the store's default is `'node'` arbitrarily). Replacing with `setTargetEntity('node', null)` would be semantically equivalent but loses the clear-sink's existing shape.
- **Test helpers and non-auto-suggest callers use it** — searching the test suite would reveal call sites that rely on the legacy signature. Preserving it costs nothing; deleting it is a wide refactor with no benefit beyond surface-area reduction.
- **The auto-suggest writer is the only path that needs both kind + id.** Other callers know their kind statically (e.g. a "stage this node by id" keyboard handler implicitly knows `kind: 'node'`). The legacy setter is the right shape for those.

### §4. **Cross-kind transitions trigger Case 2 re-stage** when no override is active.

The alternative is to treat a kind change as an override (Case 3) so the staged target persists. **Rejected** because:

- **The Case 2 contract is "the moderator moved selection; mirror their attention."** A click on a different entity IS a move of attention regardless of kind. Treating kind-changes as override-establishing would mean the moderator's first click after staging changes their override status — confusing.
- **The override establishment is a deliberate action.** An override happens when the moderator clicks the chip's × button (clear), or when an external write to the capture store (a keyboard gesture, a programmatic stage) writes a target that doesn't match `lastAutoStagedRef`. A simple selection-change should not establish override.

### §5. **No new Playwright spec**; the existing capture-staging scenario covers the user-visible contract.

The existing scenario in [`tests/e2e/annotation-endpoint-gestures.spec.ts`](../../../tests/e2e/annotation-endpoint-gestures.spec.ts) asserts the end-to-end behavior: click an annotation node → the chip shows the staged annotation with `data-target-kind="annotation"` → propose round-trips with the annotation endpoint. That assertion is the user-visible contract this task preserves.

The internal rewrite (two effects → one) is invisible at the e2e layer. Adding a new Playwright scenario for "the chip stages an annotation via auto-suggest" would re-assert the same observable behavior with no new coverage value — the only difference would be the implementation path inside the chip, which is by definition not observable through the DOM.

The new Vitest cases pin the implementation-level behaviors that ARE observable in unit tests but not in e2e: the override-no-stomp predicate across kinds, the cross-kind Case-2 re-stage, the unified `lastAutoStagedRef`. These are the right test layer for the unification.

### §6. **No tech-debt registration**; this task is the resolution.

No follow-up surfaces beyond what's already done. The selector's file header mentions future capture-flow consumers (`mod_decompose_flow`, `mod_capture_defeater`, `mod_axiom_mark_flow`) — those are pre-existing tasks in the WBS, not new debt from this task. They'll evaluate the widened selector when they land; no preemptive registration needed.

## Open questions

(none — all decided in §1–§6.)

## Status

**Done** — 2026-05-31.

- `apps/moderator/src/stores/recentlyActiveNode.ts` — renamed `selectMostRecentlyActiveNodeId` to `selectMostRecentlyActiveEntity`; return type widened to `{ kind: 'node' | 'annotation'; id: string } | null`; edge selections continue to return `null`.
- `apps/moderator/src/stores/recentlyActiveNode.test.ts` — existing node/null/edge cases preserved; new annotation-selection case asserts `{ kind: 'annotation', id }`.
- `apps/moderator/src/layout/CaptureTargetChip.tsx` — deleted the annotation-staging bridge effect and `lastAnnotationStagedRef`; unified auto-suggest effect is a kind-aware four-case (Case 0/1/2/3) implementation writing via `setTargetEntity`; `overrideActive` marker widened to compare both kind and id; Zustand v5 `useShallow` wrap added for the object-returning selector.
- `apps/moderator/src/layout/CaptureTargetChip.test.tsx` — stale "annotation override survives node selection" test replaced with manual-override variant matching new contract; added annotation Case 0/1/2/3 matrix, two cross-kind Case 2 transitions, and a cross-kind override-marker check (7 new cases, 1 rewritten).
- No new ADR, no schema/projection/methodology-engine change; pure moderator-UI internal refactor per Decision §6 (no tech-debt registration needed).
