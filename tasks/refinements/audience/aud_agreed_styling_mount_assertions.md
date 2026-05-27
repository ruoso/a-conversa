# Audience agreed-state mount-time assertions (two deferred Vitest cases pinning that `[rollupStatus = 'agreed']` actually fires on a mounted element)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_agreed_styling_mount_assertions` (lines 177-189).
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_agreed_styling` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:139`](../../50-audience-and-broadcast.tji#L139); refinement at [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md)). That leaf landed two `STYLESHEET` selector entries (`node[rollupStatus = 'agreed']` → `border-color: '#334155'` and `edge[rollupStatus = 'agreed']` → `line-color: '#334155'`, `target-arrow-color: '#334155'`) plus two **structural** Vitest cases (w, x at [`apps/audience/src/graph/GraphView.test.tsx:551-561`](../../../apps/audience/src/graph/GraphView.test.tsx#L551)). The two **mount-time** cases from its Constraints spec (cases 3 + 4 at [`tasks/refinements/audience/aud_agreed_styling.md:115-116`](aud_agreed_styling.md#L115)) were explicitly deferred to this task in its Status block at [`aud_agreed_styling.md:243`](aud_agreed_styling.md#L243) — they require the projection-time `data.rollupStatus` emission that `aud_proposed_styling` owned but had not yet shipped at the time `aud_agreed_styling` landed.
- `!audience.aud_graph_rendering.aud_proposed_styling` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:119`](../../50-audience-and-broadcast.tji#L119); refinement at [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md)). That leaf landed the heavy plumbing this task consumes: the `apps/audience/src/graph/facetStatus.ts` port, the `data.rollupStatus` + `data.facetStatuses` emission inside `projectGraph`, and the `'none'` sentinel. With the predecessor shipped, the deferred mount-time cases below can now actually run — a projected element whose facet record resolves to `'agreed'` will carry `data.rollupStatus === 'agreed'` on the live Cytoscape instance, and the existing `node[rollupStatus = 'agreed']` selector entry will match it.
- Prose-only context (NOT a `.tji` edge): [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — established the `cytoscapeTestEnv` install / restore handle ([`apps/audience/src/graph/cytoscapeTestEnv.ts`](../../../apps/audience/src/graph/cytoscapeTestEnv.ts)) and the `renderView()` / `cyRef`-capture seam at [`apps/audience/src/graph/GraphView.test.tsx:224-240`](../../../apps/audience/src/graph/GraphView.test.tsx#L224) that this task reuses verbatim. No new test infrastructure lands.

## What this task is

The 0.25d test-only follow-up that pays down the deferred mount-time assertions from `aud_agreed_styling`. Two new Vitest cases land in [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx), mirroring the proposed-state cases (`aa`, `bb`) that `aud_proposed_styling` already landed inline ([L579-605](../../../apps/audience/src/graph/GraphView.test.tsx#L579)) — same pattern (`renderView()`, seed events, capture `cy`, assert `cy.getElementById(id).style(...)`), different state target (`'agreed'` rather than `'proposed'`).

After this leaf:

- A new case asserts that after mounting `<AudienceGraphView>` with an event sequence whose projection puts a node into `rollupStatus === 'agreed'`, the live Cytoscape instance reports the node's computed `border-color` as `rgb(51, 65, 85)` (the resolved hex literal `#334155`).
- A new symmetric case asserts the same for an edge — computed `line-color` resolves to `rgb(51, 65, 85)` after mount.
- The total Vitest count in `GraphView.test.tsx` rises by 2, from 28 (the post-`aud_proposed_styling` baseline) to 30. The 28 baseline cases continue to pass unchanged.

What this task does NOT do:

- **No new selector entry, no `STYLESHEET` edit.** The selector pair this leaf pins was already landed by `aud_agreed_styling`; the JSDoc + header-trail prose was already updated when the proposed-state predecessor relaxed the "not yet emitted" caveat at [`aud_proposed_styling.md:137`](aud_proposed_styling.md#L137). This task only adds test cases.
- **No edit to `projectGraph.ts` / `facetStatus.ts` / `layoutOptions.ts` / `cytoscapeTestEnv.ts`.** The data fixtures these tests rely on (the `data.rollupStatus` field on projected elements, the `'agreed'` rule firing on the right event combination) are owned by the predecessor leaves; this task consumes them.
- **No new component / new mount path.** `renderView()` + `seedEvent()` are reused as-is.
- **No proposed-state mount-time work.** That pair already landed as cases (aa) and (bb) when `aud_proposed_styling` shipped; this task does not duplicate it. Decision §1 below documents why the predecessor's framing ("agreed-state and proposed-state mount assertions") collapses to "the agreed-state pair" in practice.
- **No Playwright spec.** The audience surface is still not reachable through any user-flow route (the wildcard at [`apps/audience/src/App.tsx:124`](../../../apps/audience/src/App.tsx#L124) still maps every path to the placeholder). The deferred-e2e exception still applies; pixel-stability for per-state styling is already deferred to `aud_visual_regression` by `aud_agreed_styling` Decision §5 and `aud_proposed_styling` Decision §6 — this task does NOT add a new e2e debt entry on top.

## Why it needs to be done

The structural cases (w, x) that `aud_agreed_styling` landed pin that the `STYLESHEET` array, as an object, contains the right selector + style fields. They do NOT pin that Cytoscape's stylesheet parser actually consumes those entries, or that the attribute-equality matcher (`[rollupStatus = 'agreed']`) actually fires when a real projected element carries `data.rollupStatus === 'agreed'`. Three failure modes are invisible to the structural pair but visible to the mount-time pair this task adds:

- **Typo in the selector string** — `node[rollupStatus = 'agreed']` (with spaces around `=`) vs `node[rollupStatus='agreed']` (without). Both pass the structural assertion if the typo is symmetric across `STYLESHEET` and the assertion string; both differ in Cytoscape's parse behaviour across versions. The mount-time assertion catches the case where the structural test reads the same typo'd string the stylesheet ships, so equality holds but the actual element never matches.
- **Field-name typo in the style object** — `border-color` vs `borderColor` (Cytoscape accepts kebab-case in stylesheet definitions but JavaScript object literal access reads either; if the structural assertion uses one form and the stylesheet ships the other, equality holds via JS coercion but Cytoscape's renderer never picks it up). Caught by `cy.getElementById(id).style('border-color')` returning the literal default tone instead of the slate-700 override.
- **Data-emission regression** — if a future change to `projectGraph` (or to `facetStatus.ts` / `cardRollupStatus`) accidentally drops the `data.rollupStatus` field for the agreed-state branch, every per-state selector silently misses. The mount-time assertion catches this because it checks the computed style on the live Cytoscape instance, not the projection output.

The proposed-state pair (aa, bb at [L579-605](../../../apps/audience/src/graph/GraphView.test.tsx#L579)) already pins these failure modes for the proposed-state selectors. Adding the agreed-state pair closes the asymmetry — the two state-styling leaves shipped at the same depth of regression coverage end up at the same depth of regression coverage after this task.

Downstream concretely:

- **`aud_disputed_styling` and `aud_meta_disagreement_split`** (the next two per-state leaves under `aud_graph_rendering`) will likely use the (aa, bb, this-task's-pair) cases as the template for their own mount-time pin pair. Without the agreed-state pair, the implementer of those tasks has to choose between "match the proposed-state precedent only" and "match both" — leaving the asymmetry in place would push the cost of resolution onto each successor task, instead of paying it down once here.
- **`aud_visual_regression`** ([`tasks/50-audience-and-broadcast.tji:333-360`](../../50-audience-and-broadcast.tji#L333)) is the pixel-level coverage; it does not subsume the mount-time check (visual regression confirms the pixels match across runs; the mount-time check confirms the selector → style → render path works *at all*). The two layers are complementary, not redundant.
- **The named-future-task `aud_stylesheet_module_extraction`** (~0.25d, registered by [`aud_clean_typography.md`](aud_clean_typography.md) Decision §4 + `aud_agreed_styling.md` Decision §3 footer) fires when the third per-state sibling lands. When it does, the extraction touches `STYLESHEET`'s file location but not its contents; the mount-time cases here remain the regression pin that the extraction did not break per-state selector firing.

## Inputs / context

### ADRs

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the two Vitest cases below are the regression coverage for the deferred mount-time pin. No "I ran the audience locally and the agreed-state node was visibly darker" smoke. The visible-rendering pin remains deferred to `aud_visual_regression` per its inherited deferrals from the two predecessor leaves.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — Rule 7 (every current participant voted `agree` on the current candidate for the facet) is the rule that puts a facet into `'agreed'`. Decision §2 below picks the smallest event sequence that exercises this rule for the mount-time fixture.
- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape's attribute-equality selectors (`[rollupStatus = 'agreed']`) are the seam this task validates. The mount-time assertion goes through Cytoscape's `.style(...)` resolver, exercising the same parse + match path the production canvas does.
- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md) — the event log feeding `seedEvent()` follows the discriminated-union envelope shape; the helpers `nodeCreatedEvent` / `edgeCreatedEvent` / `classifyProposalEvent` / `commitEvent` defined at [`GraphView.test.tsx:102-188`](../../../apps/audience/src/graph/GraphView.test.tsx#L102) emit envelopes matching the canonical shape. A new helper for the participant-joined / vote events the agreed-state fixture needs follows the same pattern.

### Sibling refinements

- [`tasks/refinements/audience/aud_agreed_styling.md`](aud_agreed_styling.md) — the leaf this task closes the loop on. Its Constraints cases 3 + 4 ([L115-116](aud_agreed_styling.md#L115)) are the verbatim spec for the two cases this task lands. Its Status block ([L243](aud_agreed_styling.md#L243)) names this task as the deferral target.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md) — the cross-state precedent. Its Constraints cases 3 + 4 ([L160-161](aud_proposed_styling.md#L160)) shipped inline (because the leaf owned the emission); the two new agreed-state cases here mirror that pair's pattern.
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — the mount + `cyRef` + `cytoscapeTestEnv` infrastructure. The `renderView()` helper at [`GraphView.test.tsx:224-240`](../../../apps/audience/src/graph/GraphView.test.tsx#L224) is the testability seam this task reuses.

### Live code the leaf modifies

- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — the only file this task modifies. Two new test cases land after the existing proposed-state pair (after line 605); the header refinement-trail block (lines 1-60) gains a one-line-per-decision summary for this refinement, and the `aud_agreed_styling` trail entry's caveat ("the two mount-time cases the refinement also scopes defer to `aud_proposed_styling`") is rewritten to point to this task as the target where they actually landed.

### Live code consumed but not modified

- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — the agreed-state selector entries the new cases match against are at [L131-141](../../../apps/audience/src/graph/GraphView.tsx#L131) (verify exact line numbers at implementation time; the post-`aud_proposed_styling` state of the file has them appended after the baseline `node` / `edge` entries and before the proposed-state pair). The `STYLESHEET` constant is exported and consumed by the test file via the existing import at [`GraphView.test.tsx:72-79`](../../../apps/audience/src/graph/GraphView.test.tsx#L72).
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — the `computeFacetStatuses` + `cardRollupStatus` integration that emits `data.rollupStatus` on each element. The new tests trust this emission and check the downstream Cytoscape `.style()` resolution; they do NOT re-test the projection (`projectGraph.test.ts` is the regression pin for that layer).
- [`apps/audience/src/graph/facetStatus.ts`](../../../apps/audience/src/graph/facetStatus.ts) — the eight-rule derivation engine. The new test fixtures rely on Rule 7 firing for the agreed state; if a future refactor changes which rule produces `'agreed'`, `facetStatus.test.ts` is the regression pin, not this file.

### What the surface MUST NOT do

- **No edit to `STYLESHEET` in `GraphView.tsx`.** The selector entries this task pins are already in place.
- **No edit to `projectGraph.ts` / `facetStatus.ts` / `cytoscapeTestEnv.ts` / `layoutOptions.ts`.** Test infrastructure and projection logic are unchanged.
- **No new test file.** The two cases land in the existing `GraphView.test.tsx`; no `GraphView.agreedStyling.test.tsx` split. The existing file already contains the proposed-state mount-time pair; the agreed-state pair belongs in the same describe block for parallel readability.
- **No edit to `package.json`, `vitest.config.ts`, or `tsconfig.json`.** No new dependency; no new test setup.
- **No `await new Promise(setTimeout, n)` polling in the test cases.** Cytoscape's element-sync runs synchronously inside the React `useEffect` triggered by the event-store update; `seedEvent()` wraps the store call in `act(...)` and the existing proposed-state pair confirms the cy instance has the right `data.rollupStatus` immediately after seeding (no awaits). The agreed-state pair follows the same pattern.
- **No Playwright spec.** Component still not reachable per [`apps/audience/src/App.tsx:124`](../../../apps/audience/src/App.tsx#L124). The deferred-e2e routing established by the predecessor leaves' Decisions §5/§6 carries; this task does NOT register a new pixel-stability deferral on `aud_visual_regression` because the predecessor already did.
- **No edit to `.tji` files** beyond `complete 100` (the closer's ritual).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Two diff regions:

  - Header refinement-trail block (lines 1-60). The existing `aud_agreed_styling` trail entry (lines 24-34) has a closing caveat ("the two mount-time cases the refinement also scopes defer to `aud_proposed_styling` — the projection-time `data.rollupStatus` emission is owned there and not yet in the tree; the structural pins here are sufficient regression coverage until that predecessor ships"). Rewrite that caveat to point to this task as the landed-here-now target. Add a new `aud_agreed_styling_mount_assertions` trail entry immediately after the `aud_proposed_styling` entry, summarizing the two new cases and the rationale for closing the symmetry gap.

  - Two new cases appended inside the `describe('<AudienceGraphView>', ...)` block at [L242-606](../../../apps/audience/src/graph/GraphView.test.tsx#L242), after the existing case (bb) at L593-605 (suggested case identifiers: `cc` and `dd` — sequential continuation of the alphabetical case index used throughout the file):

    1. `(cc) a node whose rollupStatus resolves to "agreed" carries the agreed-state computed style` — seed an event sequence that produces `data.rollupStatus === 'agreed'` on a projected node (the exact sequence is per Decision §2 below: a `participant-joined` event for one participant, a `node-created` event, a `classify-node` proposal, and an `agree` vote from that participant on the proposal — the smallest sequence that exercises Rule 7 of the `facetStatus.ts` derivation). Mount via `renderView()`, assert `cy.getElementById(NODE_A).data('rollupStatus')` equals `'agreed'` (regression pin against a projection-emission drop), and assert `cy.getElementById(NODE_A).style('border-color')` equals `'rgb(51, 65, 85)'`.

    2. `(dd) an edge whose rollupStatus resolves to "agreed" carries the agreed-state computed style` — same pattern, but the agreed facet is the edge's `shape` (per ADR 0030 §5 + the post-`pf_part_facet_name_widen_shape` rule set the audience inherits). Seed `participant-joined`, two `node-created` events, an `edge-created` (which seeds the shape facet to `'proposed'` per Rule 8 inline), an `agree` vote on the implicit shape proposal. Mount, assert `data.rollupStatus === 'agreed'` and `style('line-color') === 'rgb(51, 65, 85)'`.

  The two new cases require new event-emitting helpers (`participantJoinedEvent`, `voteEvent`) that the existing helpers list at [L102-188](../../../apps/audience/src/graph/GraphView.test.tsx#L102) does not yet cover. Add them inline in the same file, matching the existing helpers' shape (typed `Event` payload, `sequence` parameter, deterministic `id` derivation). Reuse the participant's analogous helpers as the line-by-line template — `apps/participant/src/graph/GraphView.test.tsx` and `apps/participant/src/graph/facetStatus.test.ts` both construct the same shape; the audience port lifted the projection but not the test helpers, so this task adds the missing two helpers as a small extension.

### Files this task does NOT touch

- `apps/audience/src/graph/GraphView.tsx` — UNCHANGED. Stylesheet entries already in place from `aud_agreed_styling`.
- `apps/audience/src/graph/projectGraph.ts` — UNCHANGED. Emission already in place from `aud_proposed_styling`.
- `apps/audience/src/graph/projectGraph.test.ts` — UNCHANGED. Projection-layer regression already pinned.
- `apps/audience/src/graph/facetStatus.ts` / `apps/audience/src/graph/facetStatus.test.ts` — UNCHANGED.
- `apps/audience/src/graph/layoutOptions.ts` / `.test.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` / `.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx`, `apps/audience/src/index.css`, `apps/audience/src/main.tsx` — UNCHANGED.
- `apps/audience/src/state/**`, `apps/audience/src/ws/**` — UNCHANGED.
- `apps/audience/package.json`, `apps/audience/tsconfig.json`, `apps/audience/vitest.config.ts` — UNCHANGED. No new dependency, no new test config.
- `apps/participant/**`, `apps/moderator/**`, `apps/root/**`, `apps/server/**` — UNCHANGED. The two new test helpers are added to `GraphView.test.tsx` locally (the audience workspace already has its own copies of every shared test helper; cross-workspace test imports are not used).
- `packages/**` — UNCHANGED.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §3).
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Component still not reachable; no e2e debt.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md). No new edges, no new tasks registered.

## Acceptance criteria

The check that says "done":

- `apps/audience/src/graph/GraphView.test.tsx` has two new test cases inside the `<AudienceGraphView>` describe block, after case (bb), labelled (cc) and (dd). Each case mounts the component via `renderView()`, seeds an event sequence that produces `data.rollupStatus === 'agreed'` on a target element (node for (cc), edge for (dd)), and asserts both `cy.getElementById(id).data('rollupStatus') === 'agreed'` and `cy.getElementById(id).style(...)` resolves to `'rgb(51, 65, 85)'` for the relevant property (`border-color` on the node, `line-color` on the edge).
- The total Vitest case count in `GraphView.test.tsx` rises by 2 (from 28 to 30). The 28 baseline cases continue to pass unchanged.
- Two new event-emitting helpers (`participantJoinedEvent`, `voteEvent`) are added to the helpers section ([L102-188](../../../apps/audience/src/graph/GraphView.test.tsx#L102) area) matching the existing helpers' shape.
- The header refinement-trail block is updated: the `aud_agreed_styling` entry's closing caveat is rewritten to point to this task as the where-the-mount-cases-landed target; a new `aud_agreed_styling_mount_assertions` trail entry is appended after the `aud_proposed_styling` entry.
- `apps/audience/src/graph/GraphView.tsx` is UNCHANGED (no edit to `STYLESHEET`, no header-trail edit on the component file — only the test file gets a trail entry, mirroring how `aud_proposed_styling` did NOT need a `GraphView.tsx` trail entry for cases (aa) / (bb)).
- `apps/audience/package.json` is UNCHANGED — no new dependency.
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- No new Playwright spec, no new e2e debt. The per-state pixel-stability deferrals on `aud_visual_regression` already registered by `aud_agreed_styling` Decision §5 and `aud_proposed_styling` Decision §6 are the correct destination; this task does NOT register a new one (Decision §4).
- `pnpm run check` clean (strict TS pass; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by **2** new cases in `GraphView.test.tsx`; `facetStatus.test.ts` / `projectGraph.test.ts` counts unchanged).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is zero (no source change; only test additions).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_agreed_styling_mount_assertions` in the same commit (the closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The two new Vitest cases ARE the regression coverage that pins the selector firing + computed-style resolution path end-to-end.

## Decisions

### §1 — Scope: agreed-state pair only; proposed-state mount-time coverage already shipped

The orchestrator's task brief framed this task as "mount-level assertions verifying agreed-state and proposed-state Cytoscape styling actually reaches the DOM/canvas from AudienceGraphView." Three readings of that framing:

- **(A — chosen)** Treat "agreed-state and proposed-state" as the broader subject area; recognize that the proposed-state mount-time pair already shipped inline with `aud_proposed_styling` as cases (aa) and (bb) at [`GraphView.test.tsx:579-605`](../../../apps/audience/src/graph/GraphView.test.tsx#L579) — because that leaf owned the emission those assertions require and could test it inline. The deferred debt is *only* the agreed-state pair (the two cases `aud_agreed_styling` Constraints cases 3 + 4 spec). This task lands exactly those two cases. Cost: small scope; the task does what its name says. Benefit: no duplication of (aa) / (bb); no over-scope creep.
- **(B)** Re-land the proposed-state mount-time pair in this task too (delete-and-rewrite (aa) / (bb)). Cost: pure churn — the existing cases work, are passing, and are the exact pattern this task is meant to mirror. Benefit: none. Rejected as no-op churn.
- **(C)** Add additional state-coverage cases (a precedence case: a node carrying both proposed and agreed facets has `rollupStatus === 'proposed'` per `ROLLUP_PRIORITY`; a disputed-state case; etc.). Cost: scope creep past the 0.25d budget; the precedence rule is already pinned at the `facetStatus.test.ts` layer via the `cardRollupStatus` cases the participant suite ships. The disputed-state case belongs to `aud_disputed_styling`'s own mount-time pair when it lands. Benefit: marginal — the GraphView layer is for selector + emission integration; the rule layer is for derivation. Rejected — keep this task surgical.

The `aud_agreed_styling.md` Status block at [L243](aud_agreed_styling.md#L243) is unambiguous: "Mount-time assertions (cases 3 and 4 from the Constraints spec) deferred to `aud_agreed_styling_mount_assertions`." Two cases, one node + one edge. The task name's "_mount_assertions" (singular subject "agreed_styling") corroborates the agreed-state-only scope.

No ADR required — this is a scope-clarification decision, not architectural.

### §2 — Fixture: smallest event sequence that fires Rule 7 of `facetStatus.ts` for both the node and edge cases

`facetStatus.ts` (ported verbatim from the participant) derives `'agreed'` via Rule 7: "every current participant voted `agree` on the current candidate for the facet, and no commit has landed." The smallest event sequence that fires this rule depends on the facet type:

- **For a node (case cc) — the `classification` facet:**
  1. `participant-joined` for one participant (so `current participants = 1`; Rule 7's "all of zero" edge case is avoided — the participant's existing test suite documents that 0 current participants produces `'awaiting-proposal'` or `'proposed'` per Rule 8 default, not `'agreed'`).
  2. `node-created` for `NODE_A`.
  3. `proposal` envelope carrying `{ kind: 'classify-node', node_id: NODE_A, classification: 'fact' }`.
  4. `vote` event from the joined participant with `vote: 'agree'` targeting the proposal envelope.

  After projection: `facetStatusIndex.nodes.get(NODE_A).classification === 'agreed'`, `cardRollupStatus(record) === 'agreed'`, `data.rollupStatus === 'agreed'`.

- **For an edge (case dd) — the `shape` facet:**
  1. `participant-joined` for one participant.
  2. Two `node-created` events for `NODE_A` and `NODE_B` (edge endpoints).
  3. `edge-created` for `EDGE_A` connecting them (per ADR 0030 §5 + the `pf_part_facet_name_widen_shape` rule extension the audience inherits, an `edge-created` seeds the `shape` facet inline at `'proposed'`).
  4. The shape facet's "current candidate" is the edge's seeded shape; a `vote` event with `vote: 'agree'` on the implicit shape candidate puts the facet into `'agreed'`.

  After projection: `facetStatusIndex.edges.get(EDGE_A).shape === 'agreed'`, `cardRollupStatus(record) === 'agreed'`, `data.rollupStatus === 'agreed'`.

Three approaches to fixture scope:

- **(A — chosen)** The minimal-rule-firing sequence above. Cost: requires two new event-emitting helpers (`participantJoinedEvent`, `voteEvent`) in `GraphView.test.tsx` — small, ~30 lines combined, mirroring the existing helpers' shape. Benefit: the test stays close to a real broadcast session's event log, exercising the same projection + derivation path production audience surfaces traverse; the fixture is self-documenting.
- **(B)** Stub `projectGraph` so it directly emits `data.rollupStatus === 'agreed'` without running the derivation. Cost: the test no longer exercises `facetStatus.ts` / `projectGraph`'s integration — it tests only the stylesheet layer. The failure modes the test is meant to catch (data-emission regression in particular) are no longer caught. Rejected.
- **(C)** Reuse an existing test fixture from `facetStatus.test.ts` that already builds an agreed-state record, then feed it through `projectGraph` manually. Cost: cross-file fixture coupling; the `facetStatus.test.ts` fixtures are sized for the derivation engine, not for the projection. Benefit: smaller helper code. Rejected — the projection's role is exactly to translate the rule output into element data; the GraphView mount-time pair is the integration check and needs to drive the full pipeline.

The participant's analogous test (`apps/participant/src/graph/GraphView.test.tsx`, the cases pinning agreed-state mount-time computed style) uses Option A's shape; the audience mirror follows the precedent.

No ADR required — fixture-construction is a test-design decision.

### §3 — Two new helpers (`participantJoinedEvent`, `voteEvent`) added inline; no extraction to a shared test-helper module

The audience workspace already inlines its own copies of every test helper it needs (e.g., `nodeCreatedEvent` / `edgeCreatedEvent` / `classifyProposalEvent` / `commitEvent` at [L102-188](../../../apps/audience/src/graph/GraphView.test.tsx#L102), each a small ~15-line function emitting a discriminated-union `Event` envelope). The same convention applies to the two new helpers this task adds.

Three approaches:

- **(A — chosen)** Add `participantJoinedEvent` and `voteEvent` inline in `GraphView.test.tsx`, matching the existing helpers' shape (typed payload, `sequence` parameter, deterministic UUID derivation per the existing namespace pattern). Cost: two new helper functions in the same file, ~30 lines total. Benefit: the test file stays self-contained; no cross-file indirection for a 0.25d task; the file's existing convention is followed.
- **(B)** Extract a `apps/audience/src/graph/__test-helpers__/eventEnvelopes.ts` module and consolidate all six helpers (four existing + two new). Cost: a refactor that touches every existing test case using those helpers; out of scope for a 0.25d mount-assertion task; the existing helpers' purpose is local to `GraphView.test.tsx` and `projectGraph.test.ts` (which has its own copies). Rejected — wrong task for the refactor.
- **(C)** Reuse helpers from `apps/audience/src/graph/projectGraph.test.ts` via a relative import. Cost: cross-test-file imports are an established anti-pattern (the participant and moderator workspaces both inline their helpers per file, not import them across files); also, `projectGraph.test.ts` does not currently export its helpers — it would need a refactor to do so. Rejected.

A possible future shared-helper-extraction task (`audience_test_event_helpers_extraction`, ~0.25d) is a named-future-task the closer-or-maintainer can register only if a third audience test file materializes that needs the same helpers. Today only two files (`GraphView.test.tsx` + `projectGraph.test.ts`) construct events; two callers is YAGNI per [`aud_cytoscape_init.md`](aud_cytoscape_init.md) Decision §4's named extraction trigger. This task does NOT register the future task in the WBS — the trigger is empirical (a third test file appears).

No ADR required.

### §4 — No new pixel-stability deferral on `aud_visual_regression`

Both predecessor leaves already deferred per-state pixel-stability to `aud_visual_regression`:

- `aud_agreed_styling.md` Decision §5 routed agreed-state pixel-stability there (extending the existing note with agreed-state coverage).
- `aud_proposed_styling.md` Decision §6 did the same for proposed-state pixel-stability.

This task is test-only (Vitest) and does NOT modify the rendered styling itself — the computed `border-color` / `line-color` values were already pinned at the structural layer by `aud_agreed_styling`'s cases (w, x). The pixel-level rendering check is already covered by the inherited deferrals.

Three approaches:

- **(A — chosen)** Do not register a new pixel-stability deferral. The two predecessor leaves' deferrals carry; this task closes the symmetry gap at the Vitest layer and does not introduce new pixel-rendering work. Cost: none. Benefit: `aud_visual_regression`'s inheritance count stays at the current threshold (it already inherits from `aud_layout_engine`, `aud_clean_typography`, `aud_agreed_styling`, `aud_proposed_styling`); not adding a fifth-pointing-at-the-same-thing is the right call per the `ORCHESTRATOR.md` "2+ refinements, pay down" rule.
- **(B)** Add a duplicate deferral entry on `aud_visual_regression` for "agreed-state mount-time pin pixel-stability." Cost: planning debt — the pixel-stability work is identical to what `aud_agreed_styling` Decision §5 already routed; restating it bloats the destination task's note for no new coverage. Rejected.
- **(C)** Register a new pixel-stability task. Cost: planning debt for no architectural reason. Rejected.

No ADR required.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/graph/GraphView.test.tsx` — header refinement-trail block updated: `aud_agreed_styling` entry caveat rewritten to point at this leaf; new `aud_agreed_styling_mount_assertions` trail entry appended after `aud_proposed_styling`.
- `apps/audience/src/graph/GraphView.test.tsx` — `FacetName` import and `PARTICIPANT_A` constant added; two new helpers (`participantJoinedEvent`, `voteEvent`) added inline, matching existing helpers' shape.
- `apps/audience/src/graph/GraphView.test.tsx` — case (cc): node whose `rollupStatus` resolves to `'agreed'` via `participant-joined` + `node-created` + `classify-node` proposal + `agree` vote; asserts `data('rollupStatus') === 'agreed'` and `style('border-color') === 'rgb(51,65,85)'`.
- `apps/audience/src/graph/GraphView.test.tsx` — case (dd): edge whose `rollupStatus` resolves to `'agreed'` via `participant-joined` + two `node-created` + `edge-created` + `agree` vote on inline-seeded shape; asserts `data('rollupStatus') === 'agreed'` and `style('line-color') === 'rgb(51,65,85)'`.
- Total Vitest cases in `GraphView.test.tsx` rose from 28 to 30; 28 baseline cases unchanged.
- Color literal used: `rgb(51,65,85)` (no spaces — Cytoscape `parse.mjs` stylesheet path) rather than refinement's `rgb(51, 65, 85)`.
- No `STYLESHEET` edit, no projection-layer edit, no new test file, no Playwright spec — scope is test-only as specified.
- `tasks/50-audience-and-broadcast.tji` — `complete 100` added to `aud_agreed_styling_mount_assertions` (closer's ritual).
