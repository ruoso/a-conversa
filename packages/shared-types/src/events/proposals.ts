// Proposal payload schemas — the eleven proposal sub-kinds.
//
// Refinement: tasks/refinements/data-and-methodology/proposal_events.md
// TaskJuggler: data_and_methodology.event_types.proposal_events
//
// Proposals are the methodology's main currency: every change to the
// graph starts as one. A single envelope kind (`proposal`) carries all
// eleven sub-kinds, which discriminate on the payload's inner `kind`.
// Vote and commit events reference proposal events by id (resolved at
// the envelope level, not here).
//
// **Module split**: this lives in its own file (rather than inline in
// `events.ts`) because the discriminated union — three of which nest a
// secondary discriminated union — runs long. `events.ts` re-exports
// the public surface so consumers see one entry point.
//
// **Top-level discriminator**: `kind` — eleven values matching the
// sub-kind names in docs/data-model.md. Two sub-kinds (`edit-wording`,
// and conceptually `meta-move`) carry an inner discriminator; see the
// notes on each schema.
//
// **Component-list bounds (R27)**: `decompose.components` and
// `interpretive-split.readings` validate `2 ≤ count ≤ 10`. Size 1 is a
// no-op and rejected; size > 10 is pathological and rejected.
//
// **Meta-move target (R28)**: `target_kind` and `target_id` are
// required in v1; session-level meta-moves (no target) are deferred.
//
// **Cross-field referential checks** (e.g. "node_id exists in this
// session", "edge_id role matches expected") are server-side concerns
// resolved against the projection — *not* part of payload validation
// per the refinement. The Zod schemas below check structural shape
// only.
//
// **Reused enums**: `AnnotationKind` (annotate sub-kind) is imported
// from the leaf `./enums.ts` module — we don't re-define annotation
// kind values here. (Importing from `../events.js` would create a
// circular import because `events.ts` imports this file; see
// `./enums.ts` for the rationale.) `StatementKind` is defined here
// (top-level export) because the moderator UI and other downstream
// code will reuse it; `events.ts` re-exports.

import { z } from 'zod';

import { MAX_METHODOLOGY_TEXT_LENGTH } from '../limits.js';
import { annotationKindSchema, edgeRoleSchema } from './enums.js';

// -- StatementKind ---------------------------------------------------
//
// Mirrors the five-way classification in docs/data-model.md. Used by
// the `classify-node` proposal and by the `decompose` /
// `interpretive-split` component shapes (each component carries its
// proposed classification). Hoisted to a top-level export — the
// moderator UI's classification picker, the projection's per-node
// classification field, and any future schema referring to statement
// kind all share this single source of truth.

export const statementKindSchema = z.enum([
  'fact',
  'predictive',
  'value',
  'normative',
  'definitional',
]);

export type StatementKind = z.infer<typeof statementKindSchema>;

// -- Sub-kind: classify-node -----------------------------------------
//
// Propose a classification for a node. When the `node_id` doesn't yet
// exist on the projection (the free-floating-statement case), the
// proposal also introduces the node — the optional `wording` field
// carries the participant-supplied statement text the server uses to
// mint the matching `node-created` event at propose-time per ADR 0027
// (entity vs facet layer separation). When the node already exists
// (re-classify of a committed node), `wording` is absent and the
// engine emits no `node-created` (only the `proposal` envelope).
//
// **Wire-shape evolution.** Pre-ADR-0027, classify-node carried only
// `node_id` + `classification` — the wording was held client-side
// until commit-time, when a separate flow materialised the node.
// That flow violated `docs/methodology.md` L57 ("A proposed change
// appears on the graph in `proposed` state from the moment it is
// made"). The optional `wording` field reinstates the methodology
// contract: the client passes the wording inline; the server emits
// `node-created` + `entity-included` + `proposal` in one envelope
// chain so subscribers see the proposed entity immediately.
// Methodology-text cap per F-003 — see `limits.ts`.

export const classifyNodeProposalSchema = z.object({
  kind: z.literal('classify-node'),
  node_id: z.string().uuid(),
  classification: statementKindSchema,
  wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH).optional(),
});

export type ClassifyNodeProposal = z.infer<typeof classifyNodeProposalSchema>;

// -- Sub-kind: set-node-substance ------------------------------------
//
// Propose a substance value (`agreed` | `disputed`) for a node.

export const setNodeSubstanceProposalSchema = z.object({
  kind: z.literal('set-node-substance'),
  node_id: z.string().uuid(),
  value: z.enum(['agreed', 'disputed']),
});

export type SetNodeSubstanceProposal = z.infer<typeof setNodeSubstanceProposalSchema>;

// -- Sub-kind: set-edge-substance ------------------------------------
//
// Propose a substance value for an edge. Same base shape as
// node-substance but addressing an edge, plus three OPTIONAL endpoint
// fields (`source_node_id`, `target_node_id`, `role`) used by the
// connecting-edge case.
//
// **Wire-shape evolution.** Pre-ADR-0027, set-edge-substance carried
// only `edge_id` + `value` — the connecting case minted the edge
// client-side and the edge surfaced on the canvas only after commit.
// That flow violated `docs/methodology.md` L57 ("A proposed change
// appears on the graph in `proposed` state from the moment it is
// made"). The optional `source_node_id` / `target_node_id` / `role`
// fields reinstate the methodology contract: the client passes the
// endpoints inline; the server emits `edge-created` + `entity-included`
// + `proposal` in one envelope chain so subscribers see the proposed
// edge immediately.
//
// The fields are `.optional()` (not required) because the sub-kind
// serves two distinct use-cases on the wire:
//   (a) Proposing the substance for a freshly-minted edge (the
//       connecting case) — all three endpoint fields are present and
//       the propose handler emits `edge-created` + `entity-included`.
//   (b) Proposing a substance re-vote against an extant edge (e.g.
//       the defeater-precommit flow in
//       `apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts`)
//       — none of the endpoint fields are present and the propose
//       handler emits only the `proposal` envelope.
// The propose handler discriminates via the fresh-edge predicate
// `projection.getEdge(edge_id) === undefined && source_node_id !==
// undefined && target_node_id !== undefined && role !== undefined`.
// The `role` field reuses `edgeRoleSchema` so the proposal payload and
// the matching `edgeCreatedPayloadSchema` share one source of truth
// for the seven-value vocabulary.

export const setEdgeSubstanceProposalSchema = z.object({
  kind: z.literal('set-edge-substance'),
  edge_id: z.string().uuid(),
  value: z.enum(['agreed', 'disputed']),
  source_node_id: z.string().uuid().optional(),
  target_node_id: z.string().uuid().optional(),
  role: edgeRoleSchema.optional(),
});

export type SetEdgeSubstanceProposal = z.infer<typeof setEdgeSubstanceProposalSchema>;

// -- Sub-kind: edit-wording (nested discriminated union) -------------
//
// Two distinct wire shapes (and projection semantics — see
// methodology-engine `reword_vs_restructure`):
//   - `reword`: preserves node id; only `new_wording` is required.
//   - `restructure`: creates a new node id (old edges don't follow);
//     `new_wording` and `new_node_id` both required.
//
// A nested `z.discriminatedUnion('edit_kind', ...)` is the right tool
// here because the two shapes differ: only `restructure` carries
// `new_node_id`. Discriminated union beats a single object with
// optionals because it makes the missing-`new_node_id`-on-restructure
// case a structural rejection, not a refine() check.

export const rewordEditProposalSchema = z.object({
  kind: z.literal('edit-wording'),
  edit_kind: z.literal('reword'),
  node_id: z.string().uuid(),
  // Methodology-text cap per F-003 — see `limits.ts`.
  new_wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
});

export type RewordEditProposal = z.infer<typeof rewordEditProposalSchema>;

export const restructureEditProposalSchema = z.object({
  kind: z.literal('edit-wording'),
  edit_kind: z.literal('restructure'),
  node_id: z.string().uuid(),
  // Methodology-text cap per F-003 — see `limits.ts`.
  new_wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
  new_node_id: z.string().uuid(),
});

export type RestructureEditProposal = z.infer<typeof restructureEditProposalSchema>;

export const editWordingProposalSchema = z.discriminatedUnion('edit_kind', [
  rewordEditProposalSchema,
  restructureEditProposalSchema,
]);

export type EditWordingProposal = z.infer<typeof editWordingProposalSchema>;

// -- Component shape used by decompose / interpretive-split ----------
//
// Each component / reading is a wording + classification pair. The
// resulting node is created at commit time by the methodology engine
// (decomposition_logic / interpretive_split_logic); ids are assigned
// then.

export const proposalComponentSchema = z.object({
  // Methodology-text cap per F-003 — see `limits.ts`. Each component
  // is a wording in its own right, so the per-string cap applies.
  wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
  classification: statementKindSchema,
});

export type ProposalComponent = z.infer<typeof proposalComponentSchema>;

// -- Sub-kind: decompose ---------------------------------------------
//
// Replace a parent node with 2..10 component nodes. Bounds per R27.

export const decomposeProposalSchema = z.object({
  kind: z.literal('decompose'),
  parent_node_id: z.string().uuid(),
  components: z.array(proposalComponentSchema).min(2).max(10),
});

export type DecomposeProposal = z.infer<typeof decomposeProposalSchema>;

// -- Sub-kind: interpretive-split ------------------------------------
//
// Same shape as decompose, but the components are alternative readings
// of the parent rather than a conjunctive decomposition. Bounds per
// R27.

export const interpretiveSplitProposalSchema = z.object({
  kind: z.literal('interpretive-split'),
  parent_node_id: z.string().uuid(),
  readings: z.array(proposalComponentSchema).min(2).max(10),
});

export type InterpretiveSplitProposal = z.infer<typeof interpretiveSplitProposalSchema>;

// -- Sub-kind: axiom-mark --------------------------------------------
//
// Per-participant axiom marker on a node — the marker is per-
// participant (each debater can mark independently), and the
// `participant` field is the participant's user id.

export const axiomMarkProposalSchema = z.object({
  kind: z.literal('axiom-mark'),
  node_id: z.string().uuid(),
  participant: z.string().uuid(),
});

export type AxiomMarkProposal = z.infer<typeof axiomMarkProposalSchema>;

// -- Sub-kind: meta-move ---------------------------------------------
//
// **Single-shape over discriminated union**: per the refinement, the
// three meta-move kinds (`reframe` / `scope-change` / `stance`) share
// the *exact same* payload shape — `meta_kind` + `content` +
// `target_kind` + `target_id`. A `z.discriminatedUnion` would produce
// three identical-shape branches differing only on the literal
// `meta_kind` value, which adds runtime/type complexity for no shape
// difference. A single object with `meta_kind: z.enum([...])` is
// strictly simpler. (Contrast `edit-wording`, where the two branches
// genuinely differ in fields — that one is a discriminated union.)
//
// **Target required (R28)**: both `target_kind` and `target_id` are
// required in v1. Session-level meta-moves (no target) are deferred.

export const metaMoveProposalSchema = z.object({
  kind: z.literal('meta-move'),
  meta_kind: z.enum(['reframe', 'scope-change', 'stance']),
  // Methodology-text cap per F-003 — see `limits.ts`.
  content: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
  target_kind: z.enum(['node', 'edge']),
  target_id: z.string().uuid(),
});

export type MetaMoveProposal = z.infer<typeof metaMoveProposalSchema>;

// -- Sub-kind: break-edge --------------------------------------------
//
// Propose breaking (removing) an edge. Used in the cycle-resolution
// path.

export const breakEdgeProposalSchema = z.object({
  kind: z.literal('break-edge'),
  edge_id: z.string().uuid(),
});

export type BreakEdgeProposal = z.infer<typeof breakEdgeProposalSchema>;

// -- Sub-kind: amend-node --------------------------------------------
//
// Propose new content for a node. Used in the contradiction-
// resolution path. Distinct from `edit-wording.reword`: amend is the
// methodology-driven repair op; reword is the participant-driven
// wording tweak. (Whether these collapse into one is a methodology-
// engine concern; the schemas remain distinct here.)

export const amendNodeProposalSchema = z.object({
  kind: z.literal('amend-node'),
  node_id: z.string().uuid(),
  // Methodology-text cap per F-003 — see `limits.ts`.
  new_content: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
});

export type AmendNodeProposal = z.infer<typeof amendNodeProposalSchema>;

// -- Sub-kind: annotate ----------------------------------------------
//
// Propose attaching an annotation to a node or edge. The
// `annotation_kind` reuses the existing `AnnotationKind` enum
// (note / reframe / scope-change / stance) — single source of truth
// shared with the `annotation-created` payload.

export const annotateProposalSchema = z.object({
  kind: z.literal('annotate'),
  target_kind: z.enum(['node', 'edge']),
  target_id: z.string().uuid(),
  annotation_kind: annotationKindSchema,
  // Methodology-text cap per F-003 — see `limits.ts`.
  content: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
});

export type AnnotateProposal = z.infer<typeof annotateProposalSchema>;

// -- Discriminated union over `kind` ---------------------------------
//
// Top-level discriminator is `kind`. Three sub-kinds carry an inner
// discriminator:
//   - `edit-wording`: nested `z.discriminatedUnion('edit_kind', ...)`
//     (real shape difference between reword and restructure).
//   - `meta-move`: single object with `meta_kind: z.enum(...)` (no
//     shape difference; see schema notes).
//   - `decompose` / `interpretive-split`: same component shape, no
//     inner discriminator.

// Zod's `discriminatedUnion` requires unique literal values on the
// discriminator across branches. The `edit-wording` sub-kind has two
// internal shapes (reword / restructure) that share the same outer
// `kind: 'edit-wording'` literal, so they're combined into a nested
// discriminated union (`editWordingProposalSchema`, keyed on
// `edit_kind`) which is then a single branch at the top level. The
// outer union is still a discriminated union over `kind`; the parser
// dispatches to the inner union when `kind === 'edit-wording'`.

export const proposalPayloadSchema = z.discriminatedUnion('kind', [
  classifyNodeProposalSchema,
  setNodeSubstanceProposalSchema,
  setEdgeSubstanceProposalSchema,
  editWordingProposalSchema,
  decomposeProposalSchema,
  interpretiveSplitProposalSchema,
  axiomMarkProposalSchema,
  metaMoveProposalSchema,
  breakEdgeProposalSchema,
  amendNodeProposalSchema,
  annotateProposalSchema,
]);

export type ProposalPayload = z.infer<typeof proposalPayloadSchema>;

// -- Outer proposal envelope payload ---------------------------------
//
// **Nesting choice**: the proposal sub-payload is nested under a
// `proposal` key on the outer envelope payload — i.e. the wire shape
// is `{ proposal: { kind: 'classify-node', ... } }`. Alternative
// considered: merge the proposal fields directly into the envelope
// payload. Rejected because the validator's two-stage parse (envelope
// shape, then payload shape) reads more cleanly when the proposal
// sub-payload is its own field — error messages name `payload.proposal
// .kind` rather than `payload.kind`, distinguishing proposal-shape
// errors from envelope-kind errors. Also reserves room for envelope-
// level proposal metadata (e.g. `proposal_id` once server-assigned;
// session-scoped tags; future fields) without colliding with proposal
// payload field names.

export const proposalEnvelopePayloadSchema = z.object({
  proposal: proposalPayloadSchema,
});

export type ProposalEnvelopePayload = z.infer<typeof proposalEnvelopePayloadSchema>;
