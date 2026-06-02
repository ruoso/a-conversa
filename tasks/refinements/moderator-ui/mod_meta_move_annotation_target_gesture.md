# Moderator meta-move annotation-target handling — freeze annotation rejection as a permanent product rule

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_meta_move_flow.mod_meta_move_annotation_target_gesture`.

```
task mod_meta_move_annotation_target_gesture "Annotation-target handling for meta-move" {
  effort 0.5d
  allocate team
  depends !mod_meta_move_action
  note "Source: moderator_ui.mod_meta_move_flow.mod_meta_move_action AC §12 — decides whether meta-moves on annotations should be permissible (engine-side enum widening) or whether the v1 rejection remains as a permanent product rule. Concrete spec-write + implementation per Decision §4 of tasks/refinements/moderator-ui/mod_meta_move_action.md."
```

## Effort estimate

**0.5d.** Confirmed. The task lands a permanent product rule rather than a
new feature surface — the bulk of the work is the architectural decision
(captured as ADR 0036) plus three tight code touches and a defensive
Cucumber scenario:

- **ADR 0036** — write the permanent-product-rule decision (drafted under
  Decisions §1 below; lands at
  [`docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md`](../../../docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md)).
- **Schema seam comment** — a one-line `// see ADR 0036` annotation on
  `metaMoveProposalSchema.target_kind` at
  [packages/shared-types/src/events/proposals.ts L417](../../../packages/shared-types/src/events/proposals.ts#L417).
- **Hook guard comment** — the comment in `useMetaMoveAction` at
  [L135–144](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135)
  loses its "decision lives with the sibling
  `mod_meta_move_annotation_target_gesture` task" line and gains a
  reference to ADR 0036. The guard itself stays unchanged.
- **i18n message correction** — `reason.targetKindInvalid` and
  `reason.targetMissing` at
  [packages/i18n-catalogs/src/catalogs/en-US.json L555–556](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L555)
  currently reference "a node" only; the `mod_meta_move_edge_target_gesture`
  sibling widened the allow-list to `{'node', 'edge'}` without updating
  these strings (its Acceptance criteria §7 explicitly deferred i18n
  chrome to "stays valid for the narrower annotation-only case", but the
  "target a node" wording is inaccurate now that edges are also valid).
  Corrected to "node or edge" wording in en-US; equivalent corrections
  drafted in pt-BR.json L555–556 and es-419.json L555–556. Native-speaker
  review for pt-BR and es-419 surfaces as a parking-lot item (humans
  only).
- **Cucumber defense-in-depth scenario** — extends
  `tests/behavior/methodology/propose-meta-move.feature` with one
  scenario: "a meta-move propose carrying an annotation id under
  `target_kind: 'node'` is rejected with `target-entity-not-found`".
  Pins the engine-side cross-layer rule (the methodology projection has
  no `getNode(annotationId)` resolution, so the engine rejects with a
  clear `target-entity-not-found` even if a client bypassed the schema's
  enum-typed wire) — a defense-in-depth pin against future projection
  refactors that might accidentally let annotation ids resolve through
  the node accessor.
- **Vitest** — extend `useMetaMoveAction.test.tsx` with one case
  asserting the corrected localized message is returned for the
  annotation-rejection path (the existing rejection-case test pins the
  reason key; the new case pins the corrected user-facing copy).
- **Playwright e2e** — extend `tests/e2e/moderator-capture.spec.ts` with
  one `test()` block alongside the existing F8 default-kind block
  (L2539–2627), the kind-selector block (L2635–2669), and the
  edge-target block (added by the sibling 2026-06-01): seed a node + an
  annotation hanging from it, select the annotation, press F8, type
  content, press the submit key, assert the inline validation error
  region renders the localized `targetKindInvalid` message (corrected
  copy) and no propose event lands in the WS store.

The work is bounded because nothing about the wire contract changes; the
existing guard already does the work; the task makes the permanence of
that rule explicit and corrects stale localized copy.

## Inherited dependencies

Settled:

- **`moderator_ui.mod_meta_move_flow.mod_meta_move_action`** (done —
  2026-05-31). Shipped the F8 spine and the v1 client-side annotation
  rejection (`useMetaMoveAction.ts` L135–144 inline guard +
  `reason.targetKindInvalid` i18n key). Decision §4 of
  [mod_meta_move_action.md](./mod_meta_move_action.md) deferred the
  permanence-vs-widening question to this task by name; AC §12
  registered this task's brief: "decides whether meta-moves on
  annotations should be permissible (engine-side enum widening) OR
  whether the v1 `targetEntityKind: 'annotation'` rejection should
  remain as a permanent product rule. The decision is a concrete
  spec-write + implementation, not an open-ended audit."
- **`moderator_ui.mod_meta_move_flow.mod_meta_move_edge_target_gesture`**
  (done — 2026-06-01). Widened the allow-list to `{'node', 'edge'}`,
  shipped the edge-click stage gesture, and left a follow-up trail: the
  `'target-kind-invalid'` localized message (current copy: "meta-moves
  target a node — clear the annotation target and pick a node") was
  preserved on the theory that annotation-only rejection makes the
  "target a node" wording "stay valid for the narrower annotation-only
  case." After this task lands, the annotation rejection is permanent,
  but the message wording is inaccurate post-edge-widening — this task
  corrects it.
- **`moderator_ui.mod_meta_move_flow.mod_meta_move_disputed_visibility`**
  (done — 2026-06-01). Established that contested meta-moves render as
  disputed annotation badges via the `AnnotationBadge` `facetStatuses`
  prop. Its existence is the second of three forces (Decisions §1
  below) driving the freeze decision: if meta-moves could target
  annotations, the disputed-annotation badge that depicts a contested
  meta-move would itself be meta-movable — an infinite-regress
  methodology trap.
- **`data_and_methodology.methodology_engine.meta_move_logic`** (done —
  2026-05-10). The server's `validateMetaMoveProposal` dispatches on
  `target_kind` per the rule catalog excerpted in
  [apps/server/src/methodology/handlers/propose.ts L96–111](../../../apps/server/src/methodology/handlers/propose.ts#L96).
  The existing Cucumber feature
  [`tests/behavior/methodology/propose-meta-move.feature`](../../../tests/behavior/methodology/propose-meta-move.feature)
  pins the validator's `'target-entity-not-found'` and
  `'illegal-state-transition'` rejection codes. This task adds one
  defensive scenario, no validator changes.
- **`packages/shared-types/src/events/proposals.ts L412–419`** —
  `metaMoveProposalSchema.target_kind` is `z.enum(['node', 'edge'])`.
  No schema change. A `// see ADR 0036` comment marks the seam.
- **`moderator_ui.mod_annotation_ui.mod_propose_annotation_endpoint_gestures`**
  (done — 2026-05-30). Established that annotation targets can stage
  into the capture store (via auto-suggest off a selected annotation,
  plus explicit endpoint gestures for F1 capture). That staging path is
  what makes the inline guard at L135–144 a live, regularly-fired check
  rather than a defensive dead branch.

Pending: (none — every contract this task touches is closed.)

## What this task is

The architectural decision and the small implementation work that pins
**meta-moves never target annotations**, as a permanent product rule. The
schema's `target_kind` enum stays at `{'node', 'edge'}`; the moderator
hook's inline annotation-rejection guard stays; the localized message
that surfaces the rejection gets corrected to reflect that edges have
joined nodes as valid targets; a defensive Cucumber scenario pins the
engine-side cross-layer rule.

This task does NOT:

- Widen the schema enum to include `'annotation'`.
- Add a `projection.getAnnotation` accessor to the methodology engine.
- Add a `target_kind === 'annotation'` dispatch arm to
  `validateMetaMoveProposal`.
- Add an annotation-click stage gesture for the meta-move target picker.
- Filter annotations out of auto-suggest specifically while in meta-move
  mode (would add modal-state-dependent auto-suggest that conflicts with
  prior decisions).

The decision is captured in ADR 0036; the refinement registers the small
code touches that make the rule's permanence explicit at the schema and
hook seams.

## Why it needs to be done

**The permanence question is real architectural debt that compounds.**
After the action task shipped, the engine accepted the schema-typed
`target_kind: 'node' | 'edge'` and the moderator UI carried an inline
"annotation is not a meta-move target" guard. The guard's comment
explicitly says the permanence question is the sibling's responsibility
— so every future refinement that touches `useMetaMoveAction`,
`metaMoveProposalSchema`, or the validator has to either re-derive the
intent or chase the deferred-decision trail. An ADR closes that loop.

**The localized message is wrong after the edge-target gesture landed.**
Today the message reads "meta-moves target a node — clear the
annotation target and pick a node." After 2026-06-01, meta-moves also
target edges; a moderator who sees this message has been misinformed.
Correcting it is in scope for the annotation-rejection task by virtue
of being its message. The edge-target task explicitly left the wording
to a follow-up "for the narrower annotation-only case" — this is that
follow-up.

**The cross-layer rule needs a Cucumber pin.** The engine's rejection
behavior for "annotation id passed as `target_kind: 'node'`" is
load-bearing — it's what makes the schema's `'node' | 'edge'` enum
contractual rather than merely declarative. The existing Cucumber
coverage pins the node-not-found and edge-not-found paths; it does not
pin the cross-kind case where an annotation id is funneled through the
node accessor. A future projection refactor that accidentally let
annotation ids resolve through `projection.getNode` would silently
break the rule. A defensive scenario pins it.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

### The wire schema (no change — just a comment)

- [packages/shared-types/src/events/proposals.ts L412–419](../../../packages/shared-types/src/events/proposals.ts#L412)
  — `metaMoveProposalSchema` accepts `target_kind: z.enum(['node', 'edge'])`.
  A one-line `// see ADR 0036 — annotation targets intentionally absent`
  comment marks the seam. No enum widening, no field change.

### The engine validator (no change)

- [apps/server/src/methodology/handlers/propose.ts L96–111](../../../apps/server/src/methodology/handlers/propose.ts#L96)
  — `validateMetaMoveProposal` rule catalog. No dispatch-arm change; no
  new rejection code. The defensive Cucumber scenario this task adds
  exercises the existing `target-entity-not-found` rejection against
  an annotation id passed under `target_kind: 'node'`.

### The hook guard (comment refresh; no logic change)

- [apps/moderator/src/layout/useMetaMoveAction.ts L135–144](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135)
  — the existing render-time guard
  (`targetEntityKind !== 'node' && targetEntityKind !== 'edge' → validationError = 'target-kind-invalid'`).
  The current inline comment closes with "The annotation-target decision
  lives with the sibling `mod_meta_move_annotation_target_gesture` task."
  Rewrite to point at ADR 0036 as the decision's permanent home. The
  guard's logic does not change.
- [apps/moderator/src/layout/useMetaMoveAction.ts L200](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L200)
  — the call-time re-check. No change; the same comment-refresh
  treatment if it carries a sibling reference.

### The i18n strings (correct stale "a node" copy)

- [packages/i18n-catalogs/src/catalogs/en-US.json L555–556](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L555):
  - `reason.targetMissing`: `"pick a target node — click a node to stage it"`
    → `"pick a target node or edge — click one to stage it"`.
  - `reason.targetKindInvalid`: `"meta-moves target a node — clear the annotation target and pick a node"`
    → `"meta-moves target nodes or edges — clear the annotation target and pick a node or edge"`.
- [packages/i18n-catalogs/src/catalogs/pt-BR.json L555–556](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json#L555):
  - `targetMissing`: current `"selecione um nó-alvo — clique em um nó para defini-lo"`
    → draft `"selecione um alvo (nó ou aresta) — clique em um para defini-lo"`.
  - `targetKindInvalid`: current `"meta-movimentos têm como alvo um nó — limpe o alvo de anotação e escolha um nó"`
    → draft `"meta-movimentos têm como alvo nós ou arestas — limpe o alvo de anotação e escolha um nó ou aresta"`.
- [packages/i18n-catalogs/src/catalogs/es-419.json L555–556](../../../packages/i18n-catalogs/src/catalogs/es-419.json#L555):
  - `targetMissing`: current `"selecciona un nodo objetivo — haz clic en un nodo para fijarlo"`
    → draft `"selecciona un objetivo (nodo o arista) — haz clic en uno para fijarlo"`.
  - `targetKindInvalid`: current `"los meta-movimientos apuntan a un nodo — limpia el objetivo de anotación y elige un nodo"`
    → draft `"los meta-movimientos apuntan a nodos o aristas — limpia el objetivo de anotación y elige un nodo o arista"`.

  Native-review for pt-BR and es-419 is surfaced as a parking-lot
  follow-up (the closer adds it to `tasks/parking-lot.md`); this is
  human-only sign-off work, not WBS-eligible per the refinement-writer
  brief.

### The auto-suggest path (no change; documented constraint)

- [apps/moderator/src/stores/recentlyActiveNode.ts L37–40](../../../apps/moderator/src/stores/recentlyActiveNode.ts#L37)
  — `selectMostRecentlyActiveEntity` returns
  `{ kind: 'node' | 'annotation'; id }` (edges intentionally excluded).
  In meta-move mode, an annotation selection still gets staged via the
  auto-suggest at
  [CaptureTargetChip.tsx L216–242](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L216);
  the inline hook guard then rejects the propose attempt. This task
  documents that the keep-auto-suggest-kind-agnostic invariant takes
  priority over pre-filtering (Decision §2 below).

### The Cucumber feature (one new scenario)

- [tests/behavior/methodology/propose-meta-move.feature](../../../tests/behavior/methodology/propose-meta-move.feature)
  — the existing feature pins the validator's rejection codes for
  node/edge target validation. Adds one defensive scenario: "annotation
  id passed as `target_kind: 'node'` rejects with
  `target-entity-not-found`" (the cross-layer pin Decision §3 below).

### The Vitest test (one new case)

- [apps/moderator/src/layout/useMetaMoveAction.test.tsx](../../../apps/moderator/src/layout/useMetaMoveAction.test.tsx)
  — the existing suite covers the rejection's reason key
  (`'target-kind-invalid'`). Adds one case asserting the corrected
  localized message wording is the one rendered through the
  `validationError` formatter (uses the en-US catalog).

### The Playwright spec (one new block)

- [tests/e2e/moderator-capture.spec.ts L2539–2627](../../../tests/e2e/moderator-capture.spec.ts#L2539)
  — the existing F8 default-kind block. New block lands alongside it:
  seed a node + an annotation hanging from it via `seedWsStore`, log
  in / create session / enter operate route, click the annotation to
  select it, press F8, type meta-move content, attempt to submit,
  assert the inline `meta-move-propose-error` region renders the
  corrected `targetKindInvalid` message and that no propose event
  lands in `useWsStore.sessionState[sessionId].events`.

### Prior-art refinements and ADRs

- [tasks/refinements/moderator-ui/mod_meta_move_action.md](./mod_meta_move_action.md)
  — Decision §4 deferred the permanence-vs-widening question to this
  task; AC §12 registered this task by name.
- [tasks/refinements/moderator-ui/mod_meta_move_edge_target_gesture.md](./mod_meta_move_edge_target_gesture.md)
  — Decision §3 widened the allow-list to `{'node', 'edge'}` and
  preserved the i18n wording for "the narrower annotation-only case";
  Decision §5 pinned no-edge-target-auto-suggest. Both feed Decision §2
  below.
- [tasks/refinements/moderator-ui/mod_meta_move_disputed_visibility.md](./mod_meta_move_disputed_visibility.md)
  — established that contested meta-moves render as disputed annotation
  badges, which is the second of three forces (Decision §1 below)
  motivating the freeze decision.
- [tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md](./mod_propose_annotation_endpoint_gestures.md)
  — annotation-staging precedent (Decision §5 there: auto-suggest stays
  kind-narrow; explicit gestures expand the kind set).
- [tasks/refinements/data-and-methodology/meta_move_logic.md](../data-and-methodology/meta_move_logic.md)
  — engine-side rule catalog. No change required; one defensive Cucumber
  scenario added to the existing feature.
- [docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md](../../../docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md)
  — the permanent-product-rule ADR this task lands.
- [docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md)
  — drives the Vitest + Cucumber + Playwright layering of acceptance.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — i18n catalog discipline; this task changes two existing keys'
  values, triggering pt-BR / es-419 native-review (parking-lot).
- [docs/methodology.md L189–197](../../../docs/methodology.md#L189) —
  the methodology framing for meta-moves; the first force behind
  Decision §1.

## Constraints / requirements

- **Wire envelope unchanged.** `metaMoveProposalSchema.target_kind`
  stays `z.enum(['node', 'edge'])`. No schema migration. No engine
  validator dispatch-arm change. No projection accessor change.
- **Client guard semantics preserved.** The inline render-time and
  call-time guards at
  [useMetaMoveAction.ts L135–144 and L200](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135)
  continue to reject `targetEntityKind === 'annotation'` with the
  `'target-kind-invalid'` reason key. Only the surrounding comment
  refreshes to cite ADR 0036.
- **Auto-suggest stays kind-agnostic.** No modal-state-dependent
  filtering of annotation targets in meta-move mode. The auto-suggest
  path stays as
  `mod_propose_annotation_endpoint_gestures` §5 and
  `mod_meta_move_edge_target_gesture` §5 established it. The inline
  guard catches annotations the auto-suggest staged.
- **Localized message correction is en-US-only at land; pt-BR /
  es-419 corrections ship drafted, native-review queued.** The
  en-US copy is authoritative at land; pt-BR and es-419 drafts ship
  alongside it so the catalog stays parity-complete, with a parking-lot
  item recording that native sign-off is pending. The closer registers
  the parking-lot item; the next native-review pass clears it.
- **No new i18n keys.** The two key paths whose values change
  (`reason.targetMissing`, `reason.targetKindInvalid`) are already in
  every catalog; this task corrects their values, not their identity.
- **No new dispatch arms or rejection codes anywhere.** The engine
  continues to reject annotation ids passed as node ids with
  `target-entity-not-found`. No new error code. No new validator rule
  number.
- **Cucumber scenario is additive, defensive, and pins existing
  behavior.** It must not change the existing rule catalog; it pins
  one cross-kind case the existing feature does not explicitly cover.
- **ADR amendment-pass not required.** ADR 0036 establishes a new
  decision rather than amending a prior one; no prior ADR's
  `Decision` or `Context` text needs editing. (The seam comment
  added at `proposals.ts:417` references the new ADR; no prior ADR
  text changes.)

## Acceptance criteria

(Reference [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)
— each layer below pins durable behavior; no throwaway scripts.)

1. **ADR 0036 lands** at
   [`docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md`](../../../docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md)
   with `Status: Accepted`. The four standard sections (Context,
   Decision, Consequences, plus the date header) are present.
   `make lint` (or the project's equivalent) treats the file as a
   normal markdown ADR — no special validator hook trips.

2. **Schema seam comment.** Line above `target_kind` in
   [proposals.ts L417](../../../packages/shared-types/src/events/proposals.ts#L417)
   reads `// see ADR 0036 — annotation targets intentionally absent`
   (or equivalent one-liner). Vitest snapshot of the schema's
   `safeParse` behavior continues to pass with no shape change.

3. **Hook guard comment refresh.** The comment block at
   [useMetaMoveAction.ts L135–144](../../../apps/moderator/src/layout/useMetaMoveAction.ts#L135)
   no longer references "the sibling
   `mod_meta_move_annotation_target_gesture` task" and instead cites
   `ADR 0036`. The guard's logic is byte-identical to before. Vitest
   suite for `useMetaMoveAction` continues to pass without test
   changes (the comment refresh has no behavioral effect).

4. **Localized message correction (en-US).** `reason.targetMissing`
   reads `"pick a target node or edge — click one to stage it"` and
   `reason.targetKindInvalid` reads `"meta-moves target nodes or
   edges — clear the annotation target and pick a node or edge"` in
   [en-US.json L555–556](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L555).

5. **Localized message draft (pt-BR / es-419).** The pt-BR.json L555–556
   and es-419.json L555–556 corrections from Inputs/context land. The
   i18n catalog-parity Vitest suite (per ADR 0024) passes — all three
   catalogs carry the same key paths with non-empty values. The
   closer registers a parking-lot item:
   `i18n native review — meta-move targetMissing/targetKindInvalid (pt-BR, es-419)`
   for human-only sign-off.

6. **Vitest — corrected message asserted.**
   `apps/moderator/src/layout/useMetaMoveAction.test.tsx` gains one
   case: staging an annotation target, attempting to propose, asserting
   `validationError` carries the en-US copy "meta-moves target nodes or
   edges — clear the annotation target and pick a node or edge". The
   existing reason-key case continues to pass.

7. **Cucumber scenario — defensive cross-layer pin.**
   `tests/behavior/methodology/propose-meta-move.feature` gains one
   scenario asserting that a propose event carrying
   `{ kind: 'meta-move', target_kind: 'node', target_id: <annotation_id> }`
   (with a pre-existing annotation at `<annotation_id>` in projection)
   rejects with `code: 'target-entity-not-found'`. No new step
   definitions required; the existing seeding helpers cover annotation
   creation.

8. **Playwright e2e — annotation-target rejection block.**
   `tests/e2e/moderator-capture.spec.ts` gains one `test()` block
   alongside the existing F8 / kind-selector / edge-target blocks:
   - logs in, creates a session, enters the operate route;
   - seeds a node + an annotation via `seedWsStore`;
   - clicks the annotation to select it (the auto-suggest then stages
     it as the capture target on F8 entry);
   - presses F8 to enter meta-move mode;
   - asserts the chip renders the annotation's content (the
     `'annotation'` branch of the wording-lookup);
   - types content; presses the submit key;
   - asserts the inline `meta-move-propose-error` region renders the
     corrected `targetKindInvalid` text;
   - asserts that no `propose` event lands in
     `useWsStore.sessionState[sessionId].events` (the guard short-
     circuits before any envelope is sent).

   **E2e is in scope, NOT deferred** — the gesture surface is
   user-reachable (annotation click → F8 → submit attempt), satisfying
   the UI-stream "default — e2e is in scope" policy.

9. **No regressions to F1 / F8 happy paths.** The existing F8
   default-kind and edge-target Playwright blocks continue to pass.
   The existing F1 propose blocks (which also exercise annotation
   targets, validly) continue to pass — the schema and validator
   change is zero; the i18n correction touches only meta-move-scoped
   keys.

10. **Build + test green.** `make build && make test` clean; Vitest,
    Cucumber, Playwright, and i18n catalog-parity suites all pass.

11. **Refinement `## Status` block** appended on landing, per the
    task-completion ritual
    ([tasks/refinements/README.md L32–42](../README.md#L32)).

## Decisions

### §1 — Freeze annotation rejection as a permanent product rule (ADR 0036)

Meta-moves never target annotations. The schema's `target_kind` enum
stays `{'node', 'edge'}`; the engine validator stays node/edge-only;
the moderator UI's inline annotation-rejection guard stays. ADR 0036
captures the decision; this task implements the small code touches
that make the permanence explicit at the seams.

**Rationale.** Three forces converged on the freeze call:

1. **Methodologically, annotations are projection-layer residue, not
   first-class objects.** Per
   [`docs/methodology.md` L189–197](../../../docs/methodology.md#L189),
   a meta-move relocates the debate — claims about what's being argued
   about, or how. The first-class objects on the board are statements
   (nodes) and inferential links (edges); annotations are renderings
   of facet-status, axiom marks, contested-meta-move marks,
   interpretive-split residue. A meta-move on an annotation is a
   meta-move on how the methodology layer is labeling the debate —
   a category error. The proper expression of "this annotation's
   framing is itself the question" is a meta-move on the underlying
   node or edge.

2. **Contested meta-moves themselves render as annotations.**
   [`mod_meta_move_disputed_visibility`](./mod_meta_move_disputed_visibility.md)
   (done 2026-06-01) extended `AnnotationBadge` so a contested
   meta-move surfaces as a disputed annotation badge on its host.
   If meta-moves could target annotations, a contested meta-move
   could target the disputed-annotation badge that depicts a
   contested meta-move that targets… — an infinite-regress
   methodology trap with no resolution path. The rule keeps the
   methodology layer terminating.

3. **The wire-side widening would be substantial for unclear product
   value.** Adding `'annotation'` to the schema enum is one line, but
   making the engine actually validate annotation targets requires a
   new `projection.getAnnotation(target_id)` accessor (does not
   exist), visibility predicates analogous to `edgeIsVisible`, a new
   dispatch arm in `validateMetaMoveProposal`, and projector logic
   deciding where a committed annotation-targeted meta-move actually
   hangs (on the annotation's host? on a free-floating annotation?
   on the annotation itself, recurring?). For a methodology call
   whose semantic value is unclear, this is too much surface to
   widen on speculation.

**Alternative rejected — widen the schema enum to include
`'annotation'`.** The cleanest expression of "meta-moves are a
universal methodology operation" would treat all rendered objects on
the board as potential targets. But annotations are not rendered
objects in the same first-class sense — they're projection-layer
labels on the rendered objects. Widening the enum without resolving
the annotation-of-annotation recursion (force §2) creates an
unbounded methodology trap. The narrower wire surface is more
defensible until a separate methodology refinement argues
annotations should become first-class methodology objects (which
would itself supersede ADR 0036 along with `mod_meta_move_disputed_visibility`'s
overlay convention).

**Alternative rejected — keep the rejection but leave the permanence
question open for later.** The action task's Decision §4 already
deferred this once; deferring it again creates a third decision-trail
hop the next refinement has to chase. An ADR is the right home for
permanent product/methodology rules; landing it now closes the loop
cheaply and unambiguously.

### §2 — Auto-suggest stays kind-agnostic; the inline guard remains the failure surface

Annotations selected on the canvas continue to auto-stage as the
capture target on F8 entry, via the existing auto-suggest path at
[CaptureTargetChip.tsx L216–242](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L216).
The inline `useMetaMoveAction` guard at L135–144 catches the propose
attempt and surfaces the (now corrected) `targetKindInvalid` message.
The chip continues to render the annotation's content while the
moderator is in meta-move mode and the staged target is an annotation.

**Rationale.**
[`mod_propose_annotation_endpoint_gestures`](./mod_propose_annotation_endpoint_gestures.md)
§5 and
[`mod_meta_move_edge_target_gesture`](./mod_meta_move_edge_target_gesture.md)
§5 both established that auto-suggest stays narrow on the kinds it
naturally returns; explicit gestures (not modal-state-dependent
filtering) are what shape the staged target. The keep-auto-suggest-
kind-agnostic invariant is older and broader than the meta-move
annotation case; overriding it here for one mode would diverge from
the established discipline. The inline message is the redirect
surface — it names what's invalid and what the moderator should do
instead.

**Alternative rejected — filter `'annotation'` out of
`selectMostRecentlyActiveEntity` while `mode === 'meta-move'`.** Would
pre-empt the rejection at the staging step (the chip would not show
an annotation; the moderator would see a "pick a target" hint). UX-
nicer in the local sense, but it would add modal-state-dependent
auto-suggest, contradicting both prior decisions. The inline rejection
+ corrected message is the consistent failure surface.

**Alternative rejected — add a separate "meta-move mode filters out
annotation auto-suggest" decision and update both prior tasks'
decisions to allow modal-state-dependent auto-suggest in general.**
Over-broad for the size of the wins; the inline rejection is
sufficient redirect.

### §3 — Defensive Cucumber scenario for cross-layer rule

The engine's projection has no `getAnnotation` accessor on the
node-resolution path. An annotation id passed as `target_kind: 'node'`
through the schema layer (which would require a misbehaving client
since the wire schema is enum-typed) rejects with
`target-entity-not-found` at the validator. This task adds one
Cucumber scenario pinning that behavior.

**Rationale.** The schema's `'node' | 'edge'` enum is the structural
guarantee; the engine validator is the behavioral guarantee. Today,
no Cucumber scenario exercises the case where the structural
guarantee is bypassed (a future projection refactor that lets
annotation ids resolve through `getNode` would silently break the
rule and produce confusing engine behavior — accepting a meta-move
whose target id is an annotation, committing it as if it targeted a
node). The defensive scenario pins the cross-layer rule so the next
refactor can't elide it.

**Alternative rejected — Vitest only, no Cucumber.** Vitest covers
unit-level concerns; the cross-layer rule (schema + validator +
projection) is exactly the seam Cucumber is designed for. Per the
brief: "for anything that crosses the protocol or replay boundary,
Cucumber is the right pin."

**Alternative rejected — no defensive coverage.** The rule is "load-
bearing for the methodology layer's termination" (force §2 of
Decision §1). Leaving it un-pinned makes future projection changes
unsafe.

### §4 — Localized message correction in this task, not a follow-up

The two stale i18n key values (`reason.targetMissing`,
`reason.targetKindInvalid`) land in en-US.json in this commit; drafted
pt-BR and es-419 corrections land alongside; native review for the
non-English corrections surfaces as a parking-lot item.

**Rationale.** The `mod_meta_move_edge_target_gesture` task
explicitly left the strings unchanged on the theory that
annotation-only rejection makes the "target a node" wording stay
valid. That theory is wrong post-edge-widening — the strings
misinform the moderator. The annotation-rejection task is the
natural home for the correction (the strings name the annotation
rejection's failure mode) and it would be inconsistent to defer
again. Drafting pt-BR / es-419 keeps the catalog parity invariant
(per ADR 0024) without falsely claiming native-quality wording —
the parking-lot item makes the pending review visible.

**Alternative rejected — register a `i18n_meta_move_target_copy_fix`
follow-up task to land the catalog correction in a separate commit.**
The correction is one line in three catalogs plus a Vitest case;
splitting it from the ADR + comment refresh creates two PRs that
share a justification. Keeping them bundled is cleaner. (The native-
review parking-lot item is the human-only part; that genuinely
cannot ship as an agent-implementable task.)

**Alternative rejected — only fix en-US and rely on the catalog-
parity suite to flag the pt-BR / es-419 mismatch.** Would land the
mismatch and require a follow-up to clear it. Drafting the
non-English copy now (even pending native review) keeps the suite
green and surfaces the review item once, in the parking-lot.

### §5 — E2e is in scope, single block in `moderator-capture.spec.ts`

The Playwright cover lands as one new `test()` block in
[`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts),
alongside the existing F8 default-kind block (L2539–2627), the
kind-selector block (L2635–2669), and the edge-target block (added
2026-06-01). NOT a new spec file; NOT deferred.

**Rationale.** The component is reachable: annotation click selects;
F8 enters meta-move mode; the auto-suggest stages the annotation;
the chip renders annotation content; the submit attempt fires the
inline rejection. All of that is user-reachable via documented
keyboard + click gestures. The UI-stream policy says "default —
e2e is in scope" when the component is reachable; this case sits
squarely under that default. The block also pins the corrected
localized message string in a behavioral check, complementing the
Vitest case (Vitest pins the contract; Playwright pins the user-
visible rendering).

**Alternative rejected — defer to a `mod_pw_meta_move_flow` catch-
all.** No such task exists in the WBS; per the brief's UI-stream
policy, "before deferring to a future Playwright task, check how
many prior refinements already point at it. If it's inheriting
from 2+ refinements already, pay debt down instead." The default
is in-line; the edge-target sibling paid it in-line; this task
follows.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- ADR 0036 landed at `docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md` — freezes annotation rejection as a permanent product rule with Status: Accepted.
- Schema seam comment added above `target_kind` in `packages/shared-types/src/events/proposals.ts` — `// see ADR 0036 — annotation targets intentionally absent`.
- Hook guard comments refreshed in `apps/moderator/src/layout/useMetaMoveAction.ts` — sibling-task reference replaced with ADR 0036 cite; no logic change.
- i18n messages corrected in `packages/i18n-catalogs/src/catalogs/en-US.json` — `reason.targetMissing` and `reason.targetKindInvalid` now reference "node or edge"; parity-complete drafts shipped in `pt-BR.json` and `es-419.json`; native review queued in parking-lot.
- Vitest case added in `apps/moderator/src/layout/useMetaMoveAction.test.tsx` — asserts corrected en-US copy for annotation-rejection path; `MetaMoveProposeAction.test.tsx` stale assertion bumped to match.
- Cucumber scenario added in `tests/behavior/methodology/propose-meta-move.feature` + `tests/behavior/steps/methodology-propose-meta-move.steps.ts` — pins cross-layer engine rejection (annotation id under `target_kind: 'node'` → `target-entity-not-found`).
- Playwright block added in `tests/e2e/moderator-capture.spec.ts` — annotation → F8 → submit rejection surfaces corrected `targetKindInvalid` copy; no propose envelope sent.
- Race-robust helpers ported to `tests/e2e/annotation-endpoint-gestures.spec.ts` (`dragFromHandleToHandle` + `waitForBoundingBoxStable`) fixing a pre-existing dagre re-layout race in an unrelated test.
