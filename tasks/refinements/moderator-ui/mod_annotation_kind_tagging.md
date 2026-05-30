# Moderator annotation-kind tagging (concern / reframe / stance picker in the annotate submenu)

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_annotation_kind_tagging` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L674-L678).

**Effort estimate**: 0.5d (per `.tji`).

**Inherited dependencies**:

- `moderator_ui.mod_annotation_ui.mod_propose_annotation_action` (settled — see the `.tji` `note` line at L672, verified by parking-lot triage 2026-05-30). Shipped [`apps/moderator/src/layout/useAnnotateAction.ts`](../../../apps/moderator/src/layout/useAnnotateAction.ts) (the per-target propose hook that fires an `annotate` envelope with a hardcoded `annotation_kind === 'note'`) + [`apps/moderator/src/layout/AnnotateSubmenu.tsx`](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx) (the sibling submenu rendering a textarea + Submit + inline error) + wiring in [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L815-L1460) (node/edge right-click → setAnnotateSubmenu → `<AnnotateSubmenu>` mounted). The hook's source-level comment at [`useAnnotateAction.ts:19-25`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L19-L25) explicitly anticipates THIS task: "A future 'annotation-kind picker' task may surface the full enum; the hook's signature already accepts the kind so that lift is a one-line submenu change." (The signature comment is forward-looking; the actual `annotate(content: string)` signature has only `content` today — see Constraints §1.)

- `moderator_ui.mod_annotation_ui.mod_render_annotations` / `mod_graph_rendering.mod_annotation_rendering` (settled — done 2026-05-11, see [refinement Status](./mod_annotation_rendering.md#status)). Shipped `AnnotationBadge.tsx` rendering each annotation's localized kind label via `t('methodology.annotationKind.<kind>')`, and the `selectAnnotations` / `groupAnnotationsBy{Node,Edge}` selectors that bucket annotations onto their target. This task's kind picker emits a wire envelope whose post-projection rendering is already covered: select `'reframe'` here → `annotation-created` event → badge renders `"Reframe"` (en-US) / `"Reenquadre"` (pt-BR) / etc.

- [ADR 0021 — Event envelope: discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the wire schema `annotateProposalSchema.annotation_kind` is the source of truth for the enum; the picker submits one of the four canonical values, the server validates as before.

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavior pinned by committed Vitest cases + the existing Playwright `methodology-full-flow.spec.ts` Phase 9.1.

- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the kind labels resolve through the existing `methodology.annotationKind.<kind>` catalog entries (en-US / pt-BR / es-419); one new key (`moderator.annotateAction.submenu.kindLegend`) lands in all three locale catalogs in the same commit.

## What this task is

Add an **annotation-kind picker** to the moderator's annotate submenu so the moderator can tag an annotation as one of the four canonical kinds — `note` / `reframe` / `scope-change` / `stance` — when proposing it, instead of the v1 hardcoded `'note'` default. Concretely:

- A new `useState<AnnotationKind>('note')` slice inside [`AnnotateSubmenu.tsx`](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx) tracks the selected kind.
- A radio-group `<fieldset>` mirroring the `<EditWordingSubmenu>` precedent at [`EditWordingSubmenu.tsx:168-219`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L168-L219) renders four `role="radio"` buttons — one per `AnnotationKind` — each carrying its localized label via `t('methodology.annotationKind.<kind>')`. The currently selected button reads `aria-checked="true"` + `data-selected="true"` so assistive tech and tests can observe the selection.
- The Submit button at [`AnnotateSubmenu.tsx:190-201`](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx#L190-L201) threads the selected kind into the hook callback: `hook.annotate(content, selectedKind)`.
- The hook signature at [`useAnnotateAction.ts:66`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L66) widens from `annotate: (content: string) => Promise<void>` to `annotate: (content: string, annotationKind: AnnotationKind) => Promise<void>`. The body at [`useAnnotateAction.ts:227`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L227) drops the hardcoded `const annotation_kind: AnnotationKind = 'note'` line and uses the parameter instead.
- One new i18n catalog key — `moderator.annotateAction.submenu.kindLegend` — for the radio-group `<legend>` text. The four kind labels reuse the existing `methodology.annotationKind.<kind>` keys (the same ones `<AnnotationBadge>` already consumes — DRY, no per-surface duplication).
- Test additions pin the new behavior: hook-level cases lock in that each of the four kinds round-trips through the envelope's `annotation_kind` field; submenu cases lock in the radio-selection → submit threading + the default `'note'` selection; the Playwright Phase 9.1 spec at [`tests/e2e/methodology-full-flow.spec.ts:1486-1497`](../../../tests/e2e/methodology-full-flow.spec.ts#L1486-L1497) gains a kind-pick step before Submit (asserting the post-projection badge renders the selected kind's localized label).

This task is **UI-only on the moderator surface** — no schema, no projector, no methodology-engine change. The wire enum `annotationKindSchema = z.enum(['note', 'reframe', 'scope-change', 'stance'])` already exists at [`packages/shared-types/src/events/enums.ts:38`](../../../packages/shared-types/src/events/enums.ts#L38) and the server validates it as before. This task simply lifts the picker from the hardcoded default into a user-controllable choice.

## Why it needs to be done

The annotation-kind enum is load-bearing methodology vocabulary — `reframe` vs `scope-change` vs `stance` vs `note` each carries distinct interpretive meaning a moderator wants to surface as they capture meta-commentary on the argument graph. The v1 default `'note'` discards that semantic information at the gesture seam: every moderator-proposed annotation lands in the event log as a generic note, regardless of whether the moderator was actually flagging a stance shift or a reframe.

The rendering side already differentiates the four kinds — `<AnnotationBadge>` renders the localized kind label and stamps a `data-annotation-kind="<kind>"` attribute on the badge. Without the picker the badge surface is forever a sea of `"Note"` pills, defeating the rendering distinction the predecessor task carefully built.

Downstream consumers that condition on `annotation_kind` need a real distribution of kinds to render meaningfully — per-kind colour theming (deferred to `packages/ui-tokens`), the per-kind facet-pill row on the annotation detail surface ([`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — see `mod_annotation_rendering`'s Decision §5 + the participant annotation-detail refinement at [`tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md`](../participant-ui/part_entity_detail_panel_annotation_view.md)), and the upcoming `mod_render_annotation_endpoint_edges` (which uses the kind to pick the annotation graph-node glyph) all assume the wire data has a meaningful kind. Closing this picker is the bridge from "every annotation is a note" to a populated enum the rest of the methodology UI can read.

## Inputs / context

### Live code the task touches

- [`apps/moderator/src/layout/useAnnotateAction.ts:66`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L66) — the `UseAnnotateActionResult.annotate` callback signature widens from `(content: string)` to `(content: string, annotationKind: AnnotationKind)`.
- [`apps/moderator/src/layout/useAnnotateAction.ts:180`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L180) — the `async function annotate(content: string)` signature mirrors the result-type lift.
- [`apps/moderator/src/layout/useAnnotateAction.ts:224-227`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L224-L227) — the `const annotation_kind: AnnotationKind = 'note';` line is removed; the propose envelope at [L228-L238](../../../apps/moderator/src/layout/useAnnotateAction.ts#L228-L238) reads the parameter instead.
- [`apps/moderator/src/layout/useAnnotateAction.ts:19-25`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L19-L25) — the source-level "v1 annotation_kind = 'note'" comment block updates to describe the picker-driven lift.
- [`apps/moderator/src/layout/AnnotateSubmenu.tsx:101-217`](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx#L101-L217) — the submenu component gains a `useState<AnnotationKind>('note')` slice + a radio-group fieldset rendered between the textarea (currently at [L178-L188](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx#L178-L188)) and the Submit row (currently at [L189-L202](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx#L189-L202)). The `handleSubmit` callback at [L140-L154](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx#L140-L154) threads the selected kind into the hook call.
- [`apps/moderator/src/layout/useAnnotateAction.test.tsx`](../../../apps/moderator/src/layout/useAnnotateAction.test.tsx) — existing 10 cases (per the file header) get their `annotate('content')` call sites updated to `annotate('content', 'note')` (preserves the historical default for migration delta); 3 new cases assert each of `'reframe'` / `'scope-change'` / `'stance'` round-trip through the envelope's `annotation_kind` field intact.
- [`apps/moderator/src/layout/AnnotateSubmenu.test.tsx`](../../../apps/moderator/src/layout/AnnotateSubmenu.test.tsx) (assumed-existing; if absent, this task creates it) — new cases covering default-selection / radio-click / submit-threading. If the file doesn't exist today, the implementer creates it co-located with the source file.
- [`packages/i18n-catalogs/src/catalogs/en-US.json:343-358`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L343-L358) (+ `pt-BR.json` + `es-419.json` at the matching block) — add `moderator.annotateAction.submenu.kindLegend` key under each locale's existing `moderator.annotateAction.submenu` block.
- [`tests/e2e/methodology-full-flow.spec.ts:1486-1531`](../../../tests/e2e/methodology-full-flow.spec.ts#L1486-L1531) — Phase 9.1 (the existing annotate flow) gains one new step between submenu-visible and Submit: click a non-default kind radio (e.g. `annotate-submenu-kind-reframe`), then assert the resulting badge renders the chosen kind's localized label.

### Sibling precedent

- [`apps/moderator/src/layout/EditWordingSubmenu.tsx:168-219`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L168-L219) — the canonical kind-picker shape on the moderator surface: a `<fieldset>` with a `<legend>` (stable testid `edit-wording-submenu-edit-kind-legend`) + a `role="radiogroup"` div with one `role="radio"` button per kind value, each stamping `aria-checked` + `data-selected` + a per-kind `data-testid="edit-wording-submenu-edit-kind-<kind>"`. Each radio button shows a `<span class="font-medium">` for the label + a `<span class="text-[11px]">` for the per-kind description. This refinement mirrors the structural shape but defers the per-kind description text (see Decisions §3).

### Wire schema + enum

- [`packages/shared-types/src/events/enums.ts:38`](../../../packages/shared-types/src/events/enums.ts#L38) — `annotationKindSchema = z.enum(['note', 'reframe', 'scope-change', 'stance']);` and the derived `AnnotationKind` type. Already imported at [`useAnnotateAction.ts:44`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L44).
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `annotateProposalSchema.annotation_kind` consumes the enum verbatim; no schema edit lands here.

### i18n catalogs

- [`packages/i18n-catalogs/src/catalogs/en-US.json:92-97`](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L92-L97) — `methodology.annotationKind.{note,reframe,scope-change,stance}` already populated in all three locales. The picker reuses these keys for the radio labels rather than duplicating new `moderator.annotateAction.submenu.kindNote.label` strings (DRY — the badge component already binds against these).
- The `moderator.annotateAction.submenu` block at L343-L350 needs one new key: `"kindLegend": "Kind"` (en-US) / `"Tipo"` (pt-BR) / `"Tipo"` (es-419). A native-speaker review of the pt-BR + es-419 strings is queued for the parking lot (see closer summary) — not a WBS task.

### Sibling refinements

- [`tasks/refinements/moderator-ui/mod_annotation_rendering.md`](./mod_annotation_rendering.md) — the rendering-side counterpart; documents the `AnnotationBadge` component + the `methodology.annotationKind.<kind>` catalog binding the picker reuses.
- [`tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md`](../participant-ui/part_entity_detail_panel_annotation_view.md) — downstream consumer of populated `annotation_kind` data; the annotation detail body renders the kind in its identity section.

### Related but not gating

- [`tasks/refinements/shell-package/extract_annotation_detail_view.md`](../shell-package/extract_annotation_detail_view.md) — has a load-bearing trigger gate (Constraints "Trigger condition gate"; the body at L450-L463 + Decision §9 elsewhere in the doc) waiting on a moderator-side OR audience-side per-annotation **drill-down panel** to materialize as a second caller. **This task is NOT the qualifying drill-down.** Adding a kind picker to the propose-annotation submenu does not open or consume a per-annotation detail view; the gate stays open. The shell-extract refinement's prose at [L242-L260](../shell-package/extract_annotation_detail_view.md#L242-L260) mentions this task in passing as part of a hypothetical "click-target-surface" expansion, but the actual trigger remains the materialization of a `mod_entity_detail_panel`-shaped surface, which this task does not deliver.

## Constraints / requirements

1. **Hook signature.** `useAnnotateAction(targetId, targetKind).annotate(content, annotationKind)`. The second parameter is required (no default). The hook body passes the parameter verbatim into the propose envelope's `proposal.annotation_kind` field. No new validation — `AnnotationKind` is already a closed union; TypeScript enforces the call-site contract; the server schema enforces the wire contract.

2. **Submenu default.** Initial submenu state selects `'note'` (the predecessor's v1 default). The Submit button does NOT gate on kind selection (it stays gated only on the existing `inFlight || content.length === 0` predicate). Rationale: every annotation has a meaningful kind already selected from the moment the submenu opens, mirroring the v1 behavior where a quick-text-and-Submit gesture produced a note. See Decisions §1.

3. **Radio-group shape.** `<fieldset>` containing one `<legend data-testid="annotate-submenu-kind-legend">` and one `role="radiogroup"` div with four `role="radio"` buttons. Each button:
   - `data-testid="annotate-submenu-kind-<kind>"` (the wire-format kind name — `note` / `reframe` / `scope-change` / `stance`).
   - `aria-checked={selectedKind === '<kind>'}` and `data-selected="<true|false>"`.
   - `disabled={hook.inFlight}` so the moderator can't change kind mid-submit.
   - Inner `<span>` showing `t('methodology.annotationKind.<kind>')` (the existing catalog binding).
   - `onClick` setting the submenu's `selectedKind` state.

4. **Submit threading.** `handleSubmit` passes the selected kind: `void hook.annotate(content, selectedKind).then(...)`. Identical close-on-success / stay-open-on-failure semantics; the only behavior change is the kind parameter.

5. **Source-level comment refresh.** The block at [`useAnnotateAction.ts:19-25`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L19-L25) updates from "v1 annotation_kind = 'note'" + the forward-plan paragraph to a single sentence describing the picker-driven flow + a back-reference to this refinement file. (One paragraph max; no historical narrative inside the source.)

6. **i18n catalog edits.** All three locales (`en-US.json`, `pt-BR.json`, `es-419.json`) gain `moderator.annotateAction.submenu.kindLegend` under their existing `moderator.annotateAction.submenu` block. No other i18n changes.

7. **No new dependencies.** No package adds. No new shared-types fields. No new ADRs (the wire enum already exists per ADR 0021).

8. **TypeScript strict + ESLint.** The widened hook signature, the new submenu state slice, and the catalog edits compile clean under the existing strict config (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`). The flat ESLint config already covers `apps/moderator/src/**/*.{ts,tsx}` and `packages/i18n-catalogs/**`.

9. **Existing Cucumber features unchanged.** The wire envelope shape is unchanged — `propose` + `proposal.kind: 'annotate'` + `proposal.annotation_kind: <enum>` — so the methodology-engine + projector + replay coverage is unaffected. No Cucumber edits land.

10. **Test count delta.** Vitest baseline rises by ~7 cases (3 new hook envelope cases + 4 new submenu cases — see Acceptance criteria for the exact list). Playwright Phase 9.1 gains one new in-spec assertion (the kind-pick step) but stays a single test case — no new spec file.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/moderator/src/layout/useAnnotateAction.ts`: `UseAnnotateActionResult.annotate` signature is `(content: string, annotationKind: AnnotationKind) => Promise<void>`. The function body at L180+ accepts the second parameter, the hardcoded `const annotation_kind: AnnotationKind = 'note';` line at L227 is removed, and the propose envelope at L228-L238 reads the parameter into `proposal.annotation_kind`.
- [ ] `apps/moderator/src/layout/AnnotateSubmenu.tsx`: `useState<AnnotationKind>('note')` slice tracks the selection. A `<fieldset>` with `<legend data-testid="annotate-submenu-kind-legend">` and a `role="radiogroup"` div renders four `role="radio"` buttons stamping `data-testid="annotate-submenu-kind-<kind>"` + `aria-checked` + `data-selected`. `handleSubmit` calls `hook.annotate(content, selectedKind)`.
- [ ] `apps/moderator/src/layout/useAnnotateAction.ts` header block (L19-L25) updates to describe the picker-driven kind selection (one-paragraph replacement).
- [ ] `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`: each gains `moderator.annotateAction.submenu.kindLegend` under its existing `moderator.annotateAction.submenu` block. No other catalog edits.

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/moderator/src/layout/useAnnotateAction.test.tsx`: existing 10 cases get their `annotate('...')` calls updated to `annotate('...', 'note')` (preserves the v1 envelope assertion). Three new cases land — one per non-`note` kind — each asserting the envelope's `proposal.annotation_kind` matches the parameter (`'reframe'`, `'scope-change'`, `'stance'`). Total file delta: `+3` cases.
- [ ] `apps/moderator/src/layout/AnnotateSubmenu.test.tsx`: four new cases land —
  1. Initial render: `[data-testid="annotate-submenu-kind-note"]` carries `aria-checked="true"`; the other three carry `aria-checked="false"`.
  2. Click `[data-testid="annotate-submenu-kind-reframe"]`: it now carries `aria-checked="true"`; the previous selection no longer does.
  3. After typing content + clicking a non-default kind + Submit: the injected `hookOverride.annotate` is called once with `(content, 'reframe')` (use the existing `hookOverride` test seam at [L98](../../../apps/moderator/src/layout/AnnotateSubmenu.tsx#L98)).
  4. Each of the four radios renders the matching `methodology.annotationKind.<kind>` catalog string for the active locale (parameterized — 4 sub-assertions inside one case, or 4 separate cases; the implementer picks).

   If `AnnotateSubmenu.test.tsx` doesn't exist today, the implementer creates it co-located alongside the source file. Total file delta: `+4` cases (new file).

**Playwright coverage** — the surface is reachable (no deferral)

- [ ] `tests/e2e/methodology-full-flow.spec.ts` Phase 9.1 (the existing `alice proposes an annotation on N1` test at L1486-L1531) gains one new step between the submenu becoming visible and the Submit click: `await alicePage.getByTestId('annotate-submenu-kind-reframe').click();` plus an `await expect(alicePage.getByTestId('annotate-submenu-kind-reframe')).toHaveAttribute('aria-checked', 'true');`. After the proposal commits, the resulting `<AnnotationBadge>` is asserted to carry `data-annotation-kind="reframe"` (the existing badge testid + attribute pin, per `mod_annotation_rendering`'s shipped surface).

  Rationale: the annotate flow is already in the suite; extending the existing step is cheaper and more honest than adding a parallel test, and the assertion exercises the full path picker → envelope → projector → badge.

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green (Vitest test count rises by `+7` cases).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L674-L678.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_annotation_kind_tagging` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_annotation_kind_tagging.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion (per [tasks/refinements/README.md](../README.md) ritual), listing the produced source / test / catalog deltas and the smoke / build / `tj3` results.

## Decisions

### §1. Default selected kind is `'note'`, not "no selection required".

The strongest alternative is the EditWording precedent — start with no kind selected and gate Submit on kind selection (mirroring [`EditWordingSubmenu.tsx:112`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L112)'s `useState<EditWordingKind | null>(null)` + the `canSubmit` predicate at [L136](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L136)). **Rejected** because:

- v1 already shipped `'note'` as the implicit default — every annotation in the event log today carries `annotation_kind: 'note'`. A no-default picker would mean a moderator-facing regression: the "right-click → Annotate → type → Submit" gesture that worked yesterday now requires an extra click.
- `'note'` is the documented "most generic kind" per the source comment at [`useAnnotateAction.ts:21`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L21). It's the "default of last resort" interpretation — semantic-information-loss is contained to "the moderator didn't pick a more specific kind", which is the same situation we have today.
- The EditWording precedent is asymmetric: `reword` and `restructure` have meaningfully different downstream semantics (reword preserves the node id; restructure creates a successor node — see the kind-card descriptions at [`EditWordingSubmenu.tsx:194`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L194) and [L215](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L215)). Annotation kinds are interpretive-flavor distinctions on a single wire-event shape, not divergent projector behaviors — so forcing the moderator to actively pick is friction without a downstream payoff.

The cost of this choice: a moderator who wanted (e.g.) `'reframe'` but submitted without changing the radio gets `'note'` instead, with no warning. Mitigation: the radio group is visually salient — full-width, four buttons, between the textarea and Submit — so missing it requires actively ignoring it.

### §2. Radio-group fieldset, not `<select>` dropdown.

Four options, all with short labels, in a submenu that already has ~18rem horizontal width. A radio group:

- Shows all four kinds at a glance — discoverability is high, the moderator doesn't have to open a menu to see the inventory.
- Mirrors the EditWording precedent on the moderator surface — visual + interaction consistency across the two "propose a methodology-event with a kind" submenus.
- Plays cleanly with assistive tech (`<fieldset>` + `<legend>` is the canonical pattern).

A `<select>` would save vertical space but trade discoverability for compactness; given annotation-kind selection is the *whole point* of this submenu lift, hiding the inventory behind a dropdown is counter-productive.

### §3. No per-kind description text (single-line labels only).

The EditWording precedent renders both a label and a small description span per kind ([`EditWordingSubmenu.tsx:193-195`](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L193-L195) + [L214-L216](../../../apps/moderator/src/layout/EditWordingSubmenu.tsx#L214-L216)). For annotation kinds, **rejected** because:

- Four kinds × three locales × per-kind description = 12 new strings, vs. zero new strings if we reuse `methodology.annotationKind.<kind>` (which already populates badges across the same surface).
- The kind labels (`Note` / `Reframe` / `Scope change` / `Stance`) are individually meaningful to the moderator audience — they're methodology vocabulary, not bare wire tokens. (EditWording's `reword` / `restructure` are also methodology vocabulary, but their downstream behavior diverges enough that the description is genuinely informative; annotation kinds don't.)
- The submenu is already visually busy (textarea + radio fieldset + Submit + error region). A second line per radio button would push the submit row noticeably below the viewport on smaller screens.

A future "annotation-kind tooltip" task can add hover descriptions cheaply (the `data-annotation-kind` attribute on each radio is the seam) if moderator feedback shows the bare label isn't enough.

### §4. Reuse `methodology.annotationKind.<kind>` i18n keys; one new `submenu.kindLegend` key.

The badge component already binds against `methodology.annotationKind.<kind>` for each of the four labels — DRY. The single new key (`moderator.annotateAction.submenu.kindLegend`) is the fieldset's group-name; it lives under the existing `moderator.annotateAction.submenu` namespace alongside `header` / `placeholder` / `submit`. No risk of i18n key drift between badge and picker because they read the same source.

### §5. Hook signature widens (required parameter), not a defaulted parameter.

The hook's `annotate` callback adds `annotationKind: AnnotationKind` as a **required** second argument. The alternative — `annotationKind: AnnotationKind = 'note'` — would preserve drop-in source compatibility for any other call site. **Rejected** because:

- The only call site is `AnnotateSubmenu.tsx`; there is no other consumer to keep compatible (verified by grepping the moderator workspace for `useAnnotateAction(` / `.annotate(`).
- A default-valued parameter would silently mask future call sites that omit the kind, re-introducing the v1 "everything is a note" bug at a different layer.
- The TypeScript compiler is the right enforcement seam — if a future surface (audience? participant?) reaches `useAnnotateAction`, the type-checker forces them to pick a kind.

### §6. No new ADR.

This refinement settles only UI-level choices (default selection, picker shape, label reuse). The wire enum predates this task and is already governed by ADR 0021. The i18n integration is already governed by ADR 0024. No new dependency lands, no new architectural seam opens, no security trade-off is touched. ADR creation would be ceremony without content.

### §7. e2e is in scope (no deferral).

The annotate flow is reachable today — the existing Playwright `methodology-full-flow.spec.ts` Phase 9.1 already drives it end-to-end. Extending the existing test with a kind-pick step + a post-projection badge attribute assertion is one targeted change inside an already-running spec — strictly cheaper than deferring to a future `mod_pw_*` catch-all. (Per the deferred-e2e debt-watch guidance: there is no current annotation-flow `mod_pw_*` task accumulating debt; the in-spec extension is the right placement.)

### §8. Source-comment block contracts, not expands.

The current comment block at [`useAnnotateAction.ts:19-25`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L19-L25) documents the v1 default + the forward-plan for the picker. Once the picker ships, the block becomes a historical artifact. The replacement is a single short paragraph (one or two lines) noting that `annotation_kind` is supplied by the call site (the submenu's radio selection), with the type-level enforcement carried by `AnnotationKind`. The historical narrative goes to git history + this refinement; no need to bloat the source file.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-30.

- `apps/moderator/src/layout/useAnnotateAction.ts` — widened `UseAnnotateActionResult.annotate` to `(content: string, annotationKind: AnnotationKind) => Promise<void>`; removed hardcoded `const annotation_kind: AnnotationKind = 'note'`; updated source comment block (L19-L25) to describe picker-driven flow.
- `apps/moderator/src/layout/AnnotateSubmenu.tsx` — added `useState<AnnotationKind>('note')`; rendered `<fieldset>` + `role="radiogroup"` with 4 `role="radio"` buttons stamping `data-testid="annotate-submenu-kind-<kind>"` / `aria-checked` / `data-selected`; threaded `selectedKind` into `handleSubmit`.
- `apps/moderator/src/layout/useAnnotateAction.test.tsx` — all existing `annotate(...)` call sites updated to pass `'note'` as 2nd arg; 3 new envelope round-trip cases for `'reframe'` / `'scope-change'` / `'stance'`.
- `apps/moderator/src/layout/AnnotateSubmenu.test.tsx` (new file) — 4 new cases: default selection, click-flip, submit threading, catalog-label binding incl. legend.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — added `moderator.annotateAction.submenu.kindLegend`.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — added `moderator.annotateAction.submenu.kindLegend`; keyed for native-speaker review.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — added `moderator.annotateAction.submenu.kindLegend`; keyed for native-speaker review.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` + `es-419.review.json` — queued `kindLegend` for native-speaker sign-off.
- `tests/e2e/methodology-full-flow.spec.ts` — Phase 9.1 picks the `reframe` radio + asserts `aria-checked`; Phase 9.2 post-commit asserts `data-annotation-kind="reframe"` on the resulting badge.
- Native-speaker review of pt-BR / es-419 `kindLegend` strings logged in `tasks/parking-lot.md` (human judgment call; no WBS task).
