# Lift the annotation entity-detail body into `@a-conversa/shell`

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task
`shell_package.extract_annotation_detail_view` (block at L217-238).

**Effort estimate**: 0.5d (per `.tji`)

**Inherited dependencies**:

- `participant_ui.part_graph_view.part_entity_detail_panel_annotation_view`
  (settled — 2026-05-30, see
  [refinement Status](../participant-ui/part_entity_detail_panel_annotation_view.md#status)).
  Shipped the five-section annotation-entity body — identity / content /
  author / target-link / contradicts-list — inline in the participant's
  [`apps/participant/src/detail/EntityDetailPanel.tsx:481-526`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L481-L526),
  composed from the participant-local sub-components at
  [`EntityDetailPanel.tsx:1010-1156`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1010-L1156)
  (`AnnotationIdentitySection`, `AnnotationContentSection`,
  `AnnotationAuthorSection`, `AnnotationTargetSection`,
  `AnnotationContradictsSection`) plus the two polymorphic-target resolver
  helpers at [`EntityDetailPanel.tsx:1230-1293`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1230-L1293)
  (`resolveAnnotationTarget`, `resolveEntityById`). The body reads the
  annotation's `kind` / `content` / `createdBy` / `targetNodeId` /
  `targetEdgeId` and the route-hoisted `projectedNodes` / `projectedEdges` /
  `annotations` arrays to compose the rendered surface. Decision §2 of that
  refinement explicitly registered THIS task as the future shell-lift,
  gated on a third caller materializing.

- Prose-only context: `shell_package.extract_facet_pill` (settled
  2026-05-18, see [Status](./extract_facet_pill.md#status)). Established
  the shell-extraction recipe this leaf follows: lift wholesale into a
  new `packages/shell/src/<subsystem>/` subdirectory, co-locate the
  Vitest test file, drop the source-local copy, rewire consumer
  imports atomically, grow the shell barrel by one named block. No new
  ADR. The audience-facet-rendering trigger language ("the third caller
  trigger has fired") is the canonical phrasing for the wait-condition.

- Prose-only context: `shell_package.shell_axiom_marks_extraction`
  (settled — see
  [Status](./shell_axiom_marks_extraction.md#status)). Established the
  precedent that a "drill-down" primitive (the per-entity axiom-mark
  badge) lifts into shell at its second/third caller, with a small
  participant-side panel-badge consolidation deferred to a separate
  follow-up when the prop shape diverges. The annotation-detail body
  has only ONE caller today (the participant); this refinement is the
  forward-plan for the trigger when it eventually fires.

- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — the
  existing 7 Vitest cases (`annotation-a` through `annotation-g` in
  `EntityDetailPanel.test.tsx`) plus the lookupEntity annotation-arm
  cases serve as the failing-first check during the lift.

- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — the lifted body still reaches `useTranslation()` against a shared
  catalog; the existing keys in the `participant.detailPanel.annotation.*`
  namespace migrate to a surface-neutral namespace as part of the lift
  (Decision §4).

- [ADR 0026](../../../docs/adr/0026-participant-detail-panel-no-shell-export-until-third-caller.md)
  — the deferred-until-third-caller policy this leaf discharges. The ADR
  is the framework; this refinement is the specific application to the
  annotation-detail surface.

- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md)
  — the lifted body carries entity-layer attributes only (no facet pill
  row, no per-facet vote rows). Constraint preserved verbatim through
  the lift; no new ADR amendment.

## What this task is

The single-commit **shell-extraction transition** that lifts the
participant's annotation entity-detail body — the five sections plus the
two polymorphic-target resolver helpers — out of
`apps/participant/src/detail/EntityDetailPanel.tsx` into
`packages/shell/src/annotation-detail/`, decouples the body from the
participant's selection store (replaces the in-body
`useSelectionStore.getState().select(...)` calls with an `onSelect`
callback prop per Decision §2), migrates the participant-namespaced
i18n keys to a surface-neutral namespace (Decision §4), rewires the
participant's panel to import + compose the shell-exported view, and
opens the surface for the second + third callers (a future
moderator-side per-annotation drill-down and a future audience-side
drill-down) to import the same body without re-implementing the
composition.

Concretely the deliverable is:

- **New shell subsystem** — `packages/shell/src/annotation-detail/`
  hosts the lifted code. The new subdirectory parallels
  `packages/shell/src/facet-pill/` and `packages/shell/src/axiom-marks/`
  in shape (a small set of co-located `.tsx` / `.ts` modules + a
  subsystem `index.ts` barrel re-exported from the package's
  root `index.ts`).
- **Lift the five section components + the two resolver helpers** —
  copy the bodies of `AnnotationIdentitySection`,
  `AnnotationContentSection`, `AnnotationAuthorSection`,
  `AnnotationTargetSection`, `AnnotationContradictsSection`,
  `resolveAnnotationTarget`, `resolveEntityById` from
  [`apps/participant/src/detail/EntityDetailPanel.tsx:1010-1293`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1010-L1293)
  into the new subdirectory. The five section components stay
  **internal** (not re-exported from the shell barrel); the two resolver
  helpers are exported as named functions for headless consumers that
  want the polymorphic-target resolution without the JSX
  (Decision §1 explains the API surface).
- **Compose a single public `<AnnotationDetailView>` top-level
  component** — composes the five sections in the established order
  (identity → content → author → target → contradicts). Takes all
  inputs as props (the annotation; the projection arrays; the resolved
  author screen name as a string; the localized labels as callbacks;
  the `onSelect` navigation callback). Returns a React fragment (NOT
  the `<aside>` wrapper — the wrapper stays surface-specific per
  Decision §6).
- **Decouple from the participant's selection store** — the lifted
  target-link button and contradicts-link buttons take an
  `onSelect: (selection: { kind: EntityKind, id: string }) => void`
  callback prop; the in-body `useSelectionStore.getState().select(...)`
  call sites are replaced with `props.onSelect({ kind, id })`. The
  participant's panel passes a `useSelectionStore`-bound closure as
  the callback at the call site (Decision §2 + §5).
- **Decouple from `react-i18next` resolution at the leaf level** — the
  five section components take pre-resolved label strings as props
  (the kind-prefix label; the kind label; the section headings; the
  unknown-target label; plus callback functions for the per-kind /
  per-role labels that vary by the rendered row). The top-level
  `<AnnotationDetailView>` resolves them once via `useTranslation()`
  inside the shell (Decision §3) — same surface pattern as `<FacetPill>`,
  which calls `useTranslation()` itself rather than threading
  pre-resolved labels.
- **Lift the participant-local `Annotation` re-export** — the
  participant's
  [`apps/participant/src/graph/annotations.ts`](../../../apps/participant/src/graph/annotations.ts)
  is already a thin re-export of `@a-conversa/shell`'s
  `Annotation` type; the lifted body imports the type from shell
  directly (`from '../annotations/index.js'` internally; from
  `@a-conversa/shell` externally) — no participant-local types reach
  shell.
- **Generalize the node / edge input shapes** — the lifted resolver
  helpers consume `projectedNodes` / `projectedEdges` arrays. They read
  ONLY `id` + `wording` (node) + `id` + `role` (edge) + `nodeKind` (to
  exclude annotation graph-nodes from the statement-node lookup); per
  Decision §5 the lifted code defines minimal `AnnotationDetailNode` /
  `AnnotationDetailEdge` structural interfaces in the shell that the
  participant's existing `ParticipantNodeData` / `ParticipantEdgeData`
  structurally satisfy (and that any future moderator-side
  `ModeratorNodeData` / audience-side equivalent will satisfy by
  including the same minimal fields). No shell dependency on participant
  types.
- **Migrate i18n keys to a surface-neutral namespace** — the existing
  `participant.detailPanel.identity.annotation`,
  `participant.detailPanel.annotation.sectionTitle.{content,author,target,contradicts}`,
  and `participant.detailPanel.annotation.unknownTarget` keys move to a
  new `entityDetailPanel.annotation.*` block at the root of each locale
  catalog (Decision §4). The participant's existing
  `participant.detailPanel.identity.{node,edge}` keys stay in place
  (those are participant-specific identity labels — the lift only
  affects the annotation-arm vocabulary that future moderator / audience
  drill-downs will share).
- **Rewire the participant panel** — replace the 5 inline section
  components in
  [`apps/participant/src/detail/EntityDetailPanel.tsx:481-526`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L481-L526)
  with a single `<AnnotationDetailView>` import + JSX block. Delete the
  participant-local `AnnotationIdentitySection` /
  `AnnotationContentSection` / `AnnotationAuthorSection` /
  `AnnotationTargetSection` / `AnnotationContradictsSection` /
  `resolveAnnotationTarget` / `resolveEntityById` definitions (~280 lines
  go away). The `<aside data-state="annotation">` wrapper stays in
  participant-local code (per Decision §6 — the wrapper carries
  participant-specific testids + class strings; only the inner body
  lifts).
- **Move the participant's Vitest cases for the annotation sections** —
  the cases `annotation-a` through `annotation-g` in
  [`apps/participant/src/detail/EntityDetailPanel.test.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx)
  that pin section-internal behavior (kind label / content body / author
  name / target-link resolution / contradicts list / annotation-of-
  annotation target chain) lift wholesale to
  `packages/shell/src/annotation-detail/AnnotationDetailView.test.tsx`.
  The participant-side cases that pin the participant's `<aside>` wrapper
  attributes (`data-state="annotation"`, `data-entity-id`,
  `participant-detail-panel` testid) STAY in the participant test —
  those are participant-surface seams, not the body's seams. Decision §7
  walks through which cases move vs stay.
- **No new ADR.** The architectural seams (shell-package shape per ADR
  0026; the third-caller deferral policy; the i18n catalog seam per ADR
  0024) are all settled. This leaf applies them to a new shell subsystem
  (Decision §8).
- **No new Playwright spec.** The participant-side block in
  [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts)
  (extended by the predecessor) already pins the rendered annotation
  body end-to-end; this leaf is a pure refactor — the rendered DOM
  testids and behavior stay binary-identical. Decision §7.

### Scope bounded by 0.5d budget

Per the `.tji` `effort 0.5d` estimate, the in-scope move is **the
participant body + the two resolver helpers, plus the participant
rewire, plus the i18n key migration**. Scope cut-offs registered as
Decisions, NOT silently dropped:

- **In scope (ships in this leaf, when the trigger fires)**: lift the 5
  section components + 2 resolver helpers into
  `packages/shell/src/annotation-detail/`; introduce a public
  `<AnnotationDetailView>` composition + an `<AnnotationDetailViewProps>`
  interface + the two named resolver exports; introduce the minimal
  `AnnotationDetailNode` / `AnnotationDetailEdge` structural interfaces
  (Decision §5); migrate the i18n keys; rewire the participant import +
  delete the participant-local copies; transfer the relevant Vitest
  cases; shell barrel grows by 5 names.
- **Out of scope (deferred or explicitly not done)**: lifting the
  participant's `<aside>` wrapper (the wrapper stays participant-local
  per Decision §6 — each consumer surface wraps with its own surface-
  scoped data attributes). Lifting the full `<EntityDetailPanel>`
  composition into shell (the panel's node / edge branches are participant-
  specific projection vocabulary; ADR 0026 still applies to the panel
  composition itself; only the annotation arm lifts). Adding a moderator-
  side or audience-side consumer in the same commit — those are the
  future `mod_entity_detail_panel` / `aud_annotation_drill_down` leaves
  that motivate this lift; this leaf opens the seam, those leaves
  consume it. Renaming the i18n keys' string values (the English labels
  "Annotation" / "Content" / "Author" / "Annotating" / "Contradicted by"
  carry over verbatim; only the namespace key path changes). Headless
  use of the resolver helpers by non-panel consumers (the helpers are
  exported for the panel + future drill-downs; broader headless use is
  YAGNI today).

## Why it needs to be done

**The participant body is the first and only caller today; the lift
fires when a second + third caller materialize.** Per the deferred-
until-third-caller policy ([ADR 0026](../../../docs/adr/0026-participant-detail-panel-no-shell-export-until-third-caller.md);
established precedents `extract_facet_pill`, `extract_cytoscape_projectors`,
`shell_axiom_marks_extraction`), a one-caller primitive does not lift —
the shape is over-fit to its one consumer's needs and the abstraction
ossifies prematurely. The participant's annotation-detail body went into
the participant workspace per
[`part_entity_detail_panel_annotation_view`](../participant-ui/part_entity_detail_panel_annotation_view.md)
Decision §2 ("No shell-lift in this leaf"); the tech-debt registration
in that refinement's Acceptance criteria + Status block named THIS task
as the future-lift trigger. This refinement is the forward-plan that
makes the lift mechanical when the trigger fires; landing it before the
trigger fires is wasteful.

**The two candidate triggers in flight today.** Each would independently
make this leaf actionable:

- *Moderator-side per-annotation drill-down* — the moderator surface
  today renders annotations as canvas-side `<AnnotationBadge>` pills
  ([`apps/moderator/src/graph/AnnotationBadge.tsx`](../../../apps/moderator/src/graph/AnnotationBadge.tsx#L1))
  with the kind label inline and the content text behind a `title`
  attribute. Once the moderator gains a panel-style drill-down (a
  hypothetical `mod_entity_detail_panel` task or equivalent surface
  triggered by `mod_annotation_kind_tagging` /
  `mod_render_annotation_endpoint_edges` extending the click-target
  surface), the same kind/content/author/target/contradicts composition
  is exactly what the moderator needs. The mod-surface drill-down is the
  most likely second caller.
- *Audience-side per-annotation drill-down* — when the audience surface
  gains an entity-level drill-down to support broadcast-side
  annotation reading (probably a sibling of `aud_graph_rendering` once
  per-annotation overlay rendering lands), it would be the third caller.

**The mechanical cost is small once the trigger fires.** The five
section components plus the two resolver helpers are 280 lines of pure-
presentation code with no participant-specific logic except (a) the
`useSelectionStore` call sites (replaced by an `onSelect` callback —
Decision §2) and (b) the `screenNameFor` resolution call (already
happens at the panel level today; the lifted body takes `authorName` as
a string — Decision §3). The two prop-shape generalizations carry zero
participant-specific assumptions. The i18n key namespace migration is a
keys-move-with-the-string operation across 3 locale files.

**Unblocks future surface-symmetric annotation reading.** When this lift
lands, the participant + moderator + audience surfaces all import the
same rendered body. A future tweak to the annotation-detail vocabulary
(e.g. surfacing the annotation's `created_at` timestamp, or adding a
"this annotation has been withdrawn" indicator once an annotation-
withdrawal wire kind exists) ships once in shell instead of three times
across the surfaces.

## Inputs / context

### ADRs

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md)
  — every behavior pinned by a committed test. The existing
  participant-side `annotation-a..g` cases are the failing-first check
  during the lift.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — the i18n key migration honors the existing react-i18next +
  `@a-conversa/i18n-catalogs` flow; only the key path under each locale
  catalog changes (Decision §4).
- [ADR 0026 — Participant detail panel: no shell export until third caller](../../../docs/adr/0026-participant-detail-panel-no-shell-export-until-third-caller.md)
  — the policy this leaf discharges for the annotation arm of the panel.
- [ADR 0027 — Entity and facet layers: strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md)
  — the lifted body carries entity-layer attributes only; no facet pill
  row, no per-facet vote rows. Carries over verbatim through the lift.
- [ADR 0010 — Directory layout: pnpm workspaces](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md)
  — the `source` / `default` dual-export pattern. The shell's root
  `exports."."` entry serves the new subsystem without a new sub-path
  entry.
- [ADR 0013 — Typecheck: tsconfig strict with project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)
  — the lifted code compiles clean under strict + `exactOptionalPropertyTypes`
  today (the participant workspace ships with the same settings); the
  move preserves that.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md`](../participant-ui/part_entity_detail_panel_annotation_view.md)
  — the **source of this debt**. Decision §2 ("No shell-lift in this
  leaf") + the Tech-debt registration in Acceptance criteria explicitly
  named this task as the future lift point. Decision §1 settled the
  `lookupEntity` widening (third `annotations` argument + return-type
  widening to `ParticipantNodeData | ParticipantEdgeData | Annotation | null`);
  the lifted body inherits that lookup pattern but the shell-side body
  takes the resolved `Annotation` record as a direct prop (the
  participant panel handles the lookup; the shell body handles the
  render).
- [`tasks/refinements/shell-package/extract_facet_pill.md`](./extract_facet_pill.md)
  — the canonical "first extraction at the trigger" template. This leaf
  mirrors its shape: new shell subdirectory; co-located Vitest; barrel
  growth; consumer rewire in the same commit; Tailwind v4 `@source`
  directive already in place (covers `packages/shell/src/**` per
  Decision §6 of that leaf).
- [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](./shell_axiom_marks_extraction.md)
  — precedent for lifting a "badge / drill-down" primitive at its
  second/third caller. Pattern: lift the canonical body to shell, keep
  surface-specific wrappers (participant's panel-badge variant) outside
  the lift; document the divergence as a follow-up consolidation task.
- [`tasks/refinements/shell-package/extract_cytoscape_projectors.md`](./extract_cytoscape_projectors.md)
  — established the convention of lifting at the trigger event and
  keeping moderator-specific consumers separate from the shell-side
  generic projector. The annotation-detail body follows the same
  posture: shell exposes the generic rendered view, each surface
  composes it with its surface-specific wrapper.

### Live code the leaf moves / touches

- [`apps/participant/src/detail/EntityDetailPanel.tsx:481-526`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L481-L526)
  — the annotation-arm body. The five section components are composed
  here today; replace with one `<AnnotationDetailView>` JSX block.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:1010-1156`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1010-L1156)
  — the five section component definitions (`AnnotationIdentitySection`,
  `AnnotationContentSection`, `AnnotationAuthorSection`,
  `AnnotationTargetSection`, `AnnotationContradictsSection`). All five
  move to `packages/shell/src/annotation-detail/`. Their participant-local
  definitions DELETE.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:1230-1293`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1230-L1293)
  — the two polymorphic-target resolver helpers (`resolveAnnotationTarget`,
  `resolveEntityById`). Both move to
  `packages/shell/src/annotation-detail/resolvers.ts` and re-export
  through the subsystem barrel. The participant-local definitions DELETE.
- [`apps/participant/src/detail/EntityDetailPanel.test.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx)
  — the 7 cases `annotation-a..g` covering section-internal behavior
  move to `packages/shell/src/annotation-detail/AnnotationDetailView.test.tsx`;
  the cases pinning the participant `<aside>` wrapper stay in the
  participant test (Decision §7).
- [`apps/participant/src/detail/lookupEntity.ts`](../../../apps/participant/src/detail/lookupEntity.ts)
  — UNCHANGED by this lift. The lookup helper is participant-local
  (couples the participant's selection-store shape to the participant's
  projection); the shell-side body takes the resolved `Annotation`
  record as a prop, not a selection.
- [`apps/participant/src/detail/participantRoster.ts`](../../../apps/participant/src/detail/participantRoster.ts)
  — UNCHANGED. The roster + `screenNameFor` stay in participant; the
  shell-side body takes the resolved `authorName: string` as a prop
  (Decision §3).
- [`apps/participant/src/stores/selectionStore.ts`](../../../apps/participant/src/stores/selectionStore.ts)
  — UNCHANGED. The participant's selection store stays participant-
  local; the shell-side body's navigation calls go through an `onSelect`
  callback that the participant panel binds to the store
  (Decision §2).
- [`packages/shell/src/annotations/annotations.ts:56-64`](../../../packages/shell/src/annotations/annotations.ts#L56-L64)
  — the `Annotation` interface that the lifted body consumes. Already
  exported from the shell barrel via the existing
  `// ─── annotations ───` block at
  [`packages/shell/src/index.ts:140-148`](../../../packages/shell/src/index.ts#L140-L148);
  no edit needed.
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) —
  the barrel grows by 5 names in a new `// ─── annotation-detail ───`
  block: `AnnotationDetailView`, `AnnotationDetailViewProps`,
  `resolveAnnotationTarget`, `resolveEntityById`,
  `AnnotationDetailNode` + `AnnotationDetailEdge` (the structural
  interfaces — Decision §5). The block sits after the existing
  `// ─── annotations ───` block, mirroring the established naming
  pattern.
- [`packages/shell/package.json`](../../../packages/shell/package.json) —
  no edits. The required `peerDependencies` (`react`, `react-dom`,
  `react-i18next`, `@a-conversa/i18n-catalogs`) are already declared;
  the lifted code reaches only those.
- [`packages/shell/vite.config.ts`](../../../packages/shell/vite.config.ts)
  — no edits. The `external` list already covers every dep the lifted
  code reaches.
- [`packages/shell/tsconfig.json`](../../../packages/shell/tsconfig.json)
  — no edits. The required project refs (`shared-types` for
  `EntityKind` / `AnnotationKind`, `i18n-catalogs` for i18n) are already
  declared.
- [`packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  — three locale files. Each gets:
    1. **New block** at the catalog root:
       `entityDetailPanel.annotation.{identity,sectionTitle.{content,author,target,contradicts},unknownTarget}`.
       Values are verbatim copies of the existing strings under
       `participant.detailPanel.identity.annotation` and
       `participant.detailPanel.annotation.*` (e.g. `"Annotation"`,
       `"Content"`, `"Author"`, `"Annotating"`, `"Contradicted by"`,
       `"Unknown target"`).
    2. **Removed**: the existing
       `participant.detailPanel.annotation.*` keys
       (`sectionTitle.{content,author,target,contradicts}`,
       `unknownTarget`). The existing
       `participant.detailPanel.identity.annotation` key is also
       removed — the lifted body resolves the identity prefix via the
       new namespace.
    3. **Unchanged**: every other key in the catalog. The
       `participant.detailPanel.identity.{node,edge}` keys stay (they're
       participant-specific identity vocabulary for the non-annotation
       branches of the panel).
- App Tailwind configs (`apps/<surface>/src/index.css`) — no edits
  needed. Each app's `index.css` already carries a
  `@source '../../../packages/shell/src/**/*.{ts,tsx}';` directive (per
  `extract_facet_pill` Decision §6); the new subdirectory's classnames
  are picked up automatically.

### Existing test coverage already pinned

- **Participant Vitest cases that move to the shell** (per Decision §7):
  - `annotation-a` — selection renders the body (kind / content / author /
    target row / contradicts absent when no contradicting edge).
  - `annotation-b` — contradicts section renders one `<li>` per `contradicts`
    edge anchored on the annotation.
  - `annotation-c` — target-link `onClick` writes the correct selection.
  - `annotation-d` — contradicts-link `onClick` writes the correct selection.
  - `annotation-f` — placeholder `<p>` is gone (re-cast as a
    participant-side assertion that the `<AnnotationDetailView>` is rendered).
  - `annotation-g` — annotation-of-annotation target chain (target resolves
    via the annotation-kind label).
- **Participant Vitest cases that stay** (surface-seam assertions):
  - The case pinning the `<aside data-state="annotation" data-entity-kind="annotation" data-entity-id={id}>`
    wrapper attributes (the `participant-detail-panel` testid framing).
  - `annotation-e` — stale annotation id renders the `data-state="stale"`
    body + auto-clears the selection. This is a participant-panel branch
    decision, not body internal behavior.
- **Participant Playwright block** (extended by the predecessor in
  `tests/e2e/participant-graph-render.spec.ts`) — stays green. Every
  DOM testid the spec asserts on
  (`participant-detail-panel-annotation-kind`,
  `participant-detail-panel-annotation-content-body`,
  `participant-detail-panel-annotation-author-name`,
  `participant-detail-panel-annotation-target-link`,
  `participant-detail-panel-annotation-contradicts-row`) is stamped by
  the lifted body verbatim, since the lifted body keeps the same testid
  strings (Decision §6 + Decision §7).

## Constraints / requirements

- **Trigger condition gate.** The implementer MUST NOT land this leaf
  until at least ONE of the following is true: (a) a moderator-side
  per-annotation drill-down task (e.g. a `mod_entity_detail_panel` or
  equivalent panel surface that consumes the same kind/content/author/
  target/contradicts composition) is in flight or settled and IS the
  second caller of this body; (b) an audience-side per-annotation
  drill-down task is in flight or settled and IS the second or third
  caller. If neither condition holds when the orchestrator picks up this
  leaf, the implementer surfaces the gate in the closer summary and the
  leaf re-defers (the WBS row stays open; no commit). Decision §9
  documents the exact trigger language + the closer behavior.
- **No new top-level dependencies.** The lifted body reaches React +
  react-i18next + shell-internal types only — every consumer is already
  a `peerDependencies` of `packages/shell`. No `dependencies` entries
  land.
- **No new `peerDependencies` entries.** Same reason.
- **`packages/shell/vite.config.ts` `rollupOptions.external` is unchanged.**
- **TypeScript strict.** The lifted code compiles clean under
  `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` (the participant workspace ships with
  these settings today; the shell workspace too).
- **ESLint clean.** The flat config at the root covers
  `packages/**/*.{ts,tsx}` automatically.
- **`source` / `default` dual-export.** The shell's existing root
  `exports."."` entry serves the lifted code; no per-subsystem sub-path
  entries needed.
- **No new external consumer paths.** The lift is internal-surface only;
  every consumer imports the new names via `@a-conversa/shell`.
- **DOM testid stability.** Every testid the participant body stamps
  today (`participant-detail-panel-annotation-identity`,
  `participant-detail-panel-annotation-kind`,
  `participant-detail-panel-annotation-id`,
  `participant-detail-panel-annotation-content`,
  `participant-detail-panel-annotation-content-body`,
  `participant-detail-panel-annotation-author`,
  `participant-detail-panel-annotation-author-name`,
  `participant-detail-panel-annotation-target`,
  `participant-detail-panel-annotation-target-link`,
  `participant-detail-panel-annotation-contradicts`,
  `participant-detail-panel-annotation-contradicts-row`,
  `participant-detail-panel-annotation-contradicts-link`) stays
  byte-identical when stamped by the participant-mounted
  `<AnnotationDetailView>`. The body takes a `testIdPrefix: string`
  prop (Decision §6) defaulting to `entity-detail-panel-annotation`;
  the participant passes `participant-detail-panel-annotation` to
  preserve the existing strings; future moderator + audience consumers
  pass their own prefixes (e.g.
  `moderator-detail-panel-annotation` / `audience-detail-panel-annotation`).
- **i18n key migration is atomic.** The three locale catalog edits
  (add new block + remove old keys) ship in the same commit as the
  participant rewire. Any intermediate state where the participant
  reads removed keys OR new-namespace keys missing surfaces as a
  Vitest failure (the panel test suite renders the body against the
  test catalog).
- **All existing Vitest tests stay green.** Net moderator test count:
  unchanged (the moderator does not consume this body today). Net
  participant test count: `-6` (cases `annotation-a..d` + `annotation-f..g`
  move to shell) `+0` (the participant keeps the wrapper + stale-arm
  cases). Net shell test count: `+6` (the moved cases). Net `pnpm run test:smoke`
  delta: ≈ 0 (pure transfer; small variance for the test setup
  scaffolding the shell-side test needs to provide labels via
  i18n test helpers).
- **All existing Cucumber features stay green.** No wire-format change,
  no methodology change.
- **All existing Playwright suites stay green** under `make up` / `make down-v`.
  The participant graph-render spec block continues to assert the same
  DOM testids; pure refactor.
- **Audit greps confirm the cleanup** (Acceptance criteria spell them
  out):
  - The participant-local section component definitions are gone.
  - The participant's i18n keys under `participant.detailPanel.annotation.*`
    are removed from all three locales (the only remaining
    `participant.detailPanel.annotation`-rooted reference is the
    surface-scoped wrapper rendering, which now reaches
    `entityDetailPanel.annotation.*`).
  - The shell exports the 5 new names.
- **`tj3` scheduler clean.** `tj3 project.tjp 2>&1 | grep -iE "error|fatal"`
  silent after `complete 100` lands on the task block.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md),
every check below is a committed test or a script CI already runs — no
throwaway probes.

**Trigger gate**

- [ ] The orchestrator surfaces this leaf only when a second caller has
      materialized (a moderator-side or audience-side per-annotation
      drill-down task is in flight or settled). If not, the implementer
      reports back to the closer with the gate status and the leaf
      re-defers. (Decision §9.)

**Shell subsystem**

- [ ] New directory `packages/shell/src/annotation-detail/` with:
  - `AnnotationDetailView.tsx` — the public composition component.
  - `sections.tsx` — the 5 internal section components.
  - `resolvers.ts` — the 2 polymorphic-target resolver helpers.
  - `types.ts` — the `AnnotationDetailNode` / `AnnotationDetailEdge`
    structural interfaces + the `AnnotationDetailViewProps` shape.
  - `index.ts` — subsystem barrel re-exporting the public surface.
  - `AnnotationDetailView.test.tsx` — co-located Vitest cases (the
    transferred `annotation-a..d` + `annotation-f..g`, plus a small
    `<AnnotationDetailView>`-composition case asserting the top-level
    component renders all 5 sections in order with realistic props).
- [ ] [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts)
      gains a `// ─── annotation-detail ───` block re-exporting:
      `AnnotationDetailView`, type `AnnotationDetailViewProps`,
      `resolveAnnotationTarget`, `resolveEntityById`, type
      `AnnotationDetailNode`, type `AnnotationDetailEdge`.
- [ ] `pnpm -F @a-conversa/shell build` exits zero.
      `dist/index.d.ts` exports the 5 new names alongside the existing
      blocks.
- [ ] `pnpm -F @a-conversa/shell typecheck` exits zero under strict.
- [ ] `pnpm -F @a-conversa/shell test` runs the moved Vitest cases plus
      existing shell tests. All green.

**Participant rewire**

- [ ] [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx)
      imports `AnnotationDetailView` from `@a-conversa/shell` and
      composes it inside the existing `<aside data-state="annotation">`
      wrapper. The inline JSX block at L481-526 collapses to a single
      `<AnnotationDetailView ...props />` element (plus the
      `actionSlot` rendering, which stays in participant code).
- [ ] The participant-local `AnnotationIdentitySection`,
      `AnnotationContentSection`, `AnnotationAuthorSection`,
      `AnnotationTargetSection`, `AnnotationContradictsSection`
      definitions (L1010-1156) are DELETED.
- [ ] The participant-local `resolveAnnotationTarget` +
      `resolveEntityById` definitions (L1230-1293) are DELETED.
- [ ] The participant's `onSelect` callback prop is bound to
      `useSelectionStore.getState().select` at the call site (a
      stable closure created in the panel's render OR a hoisted
      module-level constant since the store getter is stable).
- [ ] The participant's `authorName` prop is resolved at the call
      site via `screenNameFor(roster, annotation.createdBy)`.
- [ ] `pnpm -F @a-conversa/participant build` exits zero.
- [ ] `pnpm -F @a-conversa/participant typecheck` exits zero.
- [ ] `pnpm -F @a-conversa/participant test` stays green. Net case
      count delta: `-6` (the moved cases). The participant retains the
      wrapper-attribute case + the stale-annotation `annotation-e`
      case.

**i18n migration**

- [ ] All three locale files at
      [`packages/i18n-catalogs/src/catalogs/{en-US,es-419,pt-BR}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
      gain a new top-level `entityDetailPanel.annotation` block with
      the verbatim string values from the existing
      `participant.detailPanel.identity.annotation` +
      `participant.detailPanel.annotation.*` keys.
- [ ] The keys `participant.detailPanel.identity.annotation` and
      `participant.detailPanel.annotation.{sectionTitle.content,sectionTitle.author,sectionTitle.target,sectionTitle.contradicts,unknownTarget}`
      are REMOVED from all three locales.
- [ ] The `participant.detailPanel.identity.{node,edge}` keys stay
      unchanged (still consumed by the participant's node/edge identity
      branches).
- [ ] The i18n round-trip test
      (`packages/i18n-catalogs/src/*.test.ts`) stays green; any pin on
      "no orphan key" / "no missing-key" surfaces the migration cleanly.

**Audit greps confirm the cleanup**

- [ ] `grep -rn "AnnotationIdentitySection\|AnnotationContentSection\|AnnotationAuthorSection\|AnnotationTargetSection\|AnnotationContradictsSection" apps/participant/src/`
      returns zero matches.
- [ ] `grep -rn "resolveAnnotationTarget\|resolveEntityById" apps/participant/src/`
      returns zero matches.
- [ ] `grep -rn "participant\\.detailPanel\\.annotation\\." packages/i18n-catalogs/src/`
      returns zero matches (the namespace is gone from all locales).
- [ ] `grep -rn "participant\\.detailPanel\\.identity\\.annotation" packages/ apps/`
      returns zero matches.
- [ ] `grep -rn "AnnotationDetailView" packages/shell/src/ apps/participant/src/`
      returns matches in both: the shell-side definition + barrel + the
      participant-side import + usage.

**Existing suites stay green**

- [ ] `pnpm run check` (lint + format + typecheck + tools + tests) green
      across all workspaces.
- [ ] `pnpm run test:smoke` total count stays within ±2 of pre-commit.
- [ ] `pnpm run test:e2e` (Playwright; runs under `make up` / `make down-v`)
      stays green — the participant graph-render annotation block
      continues to pass against identical DOM testids.

**Build + scheduler**

- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
      `complete 100` lands on the task block.
- [ ] [`tasks/27-shell-package.tji`](../../27-shell-package.tji) task
      block at L217 gets `complete 100`.

### Failing-first verifiability

The 6 moved Vitest cases (`annotation-a..d` + `annotation-f..g`) are the
failing-first check during the lift: the file moves with the source;
any intermediate state where the section components are split between
the participant and shell, where the i18n keys are mid-migration, or
where the participant's `onSelect` callback isn't bound correctly,
surfaces as a Vitest or `tsc -b` failure within `pnpm run check`. No
new test scaffolding needed.

### UI-stream e2e policy

`shell_package.extract_annotation_detail_view` is **substrate refactor**,
not a UI-stream task. **No new Playwright spec lands in this leaf.** The
existing participant graph-render annotation block covers the rendered
output end-to-end; the lift is binary-preserving on the DOM seam, so the
existing spec re-runs as the e2e gate.

e2e disposition: **not-added-but-existing-suites-must-stay-green**.

## Decisions

- **§1 — Single public `<AnnotationDetailView>` composition + two
  exported resolver helpers; the 5 section components stay internal.**
  Alternatives:
  - *Export all 5 section components individually plus a top-level
    composition.* Considered — would let a future consumer reorder /
    omit / re-style individual sections. Rejected: today the established
    composition (identity → content → author → target → contradicts) is
    the entire vocabulary; exposing the sections as a public surface
    locks in shape choices (the section ordering, the testid stems, the
    pre-resolved label prop shape) that constrain future refactors more
    than they enable consumers. YAGNI.
  - *Export only the top-level composition; keep resolvers internal.*
    Considered — the tightest possible surface. Rejected: the resolver
    helpers (`resolveAnnotationTarget`, `resolveEntityById`) have
    legitimate headless use cases (a future moderator-side overlay that
    wants to compute "where does this annotation point" without
    rendering the body), and the polymorphic-target resolution logic is
    a real piece of cross-surface vocabulary worth exposing.
  - *Export the top-level composition + the two resolver helpers + the
    structural type interfaces.* **Chosen.** The minimum useful API
    surface: one component, two pure functions, two structural type
    aliases. Consumers compose `<AnnotationDetailView>`; headless
    consumers reach the resolvers; type consumers reach the structural
    interfaces for their own narrowing.
  - *Rationale:* keep the surface small and intentional; expose what
    has a use case, hide what doesn't.

- **§2 — The lifted body's target-link + contradicts-link buttons take
  an `onSelect: (selection: { kind: EntityKind, id: string }) => void`
  callback prop. The participant binds it to
  `useSelectionStore.getState().select` at the call site.**
  Alternatives:
  - *Keep the `useSelectionStore.getState().select(...)` call inline in
    the lifted body.* Rejected — would couple shell-package code to the
    participant's selection store, which violates the
    one-surface-per-store principle: the moderator and audience
    surfaces will have their own selection stores (and possibly
    different selection shapes). Hard no.
  - *Accept the store object itself as a prop, calling `store.select(...)`
    internally.* Considered — would let consumers pass a Zustand-shaped
    object. Rejected: forces every consumer to expose a store that
    matches the participant's interface; couples the shell to a state-
    management library; the same effect is achievable more cheaply with
    a callback.
  - *Accept an `onSelect` callback prop; consumers bind it however they
    like.* **Chosen.** The participant binds to its Zustand store; a
    future moderator binds to its store; an audience binds to whatever
    surface-state seam it has. The callback shape uses
    `EntityKind` from `@a-conversa/shared-types` (the canonical wire
    enum) so the type contract is shared.
  - *Rationale:* the smallest possible coupling. Callbacks compose
    cleanly with any state-management approach.

- **§3 — The lifted body's author section takes a resolved
  `authorName: string` prop; the caller resolves the screen name via
  its surface-local roster helper.** Alternatives:
  - *Accept a `participantRoster` object + a `userId` string; resolve
    inside the body.* Rejected — would couple the shell to the
    participant's roster shape (or force a new shared roster interface);
    the moderator and audience surfaces have their own roster shapes
    (or no roster, in the case of an audience surface seeing only
    pseudonymous attribution). Premature abstraction.
  - *Accept a `resolveAuthor: (userId: string) => string` callback.*
    Considered — would let consumers thread their own resolution. Marginal
    benefit over passing a pre-resolved string: every caller already
    knows the annotation's `createdBy` and has the roster; resolving
    once at the call site is one expression.
  - *Accept a pre-resolved `authorName: string` prop.* **Chosen.**
    Smallest possible coupling; the caller's surface-local roster code
    stays in the surface.
  - *Rationale:* the lifted body should not know what a "roster" is —
    that's surface vocabulary, not shell vocabulary.

- **§4 — i18n keys migrate to a new top-level `entityDetailPanel.annotation.*`
  namespace; the existing participant-namespaced keys are removed.**
  Alternatives:
  - *Keep the keys under `participant.detailPanel.*` and let the shell
    body read them there.* Rejected — the lifted body is no longer
    participant-specific; reading from a surface-named namespace is
    misleading and would force future moderator + audience consumers to
    read keys named for a peer surface. Confusing and semantically wrong.
  - *Move the keys under `methodology.annotation.*` alongside
    `methodology.annotationKind.*`.* Considered — the kind labels (which
    the body also reads) already live there. Rejected: the new keys
    ("Content", "Author", "Annotating", "Contradicted by") are
    panel-vocabulary (UI-surface labels), not methodology-vocabulary
    (domain labels). Mixing them into the methodology namespace blurs a
    boundary the catalog has otherwise maintained cleanly.
  - *Move the keys under a shell-scoped namespace like
    `shell.annotationDetail.*`.* Considered — would explicitly mark
    ownership. Rejected: the i18n catalogs are not organized by
    package-owner today (the `methodology.*` namespace is used by both
    server + UI surfaces; the `mount.*` namespace by shell + apps);
    introducing a shell-package-named root key would be a new
    convention. The cross-surface UI-vocabulary namespace
    `entityDetailPanel.*` is the right shape (and parallels the existing
    `participant.detailPanel.*` and any future
    `moderator.detailPanel.*` namespaces — those stay for
    surface-specific labels; the cross-surface labels live under
    `entityDetailPanel.*`).
  - *Use a new top-level `entityDetailPanel.annotation.*` namespace.*
    **Chosen.** Future moderator + audience drill-downs read the same
    namespace; the participant's surface-specific identity keys
    (`participant.detailPanel.identity.{node,edge}`) stay where they
    are; only the cross-surface annotation vocabulary migrates.
  - *Rationale:* honor the catalog's existing surface-vs-cross-surface
    boundary; minimize churn outside the annotation-arm vocabulary.

- **§5 — The lifted body declares minimal structural interfaces
  `AnnotationDetailNode` / `AnnotationDetailEdge` that the participant's
  existing projection types satisfy structurally; no shell dependency
  on participant types.** Alternatives:
  - *Import the participant's `ParticipantNodeData` /
    `ParticipantEdgeData` from `apps/participant/src/graph/projectGraph.ts`.*
    Rejected — same dependency-inversion problem `extract_facet_pill`
    solved: shell-package code cannot reach into a surface app. Hard no.
  - *Import a canonical projection type from `@a-conversa/shared-types`.*
    Considered — would centralize the shape. Rejected: `shared-types` is
    the wire/protocol schema; the projection types are surface-side
    derived shapes (a `ParticipantNodeData` carries `rollupStatus`,
    `facetStatuses`, etc., which are projection-vocabulary not wire-
    vocabulary). Widening `shared-types` to include them would pull
    cross-surface render concerns into the protocol layer.
  - *Declare minimal structural interfaces in the shell with only the
    fields the lifted body reads.* **Chosen.** Concretely:
    ```ts
    export interface AnnotationDetailNode {
      readonly id: string;
      readonly wording: string;
      readonly nodeKind: 'statement' | 'annotation';
    }
    export interface AnnotationDetailEdge {
      readonly id: string;
      readonly role: string;
      readonly source: string;
      readonly target: string;
    }
    ```
    The participant's `ParticipantNodeData` / `ParticipantEdgeData`
    structurally satisfy these (they have the listed fields + many
    more). A future moderator-side `ModeratorNodeData` will satisfy
    them as long as it carries the listed fields. The `role` field is
    typed `string` rather than the wire `EdgeRole` enum from
    `@a-conversa/shared-types` because the lifted body passes the role
    through to the `edgeRoleLabel` callback rather than discriminating
    on it (the only discrimination is `role === 'contradicts'` for
    the contradicts list, which works against `string` cleanly). The
    edge-role enum stays at the wire layer; the shell body stays
    decoupled.
  - *Rationale:* structural-typing matches TypeScript's strengths;
    keeps the shell decoupled from any surface's projection type
    family; smallest possible commitment.

- **§6 — The lifted `<AnnotationDetailView>` returns a React fragment
  (NOT the `<aside>` wrapper); each consumer wraps with its own
  surface-scoped `<aside>` carrying surface-specific data attributes +
  classes. The body takes a `testIdPrefix: string` prop to scope its
  internal testids per consumer surface.** Alternatives:
  - *Lift the `<aside>` wrapper too, with surface-specific attributes
    threaded as props.* Rejected — the `<aside>`'s class string
    (`"w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4 text-sm flex flex-col gap-4"`)
    is participant-panel-specific Tailwind (the width + border + bg are
    panel-chrome decisions). The moderator's panel chrome will likely
    differ; the audience's will too. Forcing every consumer to thread
    its className through the shell is more friction than letting each
    own its wrapper.
  - *Lift the body as a `<div>`-wrapped fragment.* Considered — would
    let the body stand alone visually. Rejected: a `<div>` introduces
    layout semantics (block-level box) that constrain the consumer's
    own layout choices; a fragment is structurally neutral.
  - *Return a fragment; consumers wrap.* **Chosen.** The body is a
    composition of five `<section>` elements with `gap-4` spacing
    between them; the consumer's `<aside>` (or `<div>` or whatever)
    sets the flex container. The participant's existing
    `flex flex-col gap-4` class string moves to the wrapper (already
    is there today).
  - *Per `testIdPrefix`:* defaulting to `entity-detail-panel-annotation`
    gives a sensible surface-neutral baseline; the participant passes
    `participant-detail-panel-annotation` to preserve the existing
    testid strings (and keep its existing component test + e2e block
    binary-identical); future consumers pass their own.
  - *Rationale:* each surface owns its chrome; the shell owns the
    composition.

- **§7 — Test-pattern disposition: 6 Vitest cases move to shell; the
  wrapper-attribute case + the stale-annotation case stay in
  participant. No new Playwright. No new Cucumber.** Alternatives
  reasoned through:
  - *Move all 7 annotation-arm cases to shell.* Rejected — the
    stale-annotation case (`annotation-e`) pins the participant's panel
    *branching decision* (when the lookup returns null, render the
    `data-state="stale"` body instead of the annotation body). That's
    a participant-panel responsibility, not body internal behavior; it
    has to stay where the panel lives.
  - *Move 0 cases; keep all annotation-arm pins in participant; add
    new shell-side cases from scratch.* Rejected — duplicates coverage
    and burns the failing-first guarantee the existing cases provide
    during the lift.
  - *Move the 6 cases that pin body-internal behavior; keep the 2 cases
    that pin participant-surface decisions.* **Chosen.** Specifically:
    - **Move to shell**: `annotation-a`, `annotation-b`, `annotation-c`,
      `annotation-d`, `annotation-f`, `annotation-g`. These test
      section rendering, click handlers, and the polymorphic-target
      resolution chain — all body-internal.
    - **Stay in participant**: the case pinning the `<aside data-state="annotation"...>`
      wrapper attributes; `annotation-e` (stale-annotation branch
      rendering + auto-clear). Both are participant-panel responsibilities.
    - **Add one new shell-side test**: a composition-level
      `<AnnotationDetailView>` case asserting it renders all 5 sections
      in order when given realistic props with no missing-target /
      contradicts gaps. Net `+1` on the shell side; net `-6` on the
      participant side; net `-5` overall — small variance, well within
      the ±2 tolerance once the new test setup helpers are accounted
      for.
  - *No new Playwright.* The participant graph-render annotation block
    covers the rendered output end-to-end; the lift is binary-preserving
    on the DOM seam (Decision §6's `testIdPrefix` pattern keeps the
    participant's testids verbatim). Running the existing spec under
    `make up` / `make down-v` IS the e2e gate.
  - *No new Cucumber.* No wire-format change, no methodology change.
  - *Rationale:* preserve the failing-first guarantee; honor the
    surface-vs-shell test boundary; no scaffolding for scaffolding's
    sake.

- **§8 — No new ADR.** Alternatives:
  - *Write an ADR codifying "lift cross-surface UI vocabulary into shell
    at the second/third caller; structural interfaces over surface
    type imports".* Considered. Rejected: the precedents
    (`extract_facet_pill`, `extract_cytoscape_projectors`,
    `shell_axiom_marks_extraction`) already form a de facto pattern
    library; another instantiation does not warrant a new ADR. ADR 0026
    is the canonical statement of the third-caller policy; this leaf
    applies it.
  - *Write an ADR formalizing the i18n namespace convention
    (`entityDetailPanel.*` for cross-surface panel vocabulary;
    `participant.detailPanel.*` etc. for surface-specific identity).*
    Considered. Rejected: the convention is observable from the
    catalog's existing structure; codifying it ahead of a second
    cross-surface namespace migration is premature. If a third
    cross-surface migration follows, write an ADR then.
  - *No new ADR.* **Chosen.** The lift is engineering work within an
    established pattern; the Decisions above carry the rationale.
  - *Rationale:* match the precedent (`extract_facet_pill` also shipped
    without an ADR); ADRs are for architectural commitments that change
    the project's shape, not for individual applications of an
    existing pattern.

- **§9 — The leaf is gated on a second caller materializing. The
  closer behavior when the orchestrator picks up this leaf prematurely:
  surface the gate status in the summary; re-defer the leaf (do not
  commit). The closer does NOT spawn a "decide when to lift" follow-up
  task (that would be the audit-task anti-pattern).**
  Alternatives:
  - *Land the lift now; no second caller required.* Rejected — locks
    the API shape against one consumer's needs; the whole point of the
    deferred-until-N-caller policy is to wait for evidence. Hard no per
    ADR 0026 + established precedent.
  - *Re-defer to a fixed date.* Rejected — calendar-based gates are
    fragile and arbitrary; the trigger is structural (a second caller
    exists), not temporal.
  - *Re-defer with a structural gate.* **Chosen.** Concrete trigger
    language: the leaf is actionable when EITHER (a) a moderator-side
    per-annotation drill-down task (e.g. `mod_entity_detail_panel` or a
    sibling task that adds a panel surface consuming the same
    kind/content/author/target/contradicts composition) is in the WBS
    AND on track to land within the same milestone as THIS leaf, OR
    (b) the same condition holds for an audience-side per-annotation
    drill-down. If neither holds, the orchestrator should not pick this
    leaf up; the closer's summary states "trigger not yet fired" and
    the leaf stays open.
  - *Rationale:* match the policy verbatim; avoid the
    "audit / re-audit" anti-pattern that produced the
    `extract_pending_axiom_mark_projector` loop. The "decide when" work
    is human-judgment work that lives in the orchestrator's queue, not
    in a WBS task.

## Open questions

(none — all decided in §1–§9.)

## Status

**Gate checked; deferred** — 2026-05-30.

- Trigger gate evaluated (Decision §9): no second caller (moderator-side or
  audience-side per-annotation drill-down) exists in the WBS or is in flight.
- Moderator annotation work (`mod_render_annotation_endpoint_edges`,
  `mod_propose_annotation_endpoint_gestures`,
  `mod_annotation_of_annotation_overlay_chain`, `mod_annotation_kind_tagging`)
  all extend canvas-side / gesture surfaces; none consume the
  kind/content/author/target/contradicts panel composition.
- Audience annotation work (`aud_annotation_rendering`) inverts the deferral
  because the audience surface is broadcast-only with no detail panel;
  annotation work there is canvas-overlay badges only.
- Participant remains the sole caller of the annotation-detail body at
  `apps/participant/src/detail/EntityDetailPanel.tsx:481-526`.
- No implementation performed; leaf stays open in the WBS per Decision §9
  until a qualifying second-surface drill-down task materialises.
