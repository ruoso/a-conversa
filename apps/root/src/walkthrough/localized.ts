// Locale overlay for the walkthrough's DEMO CONTENT — the node wordings
// and annotation texts the graph renders. The canonical event log stays
// English (it is also the server/test fixture); when the landing locale
// is pt-BR or es-419 the demo merges a per-locale overlay over the
// canonical events before they reach the renderer.
//
// The overlay is keyed by EVENT ID and overrides only human-text payload
// fields (`wording` on node-created, `content` on annotation-created,
// `new_wording` on the reword proposal). Ids, kinds, order, and count
// are untouched by construction — so the narration anchors, the dialogue
// anchors, and the visible-step table (all computed over the canonical
// module) remain locale-invariant.
//
// Refinement: tasks/refinements/landing_page/walkthrough_locale_overlay.md
// ADR:         0024 (react-i18next — chrome strings live in the catalogs;
//              this overlay carries diegetic CONTENT, like the fixture's
//              wordings themselves).

import { useTranslation } from 'react-i18next';

import type { Event } from '@a-conversa/shared-types';

import { walkthroughEvents } from './index.js';
import ptBROverlay from './overlays/pt-BR.json' with { type: 'json' };
import es419Overlay from './overlays/es-419.json' with { type: 'json' };

/** The overridable human-text fields, per event id. */
export interface WalkthroughOverlayEntry {
  readonly wording?: string;
  readonly content?: string;
  readonly new_wording?: string;
}

export type WalkthroughOverlay = Readonly<Record<string, WalkthroughOverlayEntry>>;

export const WALKTHROUGH_OVERLAYS: Readonly<Record<string, WalkthroughOverlay>> = {
  'pt-BR': ptBROverlay,
  'es-419': es419Overlay,
};

/**
 * Merge one event with its overlay entry. Only the three known text
 * fields are applied, and only when the canonical payload already
 * carries that field — an overlay can re-word, never re-shape.
 */
function applyEntry(event: Event, entry: WalkthroughOverlayEntry): Event {
  const payload = event.payload as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...payload };
  if (entry.wording !== undefined && typeof payload['wording'] === 'string') {
    merged['wording'] = entry.wording;
  }
  if (entry.content !== undefined && typeof payload['content'] === 'string') {
    merged['content'] = entry.content;
  }
  if (entry.new_wording !== undefined && event.kind === 'proposal') {
    const proposal = payload['proposal'] as Record<string, unknown>;
    if (typeof proposal['new_wording'] === 'string') {
      merged['proposal'] = { ...proposal, new_wording: entry.new_wording };
    }
  }
  return { ...event, payload: merged } as Event;
}

/**
 * The walkthrough events with the given locale's content overlay
 * applied. Unknown locales (and en-US) return the canonical module
 * reference itself — stable identity for React memoization.
 */
export function localizeWalkthroughEvents(locale: string): readonly Event[] {
  const overlay = WALKTHROUGH_OVERLAYS[locale];
  if (overlay === undefined) {
    return walkthroughEvents;
  }
  return walkthroughEvents.map((event) => {
    const entry = overlay[event.id];
    return entry === undefined ? event : applyEntry(event, entry);
  });
}

// Per-locale merge cache — the merge is pure over (locale), so each
// locale's array is computed once and React consumers get a stable
// reference across renders.
const cache = new Map<string, readonly Event[]>();

/**
 * The demo's event source: the canonical walkthrough with the current
 * UI language's content overlay applied (stable reference per locale).
 */
export function useWalkthroughEvents(): readonly Event[] {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  let events = cache.get(locale);
  if (events === undefined) {
    events = localizeWalkthroughEvents(locale);
    cache.set(locale, events);
  }
  return events;
}
