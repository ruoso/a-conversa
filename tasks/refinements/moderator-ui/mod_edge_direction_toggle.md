# Moderator capture-pane edge direction toggle — "targets" vs "is targeted by"

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) —
`moderator_ui.mod_capture_flow.mod_edge_direction_toggle`.

```
task mod_edge_direction_toggle "Edge direction toggle — 'targets' vs 'is targeted by'" {
  effort 0.5d
  allocate team
  depends !mod_target_auto_suggest, !mod_edge_role_selector, !mod_propose_action
}
```

## Effort estimate

**0.5d.** One small store slice + one `<select>` in the existing chip +
i18n + a Cucumber scenario for the inverted endpoint emission. No
engine change — the capture-node validator's rule 3 already accepts
either endpoint as the just-captured `node_id` (see
`apps/server/src/methodology/handlers/propose.ts` ~L1367-1384).

## Inherited dependencies

- `mod_target_auto_suggest` (settled) — the staged target chip and its
  no-stomp / override contract is the affordance host for the new
  toggle.
- `mod_edge_role_selector` (settled) — the directional edge-role
  enum (`supports`, `rebuts`, …) is the *semantic* direction; the
  toggle layered on top decides which end of the edge the just-
  captured node sits at.
- `mod_propose_action` (settled) — the `capture-node` proposal builder
  is the single call-site where the direction collapses to
  `source_node_id` / `target_node_id`.

## What this task is

Today the moderator's capture pane can express "new statement
*targets* the existing one" but not "new statement *is targeted by*
the existing one." The edge role is directional source→target; the
existing builder hard-codes the just-captured node as the edge SOURCE
and the staged existing node as the edge TARGET. Both directions are
valid moves in debate (e.g. "I'd like to add a claim that the
existing supporting evidence in fact supports") but only one is
reachable.

This task adds a one-bit direction control to the chip that flips
which endpoint the just-captured node lands at, without touching the
edge role list or the engine.

## Why it needs to be done

The compound capture-with-edge gesture (ADR 0030 §4) is the
methodology's primary path for adding *connected* structure. Forcing
the new node to always sit at the source side artificially blocks
half of the directed graph: any time the moderator wants the new node
to be the *target* of an existing source, they have to capture
free-floating and then add the edge in a second gesture (no such
gesture exists yet; today they would have to wait for follow-up
moderator surfaces, which are out of scope at the time of writing).

## Inputs / context

- ADR 0030 §1 (wording-only capture) and §4 (compound capture-with-
  edge survives).
- ADR 0027 — edges carry inherent directionality; identity is fixed
  at `edge-created` time.
- `apps/server/src/methodology/handlers/propose.ts` ~L1367-1384 —
  `validateCaptureNodeProposal` accepts either endpoint as the just-
  captured `node_id` via the
  `edge.source_node_id === nodeId || nodeIsVisible(...)` predicate.
- `apps/moderator/src/layout/useProposeAction.ts` —
  `buildCaptureNodeProposal` is the lone collapse point for direction.
- `apps/moderator/src/layout/CaptureTargetChip.tsx` — the chip is the
  natural affordance host because the toggle is conceptually a
  property of "the staged target."

## Constraints / requirements

- No new edge roles. `supports` stays `supports`; only the endpoint
  assignment swaps.
- No engine change. The capture-node validator already accepts either
  endpoint as the just-captured node id.
- Direction state is local to the capture pane; it does not persist
  across propose-clears. The chip resets it to the default
  (`'targets'`) when the staged target is cleared (× button, Esc) and
  the store's `reset()` resets it after a successful propose.
- Default is `'targets'` so the gesture is source-compatible with the
  prior shape; existing tests and muscle memory keep working.
- i18n: the two option labels and the select's aria-label are
  translatable; added to en-US, pt-BR, es-419 with review-flagged
  entries in the `.review.json` ledgers.

## Acceptance criteria

1. `useCaptureStore` exposes an `edgeDirection: 'targets' | 'targeted-by'`
   slice (default `'targets'`) with a `setEdgeDirection` setter.
2. The slice resets to `'targets'` on `reset()`, on each of the four
   `enter*Mode` helpers' F1-coupling clear, and inside the chip's
   `handleClear` coupled-clear.
3. `<CaptureTargetChip>`'s filled render branch renders a `<select>`
   with two options (`targets`, `targeted-by`) bound to the slice;
   the empty branch does not render the select (direction without a
   target is meaningless).
4. `buildCaptureNodeProposal` in `useProposeAction.ts` flips
   `source_node_id` / `target_node_id` based on the direction.
5. The propose-error snapshot/restore path carries `edgeDirection`
   so a failed propose preserves the moderator's direction choice.
6. Cucumber scenario `tests/behavior/methodology/propose-capture-node.feature`
   exercises the inverted-direction emission and asserts the
   `edge-created` event's source/target match the inverted shape.

## Decisions

1. **Slice shape: enum, not boolean.** `'targets' | 'targeted-by'`
   reads better at call sites than `inverted: boolean` and matches the
   user-facing copy. The cost is one more string compare; the win is
   reader-friendly conditionals (`newNodeIsSource = direction === 'targets'`).
2. **Affordance: `<select>` inside the chip, not a separate toggle.**
   The user proposed the select-in-panel shape directly. The chip is
   the natural host because the toggle is conceptually a property of
   "the staged target" — putting it elsewhere would dissociate the two
   controls. A two-option `<select>` is the smallest, most accessible
   primitive (vs. radio group, toggle button, paired buttons).
3. **No keyboard shortcut in v1.** Direction is a less-frequent choice
   than the role; adding a key consumes mnemonic real-estate and is
   easy to add later if usage warrants. The chip's clear gesture (×
   button / Esc) already resets the direction to default; the chip
   handles the "I want to start over" path.
4. **No engine change.** The capture-node validator already accepts
   the inverted shape (rule 3 of `validateCaptureNodeProposal`); the
   structural-events builder just passes source/target through. The
   inverted gesture rides the existing wire shape unchanged.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-25.** Shipped on branch `feat/targeted-by`. Touches:

- `apps/moderator/src/stores/captureStore.ts` — `EdgeDirection` type
  and slice + setter.
- `apps/moderator/src/layout/CaptureTargetChip.tsx` — `<select>`
  affordance + coupled-clear extension.
- `apps/moderator/src/layout/useProposeAction.ts` —
  `buildCaptureNodeProposal` swap + snapshot/restore carry.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` —
  3 new keys × 3 locales + review-ledger entries.
- `tests/behavior/methodology/propose-capture-node.feature` +
  `tests/behavior/steps/methodology-propose-capture-node.steps.ts` —
  inverted-direction scenario asserting the swapped endpoints
  (engine-layer; runs under `test:behavior:smoke`).
- `tests/e2e/moderator-capture-targeted-by.spec.ts` — new three-
  browser Playwright spec (alice as moderator, ben + maria as
  debaters) under the `chromium-cross-surface` project. Drives the
  full flow: alice creates a session, both debaters join and land on
  operate, alice proposes a free-floating anchor, clicks it, flips
  the chip's direction `<select>` to `targeted-by`, picks `supports`,
  captures a fresh statement, then asserts (a) the proposed edge
  surfaces on alice's canvas, (b) both debater tablets mirror the new
  node + edge, and (c) the broadcast `edge-created` event on alice's
  WS store carries inverted endpoints — anchor as `source_node_id`,
  freshly-captured node as `target_node_id`.
- `playwright.config.ts` — `chromium-cross-surface` testMatch widened
  to include the new spec.
