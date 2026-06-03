// Pure per-`EventKind` summary descriptor for a change-history row.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_event_summary.md
//
// `summarizeEvent(event)` maps each event to a compact **summary
// descriptor** the change-history pane renders as the per-row payload
// summary — the line that turns "Statement created · `a1b2c3d4` · 2 min
// ago" into "Statement created · *Markets allocate capital efficiently*
// · `a1b2c3d4` · 2 min ago".
//
// **Descriptor, not a finished string** (Decision §D1). The helper
// returns a small discriminated union rather than display text:
//
//   - `{ type: 'text'; text }`   — user-authored free text, rendered
//                                  VERBATIM (never translated): `wording`,
//                                  `content`, `topic`, `label`, and the
//                                  proposal summary (Decision §D3).
//   - `{ type: 'i18n'; key; values? }` — application-authored structural
//                                  words (enum labels, connectors). The
//                                  pane resolves `t(key, values)` at
//                                  render time.
//   - `{ type: 'none' }`         — empty-payload kinds; the pane emits NO
//                                  summary element (Decision §D5).
//
// Keeping the helper a pure function of one event — i18n-agnostic, no
// `Date.now()`, no `Math.random()`, no react-i18next dependency
// (Constraints §1/§2) — mirrors the established `changeHistory.ts` /
// `proposalSummary.ts` / `pendingProposals.ts` convention that `graph/*`
// helpers are clock/RNG/UI-free and unit-testable without a render
// harness. The structural words localize at render and user text passes
// through untranslated.
//
// **Total over `EventKind`** (Constraints §3): all 17 kinds handled
// explicitly; the `default` arm narrows to `never` and returns a safe
// `{ type: 'none' }` so a future/unknown kind renders nothing rather than
// throwing (mirrors `proposalSummary.ts`'s exhaustive fallback).
//
// **Single-event payload only, no cross-event resolution** (Decision
// §D4): a `vote` / `commit` / `edge-created` summary keys on the event's
// OWN payload — it does NOT resolve target ids to the referenced entity's
// wording. The sibling `mod_history_click_to_flash` will make those
// references navigable on the graph instead.

import type { Event } from '@a-conversa/shared-types';

import { summaryText } from './proposalSummary';

/**
 * The catalog namespace under which every summary i18n key lives
 * (Constraints §7). Mirrors the `moderator.changeHistory.kind.*` idiom
 * the pane already uses for the kind-label column.
 */
const KEY_PREFIX = 'moderator.changeHistory.summary';

/**
 * A compact, render-agnostic description of one event's payload summary.
 * The pane (`<ChangeHistoryPane>`) turns it into display text. See the
 * module header (Decision §D1) for the three arms' contract.
 */
export type EventSummary =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'i18n';
      readonly key: string;
      readonly values?: Readonly<Record<string, string>>;
    }
  | { readonly type: 'none' };

const NONE: EventSummary = { type: 'none' };

/**
 * Map the hyphenated participant-role enum (`debater-A` / `debater-B`) to
 * a select-safe token. ICU `select` arms cannot contain hyphens (the
 * MessageFormat parser rejects them — verified at implementation time),
 * so the `participantJoined` ICU template keys on these tokens instead.
 * This is a pure discriminator normalization, NOT translation — the
 * helper stays i18n-agnostic.
 */
function participantRoleToken(role: 'moderator' | 'debater-A' | 'debater-B'): string {
  switch (role) {
    case 'debater-A':
      return 'debaterA';
    case 'debater-B':
      return 'debaterB';
    case 'moderator':
      return 'moderator';
  }
}

/**
 * Summarize one event's payload into a render-agnostic descriptor.
 *
 * Pure: same input → same output. No clock / RNG / i18n. See the module
 * header for the per-kind mapping rationale.
 */
export function summarizeEvent(event: Event): EventSummary {
  switch (event.kind) {
    // -- Free text: render the user-authored field verbatim ----------
    case 'session-created':
      return { type: 'text', text: event.payload.topic };
    case 'node-created':
      return { type: 'text', text: event.payload.wording };
    case 'annotation-created':
      return { type: 'text', text: event.payload.content };
    case 'snapshot-created':
      return { type: 'text', text: event.payload.label };
    // Delegate to the shared proposal summarizer so a proposal reads
    // identically in the change-history pane and the pending-proposals
    // pane (Decision §D3 — one source of truth by construction).
    case 'proposal':
      return { type: 'text', text: summaryText(event.payload.proposal) };

    // -- Structural words: localize via the catalog -------------------
    case 'participant-joined':
      return {
        type: 'i18n',
        key: `${KEY_PREFIX}.participantJoined`,
        // `name` passes through verbatim (user-authored); `role` is the
        // select-safe token the ICU template's `select` arms key on.
        values: {
          name: event.payload.screen_name,
          role: participantRoleToken(event.payload.role),
        },
      };
    case 'edge-created':
      return { type: 'i18n', key: `${KEY_PREFIX}.edgeRole.${event.payload.role}` };
    case 'entity-included':
      return { type: 'i18n', key: `${KEY_PREFIX}.entityKind.${event.payload.entity_kind}` };
    case 'entity-removed':
      return { type: 'i18n', key: `${KEY_PREFIX}.entityKind.${event.payload.entity_kind}` };
    case 'vote':
      // The `choice` field is on both vote arms (facet / proposal); the
      // summary shows the localized choice regardless of target.
      return { type: 'i18n', key: `${KEY_PREFIX}.choice.${event.payload.choice}` };
    case 'withdraw-agreement':
      return { type: 'i18n', key: `${KEY_PREFIX}.facet.${event.payload.facet}` };
    // `commit` / `meta-disagreement-marked` are `target`-discriminated:
    // the facet arm carries a facet to localize; the proposal arm keys on
    // a `proposal_id` only (no facet, and no cross-event resolution in v1
    // per Decision §D4) so it renders no summary.
    case 'commit':
      return event.payload.target === 'facet'
        ? { type: 'i18n', key: `${KEY_PREFIX}.facet.${event.payload.facet}` }
        : NONE;
    case 'meta-disagreement-marked':
      return event.payload.target === 'facet'
        ? { type: 'i18n', key: `${KEY_PREFIX}.facet.${event.payload.facet}` }
        : NONE;
    case 'session-mode-changed':
      return {
        type: 'i18n',
        key: `${KEY_PREFIX}.sessionModeChanged`,
        values: { previous: event.payload.previous_mode, next: event.payload.new_mode },
      };

    // -- Empty payload: no meaningful summary (Decision §D5) ----------
    case 'session-ended':
    case 'participant-left':
    case 'proposal-withdrawn':
      return NONE;

    default: {
      // Exhaustively narrowed over `EventKind`; this is a runtime safety
      // net for a future/unknown kind (and callers that bypass
      // TypeScript), returning a no-summary descriptor rather than
      // throwing — mirrors `proposalSummary.ts`'s exhaustive fallback.
      const _exhaustive: never = event;
      void _exhaustive;
      return NONE;
    }
  }
}
