# walkthrough_locale_overlay — localized demo content (event-log overlay, pt-BR / es-419)

## TaskJuggler entry

`landing_page.walkthrough_locale_overlay` in `tasks/47-landing-page.tji`.

## Effort estimate

1d. Inherited dependencies: `walkthrough_dialogue_chat` (the dialogue's
own localization rides the catalogs; this task covers the rest of the
demo content), `walkthrough_representative_log` (the reword event the
overlay also translates).

## What this task is

When the landing locale is pt-BR or es-419, the walkthrough graph still
showed English node wordings and annotation texts — the demo's chrome
and captions were localized but its CONTENT was not. This task adds
per-locale content overlays: JSON assets keyed by EVENT ID that override
only the human-text payload fields (node `wording`, annotation
`content`, the reword's `new_wording`), merged over the canonical events
in apps/root before they reach the renderer.

## Why it needs to be done

User direction (2026-06-10): "we should have the entire event log
translated as well, not just the dialogue." The canonical fixture must
stay English — it is also the server/test fixture and the anchor source
— so translation happens as a landing-side overlay, not a fork.

## Constraints / requirements

1. The canonical log is untouched; every test/server consumer keeps
   reading English.
2. The merge preserves ids, kinds, order, sequences, and count — the
   narration anchors, dialogue anchors, and visible-step table (all
   computed over the canonical module) stay locale-invariant by
   construction.
3. Only the three known text fields are overridable; the merged stream
   must pass the full `validateEvent` sweep.
4. Coverage is what the graph RENDERS: every `node-created` wording,
   every `annotation-created` content, and the reword's `new_wording` —
   pinned by a completeness assertion so future fixture edits fail
   loudly if the overlays lag. Proposal-internal copies the renderer
   never shows (decompose components, capture-node wording, the session
   topic) are deliberately out of scope.
5. Machine drafts ride the same native-review process as catalog
   strings (parking-lot note; the overlay files sit outside the
   `*.review.json` trackers, so the note names them explicitly).

## Acceptance criteria

- Switching the UI language to pt-BR / es-419 renders translated node
  wordings and annotation texts in the demo (both variants — the hook is
  the single events source for each).
- `localized.test.ts` green: key/field integrity, cross-locale parity,
  completeness, id/order invariance, validateEvent sweep, stable en-US
  reference identity.

## Decisions

- **D1 — overlay over fork**: per-locale JSON assets under
  `apps/root/src/walkthrough/overlays/`, merged by a pure
  `localizeWalkthroughEvents(locale)` with a per-locale cache;
  `useWalkthroughEvents()` keys on `i18n.language` and hands React a
  stable per-locale reference.
- **D2 — content vs chrome**: the overlay carries diegetic content
  (like the fixture's wordings); UI strings stay in the catalogs
  (ADR 0024). The dialogue is catalog-resolved already
  (`walkthrough_dialogue_chat` D2) and does not ride this overlay.
- **D3 — re-word, never re-shape**: the merge applies a field only when
  the canonical payload already carries it, so an overlay typo can drop
  a translation but can never malform an event.

## Open questions

(none — all decided)

## Status

**Done** (2026-06-10). Artifacts: `apps/root/src/walkthrough/overlays/
{pt-BR,es-419}.json` (26 translated texts each), `localized.ts`
(merge + hook), both demo variants sourcing events through the hook,
`localized.test.ts`, parking-lot note for native review.
