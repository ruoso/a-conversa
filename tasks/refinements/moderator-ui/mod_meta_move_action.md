# Moderator meta-move action — propose a meta-move from a bottom-strip mode entry

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_meta_move_flow.mod_meta_move_action`.

```
task mod_meta_move_action "Capture meta-move action with target selected" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed. This is the **leaf foundation of `mod_meta_move_flow`** (the F8
capture flow): both sibling tasks (`mod_meta_move_kind_selector` and
`mod_meta_move_disputed_visibility`) declare `depends !mod_meta_move_action`.
The work is small — wire an F8 mode-entry into `captureStore`, render the
existing capture-pane slots in `'meta-move'` mode, ship a `useMetaMoveAction()`
hook that constructs the `meta-move` propose envelope and a `<MetaMoveProposeAction>`
button — but it spans three established patterns (the `captureStore.mode`
mode-entry pattern that `mod_capture_defeater_mode` / `mod_decompose_mode` /
`mod_warrant_elicitation_mode` settled, the `useProposeAction.ts` /
`useCommitAction.ts` hook shape, and the i18n catalog workflow). There is
no new architecture: the propose-side validator already lives on the server
(`apps/server/src/methodology/handlers/propose.ts` — `validateMetaMoveProposal`,
completed by `meta_move_logic.md` on 2026-05-10), the `meta-move` proposal
sub-kind has its Zod schema and wire envelope settled
([packages/shared-types/src/events/proposals.ts L412–419](../../../packages/shared-types/src/events/proposals.ts#L412)),
`CaptureMode` already lists `'meta-move'` as a valid mode
([apps/moderator/src/stores/captureStore.ts L140](../../../apps/moderator/src/stores/captureStore.ts#L140)),
the `WsClient` exposes `send('propose', payload)` with the proposed-ack /
WsRequestError discipline proven by `useProposeAction.ts`, and the
auto-suggest target chip already supports node and annotation targets
([apps/moderator/src/layout/CaptureTargetChip.tsx](../../../apps/moderator/src/layout/CaptureTargetChip.tsx)).

Concretely the deliverable is:

- **One new hook** `apps/moderator/src/layout/useMetaMoveAction.ts` —
  mirrors `useProposeAction.ts`'s shape (snapshot-restore-on-error +
  in-flight guard + single `client.send('propose', payload)` call carrying
  the meta-move proposal envelope). Reads `text`, `targetEntityId`,
  `targetEntityKind`, and the new `metaMoveKind` slice from
  `useCaptureStore`. Exposes `{ proposeMetaMove, canPropose,
  validationError, inFlight, lastError }`.
- **One new component** `apps/moderator/src/layout/MetaMoveProposeAction.tsx`
  — the Propose button + inline error region for the meta-move mode.
  Mirrors `apps/moderator/src/layout/ProposeAction.tsx` but with a
  meta-move-specific label and the new hook.
- **One new component** `apps/moderator/src/layout/MetaMoveModeExitButton.tsx`
  — the `Esc` / button affordance that exits `'meta-move'` mode back to
  `'idle'`. Mirrors `CaptureDefeaterModeExitButton.tsx` / `DecomposeModeExitButton.tsx`.
- **Slice extension** in `apps/moderator/src/stores/captureStore.ts` — adds
  `metaMoveKind: MetaMoveKind | null` (with `MetaMoveKind = 'reframe' |
  'scope-change' | 'stance'`) + `setMetaMoveKind(kind)` setter +
  `enterMetaMoveMode()` action (sets `mode: 'meta-move'` + resets other
  capture slices, mirroring `enterDecomposeMode()` / `enterCaptureDefeaterMode()`).
  `metaMoveKind` defaults to `'reframe'` (the doc-listed first kind) so the
  action ships in a propose-able state ahead of the kind-selector sibling
  (Decision §3).
- **F8 keymap wiring** in `apps/moderator/src/layout/captureKeymap.ts` and
  the moderator route — adds `onEnterMetaMove` to `CaptureKeymapHandlers`
  with the same editable-target / modifier-bail / repeat-skip discipline
  the existing handlers use. F8 is unmapped today (confirmed: the only
  `F8` references are doc-block comments forecasting this task).
- **Bottom-strip composition** in the moderator layout — when
  `mode === 'meta-move'`, render: existing `<CaptureTextInput>` (text slice
  reused), existing `<CaptureTargetChip>` (target slice reused, auto-suggest
  from selection store unchanged), a placeholder slot for
  `<MetaMoveKindSelector>` (filled by sibling task), `<MetaMoveProposeAction>`,
  and `<MetaMoveModeExitButton>`.
- **New i18n catalog keys** under `moderator.metaMoveAction.*` — Propose-button
  label, content-placeholder text, validation messages (target-missing,
  content-missing, kind-missing), WireError chrome (`wireError`, `timeoutError`,
  `unknownError`), and the mode-banner copy. Six chrome keys + three reason
  keys = nine keys × three locales = 27 catalog entries. Drafts for pt-BR /
  es-419 land flagged PENDING in the existing `*.review.json` trackers.
- **One follow-up native-review task registered** in
  `tasks/35-frontend-i18n.tji` — `i18n_meta_move_action_native_review`
  (effort 0.5d, depends on the tail of the existing native-review chain).
- **Vitest cases** under
  `apps/moderator/src/layout/useMetaMoveAction.test.tsx`,
  `apps/moderator/src/layout/MetaMoveProposeAction.test.tsx`,
  `apps/moderator/src/layout/MetaMoveModeExitButton.test.tsx`,
  and additions to `apps/moderator/src/stores/captureStore.test.ts`
  (slice shape, default, setter, `enterMetaMoveMode()` resets).
- **One new `test()` block** extending `tests/e2e/moderator-capture.spec.ts`
  — drives the full chain through the dev compose stack (login → create
  session → seed a node into the WS store via the `__aConversaWsStore`
  seam the existing propose-action / axiom-mark covers use → press F8
  → assert mode-banner reads the meta-move copy → assert target chip
  auto-suggests the seeded node → type content → assert default
  `metaMoveKind = 'reframe'` → click Propose → assert the `proposal`
  event with the `meta-move` sub-kind, default `'reframe'` `meta_kind`,
  and the node id as `target_id` lands in
  `useWsStore.sessionState[sessionId].events` via `expect.poll`).

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public
contracts):

- **`data_and_methodology.methodology_engine.meta_move_logic`** (done —
  2026-05-10). The server's propose handler enforces two rules in evaluation
  order, dispatched on `target_kind`: rule 1 — target entity exists
  (`getNode(projection, target_id)` for `target_kind: 'node'`,
  `getEdge(projection, target_id)` for `target_kind: 'edge'`) — rejection
  code `'target-entity-not-found'`. Rule 2 — target entity is visible
  (`nodeIsVisible` / `edgeIsVisible`) — rejection code
  `'illegal-state-transition'`. No new `RejectionReason` value introduced.
  See [tasks/refinements/data-and-methodology/meta_move_logic.md](../data-and-methodology/meta_move_logic.md).

- **`moderator_ui.mod_capture_flow`** (parent dep). The bottom-strip
  scaffold (`BottomStripCapture.tsx`), the five render-prop slots, the
  stable `data-testid` selectors, the `useCaptureStore` Zustand store with
  `text` / `classification` / `targetEntityId` / `targetEntityKind` /
  `edgeRole` / `mode` slices, the mode-banner, and the
  `<CaptureTargetChip>` auto-suggest mechanism are all already in place.

- **`root_app.root_moderator_cutover`** — the moderator route renders the
  bottom strip and is reachable from the session-lobby cutover.

- **`packages/shared-types/src/events/proposals.ts L412–419`**
  ([metaMoveProposalSchema](../../../packages/shared-types/src/events/proposals.ts#L412))
  — the wire shape is final: `{ kind: 'meta-move', meta_kind: 'reframe' |
  'scope-change' | 'stance', content: string.min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
  target_kind: 'node' | 'edge', target_id: UUID }`. Single-shape over
  discriminated union per the schema's doc-block (lines 397–410).

- **`backend.websocket_protocol.ws_propose_message`** — the WS propose
  handler accepts the `meta-move` sub-kind via `proposePayloadSchema` and
  dispatches to `validateMetaMoveProposal`. Ack envelope on success:
  `{ type: 'proposed', id, inResponseTo, payload: { sessionId, sequence,
  eventId } }`. Error envelope: `{ type: 'error', payload: { code, message } }`
  with `code` one of the two rejection codes above (plus the protocol-layer
  `'forbidden'` / `'sequence-mismatch'` cases shared by all propose envelopes).

Pending (none — every cross-team contract this task depends on is closed).

## What this task is

The F8 capture flow's entry point and submission spine. A meta-move proposes
to relocate the debate's framing — a `reframe` ("the netting question is the
operational form of the deeper dispute"), a `scope-change` ("we should be
defending the typical case, not the edge case"), or a methodological
`stance` ("I won't press this point on principle"). Per
[docs/moderator-ui.md L132–141](../../../docs/moderator-ui.md#L132), the
moderator triggers `Capture meta-move` with the relevant target node(s)
selected, types the meta-move content, classifies the kind, and proposes;
the captured meta-move becomes a special annotation on the targeted entity
and — if contested — stays visible as `disputed` so it cannot be quietly
absorbed.

This task ships the spine: the F8 mode-entry binding, the `'meta-move'`
mode rendering of the bottom-strip pane (text input + target chip +
propose button + exit affordance), the `metaMoveKind` slice + setter (with
a sensible default), the `useMetaMoveAction()` hook, the propose envelope
construction, the inline error handling, and the e2e regression cover.
Two sibling tasks fill out the flow on top of this spine:

- `mod_meta_move_kind_selector` (0.5d) ships the visible kind picker
  (three buttons / radio + keyboard shortcuts) that writes `metaMoveKind`.
- `mod_meta_move_disputed_visibility` (0.5d) ships the disputed-state
  rendering of committed meta-moves on the graph.

## Why it needs to be done

Without this task the F8 narrative in `docs/moderator-ui.md` is not
reachable from the moderator UI: the server accepts `meta-move` propose
envelopes (per `meta_move_logic`) but no client can construct or send one.
The flow is methodologically load-bearing — without explicit meta-move
capture, debate terrain silently shifts under the moderator's feet. The
two sibling tasks (kind selector, disputed visibility) are gated on this
one; landing this task unblocks both, and lights up the F8 column of the
moderator's keyboard surface.

## Inputs / context

Code seams the implementation plugs into (real file paths, all verified
against the working tree):

- [packages/shared-types/src/events/proposals.ts L412–419](../../../packages/shared-types/src/events/proposals.ts#L412)
  — `metaMoveProposalSchema`. The wire payload's `target_kind` /
  `target_id` are required (R28, line 410); session-level meta-moves
  with no target are deferred.
- [packages/shared-types/src/events/proposals.ts L397–410](../../../packages/shared-types/src/events/proposals.ts#L397)
  — the `meta-move` sub-kind doc-block. Single-shape over discriminated
  union because the three kinds share an identical payload shape.
- [apps/moderator/src/stores/captureStore.ts L132–141](../../../apps/moderator/src/stores/captureStore.ts#L132)
  — `CaptureMode` already lists `'meta-move'`. This task adds the
  `metaMoveKind` slice + setter + `enterMetaMoveMode()` action.
- [apps/moderator/src/layout/CaptureTargetChip.tsx](../../../apps/moderator/src/layout/CaptureTargetChip.tsx)
  — the auto-suggest target chip. Already kind-aware (`node` and
  `annotation` per Decision §3 of `mod_propose_annotation_endpoint_gestures.md`);
  reused as-is in `'meta-move'` mode. For meta-move the target may be a
  node OR an edge — Decision §4 records the v1 narrowing to **node only**
  via the existing target chip (annotation- / edge-target capture is
  deferred to a follow-up task — see Decision §4).
- [apps/moderator/src/layout/useProposeAction.ts L282–477](../../../apps/moderator/src/layout/useProposeAction.ts#L282)
  — the snapshot-restore-on-error, in-flight-guard, `client.send('propose', ...)`
  pattern the new hook mirrors.
- [apps/moderator/src/layout/captureKeymap.ts L69–80](../../../apps/moderator/src/layout/captureKeymap.ts#L69)
  — the optional-handlers seam the F8 binding extends.
- [tasks/refinements/moderator-ui/mod_axiom_mark_action.md](./mod_axiom_mark_action.md)
  — the 1d action-task precedent (target-keyed, fire-and-forget, inline
  errors, i18n catalog discipline, e2e in `moderator-capture.spec.ts`).
  This task does not adopt the submenu pattern — see Decision §1.
- [tasks/refinements/moderator-ui/mod_propose_action.md](./mod_propose_action.md)
  — the WireError-handling discipline (inline messages, NOT toasts;
  server message verbatim; per-key validation gates) that this task
  follows for the meta-move propose path.
- [tasks/refinements/data-and-methodology/meta_move_logic.md](../data-and-methodology/meta_move_logic.md)
  — the propose-side validator's rule set, rejection codes, and the
  open question about commit-time annotation creation (still deferred).
- [docs/moderator-ui.md L132–141](../../../docs/moderator-ui.md#L132)
  — the F8 narrative this task implements.
- [docs/methodology.md](../../../docs/methodology.md) — meta-move
  definition and the three kinds.
- [docs/adr/0021-event-envelope.md](../../../docs/adr/0021-event-envelope.md)
  — envelope conventions the propose payload inherits.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — i18n catalog workflow the new keys follow.
- [docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md)
  — drives the Vitest + Cucumber + Playwright layering of acceptance.

## Constraints / requirements

- **Wire envelope is fixed.** `client.send('propose', payload)` with
  `payload = { sessionId, expectedSequence, proposal }` and
  `proposal = { kind: 'meta-move', meta_kind, content, target_kind,
  target_id }`. No client-minted proposal-event id; the server mints it.
- **Single envelope per propose** — not the optional-second-envelope
  pattern of F1 capture. Meta-move always rides one envelope.
- **Target required.** `target_id` is mandatory by schema. The Propose
  button stays disabled while `targetEntityId === null`; the validation
  message names the missing-target case.
- **Target kind narrowed to `'node'` in v1** (Decision §4). The schema
  accepts `target_kind: 'edge'` but the moderator UI's only target-selection
  mechanism today is the node-scoped `CaptureTargetChip`. Meta-moves on
  edges are deferred to a follow-up task that adds an edge-target gesture.
- **Annotation targets out of v1 too** (Decision §4 corollary). The
  `CaptureTargetChip` supports `targetEntityKind: 'annotation'` for F1's
  proposal endpoints, but the meta-move propose path coerces to
  `target_kind: 'node'` and refuses to propose if
  `targetEntityKind === 'annotation'` (inline validation message).
- **Default `metaMoveKind = 'reframe'`** (Decision §3). The action ships
  in a propose-able state ahead of the kind-selector sibling. The
  validation gate accepts any of the three enum values.
- **Editable-target / modifier-bail / repeat-skip discipline** is reused
  for the F8 binding via the existing `captureKeymap` plumbing.
- **Fire-and-forget snapshot-restore on error**, mirroring
  `useProposeAction`: optimistic `text` / `targetEntityId` /
  `metaMoveKind` clear on success; on error, restore the snapshot and
  surface a localized inline error.
- **WireError discipline** matches `mod_propose_action` Decision §1:
  `WsRequestError` → inline message with `code` + server-supplied
  `message` (verbatim, do NOT re-localize). `WsRequestTimeoutError` →
  localized timeout copy. Other `Error` → localized unknown-error copy.
  Error region dismissed on next successful propose OR on next user
  modification of the inputs.
- **No moderator-as-debater concern.** Unlike axiom-mark (rule 3 forbids
  the moderator from marking on behalf of debaters), the meta-move
  validator has no per-participant gate; the moderator can propose
  meta-moves directly as `requester: moderator`.
- **No commit-time effects.** The propose handler validates and emits
  the `proposal` event only; the engine's commit-time projection does
  not yet promote the meta-move into a visible annotation on the target
  entity. That open question is still deferred from `meta_move_logic`;
  this task neither resolves nor extends it. The disputed-visibility
  sibling assumes a future commit-time projection task will land the
  annotation render input — out of scope for this action task.
- **i18n catalog parity** must remain green after the new keys land.
  Drafts for pt-BR / es-419 ride flagged PENDING in `*.review.json`;
  en-US is authoritative.
- **No regressions** to existing F-numbered flows. The F8 binding sits
  alongside the existing F-key plumbing without colliding with it
  (F1–F7 are bound by sibling flows; F8 was reserved by name in the
  doc-blocks).

## Acceptance criteria

(Reference [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)
— each layer below pins durable behavior; no throwaway scripts.)

1. **Slice + setter + action shipped.** `useCaptureStore` exports the new
   `metaMoveKind` slice (typed `MetaMoveKind | null`, default `'reframe'`),
   `setMetaMoveKind(kind)` setter, and `enterMetaMoveMode()` action that
   sets `mode: 'meta-move'` AND resets `text` / `classification` /
   `targetEntityId` / `targetEntityKind` / `edgeRole` / `edgeDirection` /
   `metaMoveKind` to defaults (mirroring `enterDecomposeMode()`).
   Vitest pins the shape, the default, the setter behavior, and the
   `enterMetaMoveMode()` reset.
2. **`useMetaMoveAction()` hook** exports
   `{ proposeMetaMove, canPropose, validationError, inFlight, lastError }`.
   Vitest pins: the success path emits exactly one propose envelope with
   the correct shape; the in-flight guard rejects re-entry; WireError
   mapping for `WsRequestError` / `WsRequestTimeoutError` / generic
   `Error`; per-key validation gates (target null, content empty, kind
   null, target-kind annotation-rejected); snapshot-restore on error
   land atomically via `useCaptureStore.setState({ ... })`.
3. **`<MetaMoveProposeAction>` component** renders a Propose button with
   stable `data-testid="meta-move-propose-action"`, an inline error
   region with `data-testid="meta-move-propose-error"`, and localized
   labels. Button enable/disable mirrors `canPropose`; label switches to
   the in-flight copy during the round-trip. Vitest pins render, store-wire,
   gesture, and error paths.
4. **`<MetaMoveModeExitButton>` component** renders an exit affordance
   with stable `data-testid="meta-move-mode-exit"` that calls
   `setMode('idle')`. Vitest pins render + click.
5. **F8 binding wired** through `captureKeymap.ts`. When pressed outside
   an editable target with no modifier, calls
   `useCaptureStore.getState().enterMetaMoveMode()`. The new handler
   inherits the same editable-target / modifier-bail / repeat-skip
   discipline as the existing handlers. Vitest pins the bail cases AND
   the success case.
6. **Bottom-strip composition** renders the meta-move slots when
   `mode === 'meta-move'`: `<CaptureTargetChip>`, `<CaptureTextInput>`,
   a placeholder slot for `<MetaMoveKindSelector>` (filled by sibling
   task — see Decision §3), `<MetaMoveProposeAction>`, and
   `<MetaMoveModeExitButton>`. The mode banner reads the localized
   meta-move copy. Vitest pins the per-mode slot selection.
7. **i18n catalog keys** land under `moderator.metaMoveAction.*` and
   `moderator.modeBanner.metaMove`. Nine keys × three locales = 27
   catalog entries. The pt-BR / es-419 entries land flagged PENDING in
   `*.review.json`; the catalog-parity Vitest stays green.
8. **Native-review follow-up registered.** `tasks/35-frontend-i18n.tji`
   carries a new `i18n_meta_move_action_native_review` task (effort 0.5d,
   depends on the tail of the existing native-review chain — currently
   `!i18n_axiom_mark_action_native_review`). Closer registers in the WBS
   under the i18n-translation milestone.
9. **Cucumber scenario added.** `tests/behavior/methodology/propose-meta-move.feature`
   was added by `meta_move_logic` already. This task adds **no new**
   Cucumber scenario — the wire contract is unchanged and the engine
   pins are already in place. (No `ws_*` shape this task introduces.)
10. **Playwright e2e** — extend `tests/e2e/moderator-capture.spec.ts`
    with one new `test()` block exercising the full chain (login →
    create session → seed node → F8 → target chip auto-suggests →
    type content → click Propose → assert one `proposal` event with
    `kind: 'meta-move'`, `meta_kind: 'reframe'` (default), correct
    `target_id`, and `target_kind: 'node'` lands in
    `useWsStore.sessionState[sessionId].events` via `expect.poll`).
    Skips gracefully if `window.__aConversaWsStore` is unreachable,
    matching the discipline of the existing propose-action / axiom-mark
    covers. **E2e is in scope, NOT deferred** — the F8 mode is
    user-reachable via the keyboard binding this task adds, satisfying
    the UI-stream "default — e2e is in scope" policy.
11. **Edge-target follow-up registered.** A new task
    `mod_meta_move_edge_target_gesture` (effort 0.5d, depends on
    `!mod_meta_move_action` and on a future edge-target chip mechanism;
    home milestone: the same `M_moderator_console` milestone that hosts
    `mod_meta_move_flow`) is registered by the closer in
    `tasks/30-moderator-ui.tji`. Adds an edge-target gesture so a
    meta-move can target an edge per the schema's `target_kind: 'edge'`
    branch. Surfaced here as concrete agent-implementable work — not
    as a "revisit" / "audit" task.
12. **Annotation-target follow-up registered.** A new task
    `mod_meta_move_annotation_target_gesture` (effort 0.5d, depends on
    `!mod_meta_move_action`; same milestone) is registered by the closer.
    Decides whether meta-moves on annotations should be permissible
    (engine-side enum widening would be required) OR whether the v1
    `targetEntityKind: 'annotation'` rejection should remain as a
    permanent product rule. The decision is a concrete spec-write +
    implementation, not an open-ended audit.
13. **Build + test green.** `make build && make test` clean; the
    catalog-parity, Vitest, Cucumber, and Playwright suites all pass.
14. **Refinement `## Status`** block appended on landing, per the
    task-completion ritual ([tasks/refinements/README.md L32–42](../README.md#L32)).

## Decisions

### §1 — Mode-entry pattern, NOT context-menu submenu

The bottom-strip mode-entry pattern (used by `mod_capture_defeater_mode`,
`mod_decompose_mode`, `mod_interpretive_split_mode`,
`mod_operationalization_mode`, `mod_warrant_elicitation_mode`) is the
home for F8, NOT the node-context-menu submenu pattern that
`mod_axiom_mark_action` adopted.

**Rationale.** Meta-move requires three inputs — content text + kind +
target — plus a propose button. That's the same input surface as F1
capture (text + classification + target + role + propose) and well
beyond what a context-menu submenu accommodates (axiom-mark gets away
with a submenu because its only input is a participant pick). The
bottom-strip pane is the existing seam for multi-input capture flows;
reusing it keeps the moderator's mental model coherent (text-input lives
in the bottom strip across F1, F2, F3, F6, F8) and inherits the
target-auto-suggest plumbing for free.

**Alternative rejected.** A modal dialog with content + kind picker + a
read-only target line would work but breaks the keyboard-first capture
discipline (`docs/moderator-ui.md:187`) — modals trap focus and require
mouse to dismiss, friction the moderator's hands-on-keyboard live-session
pattern explicitly avoids.

**Alternative rejected.** A nested submenu on the node context menu
(axiom-mark-style) would constrain meta-move to one node-at-a-time and
cannot accommodate the content text input — the submenu would have to
re-route into a modal anyway.

### §2 — F8 binds to `enterMetaMoveMode()` with no modifier

The F8 key, unmodified, calls `enterMetaMoveMode()`. The binding lives
in the existing `captureKeymap.ts` plumbing as a new optional handler
on `CaptureKeymapHandlers`. The bail discipline (editable-target /
modifier-other-than-shift / repeat-skip) is reused.

**Rationale.** F-keys are the doc-listed flow shortcuts
(`docs/moderator-ui.md` F1–F8 narrative) and F1 / F2 / F3 / F5 / F6 /
F7 all already bind to mode entries through the same plumbing. F8 is
the next natural slot — it was reserved by name across
`mod_mode_banner.md`, `mod_defeater_node_creation.md`, and the
`captureStore.ts:129` doc-block, all pointing at this task as the
binding's owner. Pressing F8 inside a textarea will not fire — the
editable-target bail intentionally hands the keystroke back to the
input. The moderator exits the textarea (Tab / click outside) or uses
the bottom-strip's mode-banner button to enter the mode while focus is
in a textarea — same UX as F1.

**Alternative rejected.** `Cmd+F8` / `Ctrl+F8`. Would conflict with the
modifier-bail discipline of `captureKeymap.ts` (the existing handlers
short-circuit on `metaKey || ctrlKey`); refactoring the bail rule for
this one binding is more disruptive than just using bare F8 (which is
neither a browser shortcut nor an OS-level binding on any of the
supported platforms).

**Alternative rejected.** Reuse the node context menu as the entry
trigger. The F-numbered shortcut is the dominant entry per the doc;
the context menu can be added in a follow-up task if user feedback
asks for it.

### §3 — `metaMoveKind` defaults to `'reframe'`; sibling adds picker UI

The new `metaMoveKind` slice defaults to `'reframe'` so the propose path
is functional immediately after this task ships, ahead of the
`mod_meta_move_kind_selector` sibling. The sibling adds the visible UI
(three buttons or radio with keyboard shortcuts) that lets the
moderator change the kind.

**Rationale.** The WBS has the kind-selector sibling `depends
!mod_meta_move_action` — so this task ships first. Without a default,
the Propose button would be permanently disabled until the next 0.5d
task lands, which makes the intermediate state inert. Defaulting to
`'reframe'` (the doc-listed first kind, the most common meta-move per
`docs/methodology.md`) leaves the flow functional in the gap. The
e2e cover in this task tests the default-kind path; the sibling's e2e
will add kind-change coverage.

**Alternative rejected.** Default to `null` and gate propose on kind
selection. Would block this task's e2e cover from exercising the
propose round-trip end-to-end (no kind picker to land in `null`).

**Alternative rejected.** Inline a temporary minimal radio picker as
part of this task. Duplicates work the sibling task is explicitly
scoped to do — and would have to be removed when the polished picker
lands. Default + sibling-replaces is cleaner.

### §4 — v1 narrows `target_kind` to `'node'` only

The schema accepts `target_kind: 'node' | 'edge'` and the
`<CaptureTargetChip>` slice supports `targetEntityKind: 'node' |
'annotation'`. This task narrows the meta-move propose path to
`target_kind: 'node'` only and refuses to propose if the staged
target is an annotation. Edge-target and annotation-target meta-moves
are deferred to two named follow-up tasks
(`mod_meta_move_edge_target_gesture`, `mod_meta_move_annotation_target_gesture`)
registered under Acceptance §11 and §12.

**Rationale.** The only target-selection mechanism in the moderator UI
today is the `<CaptureTargetChip>`, which auto-suggests the
most-recently-active node from the selection store; there is no
edge-selection mechanism in capture mode at all (edges aren't
selectable as capture targets in F1 either — the F1 propose path
encodes edges via `edge.role` + `otherEntity`, not via
`target_kind: 'edge'`). Adding an edge-target gesture is a separate
concern; lumping it into the 1d action would inflate scope and
require a new selection-UI seam. The schema's `target_kind: 'edge'`
branch becomes reachable when the edge-target gesture lands.

The annotation rejection (rather than silently coercing to
`target_kind: 'node'` with the annotation's id) protects against a
subtle bug class: the engine validates `getNode(projection, target_id)`
which would fail with `'target-entity-not-found'` for an annotation id,
producing a confusing wire error. Inline rejection client-side is
clearer.

**Alternative rejected.** Ship edge-target support in v1. The
edge-target gesture is its own UX problem (clicking an edge during
capture mode means what? hover-and-Enter? right-click-meta-move?) that
needs its own refinement.

**Alternative rejected.** Silently coerce annotation targets to nodes
(if the annotation hangs off a node, use the host node id). Surprising
behavior; the schema asks for the annotation, the wire carries the
host node — a debugging trap waiting to happen.

### §5 — Reuse `captureStore.text` for the meta-move content

The `text` slice is reused rather than adding a `metaMoveContent` slice.
The `enterMetaMoveMode()` action resets `text` to `''` so F1's lingering
wording does not leak in; the `useMetaMoveAction.proposeMetaMove`
optimistic clear nulls `text` on success.

**Rationale.** The bottom-strip is a single-mode-at-a-time capture
surface; the text slice is the single textarea backing it. The
defeater-mode, decompose-mode, etc. all already reuse `text` across
modes; meta-move follows the same pattern. Adding a parallel
`metaMoveContent` slice would diverge from the established pattern and
require switching the `<CaptureTextInput>` component on mode to pick
which slice to read, complicating the component for no semantic gain.

**Alternative rejected.** Add a `metaMoveContent` slice. Pure
duplication; mode-switching already resets `text`. Increases store
surface area with no behavioral payoff.

### §6 — WireError handling mirrors `mod_propose_action` Decision §1

The hook surfaces wire errors inline (NOT toasts or modals):
`WsRequestError(payload)` → `t('moderator.metaMoveAction.wireError', { code, message })`
with the wire `message` verbatim (do NOT re-localize the server's
message); `WsRequestTimeoutError` → `t('moderator.metaMoveAction.timeoutError')`;
other `Error` → `t('moderator.metaMoveAction.unknownError', { message })`.
Error region dismissed on next successful propose OR on next user
modification of `text` / `targetEntityId` / `metaMoveKind`.

**Rationale.** The `mod_propose_action` precedent is settled and proven;
copying it keeps the moderator's mental model of failure recovery
consistent across F1 and F8. Toasts / modals were explicitly rejected
in `mod_propose_action` Decision §1 because they pull focus during a
live session.

### §7 — E2e in scope, extends `moderator-capture.spec.ts`

The Playwright cover lands in `tests/e2e/moderator-capture.spec.ts` as
one new `test()` block, NOT a new spec file.

**Rationale.** The capture-flow precedent
(`mod_propose_action.md` Decision §8, `mod_axiom_mark_action.md`
Decision §8) parks all moderator-capture e2e blocks in one file to
reuse the login / create-session / seed-node setup. Splitting per-task
would explode the spec count and duplicate boilerplate. The F8 cover
is small enough (one happy-path round-trip + the default-kind assertion)
to fit alongside the existing blocks.

**Alternative rejected.** Defer to a `mod_pw_meta_move_flow` catch-all
task. There is no such catch-all in the WBS, and the UI-stream e2e
policy says "default — e2e is in scope" because the F8 mode IS
reachable (this task wires F8). Deferral is the exception, not the
default; deferral here would inherit debt onto a non-existent task.

### §8 — No `useCaptureStore` participant-list extension

Unlike axiom-mark, meta-move has no per-participant gate on the server
and surfaces no participant picker in the UI. The `useMetaMoveAction()`
hook does not consult `deriveCurrentParticipants(events)` and does not
key any state on `participantId`.

**Rationale.** The methodology engine's `validateMetaMoveProposal`
(per `meta_move_logic.md`) carries only two rules — target-exists and
target-visible — neither participant-scoped. The moderator's
authenticated identity becomes the proposal `actor` automatically
(server reads `connection.user.id`); no client-side participant choice
is involved.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- `apps/moderator/src/stores/captureStore.ts` — `MetaMoveKind` type, `metaMoveKind` slice (default `'reframe'`), `setMetaMoveKind`, `enterMetaMoveMode`, `exitMetaMoveMode`.
- `apps/moderator/src/layout/captureKeymap.ts` — `onEnterMetaMove` handler, F8 routing, `'meta-move'` added to Esc mode-list.
- `apps/moderator/src/routes/Operate.tsx` — meta-move slot swap (textInput, edgeRoleSelector=null, proposeAction); F8 keymap attach; modeBanner exit button.
- New files: `apps/moderator/src/layout/useMetaMoveAction.ts`, `MetaMoveProposeAction.tsx`, `MetaMoveModeExitButton.tsx`, `MetaMoveCapturePanel.tsx` (with matching `.test.tsx` files).
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — `moderator.metaMove.exit.*` + `moderator.metaMoveAction.*` keys (27 catalog entries across three locales); `pt-BR.review.json` and `es-419.review.json` flagged PENDING.
- `tests/e2e/moderator-capture.spec.ts` — new `test()` block: F8 → target chip → type content → `Cmd/Ctrl+Enter` → asserts rejection-path error region (seedWsStore-vs-server discrepancy documented in leading comment).
- Vitest: 2011 tests pass — captureStore meta-move slice, captureKeymap F8+Esc, `useMetaMoveAction`, `MetaMoveProposeAction`, `MetaMoveModeExitButton`, `MetaMoveCapturePanel`, Operate route slot swap.
- Tech-debt registered: `mod_meta_move_edge_target_gesture` (0.5d) and `mod_meta_move_annotation_target_gesture` (0.5d) added inside `mod_meta_move_flow` in `tasks/30-moderator-ui.tji`; both gate M7 transitively through the parent flow. i18n native-review covered by the existing parking-lot entry (2026-05-30); no WBS task registered (human-only activity).
