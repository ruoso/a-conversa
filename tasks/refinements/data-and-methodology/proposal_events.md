# Proposal events

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.proposal_events`
**Effort estimate**: 2d
**Inherited dependencies**: `data_and_methodology.event_types.event_base_envelope` (settled)

## What this task is

Implement the eleven proposal event sub-kinds as Zod schemas under `packages/shared-types`. Proposals are the methodology's main currency — every change to the graph starts as one. The `vote` and `commit` events (separate sub-tasks) reference proposal ids issued here.

## Why it needs to be done

Proposals carry the work of the methodology. Every facet update, every decomposition, every axiom-mark, every meta-move is a proposal. The schemas need to be precise — they're what the validation pipeline checks against.

## Inputs / context

From [docs/data-model.md — event types — proposals](../../../docs/data-model.md#proposals):

A proposal is a proposed change awaiting agreement. All proposals share the same lifecycle. Variants by `kind`:

- `classify-node` — `{ node_id, kind: StatementKind }`.
- `set-node-substance` — `{ node_id, value: 'agreed' | 'disputed' }`.
- `set-edge-substance` — `{ edge_id, value: 'agreed' | 'disputed' }`.
- `edit-wording` — discriminated by edit kind (per the visible-graph derivation update):
  - `kind: 'reword'` — `{ node_id, new_wording }`.
  - `kind: 'restructure'` — `{ node_id, new_wording, new_node_id }`.
- `decompose` — `{ parent_node_id, components: [{ wording, classification }] }`.
- `interpretive-split` — `{ parent_node_id, readings: [{ wording, classification }] }`.
- `axiom-mark` — `{ node_id, participant }`.
- `meta-move` — `{ kind: 'reframe' | 'scope-change' | 'stance', content, target_kind, target_id }` (the meta-move attaches to a node or edge).
- `break-edge` — `{ edge_id }`.
- `amend-node` — `{ node_id, new_content }`.
- `annotate` — `{ target_kind: 'node' | 'edge', target_id, kind: AnnotationKind, content }`.

Each proposal event includes proposer, target session, proposal kind, and gets a unique proposal id used by votes and commits.

## Constraints / requirements

- Lives in `packages/shared-types`.
- Each variant is a Zod schema; the proposal event is itself a discriminated union over the proposal kind.
- The proposal id is generated server-side at append time (UUID). The server may add it to the payload before persisting.
- Validation strict: enum values, UUIDs, lengths.
- For `decompose` and `interpretive-split`, validate that components/readings is a non-empty list with reasonable bounds (e.g., 2 ≤ count ≤ 10).
- For `meta-move`, validate that `target_kind` matches what `target_id` resolves to (server-side check, not Zod).
- For `restructure`, validate that `new_node_id` is provided and is a UUID.

## Acceptance criteria

- Eleven Zod schemas exported from `packages/shared-types`, plus a `ProposalPayload` discriminated union over `kind`.
- The `proposal-created` (or `proposal`) envelope payload nests this discriminated union under a `proposal_kind`-keyed field.
- Round-trip tests for each variant.
- Property-based tests that synthesize random valid payloads and confirm validation.
- Negative tests for the most common invalid shapes (wrong enum, missing required field, malformed UUID).

## Decisions

- **One Zod schema per proposal sub-kind**, all in `packages/shared-types`.
- **Discriminated union over `kind`**, then again on inner kind for `edit-wording` and `meta-move`.
- **Proposal id is server-generated** at append time; clients don't supply it.
- **Component lists for decompose / interpretive-split: minimum 2.** A "decomposition" of size 1 is a no-op; a size-2+ split is the meaningful case.

## Additional decisions

- **Component list maximum: 10** (R27). Generous for real decomposition cases (walkthrough's biggest was 4); pathological inputs flagged. Validation rejects proposals with `components.length > 10` or `readings.length > 10`.
- **`meta-move` requires a target node or edge in v1** (R28). The Zod schema enforces `target_kind` as `'node' | 'edge'` and `target_id` as a UUID; both required. Session-level meta-moves (no target) can be added in a future schema-extension if a use case appears.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10.

Implemented in `packages/shared-types/src/events/proposals.ts` (split out from `events.ts`; the discriminated union runs long enough that nesting it inline made the parent module hard to scan). `events.ts` re-exports the public surface so consumers see one entry point.

A leaf `packages/shared-types/src/events/enums.ts` module hosts `edgeRoleSchema`, `annotationKindSchema`, and `entityKindSchema` — moved out of `events.ts` because the proposal payload schema (e.g. `annotate.annotation_kind`) needs `annotationKindSchema`, and importing it from `events.ts` would create a circular import (`events.ts → proposals.ts → events.ts`) that crashes at module-init with `Cannot access ... before initialization` on the Zod builder. The leaf module is shared by both files and breaks the cycle.

**Schema choices worth recording**:

- **`meta-move` is a single-shape object, not a discriminated union.** Per the refinement, the three meta-move kinds (`reframe` / `scope-change` / `stance`) share the *exact same* payload shape (`meta_kind` + `content` + `target_kind` + `target_id`). A `z.discriminatedUnion` would produce three identical-shape branches differing only in the literal `meta_kind` value — runtime/type complexity for no shape difference. A single object with `meta_kind: z.enum([...])` is strictly simpler. (Contrast `edit-wording`, where the two branches genuinely differ in fields — that one *is* a discriminated union.)
- **Proposal sub-payload nests under a `proposal` key on the envelope payload.** Wire shape: `{ proposal: { kind: 'classify-node', ... } }`. Alternative considered — merge proposal fields directly into the envelope payload — was rejected because the validator's two-stage parse reads more cleanly when the proposal sub-payload is its own field, and the nesting reserves room for envelope-level proposal metadata (e.g. server-assigned `proposal_id`, future fields) without colliding with proposal payload field names.
- **`StatementKind` is a top-level export** (`'fact' | 'predictive' | 'value' | 'normative' | 'definitional'`) because the moderator UI's classification picker, the projection's per-node classification field, and any future schema referring to statement kind all share the single source of truth.
- **Inner discriminated union for `edit-wording`** (`reword` vs `restructure`): real shape difference (only `restructure` carries `new_node_id`), so a `z.discriminatedUnion('edit_kind', ...)` is the right tool — missing-`new_node_id`-on-restructure is a structural rejection, not a `refine()` check. Zod 4's outer `discriminatedUnion` doesn't allow duplicate discriminator literals across branches, so the inner union is a single branch at the top level (the parser dispatches to the inner union when `kind === 'edit-wording'`).

**Component-list bounds (R27)** are enforced (`2 ≤ count ≤ 10`) on `decompose.components` and `interpretive-split.readings`. **`meta-move` target (R28)** is required (both `target_kind` and `target_id`).

**Test count delta**: +44 (45 new tests in `events/proposals.test.ts`; -1 in `events.test.ts` from removing the now-stale "accepts an empty object for `proposal`" placeholder test). Total package tests: 105 (was 61).

**Deferred** (cross-field server-side checks per refinement scope; payload validation is structural only):

- `node_id` / `edge_id` / `parent_node_id` / `target_id` / `new_node_id` / `participant` referential checks (must resolve in the session's projection).
- `meta-move` `target_kind` ↔ `target_id` consistency (the id must resolve to an entity of the asserted kind).
- `axiom-mark`'s `participant` must be a current session participant.
- `annotate` `target_kind` ↔ `target_id` consistency.

These belong to `data_and_methodology.event_types.event_validation` and the methodology engine.
