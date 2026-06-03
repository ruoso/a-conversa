# Refinement — `moderator_ui.mod_change_history_pane.mod_history_event_summary`

## TaskJuggler entry

Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) under
`task mod_change_history_pane "Change history pane"`:

```
task mod_change_history_pane "Change history pane" {
  depends !mod_layout.mod_right_sidebar, root_app.root_moderator_cutover, backend.replay_endpoints.get_session_log
  task mod_history_scroller "Reverse-chronological event scroller" {
    effort 1d
    allocate team
    complete 100
  }
  task mod_history_event_summary "Brief payload summary per entry" {
    effort 1d
    allocate team
    depends !mod_history_scroller
  }
  task mod_history_click_to_flash "Click entry to flash affected entities on graph" { depends !mod_history_scroller }
  task mod_history_filtering "Filter by event kind / actor / target" { depends !mod_history_scroller }
}
```

## Effort estimate

**1 day.** Adds one pure summary helper (`graph/eventSummary.ts`), a one-line
extension to the existing `mergeAndOrderEventLog` row builder, a small summary
element in the existing `<ChangeHistoryPane>` row, a batch of `moderator.changeHistory.summary.*`
i18n keys with parity across three locales, and the Vitest + Playwright coverage
(extending three existing test files). The pane, the row contract, the fetch/merge
seam, and the e2e harness already exist from `mod_history_scroller`; this task
enriches one column. The only real design call — how to keep the summary
localizable while user-authored free text passes through verbatim — is settled
below (D1, descriptor not pre-rendered string).

## Inherited dependencies

This leaf's only direct dependency is `!mod_history_scroller`; through the parent
`mod_change_history_pane` it transitively inherits the same three the scroller
inherited.

**Settled (Done):**

- **`mod_history_scroller`** (Done 2026-06-03) —
  [`tasks/refinements/moderator-ui/mod_history_scroller.md`](mod_history_scroller.md).
  Shipped the pane, the row contract, the REST-prefetch+WS-overlay data path, and
  the e2e harness this task extends:
  - [`apps/moderator/src/graph/changeHistory.ts`](../../../apps/moderator/src/graph/changeHistory.ts) —
    `ChangeHistoryRow` (`:36-59`) + pure `mergeAndOrderEventLog` (`:72-98`).
  - [`apps/moderator/src/layout/ChangeHistoryPane.tsx`](../../../apps/moderator/src/layout/ChangeHistoryPane.tsx) —
    the pane (`:156-240`) and the co-located `ChangeHistoryRowItem` (`:125-154`)
    rendering the three columns `change-history-row-kind` / `-actor` / `-timestamp`.
  - [`tests/e2e/moderator-change-history.spec.ts`](../../../tests/e2e/moderator-change-history.spec.ts) —
    the route-rendered, `seedWsStore`-driven Playwright spec.
- **`mod_layout.mod_right_sidebar`** (Done 2026-05-11), **`root_app.root_moderator_cutover`**
  (Done 2026-05-16), **`backend.replay_endpoints.get_session_log`** (Done 2026-06-03) —
  all consumed already by the scroller; no new surface needed here. See the
  scroller refinement's Inherited-dependencies section for detail.

**Pending:** (none — all settled.)

## What this task is

Enrich each change-history row with a **brief, per-kind payload summary** — the
one extra line that turns "Statement created · `a1b2c3d4` · 2 min ago" into
"Statement created · *Markets allocate capital efficiently* · `a1b2c3d4` · 2 min
ago." The scroller (`mod_history_scroller`) deliberately shipped a minimal row
(kind label + actor + relative timestamp) and reserved the payload detail for
this leaf. This task adds:

- a pure `summarizeEvent(event)` helper that maps each `EventKind` to a compact
  **summary descriptor** (not a finished string — see D1), covering all 17 kinds
  totally;
- a `summary` field on `ChangeHistoryRow`, populated by `mergeAndOrderEventLog`;
- a `change-history-row-summary` element in the existing row component that
  renders user-authored free text verbatim and localizes the structural words.

It does **not** add interactivity (that is `mod_history_click_to_flash`) or
filtering (`mod_history_filtering`); it does not resolve target ids to the
referenced entity's wording (D4).

## Why it needs to be done

A bare kind-label row tells the moderator *that* a statement was created, not
*which* statement — for an audit/orientation surface that is half the value. The
summary is what lets the moderator scan the log and recognize the moves without
clicking into the graph. Like the scroller, this leaf is in the subtree that
gates **M7 (end-to-end debate)** ([`tasks/99-milestones.tji`](../../99-milestones.tji),
`m_end_to_end_debate`), whose walkthrough exercises the change-history pane live.
The two remaining siblings (`mod_history_click_to_flash`, `mod_history_filtering`)
are independent of this one — they extend the same row but do not consume the
summary — so this task unblocks nothing further by itself; its value is the
milestone-facing audit surface.

## Inputs / context

- **Row builder + row type to extend** —
  [`apps/moderator/src/graph/changeHistory.ts`](../../../apps/moderator/src/graph/changeHistory.ts):
  - `changeHistory.ts:36-59` — `ChangeHistoryRow` (`id`, `sequence`, `kind`,
    `actor`, `createdAt`). This task adds a `summary` field.
  - `changeHistory.ts:82-91` — the row-build loop inside `mergeAndOrderEventLog`;
    each row is built from the full `Event` in hand, so `summarizeEvent(event)`
    is computed here (one added line).
- **Row component to extend** —
  [`apps/moderator/src/layout/ChangeHistoryPane.tsx`](../../../apps/moderator/src/layout/ChangeHistoryPane.tsx):
  - `ChangeHistoryPane.tsx:125-154` — `ChangeHistoryRowItem`. Today: kind chip
    (`:143-145`), actor (`:146-148`), timestamp (`:149-151`). The summary element
    is added here.
  - `ChangeHistoryPane.tsx:132` — `t(\`moderator.changeHistory.kind.${row.kind}\`)`
    is the established per-kind label lookup; the summary lookups follow the same
    `t()` idiom for the i18n-descriptor branch.
- **Reusable proposal summary (DELEGATE for `kind === 'proposal'`)** —
  [`apps/moderator/src/graph/proposalSummary.ts`](../../../apps/moderator/src/graph/proposalSummary.ts):
  - `proposalSummary.ts:42-84` — `summaryText(proposal: ProposalPayload): string`,
    a pure, total switch over all 11 proposal sub-kinds, already used by
    `PendingProposalsPane`. Reuse it so a `proposal` row reads identically in both
    panes (D3). **Note its limitations:** it emits English structural words
    ("Set substance = …", "Decompose into N components") and falls back to 8-char
    id prefixes rather than resolving node/edge wordings (`proposalSummary.ts:42-56`).
- **Event envelope + payload shapes** — ADR 0021
  ([`docs/adr/0021-event-envelope-discriminated-union-with-zod.md`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)),
  [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts).
  The summary descriptor per kind keys on these payload fields:

  | `kind` | payload (`events.ts`) | summary source |
  | --- | --- | --- |
  | `session-created` | `:213-222` `topic`, `privacy` | text: `topic` |
  | `session-ended` | `:226-228` (none meaningful) | none |
  | `participant-joined` | `:232-241` `screen_name`, `role` | i18n: name (verbatim) + localized role |
  | `participant-left` | `:245-250` (ids only) | none |
  | `node-created` | `:307-317` `wording` | text: `wording` |
  | `edge-created` | `:321-341` `role` enum | i18n: localized role |
  | `annotation-created` | `:354-369` `kind` enum, `content` | text: `content` |
  | `entity-included` | `:387-392` `entity_kind` | i18n: localized entity kind |
  | `proposal` | nested `ProposalPayload` | text: `summaryText(payload.proposal)` (D3) |
  | `proposal-withdrawn` | `:743-747` (ids only) | none |
  | `vote` | `:439-472` `choice` enum, `target` | i18n: localized choice |
  | `commit` | `:517-542` `target` discriminator | i18n: localized target facet |
  | `meta-disagreement-marked` | `:575-600` `target` discriminator | i18n: localized target facet |
  | `snapshot-created` | `:623-629` `label` | text: `label` |
  | `entity-removed` | `:645-650` `entity_kind` enum | i18n: localized entity kind |
  | `session-mode-changed` | `:676-681` `previous_mode`, `new_mode` | i18n: localized mode transition |
  | `withdraw-agreement` | `:706-712` `entity_kind`, `facet` enum | i18n: localized facet |

  (Proposal sub-kind payloads live in
  [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts);
  delegating to `summaryText` means this task does not re-enumerate them.)
- **i18n** — ADR 0024
  ([`docs/adr/0024-frontend-i18n-react-i18next-with-icu.md`](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md));
  react-i18next **with ICU**, so enum→label and interpolation/`select` are
  available in catalog templates. Catalogs:
  [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/).
  The existing `moderator.changeHistory` block (en-US.json `:222-248`) is a
  **nested** object with `kind.*` sub-keys; this task adds a sibling `summary`
  object under it.
- **i18n parity test to extend** —
  [`packages/i18n-catalogs/src/change-history.test.ts`](../../../packages/i18n-catalogs/src/change-history.test.ts)
  (added by the scroller) asserts `moderator.changeHistory.*` parity across the
  three locales. Extend it to cover the new `summary.*` keys.
- **E2E spec to extend** —
  [`tests/e2e/moderator-change-history.spec.ts`](../../../tests/e2e/moderator-change-history.spec.ts):
  - `:99-106` seeds `node-created` events carrying a known `wording` ("First
    statement", …) via `seedWsStore`. The summary e2e asserts the row's summary
    equals that wording.
  - [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts)
    `:140-147` — `seedWsStore` can synthesize `node-created` (`wording`),
    `edge-created` (`role`), `annotation-created` (`content`), `proposals`,
    `votes` (`choice`), `commits`. Enough to seed both a free-text and an
    enum-driven summary in the spec.

## Constraints / requirements

1. **Summary derives from the event's OWN payload only.** No resolution of
   target ids against the rest of the log in v1 (D4); a single event in →
   a summary descriptor out. This keeps the helper pure on one event (no
   `Event[]` parameter, no O(n²) walk) and mirrors `proposalSummary.ts`'s
   deliberate id-prefix fallback.
2. **The helper is pure** (matches `changeHistory.ts` / `proposalSummary.ts`):
   no `Date.now()`, no `Math.random()`, no closure over time, no react-i18next
   dependency. Output is a function of the input event alone (D1).
3. **The helper is total over `EventKind`.** All 17 kinds handled explicitly;
   a `default` arm narrows exhaustively and returns a safe `{ type: 'none' }`
   so a future/unknown kind renders no summary rather than throwing (mirrors
   `proposalSummary.ts:77-82`).
4. **Localizable structural words; verbatim user text.** Any word the
   *application* authors (verbs, enum labels, connectors) is localized via a
   catalog key. Any text the *user* authored (`wording`, `content`, `topic`,
   `label`, `screen_name`) passes through verbatim — it is not translatable and
   must not be wrapped in a translation key. The descriptor shape (D1) is what
   keeps these two cleanly separated.
5. **Row contract is extended, not reshaped.** The existing
   `change-history-row` `data-*` attributes and the three existing column
   test-ids (`-kind` / `-actor` / `-timestamp`) are unchanged. The summary is a
   new element with test-id `change-history-row-summary`, rendered **only when a
   summary exists** (descriptor `type !== 'none'`) so empty-payload kinds don't
   emit a blank element. The siblings (`click_to_flash`, `filtering`) still see
   the row contract they expect.
6. **Truncate, single line.** The summary column uses the established Tailwind
   `truncate` idiom (cf. `ACTOR_CLASSES` `ChangeHistoryPane.tsx:82`); the row
   stays compact. No expand/collapse in v1.
7. **i18n parity** across en-US / pt-BR / es-419 for every new
   `moderator.changeHistory.summary.*` key, including each enum label
   (`role`, `choice`, `entity_kind`, `facet`, `mode`); ICU templates interpolate
   with no leftover `{placeholder}` tokens (ADR 0024).
8. **No new dependency, no new architectural seam.** Reuses the existing graph
   helper module pattern, the existing pane, and the existing `t()` lookup; no
   ADR required (see Decisions).

## Acceptance criteria

Per ADR 0022, every check below ships as a committed automated test — no
throwaway verification.

**Vitest (unit / component)** — `apps/moderator/src/…`, `packages/i18n-catalogs/src/…`:

1. **`summarizeEvent` (new `graph/eventSummary.test.ts`):** total over all 17
   `EventKind`s. Asserts: free-text kinds (`node-created`, `annotation-created`,
   `session-created`, `snapshot-created`) return `{ type: 'text', text: <verbatim
   payload field> }`; enum kinds (`edge-created`, `vote`, `entity-removed`,
   `session-mode-changed`, …) return `{ type: 'i18n', key, values }` with the
   expected key + interpolation values; empty-payload kinds (`session-ended`,
   `participant-left`, `proposal-withdrawn`) return `{ type: 'none' }`; and
   `kind === 'proposal'` returns `{ type: 'text', text }` byte-equal to
   `summaryText(event.payload.proposal)` for at least two sub-kinds. Pure (same
   input → same output, no clock/RNG).
2. **`mergeAndOrderEventLog` (`graph/changeHistory.test.ts`, extended):** each
   produced row's `summary` equals `summarizeEvent(event)` for that event; the
   existing ordering/dedup cases still pass with the added field.
3. **Pane row render (`layout/ChangeHistoryPane.test.tsx`, extended):** for a
   seeded `node-created`, the row's `change-history-row-summary` shows the
   `wording` verbatim; for an enum kind (e.g. `vote`), it shows the localized
   choice string; for a `{ type: 'none' }` kind (e.g. `session-ended`), **no**
   `change-history-row-summary` element is present in that row.
4. **i18n parity (`packages/i18n-catalogs/src/change-history.test.ts`, extended):**
   every new `moderator.changeHistory.summary.*` key (including each enum label)
   resolves to a non-empty, locale-distinct string across en-US / pt-BR / es-419,
   and each ICU template renders with sample values leaving no `{placeholder}`.

**Playwright (e2e)** — **in scope, NOT deferred.** The pane is already
route-rendered and `seedWsStore`-driven (wired by `mod_history_scroller`, D6
there), so the summary is reachable today with no new harness hook:

5. Extend `tests/e2e/moderator-change-history.spec.ts` (or add a sibling
   `test()` in the same describe): seed a `node-created` with a known `wording`
   and assert the matching row's `change-history-row-summary` text equals that
   wording; seed a `vote` (enum `choice`) and assert its summary renders the
   localized choice label (en-US, matching the catalog-parity layer's single-locale
   convention noted in the spec header). Reuses the existing
   `window.__aConversaWsStore` backdoor.

**No Cucumber.** This task changes no wire behavior, broadcast shape, or
projector output — it is a frontend-only read-side rendering enrichment over an
already-landed event log. Vitest + Playwright are the right pins (cf. the
Backend/WS guidance: Cucumber is for protocol/replay-boundary changes, which this
is not).

**Build/test gate:** `make` build + test green before commit (global rule).

## Decisions

- **D1 — Summary is a structured descriptor, not a pre-rendered string
  (chosen) over returning a finished display string from the helper.** The
  helper returns a small discriminated union —
  `{ type: 'text'; text } | { type: 'i18n'; key; values? } | { type: 'none' }` —
  and the pane turns it into display text (`text` verbatim; `i18n` via
  `t(key, values)`; `none` → render nothing). *Rationale:* it keeps the
  graph-layer helper **pure and i18n-agnostic** (matching the established
  `changeHistory.ts` / `proposalSummary.ts` / `pendingProposals.ts` convention
  that `graph/*.ts` helpers are clock/RNG/UI-free and unit-testable without a
  render harness), while still satisfying ADR 0024 parity — the structural words
  localize at render and user-authored free text passes through untranslated.
  *Rejected: pass `t` into the helper / return a finished string* — simpler call
  site, but it couples a pure graph helper to react-i18next, forces an i18n
  harness into the helper's unit test, and re-creates exactly the
  hard-coded-English wart that `proposalSummary.ts` already carries (see D3).
- **D2 — Compute `summary` in `mergeAndOrderEventLog`, store it on
  `ChangeHistoryRow` (chosen) over carrying the raw `Event` on the row and
  summarizing at render.** The merge loop already holds the full `Event` when it
  builds each row (`changeHistory.ts:82-91`), so a single
  `summary: summarizeEvent(event)` line populates it; the view layer stays a flat
  view-model with no envelope leaking in. *Rejected: carry `readonly event: Event`
  on the row* — more reusable for the two siblings (which also need payload), but
  speculative for *this* task and a wider row contract than the summary needs; a
  future sibling can widen the row when it actually needs the payload. The
  summarization logic still lives in its own `eventSummary.ts` module (not inline
  in the merge helper) so it is independently unit-tested.
- **D3 — Delegate `kind === 'proposal'` to the existing `summaryText` (chosen)
  over re-implementing proposal summarization here.** Reusing
  `proposalSummary.summaryText` guarantees a proposal reads **identically** in the
  change-history pane and the pending-proposals pane (one source of truth, by
  construction). *Accepted cost:* `summaryText` emits some English structural
  words and id-prefix fallbacks — a pre-existing i18n inconsistency in that shared
  helper. Re-localizing it is a cross-cutting refactor that also touches
  `PendingProposalsPane` and `proposalFilter.ts` and would need its own parity
  pass; it is **out of scope** here and surfaced to the parking lot (not a WBS
  task — the call of *whether* it's worth the churn is a judgment for the human
  queue, and "re-localize X" risks the self-perpetuating-audit anti-pattern if
  encoded as a leaf without a crisp deliverable). The 16 non-proposal kinds, being
  new summary text, are fully localized via D1.
- **D4 — Summary uses the event's own payload only; no cross-event reference
  resolution in v1 (chosen) over resolving target ids to node/edge/annotation
  wordings.** A `vote`/`commit`/`edge-created` row shows the target's id prefix
  / role, not the referenced statement's wording. *Rationale:* resolving
  references means passing the whole log into the summarizer (breaking D1/D2's
  single-event purity and adding an O(n²) walk), and the sibling
  `mod_history_click_to_flash` will make those references **navigable on the
  graph** — a better affordance than inlining wordings into every row. Selectors
  to do the resolution exist (`apps/moderator/src/graph/selectors.ts`
  `selectNodeWordingById` / `selectEdgeLabelById` / `selectAnnotationContentById`),
  so the enhancement is cheap if it proves wanted; it is surfaced to the parking
  lot rather than registered as a WBS leaf (its value is uncertain given
  click-to-flash, and a speculative-enhancement leaf would get picked up before
  that value is established).
- **D5 — Render the summary only when present (chosen) over always emitting the
  element.** Empty-payload kinds (`session-ended`, `participant-left`,
  `proposal-withdrawn`) produce `{ type: 'none' }` and emit **no**
  `change-history-row-summary` node, so a row never shows a blank/placeholder
  summary line. Keeps the minimal row genuinely minimal for those kinds and makes
  the e2e/unit assertions on absence unambiguous.
- **D6 — E2E in scope inline, no deferral.** The pane is route-rendered and
  WS-seedable today (the scroller's D6 wired it and landed
  `moderator-change-history.spec.ts`), and `seedWsStore` synthesizes both
  free-text (`node-created`) and enum (`vote`) events — so a thin-but-real summary
  spec lands here. This pays down debt rather than adding any; nothing is routed
  to `mod_pw_full_session_run` or `mod_pw_diagnostic_flow` from this task.

## Open questions

(none — all decided.)

## Status

**Done** — 2026-06-03.

- Added pure `summarizeEvent(event)` helper (`apps/moderator/src/graph/eventSummary.ts`) — total over all 17 `EventKind`s, returning a `{ type: 'text' | 'i18n' | 'none' }` descriptor union; `proposal` kind delegates to `summaryText`.
- Extended `ChangeHistoryRow` with a `summary` field, populated via `summarizeEvent` inside `mergeAndOrderEventLog` (`apps/moderator/src/graph/changeHistory.ts`).
- Added `change-history-row-summary` element (flex-1 truncate; actor→shrink, timestamp→ml-auto) to `ChangeHistoryRowItem` in `apps/moderator/src/layout/ChangeHistoryPane.tsx`; renders only when descriptor `type !== 'none'`.
- Added `moderator.changeHistory.summary.*` keys — 2 ICU templates + enum labels for edgeRole/choice/entityKind/facet — across all three locales (`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`); `sessionModeChanged` uses ASCII `->` separator (not `→`) per codepoint policy.
- Vitest coverage: `summarizeEvent` totality/purity/per-arm (`apps/moderator/src/graph/eventSummary.test.ts`); row.summary round-trip (`apps/moderator/src/graph/changeHistory.test.ts`); free-text/enum/none row render (`apps/moderator/src/layout/ChangeHistoryPane.test.tsx`); summary key parity + ICU-template render (`packages/i18n-catalogs/src/change-history.test.ts`).
- Playwright: "rows render a per-row payload summary (free text + localized enum)" spec added to `tests/e2e/moderator-change-history.spec.ts`.
- D3 (hard-coded English structural words in shared `summaryText` for proposal rows) and D4 (cross-event id→wording resolution) routed to parking lot per the refinement's decisions.
