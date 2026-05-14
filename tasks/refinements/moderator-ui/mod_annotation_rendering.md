# Moderator annotation rendering (badges decorating their target node / edge)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_annotation_rendering` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `StatementNode` + `projectNodes` populate `data` from the WS log).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `StatementEdge` + `selectEdgesForSession` populate edge `data`).
- `frontend_i18n.i18n_methodology_glossary` (done — `methodology.annotationKind.{note,reframe,scope-change,stance}` resolve in en-US / pt-BR / es-419).

## What this task is

Render `annotation-created` events from the WS event log as **badges decorating the annotation's target** — a node or an edge. Each badge is a small pill on the target's card / label showing the localized annotation-kind label (note / reframe / scope-change / stance). Hovering the badge surfaces the annotation's `content` via the `title` attribute. A target may carry multiple annotations of multiple kinds; the badges stack horizontally inside the target's decoration row.

This task lands:

- `selectAnnotations(state, sessionId)` in `apps/moderator/src/graph/selectors.ts` — a pure selector that walks the WS event log and emits a typed `Annotation[]` (id, kind, content, targetNodeId, targetEdgeId, createdAt, createdBy).
- Two grouping helpers exported from the same file — `groupAnnotationsByNode(annotations)` and `groupAnnotationsByEdge(annotations)` — that bucket annotations by their target so the node / edge projections can attach the matching subset to each ReactFlow `Node` / `Edge` `data` payload.
- An `AnnotationBadge` React component (`apps/moderator/src/graph/AnnotationBadge.tsx`) — a small `<span>` rendering the localized kind label. Stable test ids: `annotation-badge-<annotation-id>` and `annotation-badge-list-<target-kind>-<target-id>`.
- An extension to `StatementNode` and `StatementEdge` — each reads `data.annotations: readonly Annotation[]` (added to `StatementNodeData` / `StatementEdgeData`) and renders a horizontal stack of `AnnotationBadge`s in a decoration row.
- The wiring inside `GraphCanvasPane.tsx`: `projectNodes` and the edge-projection `useMemo` enrich their outputs with the matching annotation subset per target before handing the `Node[]` / `Edge[]` arrays to `<ReactFlow>`.

This task is rendering only. The diagnostic-resolution flow's annotation-action task (`mod_diagnostic_resolution_flow.mod_annotation_action`) lands the *creating* of annotations from the moderator UI; here we just show what's already in the log. Per-kind styling polish (color theming once `packages/ui-tokens` lands), context-menu actions on badges (`mod_context_menus`), and hover details (`mod_hover_details`) are downstream tasks that layer onto the rendered badges.

## Why it needs to be done

Annotations are first-class methodology entities — they capture meta-commentary on a node or edge (reframes, scope changes, debater stances, plain notes) without being part of the argument graph itself. `mod_node_rendering` and `mod_edge_rendering` shipped the node / edge cards; without annotation rendering an annotation-created event would land in the WS log invisible to the moderator. Downstream tasks (the diagnostic-resolution flow, hover details, context menus) need a stable rendered surface to attach behaviour and assertions to.

The custom-node refinement (`mod_node_rendering`) anticipated this task explicitly: "Edge rendering (`mod_edge_rendering`) will register its own custom edge types separately; annotation rendering (`mod_annotation_rendering`) lands a second node-type later (different `type: 'annotation'`)." That sentence reflected an earlier design where each annotation would be its own free-floating ReactFlow node. **This refinement supersedes that plan** — the post-`mod_edge_rendering` re-read shows annotations *always* target a node or edge (the `annotation-created` payload's XOR is the source of truth: exactly one of `target_node_id` / `target_edge_id` is set), so attaching the badge to its target rather than floating it as an independent node is the more honest UX: the badge moves with its target, the M-N "many annotations on one target" case stacks visually inside the target's card, and we don't introduce a synthetic position-engine concern for annotations.

The localized label is required because the moderator console is multilingual (ADR 0024). A bare `kind` discriminator (`note`, `scope-change`) leaks the wire-format enum; resolving through `t('methodology.annotationKind.<kind>')` renders the human-readable per-locale form (`Note` / `Nota` / `Reenquadre`).

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; custom node/edge components are the explicit reason for the pick.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — react-i18next + ICU bound through `@a-conversa/i18n-catalogs`.
- `packages/shared-types/src/events.ts` — `annotationCreatedPayloadSchema` (the XOR `target_node_id` / `target_edge_id` invariant).
- `packages/shared-types/src/events/enums.ts` — `annotationKindSchema = z.enum(['note', 'reframe', 'scope-change', 'stance'])` (the canonical four kinds).
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — `methodology.annotationKind.<kind>` (per-locale labels).
- `apps/moderator/src/graph/StatementNode.tsx` — the node card the badges attach to; the existing kind-label decoration row gives the layout precedent.
- `apps/moderator/src/graph/StatementEdge.tsx` — the edge label the badges attach to; the existing role-label `EdgeLabelRenderer` overlay gives the layout precedent.
- `apps/moderator/src/graph/selectors.ts` — the existing `selectEdgesForSession` selector pattern is the template for `selectAnnotations`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — the `projectNodes` function and the edge-projection `useMemo` are the seams the new wiring attaches to.

## Constraints / requirements

- **`Annotation` type** (exported from `selectors.ts`): a stable shape converted from the wire payload — `{ id, kind, content, targetNodeId, targetEdgeId, createdBy, createdAt }`. Camel-cased (consistent with the surrounding selectors and the `Event` envelope's camelCased fields like `sessionId`); converted once at the selector boundary so consumers don't re-handle the snake-cased wire keys.
- **`selectAnnotations(state, sessionId)`**: pure function over `WsState` (no React, no store subscription internally). Walks `state.sessionState[sessionId]?.events` once, picks every `event.kind === 'annotation-created'`, and maps each to an `Annotation`. Returns `[]` for an unknown session or an empty event log. Arrival-order is preserved — the test asserts this so downstream concerns (per-target sort, recency) layer on top deterministically.
- **`groupAnnotationsByNode(annotations) → Map<string, Annotation[]>`** and **`groupAnnotationsByEdge(annotations) → Map<string, Annotation[]>`**: pure helpers also exported from `selectors.ts`. Each picks the subset of annotations whose target matches the helper (node or edge) and buckets them by target id. Returning a `Map` (not an `Object`) gives `O(1)` `get(id)` lookups inside the projection loops and avoids the JSON-key string-coercion gotcha when ids contain dashes (UUIDs do).
- **`AnnotationBadge` component** (`apps/moderator/src/graph/AnnotationBadge.tsx`): a `<span>` rendering `t('methodology.annotationKind.<kind>')` with:
  - Tailwind classes: `inline-flex items-center rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap`. The amber palette deliberately differs from the slate frame of `StatementNode` / the role label of `StatementEdge` so a badge reads as a *decoration*, not as part of the statement card chrome. Per-kind colour theming is deferred to `packages/ui-tokens` (see Decisions).
  - `data-testid="annotation-badge-<annotation-id>"` for direct test targeting.
  - `data-annotation-kind="<kind>"` attribute (so per-kind assertions can target without DOM-text scraping — the i18n layer renders a different string per locale, but the wire-format kind is stable).
  - `title={content}` attribute — exposes the annotation body on hover. The full hover-card UX is owned by `mod_hover_details`; the `title` attribute is the cheap baseline that works on every browser and assistive tech.
- **`StatementNodeData` extension**: add `annotations: readonly Annotation[]` (default `[]` when none). The component renders the badges in a new decoration row below the kind label. Container test id: `annotation-badge-list-node-<node-id>`. Container Tailwind classes: `mt-1 flex flex-wrap gap-1` (wraps when many badges).
- **`StatementEdgeData` extension**: add `annotations: readonly Annotation[]` (default `[]`). The edge label renderer stacks the badges vertically beneath the existing role-label pill (the role label stays the prominent line). Container test id: `annotation-badge-list-edge-<edge-id>`. Container Tailwind classes: `mt-0.5 flex flex-wrap gap-0.5 justify-center`.
- **`projectNodes(events)` enrichment**: build the `Map<string, Annotation[]>` once via `groupAnnotationsByNode(selectAnnotations-shape over the same events)`, then enrich each emitted node's `data.annotations`. The function signature stays `(events) → Node[]` (no `WsState` dependency), so the helper does an inline pass over the same `events` array for `annotation-created` envelopes — the projection stays a pure function of `events`.
- **`GraphCanvasPane` edge wiring enrichment**: the existing `useMemo` over `selectEdgesForSession` is extended to also call `selectAnnotations` + `groupAnnotationsByEdge`, then map the projected edges to attach `data.annotations`. The `useMemo` dependency stays `[sessionId, events]`.
- **`null`-target invariant**: per the wire schema the XOR is enforced by Zod at the validation seam; the selector trusts that invariant and does not duplicate the check. If both fields are non-null or both null (a server-side bug), the annotation is bucketed under whichever helper hits it first. Tests pin the happy path; the invariant violation is out of scope for the rendering layer.
- **`null` actor invariant**: `Event.actor` is nullable; `Annotation.createdBy` is `string` (the payload's `created_by` is non-null per the schema). The selector reads `event.payload.created_by`, not `event.actor`.
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/selectors.test.ts` — extended with:
    - 1 case: `selectAnnotations` on unknown session returns `[]`.
    - 1 case: empty event log returns `[]`.
    - 1 case: single `annotation-created` on a node target projects with all fields camel-cased.
    - 1 case: single `annotation-created` on an edge target projects with `targetNodeId: null`, `targetEdgeId: <id>`.
    - 1 case: arrival order is preserved across multiple annotation-created events.
    - 1 case: mixed event log — only `annotation-created` events appear in the output.
    - 4 cases: each `AnnotationKind` value round-trips intact on `Annotation.kind` (`note`, `reframe`, `scope-change`, `stance`).
    - 2 cases: `groupAnnotationsByNode` / `groupAnnotationsByEdge` bucket correctly and exclude annotations targeting the other entity kind.
  - `apps/moderator/src/graph/AnnotationBadge.test.tsx` (new file):
    - 4 kinds × 3 locales (12 cases): each renders the matching catalog string for the active locale, plus `data-annotation-kind="<kind>"` attribute, plus the `title` attribute is set to `content`.
  - `apps/moderator/src/graph/StatementNode.test.tsx` — extended with:
    - 1 case: node with no annotations renders no `annotation-badge-list-node-<id>` element (or renders the container empty — pick one and assert; this refinement picks "no container element" so the DOM stays clean).
    - 1 case: node with one annotation renders the badge with the right testid.
    - 1 case: node with multiple annotations renders all badges in arrival order.
  - `apps/moderator/src/graph/StatementEdge.test.tsx` — extended with:
    - 1 case: edge with one annotation renders the badge in the label overlay.
    - 1 case: edge with multiple annotations renders all badges.
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — extended with:
    - 1 case: `projectNodes` enriches a node's `data.annotations` from an `annotation-created` event targeting that node.
    - 1 case: `projectNodes` leaves `data.annotations` empty for a node whose only annotations target a different node.
    - 1 case: end-to-end through the canvas — applying a `node-created` + an `annotation-created` to the WS store renders the annotation badge inside the node's card.

## Acceptance criteria

- `apps/moderator/src/graph/selectors.ts` exports `Annotation`, `selectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`. `selectEdgesForSession` and `StatementEdgeData` keep their current contracts; `StatementEdgeData` is extended to include `annotations: readonly Annotation[]`.
- `apps/moderator/src/graph/AnnotationBadge.tsx` exists, exports a memo'd `AnnotationBadge` rendering the localized kind label, the `annotation-badge-<id>` test id, the `data-annotation-kind` attribute, and the `title` attribute carrying `content`.
- `apps/moderator/src/graph/StatementNode.tsx` renders the badges from `data.annotations` in a `annotation-badge-list-node-<id>` decoration row when the list is non-empty.
- `apps/moderator/src/graph/StatementEdge.tsx` renders the badges from `data.annotations` in a `annotation-badge-list-edge-<id>` overlay row below the role-label pill when the list is non-empty.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` enriches `Node.data.annotations` inside `projectNodes` and `Edge.data.annotations` inside the existing edge `useMemo`.
- All test files above contain the listed cases.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_annotation_rendering` plus a `note "Refinement: …"` line.

## Decisions

- **Badge attached to target, not standalone ReactFlow node.** The `annotation-created` payload is structurally a many-to-one decoration of a node or an edge (XOR), not a free-floating graph node. Attaching the badge to its target keeps the spatial relationship visible (the badge moves with its target), stacks the M-N case naturally, and avoids a synthetic layout-engine concern for annotations.
- **`selectAnnotations` returns camelCased types**, not the wire-format snake-cased payload. Consistent with the surrounding selectors (the existing `StatementEdgeData` consumes a camelCased shape too) and with the `Event` envelope's mixed-case keys.
- **`Map` (not `Object`) for `groupAnnotations*` helpers.** `O(1)` `get(id)` without the JSON-key string-coercion gotcha that bites when ids carry dashes (UUIDs do). The `projectNodes` enrichment uses `.get(node.id) ?? EMPTY_ANNOTATIONS` so absent targets stay cheap.
- **`title` attribute for hover content**, not a custom hover-card. `mod_hover_details` is a separate task; the `title` attribute is the cheap baseline that ships annotation content visibility today and works on every browser + assistive tech without re-implementing it here.
- **Single amber pill style, no per-kind colour for v1.** Per-kind colour theming routes through `packages/ui-tokens` once that workstream ships; introducing one-off colour decisions here would either lock them into a place `packages/ui-tokens` would later need to override, or duplicate four sets of utility classes. The `data-annotation-kind` attribute is the seam — `packages/ui-tokens` can add per-kind CSS rules selecting on `[data-annotation-kind="reframe"]` without touching this component.
- **No standalone `<AnnotationNode>` ReactFlow node-type.** The earlier `mod_node_rendering` refinement floated this as a possibility; this refinement is the canonical decision against it for the reasons above. The `nodeTypes` registry stays at a single `statement` entry.
- **Selector signature `selectAnnotations(state, sessionId)`** matches `selectEdgesForSession(state, sessionId)`. Consistent surface across the three projection selectors.
- **Test ids carry the entity kind in the container id** (`annotation-badge-list-node-<id>` vs `annotation-badge-list-edge-<id>`). A test that wants "the annotations on node X" doesn't have to walk up the DOM to disambiguate from "the annotations on edge X" — and node ids and edge ids share a UUID namespace at the wire layer.
- **`memo` on `AnnotationBadge`.** The badge re-renders only when `kind` / `content` / locale change; the surrounding canvas re-renders frequently on pan/zoom.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/AnnotationBadge.tsx` — memo'd `<AnnotationBadge>` rendering one annotation as an amber pill. `useTranslation` resolves `methodology.annotationKind.<kind>`; the `data-annotation-kind` attribute carries the wire-format kind (the seam `packages/ui-tokens` will hook into for per-kind colour theming later); the `title` attribute carries the annotation `content` (cheap baseline hover surface until `mod_hover_details` lands).
- Updated `apps/moderator/src/graph/selectors.ts` — added the camelCased `Annotation` interface, the `selectAnnotations(state, sessionId)` and `projectAnnotations(events)` projection functions, plus `groupAnnotationsByNode(annotations)` / `groupAnnotationsByEdge(annotations)` Map-returning helpers. Extended `StatementEdgeData` with `annotations: readonly Annotation[]`. `selectEdgesForSession` now computes `groupAnnotationsByEdge(projectAnnotations(events))` up-front and attaches the per-edge subset to each emitted edge's `data.annotations`. Exports `EMPTY_ANNOTATIONS` (module-scope `Object.freeze([])`) so the empty case keeps a stable reference identity.
- Updated `apps/moderator/src/graph/StatementNode.tsx` — extended `StatementNodeData` with `annotations: readonly Annotation[]`. The component renders the `annotation-badge-list-node-<id>` decoration row only when the list is non-empty (no empty container in the DOM otherwise), Tailwind classes `mt-1 flex flex-wrap gap-1` so badges stack and wrap.
- Updated `apps/moderator/src/graph/StatementEdge.tsx` — reorganized the `<EdgeLabelRenderer>` overlay into a vertical `flex flex-col items-center` stack: the role-label pill stays the prominent line, and the new `annotation-badge-list-edge-<id>` container stacks beneath it (rendered only when annotations are present). The role label's wrapping `<div>` carries the existing `graph-edge-label-<id>` test id intact.
- Updated `apps/moderator/src/graph/GraphCanvasPane.tsx` — `projectNodes` now does a `groupAnnotationsByNode(projectAnnotations(events))` pass up-front and enriches each emitted node's `data.annotations` with the matching subset. The edge projection lives inside `selectEdgesForSession` (already extended above), so the existing `useMemo` over the selector picks up the enrichment without further wiring.
- New `apps/moderator/src/graph/AnnotationBadge.test.tsx` — 12 cases. 4 kinds × 3 locales: every `(kind, locale)` combination resolves the matching catalog string and pins the `data-annotation-kind` + `title` attributes.
- Updated `apps/moderator/src/graph/selectors.test.ts` — added 14 new cases: a single edge-annotation round-trip on `selectEdgesForSession`, the unknown-session / empty-log / single-node-target / single-edge-target / arrival-order / mixed-log cases for `selectAnnotations`, a per-`AnnotationKind` round-trip (4 cases), and two `groupAnnotationsBy*` bucketing cases. Existing `selectEdgesForSession` single-edge `toEqual` updated to include `annotations: []`. Total file: 25 cases (was 12).
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added 3 new cases (no-annotations renders no container; one annotation renders the badge with the right testid / `data-annotation-kind` / `title`; multiple annotations render in arrival order). Total file: 22 cases (was 19).
- Updated `apps/moderator/src/graph/StatementEdge.test.tsx` — added 2 new cases (single edge annotation; multiple edge annotations in arrival order). Total file: 24 cases (was 22).
- Updated `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — added 3 new cases under two new describe-blocks (`projectNodes` annotation enrichment: matching-node attachment + non-matching-node empty list; `GraphCanvasPane` end-to-end: a `node-created` + an `annotation-created` from the WS store render the badge inside the node card). The existing `projectNodes` `toEqual` updated to include `annotations: []`. Total file: 19 cases (was 17).
- Tests: +14 selectors + 3 StatementNode + 2 StatementEdge + 2 GraphCanvasPane + 12 AnnotationBadge = +33 cases. Baseline `pnpm run test:smoke` 2106 → 2139, green. `pnpm run check` clean. `pnpm -F @a-conversa/moderator build` green (531.51 kB / gzip 165.79 kB — small bump from the badge component + selector / projection glue). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — the dedicated `mod_diagnostic_resolution_flow.mod_annotation_action` task (lands annotation *creation* from the moderator UI), `mod_hover_details` (richer hover card replacing the `title` attribute), `mod_context_menus` (right-click actions on a badge), and any future `packages/ui-tokens` per-kind colour theming via the `data-annotation-kind` selector — now have a rendered badge surface to attach behaviour to via the `annotation-badge-<id>` and `annotation-badge-list-{node,edge}-<id>` test ids and the documented `data-annotation-kind` attribute.
