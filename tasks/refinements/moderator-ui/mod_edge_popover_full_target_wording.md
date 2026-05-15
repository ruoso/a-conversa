# Moderator edge popover — drop wording from the edge popover, surface role description + endpoint node references instead

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_edge_popover_full_target_wording` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (search the leaf `task mod_edge_popover_full_target_wording` inside `task mod_graph_rendering`).

**Effort estimate**: 0.25d (confirmed). The change is small in code: drop the `truncate()` helper, drop the `moderator.hoverPopover.edgeEndpoints` ICU substitution path inside the edge branch of `<HoverPopover>`, render a new endpoint-references row instead (no source/target wording, just the source/target node ids stamped with stable test seams), and reframe the e2e assertion in `tests/e2e/moderator-hover-details.spec.ts` Test 4 to assert role + endpoint references (not wording). One new locale-shared ICU template covers the optional role-description line; the existing `moderator.hoverPopover.edgeEndpoints` template is retired from the popover renderer (and either deleted from the three catalogs or left as catalog dead code per the Decisions below). Vitest cases on `HoverPopover.test.tsx` update from "asserts endpoints line contains truncated wording" to "asserts endpoints line contains source/target node ids and does NOT contain either wording."

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public contracts):

- `moderator_ui.mod_graph_rendering.mod_hover_details` (done — `<HoverPopover>` at `apps/moderator/src/graph/HoverPopover.tsx` is the existing popover component. This task narrows the edge branch's content; the node branch is unchanged. The component's `data-testid="hover-popover-<id>"`, `role="tooltip"`, `data-hover-target-kind="edge"`, `pointer-events: none`, and CSS-only positioning all stay as-is).
- `moderator_ui.mod_graph_rendering.mod_node_handle_rendering` (done — commit `bcbe51a` landed the source/target `<Handle>` elements on `<StatementNode>`. Test 4 of `moderator-hover-details.spec.ts` was hardened in that task with the documented relaxation: the popover-contains-target-wording assertion was reduced to a 60-char prefix match because `HoverPopover.tsx`'s `truncate()` caps wordings at 60 chars. This task closes that registered debt by re-deciding the contract — drop the wording assertion, assert role + endpoint references instead).
- `moderator_ui.mod_graph_rendering.mod_layout_measured_dimensions` (done — commit `105d6fd` is the **structural seam that reframed this decision**. Prior to that task the dagre layout fed every node a constant 90 px height while `<StatementNode>` was structurally already rendering the full wording (`whitespace-pre-line break-words` + `max-w-[18rem]`, no `line-clamp` / `max-h` / `truncate`); the visual result was overflowing cards crashing into the next rank. With measured dimensions, the card visibly grows to fit its full content. The popover's "show me what the card hides" purpose evaporated — the card now hides nothing. The Status section of `mod_layout_measured_dimensions.md` explicitly calls out this reframe: "this reframes the still-open `mod_edge_popover_full_target_wording` decision: the card already shows everything, so the popover-truncation question shifts from 'should we truncate?' to 'what does the popover add beyond a card that already shows everything?'").
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `<StatementEdge>` at `apps/moderator/src/graph/StatementEdge.tsx` is the custom ReactFlow edge component. The edge label is a small `rounded bg-white px-1 text-xs` role pill rendered inside `<EdgeLabelRenderer>`; it shows ONLY the localized role string, not the source/target wordings. This is the "asymmetry" the orchestrator brief named — the node card shows the wording, the edge label does NOT show endpoints. The popover therefore CAN earn its existence on the edge surface by surfacing what the role pill leaves out: a role-description tooltip-style sentence + endpoint node identifiers so the moderator can recall WHICH source connects to WHICH target without leaving the canvas).
- `moderator_ui.mod_graph_rendering.mod_selection` / `mod_context_menus` (done — click-to-select on the role label still drives `useSelectionStore`; right-click still opens `<GraphContextMenu>`. The popover's `pointer-events: none` is the load-bearing pin; this task preserves it).
- `frontend_i18n.i18n_methodology_glossary` (done — `methodology.edgeRole.<role>` already resolves in en-US / pt-BR / es-419 with the localized role label. This task additionally consumes `methodology.edgeRole.<role>.description` IF a description catalog entry exists; per the Decisions, this task DOES NOT add the per-role descriptions catalog — that's `i18n_methodology_role_descriptions`, a follow-up. The edge popover renders the description line conditionally on key existence; missing keys produce an omitted line).

Pending edges (this task does NOT depend on them):

- `moderator_ui.mod_graph_rendering.mod_pan_zoom` — orthogonal.
- `moderator_ui.mod_capture_flow.mod_draw_edge_flow` — future consumer (when drag-from-handle-to-handle lands, the popover content will still be the right surface for "what does this role mean and where does this edge connect?").
- `frontend_i18n.i18n_methodology_role_descriptions` (not yet registered — a follow-up task this refinement names explicitly; see Decisions). When that task lands, the popover gains a role-description line in every locale without further code change because the existence-of-key check is already in place.

## What this task is

Drop the source/target wording rendering from the **edge** popover. Replace it with:

1. **Role headline** (unchanged) — localized `methodology.edgeRole.<role>` rendered as the existing `data-hover-popover-section="role"` paragraph.
2. **NEW: Role description line** — optional, conditional on catalog key existence. The ICU template lookup is `methodology.edgeRole.<role>.description`; if i18next resolves the key to something OTHER than the literal key (i.e. a translation exists), render the description as a small `text-xs text-slate-600` paragraph below the headline with `data-hover-popover-section="role-description"`. If the key resolves to the literal string (i18next's miss behavior), omit the line entirely. This task does NOT add the descriptions to the catalog — see Decisions; the seam is wired so a future `i18n_methodology_role_descriptions` task fills it in.
3. **Endpoint references row** — replaces the truncated source→target wording line. Renders as `data-hover-popover-section="endpoints"`. Content: a small two-row block (or one inline `source → target` row, chosen below) carrying the source and target node ids with stable test seams `data-hover-popover-source-id="<id>"` and `data-hover-popover-target-id="<id>"`. The visible content is the node ids themselves — short hex / uuid fragments that read as identifiers, not prose. This is the load-bearing "what does the popover add beyond the card?" answer: the role pill on the edge doesn't tell the moderator which two nodes this edge runs between; the popover does. The node ids are the canonical canvas-stable handle (every card stamps `data-testid="statement-node-<id>"`); rendering them in the popover lets the moderator visually cross-reference between the popover and the cards.
4. **Per-facet status summary** (unchanged) — the existing `FACET_RENDER_ORDER` iteration for the substance facet stays. Same idiom as today.
5. **Active-diagnostic line** (unchanged) — same shape as the node popover's.

Concretely the code changes:

- **`apps/moderator/src/graph/HoverPopover.tsx`** — in the edge branch (lines 247–313), replace the `endpointsLine` ICU substitution + the corresponding `<p>` render with:
  - Drop the `truncate()` helper entirely (it's not used elsewhere — verified by `grep`).
  - Drop the `endpointsLine = t('moderator.hoverPopover.edgeEndpoints', { ... })` substitution.
  - Drop the `<p data-hover-popover-section="endpoints">...</p>` paragraph that rendered the truncated source→target wording string.
  - Add a conditional role-description paragraph keyed off `methodology.edgeRole.<role>.description`:
    ```tsx
    const roleDescriptionKey = `methodology.edgeRole.${role}.description`;
    const roleDescription = t(roleDescriptionKey);
    const hasRoleDescription = roleDescription !== roleDescriptionKey;
    // ... in JSX:
    {hasRoleDescription ? (
      <p
        data-hover-popover-section="role-description"
        className="text-xs text-slate-600 leading-snug"
      >
        {roleDescription}
      </p>
    ) : null}
    ```
  - Add a new endpoints reference block that renders the node ids (NOT wordings). Per the Decisions below, the inline `source-id -> target-id` rendering is preferred:
    ```tsx
    const endpointsLine = t('moderator.hoverPopover.edgeEndpointsReference', {
      sourceId: data.sourceId,
      targetId: data.targetId,
    });
    // ... in JSX:
    <p
      data-hover-popover-section="endpoints"
      data-hover-popover-source-id={data.sourceId}
      data-hover-popover-target-id={data.targetId}
      className="text-xs text-slate-700 font-mono break-all"
    >
      {endpointsLine}
    </p>
    ```
- **`apps/moderator/src/graph/selectors.ts`** — extend `StatementEdgeData` with `sourceId: string` + `targetId: string` (non-optional, mirroring the existing `sourceWording` / `targetWording` shape). Populate both fields in `selectEdgesForSession` directly from the `edge-created` event's `source_node_id` / `target_node_id` (the ids are already in the event — no walk needed; the wording-walk path stays for now per the Decisions).
- **One new ICU template** added to all three locale catalogs (`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`):
  - `moderator.hoverPopover.edgeEndpointsReference` — ICU template for the inline source-id → target-id rendering.
  - en-US / pt-BR / es-419: `"{sourceId} -> {targetId}"` (identical across locales — pure punctuation, ASCII `->` per the existing typography-codepoint policy referenced in `mod_hover_details.md`'s Status section).
  - The existing `moderator.hoverPopover.edgeEndpoints` template (which interpolates `{role}` / `{sourceWording}` / `{targetWording}`) is **removed** from all three catalogs — see Decisions for why the dead-code removal happens in-task.
- **`tests/e2e/moderator-hover-details.spec.ts` Test 4** — the central e2e contract update:
  - Drop `await expect(edgePopover).toContainText(TARGET_WORDING.slice(0, 60));` (the relaxed prefix-match assertion that registered the debt).
  - Keep `await expect(edgePopover).toContainText('Supports');` (role headline assertion stays — the popover STILL surfaces role).
  - Add `await expect(edgePopover).toContainText(NODE_ID);` (source node id appears in the popover via the endpoints row).
  - Add `await expect(edgePopover).toContainText(NODE_ID_OTHER);` (target node id appears).
  - Add `await expect(edgePopover.locator('[data-hover-popover-section="endpoints"]')).toHaveAttribute('data-hover-popover-source-id', NODE_ID);` (stable seam check — the endpoint row carries the source id as a data attribute).
  - Add `await expect(edgePopover.locator('[data-hover-popover-section="endpoints"]')).toHaveAttribute('data-hover-popover-target-id', NODE_ID_OTHER);` (target id).
  - **Explicitly add a negative assertion**: `await expect(edgePopover).not.toContainText(SOURCE_WORDING.slice(0, 60));` AND `await expect(edgePopover).not.toContainText(TARGET_WORDING.slice(0, 60));` (the popover no longer renders wordings; the negative check pins the contract).

This task does NOT change the **node** popover (the orchestrator brief explicitly scoped this task to the edge popover only). The node popover continues to render its full wording paragraph + kind + facet rows + axiom-mark line + diagnostic line as today. The asymmetry — node popover shows wording, edge popover does not — is intentional and matches the asymmetry of the rendering surfaces themselves (node card already shows wording, edge label does not show endpoints).

## Why it needs to be done

1. **Closes the relaxed e2e assertion registered by `mod_node_handle_rendering`.** The Closer of that task documented (Status section, commit `bcbe51a`): "The 'popover contains target wording' check was relaxed to a 60-char prefix match because `HoverPopover.tsx`'s `truncate()` caps source/target wordings at 60 chars — registered as a follow-up tech-debt task (`mod_edge_popover_full_target_wording` in `tasks/30-moderator-ui.tji`) per the ORCHESTRATOR.md `b7c5ff0` policy to decide whether to lift the cap or document it as the design contract." THIS task is that follow-up; it closes the relaxed assertion by reframing what the assertion actually pins. After this task, the e2e assertion is a hard "role + endpoint references appear" check with no prefix-match relaxation.

2. **Aligns the popover's purpose with what the card now shows.** `mod_layout_measured_dimensions` (commit `105d6fd`) clarified that `<StatementNode>` was always structurally showing the full wording — the visual breakage was the constant-90-px dagre input, not a card-side truncation. With measured dimensions feeding dagre, the card visibly grows to fit its full content; the wording is on the canvas, readable in place. The edge popover's original "show me the full wording the card had to truncate" motivation evaporated. The popover must now earn its existence on the edge surface by surfacing what the role pill leaves out — the role's full meaning + the endpoint relationship — not by redundantly re-rendering content the cards already show.

3. **Restores asymmetry between the node popover and the edge popover.** The node card shows wording; the node popover adds kind + facets + axiom-marks + diagnostics on top of that wording. The edge "card" (the role label pill) is a single line of localized role text; the edge popover SHOULD add the role's full meaning (the description, when localized) + the endpoint relationship + facets + diagnostics. The two popovers serve parallel roles ("show me the structured detail behind this compact surface") but their CONTENT differs because their underlying surfaces differ in how much they already show. Today's edge popover violates this by duplicating wording the cards already render; this task corrects the asymmetry.

4. **Removes a localization edge case.** The existing edge popover uses `moderator.hoverPopover.edgeEndpoints` to interpolate user-authored wording strings into a locale-neutral template. The wordings carry arbitrary user text that may contain unicode the catalog's typography-codepoint policy disallows. Dropping the wording-in-template path removes a class of edge cases entirely.

## Inputs / context

Code seams the implementation plugs into:

- `apps/moderator/src/graph/HoverPopover.tsx:84-88` — the `truncate()` helper. **Deleted** by this task; it has no other callers (verified by `grep -rn 'truncate' apps/moderator/src/graph/`).
- `apps/moderator/src/graph/HoverPopover.tsx:243-313` — the edge branch of the renderer. This task rewrites the body content per the section list under "What this task is."
- `apps/moderator/src/graph/HoverPopover.tsx:247-258` — the `endpointsLine = t('moderator.hoverPopover.edgeEndpoints', ...)` substitution. **Deleted** by this task; replaced by the new `endpointsLine = t('moderator.hoverPopover.edgeEndpointsReference', { sourceId, targetId })` substitution that interpolates ids, not wordings.
- `apps/moderator/src/graph/HoverPopover.tsx:288-293` — the `<p data-hover-popover-section="endpoints">` paragraph. **Replaced** by the new endpoints-reference paragraph with `data-hover-popover-source-id` / `data-hover-popover-target-id` attributes and a font-mono className for the id rendering.
- `apps/moderator/src/graph/selectors.ts:62-89` — `StatementEdgeData`. Gains `sourceId: string` + `targetId: string` (non-optional). The existing `sourceWording: string` + `targetWording: string` fields are **retained** despite no longer being consumed by the popover renderer — they remain useful for any future surface that wants endpoint wordings (the right sidebar's per-edge detail panel, the audit log, the diagnostic-popup detail surface, etc.) and are cheap to project. See Decisions for the "retain vs. drop the wording fields" call.
- `apps/moderator/src/graph/selectors.ts` — `selectEdgesForSession`. Populates the new `sourceId` / `targetId` fields directly from the `edge-created` event payload (`source_node_id` / `target_node_id`); no new event walk needed.
- `apps/moderator/src/graph/HoverPopover.test.tsx` — Vitest cases for the edge branch update from "renders truncated wording in the endpoints line" to "renders source/target ids in the endpoints line + omits wording from the popover." New cases added for the role-description seam (key-existence-driven render).
- `apps/moderator/src/graph/selectors.test.ts` — extension: `selectEdgesForSession` populates `data.sourceId` / `data.targetId` from `edge-created` payload; the existing `sourceWording` / `targetWording` enrichment continues to work.
- `tests/e2e/moderator-hover-details.spec.ts:162-196` — Test 4. The wording-prefix assertion goes away; role + endpoint references assertions land in its place.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json:156-158` — the `moderator.hoverPopover` namespace. The existing `edgeEndpoints` entry is **removed**; the new `edgeEndpointsReference` entry is **added**. Round-trip parity test in `packages/i18n-catalogs/src/methodology.test.ts:192-225` updates to assert the new template and remove the old one.

ADRs:

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the e2e assertion update + the Vitest case updates ship as committed test code.
- [ADR 0024 — Frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the new ICU template is added to all three locale catalogs; the round-trip parity check covers it.
- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — `<EdgeLabelRenderer>` remains the canonical extension point; nothing about the layering changes.

Refinements consulted for design continuity:

- `tasks/refinements/moderator-ui/mod_hover_details.md` — established the popover's structure, the `pointer-events: none` click-through requirement, the `role="tooltip"` + `aria-describedby` linkage, and the per-section `data-hover-popover-section` test seam pattern. This task's edge-branch rewrite preserves every one of those.
- `tasks/refinements/moderator-ui/mod_layout_measured_dimensions.md` — the reframe context that makes this task's choice coherent. Cited explicitly in Decisions.
- `tasks/refinements/moderator-ui/mod_node_handle_rendering.md` — the predecessor that registered this task as deferred debt. Its Status block names the registration.
- `tasks/refinements/moderator-ui/mod_edge_rendering.md` — pinned `<StatementEdge>`'s role-label-only rendering surface. This task's choice of "show endpoint references in the popover" is the natural completion of that asymmetry.

No new ADR is required. The task removes one ICU template, adds one ICU template (mechanical punctuation only, identical across locales), extends `StatementEdgeData` with two additive non-optional fields populated directly from already-present event data, and updates one e2e assertion + a handful of Vitest cases. No new dependency, no new design idiom, no cross-workspace contract change.

## Constraints / requirements

### Edge-popover content (after this task)

- **Role headline** — unchanged. `t('methodology.edgeRole.<role>')` rendered with `data-hover-popover-section="role"`.
- **Role description line** — conditional. Resolves `methodology.edgeRole.<role>.description`; renders only when the resolved string ≠ the key (i.e. the catalog has a description for this role in this locale). When omitted, no DOM is emitted for the section. The descriptions are NOT added to the catalog in this task — see Decisions for the naming of the follow-up.
- **Endpoint references row** — `data-hover-popover-section="endpoints"` paragraph. Renders the new ICU template `moderator.hoverPopover.edgeEndpointsReference` interpolating `{sourceId}` and `{targetId}`. Carries `data-hover-popover-source-id="<id>"` and `data-hover-popover-target-id="<id>"` attributes for stable test seams. Tailwind: `text-xs text-slate-700 font-mono break-all` — the `font-mono` flags the content as machine identifiers (not prose); `break-all` lets a long id wrap without overflowing the popover.
- **Per-facet status summary** — unchanged. The existing `FACET_RENDER_ORDER` iteration for the substance facet stays. Same `data-hover-popover-section="facets"` test seam.
- **Active-diagnostic line** — unchanged.
- **NO wording rendered.** The popover does NOT render source or target wordings under any path. This is the load-bearing contract change.

### Node popover (unchanged)

- The node branch of `<HoverPopover>` (lines 136–241) is **not** modified by this task. The node card and node popover both continue to render full wording per the existing design.

### `StatementEdgeData` shape

- New non-optional fields `sourceId: string` + `targetId: string`. Populated by `selectEdgesForSession` directly from `edge-created.payload.source_node_id` / `target_node_id` (no walk; these are always present on the event because the wire protocol requires them).
- Existing `sourceWording: string` + `targetWording: string` fields stay. They are no longer consumed by `<HoverPopover>`; they remain available for future surfaces (right sidebar's per-edge detail, audit log, diagnostic detail panel). Removing them would be scope creep and would touch every existing test case in `selectors.test.ts` that pins their projection — not worth it for this task. See Decisions.

### i18n

- **Add** `moderator.hoverPopover.edgeEndpointsReference` to all three catalogs. Value identical across locales: `"{sourceId} -> {targetId}"`. ASCII `->` per the typography-codepoint policy referenced in `mod_hover_details.md`'s Status section.
- **Remove** `moderator.hoverPopover.edgeEndpoints` from all three catalogs. Verified by `grep -rn 'edgeEndpoints' apps/` that no other consumer exists. The round-trip parity test in `packages/i18n-catalogs/src/methodology.test.ts:192-225` updates accordingly (the `describe('moderator.hoverPopover.edgeEndpoints round-trip', ...)` block is replaced by a `describe('moderator.hoverPopover.edgeEndpointsReference round-trip', ...)` block with parallel structure).
- **Do NOT add** `methodology.edgeRole.<role>.description` entries to any catalog in this task. The renderer's "render the line if the key resolves" pattern is the seam; a future `i18n_methodology_role_descriptions` task fills in the per-role descriptions in all three locales. The Vitest cases assert the conditional render path with a hand-built i18n instance that does (and doesn't) have the description key, exercising both branches.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided as the Acceptance bar.

**Updates to `apps/moderator/src/graph/HoverPopover.test.tsx`** — edge branch:

1. Remove the existing case that asserts `<HoverPopover>` renders the localized `"Supports: A -> B"` endpoints line via the old `moderator.hoverPopover.edgeEndpoints` template (the template no longer exists).
2. Remove the existing case that asserts `<HoverPopover>` truncates a > 60-char `sourceWording` (the truncate path is deleted).
3. **NEW**: edge target with `sourceId: 'src-1'`, `targetId: 'tgt-1'`, `role: 'supports'`: renders the endpoints line with text containing `"src-1"` and `"tgt-1"` and the `-> ` separator from the new template. Run across 3 locales × 1 role = 3 cases (the template is locale-identical so the same content lands in each).
4. **NEW**: the popover's `data-hover-popover-section="endpoints"` element carries `data-hover-popover-source-id="src-1"` and `data-hover-popover-target-id="tgt-1"`.
5. **NEW**: edge target with a long `sourceWording` (≥ 200 chars) and a long `targetWording`: assert the popover DOES NOT contain either wording text. This is the negative-path pin that complements the e2e negative assertions.
6. **NEW**: edge target with the role-description catalog key absent: the `data-hover-popover-section="role-description"` element is NOT in the DOM.
7. **NEW**: edge target with a fake i18n catalog that DOES carry `methodology.edgeRole.supports.description = "An edge from A to B that lends support to B's claim"`: the popover renders the description in a paragraph with `data-hover-popover-section="role-description"`.

**Updates to `apps/moderator/src/graph/selectors.test.ts`** — `StatementEdgeData` enrichment:

8. An `edge-created` event emits an `Edge<StatementEdgeData>` whose `data.sourceId` matches the event's `source_node_id` and `data.targetId` matches the event's `target_node_id`.
9. The pre-existing source/target wording enrichment cases continue to pass (no regression on `sourceWording` / `targetWording`).

**Updates to `packages/i18n-catalogs/src/methodology.test.ts`** — catalog round-trip:

10. The pre-existing `edgeEndpoints` round-trip block is replaced with an `edgeEndpointsReference` block of parallel structure: each locale resolves the new template with `{sourceId, targetId}` substitutions and produces output containing both id values + the `-> ` separator.
11. Add a negative assertion in the same block (or in the existing catalog-shape test): the `moderator.hoverPopover.edgeEndpoints` key NO LONGER resolves in any of the three locales (returns the literal key, indicating the catalog removal).

**Updates to `tests/e2e/moderator-hover-details.spec.ts`** — Test 4:

12. Remove `await expect(edgePopover).toContainText(TARGET_WORDING.slice(0, 60));` (the relaxed prefix-match assertion that registered the debt).
13. Keep `await expect(edgePopover).toContainText('Supports');` (role headline still surfaces).
14. Add `await expect(edgePopover).toContainText(NODE_ID);` and `await expect(edgePopover).toContainText(NODE_ID_OTHER);` (source + target ids appear in the popover).
15. Add `await expect(edgePopover.locator('[data-hover-popover-section="endpoints"]')).toHaveAttribute('data-hover-popover-source-id', NODE_ID);` and the symmetric target-id attribute assertion.
16. Add the **negative** assertions: `await expect(edgePopover).not.toContainText(SOURCE_WORDING.slice(0, 60));` and `await expect(edgePopover).not.toContainText(TARGET_WORDING.slice(0, 60));` — the popover no longer renders wordings under any path.
17. Update the inline comment block at lines 162–173 to remove the "prefix-match relaxation" prose and replace with a brief note that this task lifted the assertion to role + endpoint-references (preserving the historical reference to `mod_node_handle_rendering`'s registration).

### Build / type / test gates

- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count delta: roughly −2 (removed truncate / old-template cases) +5 (new endpoint-id / role-description cases) net ≈ +3).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm --filter @a-conversa/i18n-catalogs run check` passes (catalog parity).
- `pnpm exec playwright test --project chromium-moderator-hover` green against the dev compose stack — Test 4's assertions now hard-pass without the prefix-match relaxation.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_edge_popover_full_target_wording` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_edge_popover_full_target_wording.md"` line.

### UI-stream e2e scoping (per ORCHESTRATOR.md commit `28a71f9`)

The e2e assertion lives in the existing `tests/e2e/moderator-hover-details.spec.ts` Test 4 block — no new spec file, no new project entry. Rationale:

- The setup overlap with the existing block is total (same loginAs + same session-create + same seedWsStore).
- The assertion update is mechanical: drop one assertion, replace with three.
- Splitting would duplicate boilerplate for marginal isolation benefit.

The Playwright spec MUST stay green; it's the gate that pins the contract change. ORCHESTRATOR.md `f83852b` gates all UI-stream tasks on the auth-flow e2e and on the local spec for the modified surface — this task's local spec is `moderator-hover-details.spec.ts`, which now hard-asserts the new contract.

## Acceptance criteria

- `apps/moderator/src/graph/HoverPopover.tsx`'s edge branch (lines 243–313) no longer references `sourceWording` / `targetWording` and no longer imports / defines the `truncate()` helper. The edge popover renders role + (conditional) role-description + endpoint-references row + facets + diagnostic; the endpoint-references row carries `data-hover-popover-source-id` and `data-hover-popover-target-id` attributes and renders via the new `moderator.hoverPopover.edgeEndpointsReference` ICU template.
- `apps/moderator/src/graph/HoverPopover.tsx`'s node branch (lines 136–241) is **unchanged** by this task.
- `apps/moderator/src/graph/selectors.ts`'s `StatementEdgeData` carries non-optional `sourceId: string` + `targetId: string` fields; `selectEdgesForSession` populates them from each `edge-created` event's `source_node_id` / `target_node_id` (no walk). The existing `sourceWording` / `targetWording` fields stay.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry the new `moderator.hoverPopover.edgeEndpointsReference` entry and NO LONGER carry the `moderator.hoverPopover.edgeEndpoints` entry. The parity test in `packages/i18n-catalogs/src/methodology.test.ts` is updated to match.
- `apps/moderator/src/graph/HoverPopover.test.tsx` carries the 7 listed Vitest cases (3 endpoint-line locale cases + 1 data-attribute case + 1 negative-no-wording case + 2 role-description conditional cases). The 2 removed cases (old endpoints line + old truncate path) are gone.
- `apps/moderator/src/graph/selectors.test.ts` carries the new `sourceId` / `targetId` projection case.
- `tests/e2e/moderator-hover-details.spec.ts` Test 4 asserts role + endpoint references (positive) AND the absence of wordings (negative). The `TARGET_WORDING.slice(0, 60)` prefix-match line is removed. The inline comment block at lines 162–173 is updated.
- ADR 0022 — every change ships as a committed Vitest or Playwright test case; no throwaway verification.
- `pnpm run check` clean. `pnpm run test:smoke` green. `pnpm -F @a-conversa/moderator build` succeeds. `pnpm --filter @a-conversa/i18n-catalogs run check` passes. `pnpm exec playwright test --project chromium-moderator-hover` green against the dev compose stack. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_edge_popover_full_target_wording` plus the refinement-note line.
- No new ADR is created. No new dependency is added.

## Decisions

- **Option C — drop wording from the edge popover, surface role-description + endpoint node references instead.** Four options framed in the orchestrator brief; all four considered:
  1. **Option A — Lift the cap (full wording in popover).** Rejected. The card already shows full wording (verified per `mod_layout_measured_dimensions`); duplicating it in the popover is redundancy. The popover's job after the reframe is to surface what the compact rendering surface (the edge role pill) leaves out, NOT to re-render what's already on the canvas.
  2. **Option B — Contract the cap (60-char prefix as design contract).** Rejected for the same redundancy reason as Option A plus a deeper issue: the original "why truncate when the card doesn't?" tension is not resolved by codifying the truncation — it's papered over. The choice still doesn't answer "what does the popover add?"; it just declares the existing behavior is fine.
  3. **Option C — Drop wording from the edge popover entirely; surface role + role-description + endpoint references (node ids).** **Chosen.** The popover earns its existence on the edge surface by adding (i) the role's full meaning (the description line, when localized) and (ii) the endpoint relationship (source id + target id). Both are content the small role-pill on the edge cannot surface; both are content the cards cannot directly answer the question "what does THIS edge connect?" because the cards live elsewhere on the canvas. The endpoint-id row gives the moderator a visual cross-reference: hover the edge → see the source/target ids → glance at the matching `data-testid="statement-node-<id>"` cards on the canvas to recall context. The role-description seam (conditional on catalog key existence) is wired so a future i18n task can fill in the per-role descriptions without further code change.
  4. **Option D — Retire the edge popover entirely.** Rejected. The role label pill is small and shows ONLY the localized role — no facets, no diagnostics, no endpoints, no description. Dropping the popover would force the moderator to click-to-select + read the sidebar for every "what does this edge connect?" or "what does this role mean?" question; that's friction the canvas should absorb. Additionally, the existing per-facet status summary and diagnostic line in the edge popover are surfaces the role-label pill could plausibly stamp via `data-*` attributes but cannot render as readable content; the popover is the right layer for that detail.

  The reframe context (`mod_layout_measured_dimensions`'s Status section, commit `105d6fd`) makes Option C the only choice consistent with both the popover's "show what the compact surface leaves out" purpose and the asymmetry between the node card (shows wording) and the edge label (shows only role). Documented in the "Why it needs to be done" section above with explicit citation of the reframe.

- **Render node ids (not wordings) in the endpoint references row.** Three alternatives considered:
  1. **Render source / target wordings, truncated.** Rejected — the entire point of Option C is to stop duplicating card content. If the popover shows wordings (even truncated), it's re-rendering content that's already on the canvas a few pixels away.
  2. **Render short labels derived from the wordings (e.g. first 3 words).** Rejected — still card-derived content; same redundancy. Plus the derivation logic adds a renderer responsibility for no payoff.
  3. **Render node ids verbatim.** **Chosen.** Node ids are the canonical canvas-stable handle: every card stamps `data-testid="statement-node-<id>"`, every event references the node by id, every diagnostic targets the node by id. Rendering ids in the popover gives the moderator a visual cross-reference: hover the edge → see two ids → glance at the matching cards. The ids are short-ish (UUIDs are 36 chars; the popover's `max-w-[24rem]` + `break-all` + `font-mono` handles the line wrap). The `font-mono` class signals "this is a machine identifier, not prose" to the reader.

- **`data-hover-popover-source-id` + `data-hover-popover-target-id` as stable test seams.** Three test-seam shapes considered:
  1. **Rely on text content matching the node id.** Brittle — id strings are long and a future visual change (showing only the first 8 hex chars, say) would break the text-match assertion.
  2. **`data-hover-popover-source` / `data-hover-popover-target` attribute names (no `-id` suffix).** Rejected for ambiguity with the existing `data-hover-popover-section` pattern — "source" could mean "source wording" or "source id" or "source node ref." The `-id` suffix is explicit.
  3. **`data-hover-popover-source-id` / `data-hover-popover-target-id`.** **Chosen.** Mirrors the existing data-attribute naming pattern in the popover (`data-hover-popover-facet`, `data-hover-popover-section`, `data-hover-popover-diagnostic-severity`); the e2e + Vitest assertions can target these attributes without depending on rendered text.

- **`moderator.hoverPopover.edgeEndpointsReference` (new) vs. inline JSX.** Two rendering paths considered:
  1. **Inline JSX rendering the ids with no ICU template.** Simpler — no new catalog key. Rejected because the i18n-strict policy (per `mod_hover_details.md`'s Constraints) routes every popover string through the catalog, even punctuation-only strings, so the catalog is the single source of truth for what user-visible content the popover renders. The `-> ` separator is user-visible.
  2. **New `edgeEndpointsReference` ICU template with `{sourceId}` / `{targetId}` substitutions.** **Chosen.** Matches the established catalog-routing pattern. The template is locale-identical (pure punctuation, no prose) so the parity-test addition is mechanical.

- **Remove the `moderator.hoverPopover.edgeEndpoints` template from the catalogs (rather than leaving it as dead code).** Two cleanup options considered:
  1. **Leave the entry in place** — no other consumer references it, but the catalog parity test would continue to enforce it. Marginal harm; bigger catalog. Rejected because dead catalog entries become an unrelated stop-and-report trap when future tasks read the catalog wondering what `edgeEndpoints` is for.
  2. **Remove the entry from all three catalogs + update the parity test.** **Chosen.** Single source-of-truth hygiene; the parity test gets a parallel `edgeEndpointsReference` block + a negative assertion that the old key no longer resolves.

- **Retain `sourceWording` / `targetWording` on `StatementEdgeData` (do not drop them in this task).** Three options considered:
  1. **Drop both fields + the `wordingByNodeId` walk in `selectEdgesForSession`.** Tempting since the popover no longer consumes them. Rejected because: (a) every existing `selectors.test.ts` case that pins their projection would have to be deleted (regression-friendly); (b) future surfaces (the right sidebar's per-edge detail, a hypothetical audit-log view, the diagnostic-popup detail panel) plausibly want endpoint wordings; (c) the fields are cheap to project — the wording-walk is already O(N_events) and stays so. Out of scope; not worth the regression risk for a task scoped at 0.25d.
  2. **Drop the fields but keep the walk (for the map to be available)** — incoherent; the walk's only purpose is to enrich the fields.
  3. **Keep the fields, keep the walk; just stop consuming them in the popover.** **Chosen.** The popover's dependency on the fields is internal to `<HoverPopover>`; severing that consumer is the entire surface-area change. The field projection stays as a useful affordance for future surfaces.

- **`methodology.edgeRole.<role>.description` is wired as a seam but the descriptions are NOT added to the catalog in this task.** Two scope options considered:
  1. **Add the per-role descriptions to all three catalogs in-task.** Rejected because (a) it's a content-translation task disguised as a code task — each of the 7 edge roles needs a meaningful description in en-US, pt-BR, es-419, which is content design + translation work that wants its own refinement round; (b) the orchestrator brief explicitly scoped this task to 0.25d, and a 7×3 = 21 catalog entries of methodology prose would expand it; (c) the seam itself is what unblocks the e2e contract change — the descriptions can land in any future task without touching the popover code.
  2. **Wire the seam but defer the content.** **Chosen.** The popover renders the description line conditionally on i18next NOT returning the literal key (the standard miss-detection idiom). Today every locale's lookup misses and the line is omitted; the day a future `i18n_methodology_role_descriptions` task lands the descriptions, the line appears in every locale without further code change. Vitest cases cover both the miss path (current state) and the hit path (synthetic i18n instance with the description key).

- **No new ADR.** This task removes one ICU template, adds one ICU template, narrows the consumer surface of two existing `StatementEdgeData` fields, adds two new fields populated from already-present event data, and updates one e2e assertion. No new dependency, no new design idiom, no cross-workspace contract change.

- **e2e assertion lifted in-place in `moderator-hover-details.spec.ts` Test 4** — same rationale as `mod_node_handle_rendering`'s "drop the conditional in-place" decision. The setup overlap with the surrounding test block is total; splitting would duplicate boilerplate.

## Open questions

(none — all decided)

## Status

- **Option C chosen** — drop source/target wording from the edge popover; the card now structurally shows full wording per `mod_layout_measured_dimensions` (commit `105d6fd`), so duplicating wording in the popover is redundancy. The popover earns its existence by surfacing what the role pill leaves out: the role (reinforced as a headline), the role's full meaning (conditional description line), and the endpoint relationship (source/target node ids).
- **Popover content swap** — `HoverPopover.tsx` edge branch now renders: role headline (unchanged) + conditional `data-hover-popover-section="role-description"` paragraph (key-existence-driven render via `methodology.edgeRole.<role>.description`) + new `data-hover-popover-section="endpoints"` row showing `{sourceId} -> {targetId}` in `font-mono break-all`. The `truncate()` helper is removed; the wording-in-popover path is gone in every code path.
- **i18n catalog key rotation** — `moderator.hoverPopover.edgeEndpoints` REMOVED from `en-US.json` / `pt-BR.json` / `es-419.json`; `moderator.hoverPopover.edgeEndpointsReference` ADDED in all three (identical value `"{sourceId} -> {targetId}"` per the ASCII typography policy). `packages/i18n-catalogs/src/methodology.test.ts` parity test rewritten from the old key to the new one, with a negative-resolution assertion pinning that the retired key no longer resolves in any of the three locales (113 tests pass).
- **Data-attribute seams** — `data-hover-popover-source-id` + `data-hover-popover-target-id` attributes stamp the endpoints row, mirroring the established `data-hover-popover-*` naming pattern. Both the new Vitest cases on `HoverPopover.test.tsx` and Playwright Test 4 in `moderator-hover-details.spec.ts` assert against these attributes rather than rendered text.
- **`StatementEdgeData` enrichment** — `sourceId: string` and `targetId: string` added as non-optional fields, populated directly from each `edge-created` event's `source_node_id` / `target_node_id` (no walk). `sourceWording` / `targetWording` retained for future surfaces (right sidebar per-edge detail, audit log, diagnostic-popup detail panel); the popover simply stops consuming them.
- **Reframe context honored** — the `mod_layout_measured_dimensions` Status block's "this reframes the still-open `mod_edge_popover_full_target_wording` decision" call is the load-bearing antecedent. With measured-dimensions feeding dagre, the card visibly grows to fit its full content; the popover's original "show the wording the card truncates" motivation is gone, and Option C is the only choice consistent with the popover's "show what the compact surface leaves out" purpose. Closes the relaxed-assertion debt from `mod_node_handle_rendering` (commit `bcbe51a`) — Playwright Test 4 now uses positive (role + node-ids + data-attrs) plus negative (no wording slice) assertions, with the 60-char prefix-match line removed.
- **Tech-debt registration** — `frontend_i18n.i18n_methodology_role_descriptions` registered in `tasks/35-frontend-i18n.tji` in this commit per the ORCHESTRATOR.md `b7c5ff0` policy. The role-description seam is wired and key-existence-driven; once that task lands `methodology.edgeRole.<role>.description` entries for the seven edge roles in all three v1 locales, the popover automatically surfaces the description on hover without further code change.
