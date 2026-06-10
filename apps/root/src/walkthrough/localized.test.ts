// Pins the locale-overlay merge (ADR 0022 — durable, committed test
// artifact): every overlay key targets a real event; only the known
// human-text fields are overridden; the merged stream still passes the
// full per-kind schema validation; ids/order/count are untouched (so the
// anchor + step tables stay locale-invariant by construction); en-US
// returns the canonical reference itself.
//
// Refinement: tasks/refinements/landing_page/walkthrough_locale_overlay.md

import { describe, expect, it } from 'vitest';

import { validateEvent } from '@a-conversa/shared-types';

import { walkthroughEvents } from './index';
import { WALKTHROUGH_OVERLAYS, localizeWalkthroughEvents } from './localized';

const LOCALES = Object.keys(WALKTHROUGH_OVERLAYS);
const ALLOWED_FIELDS = new Set(['wording', 'content', 'new_wording']);

describe('walkthrough locale overlays — structural integrity', () => {
  it('covers pt-BR and es-419', () => {
    expect(LOCALES.sort()).toEqual(['es-419', 'pt-BR']);
  });

  it('every overlay key is a real event id and overrides only the allowed text fields', () => {
    const ids = new Set(walkthroughEvents.map((event) => event.id));
    for (const locale of LOCALES) {
      const overlay = WALKTHROUGH_OVERLAYS[locale]!;
      for (const [eventId, entry] of Object.entries(overlay)) {
        expect(ids.has(eventId), `${locale}: unknown event id ${eventId}`).toBe(true);
        for (const field of Object.keys(entry)) {
          expect(ALLOWED_FIELDS.has(field), `${locale}: disallowed field ${field}`).toBe(true);
        }
      }
    }
  });

  it('both overlays translate the same set of events (parity)', () => {
    const [a, b] = LOCALES;
    expect(Object.keys(WALKTHROUGH_OVERLAYS[a!]!).sort()).toEqual(
      Object.keys(WALKTHROUGH_OVERLAYS[b!]!).sort(),
    );
  });

  it('every rendered text event is covered: node wordings, annotation contents, the reword', () => {
    // The overlay's scope is what the graph RENDERS. A fixture edit that
    // adds a node/annotation without extending the overlays fails here.
    for (const locale of LOCALES) {
      const overlay = WALKTHROUGH_OVERLAYS[locale]!;
      for (const event of walkthroughEvents) {
        if (event.kind === 'node-created' || event.kind === 'annotation-created') {
          expect(
            overlay[event.id],
            `${locale}: missing overlay for ${event.kind} ${event.id}`,
          ).toBeDefined();
        }
        if (event.kind === 'proposal' && event.payload.proposal.kind === 'edit-wording') {
          expect(overlay[event.id]?.new_wording).toBeDefined();
        }
      }
    }
  });
});

describe('localizeWalkthroughEvents — the merge', () => {
  it('returns the canonical reference for en-US / unknown locales', () => {
    expect(localizeWalkthroughEvents('en-US')).toBe(walkthroughEvents);
    expect(localizeWalkthroughEvents('fr-FR')).toBe(walkthroughEvents);
  });

  it('keeps ids, kinds, sequences, and count identical', () => {
    for (const locale of LOCALES) {
      const localized = localizeWalkthroughEvents(locale);
      expect(localized).toHaveLength(walkthroughEvents.length);
      for (let i = 0; i < localized.length; i += 1) {
        expect(localized[i]!.id).toBe(walkthroughEvents[i]!.id);
        expect(localized[i]!.kind).toBe(walkthroughEvents[i]!.kind);
        expect(localized[i]!.sequence).toBe(walkthroughEvents[i]!.sequence);
      }
    }
  });

  it('applies the translated texts', () => {
    for (const locale of LOCALES) {
      const overlay = WALKTHROUGH_OVERLAYS[locale]!;
      const localized = localizeWalkthroughEvents(locale);
      const byId = new Map(localized.map((event) => [event.id, event]));
      let applied = 0;
      for (const [eventId, entry] of Object.entries(overlay)) {
        const event = byId.get(eventId)!;
        const payload = event.payload as Record<string, unknown>;
        if (entry.wording !== undefined) {
          expect(payload['wording']).toBe(entry.wording);
          applied += 1;
        }
        if (entry.content !== undefined) {
          expect(payload['content']).toBe(entry.content);
          applied += 1;
        }
        if (entry.new_wording !== undefined) {
          const proposal = payload['proposal'] as Record<string, unknown>;
          expect(proposal['new_wording']).toBe(entry.new_wording);
          applied += 1;
        }
      }
      expect(applied).toBeGreaterThan(0);
    }
  });

  it('the merged stream passes the full per-kind schema validation', () => {
    for (const locale of LOCALES) {
      for (const event of localizeWalkthroughEvents(locale)) {
        try {
          validateEvent(event);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          throw new Error(
            `${locale}: event seq=${event.sequence} kind=${event.kind} failed validateEvent: ${reason}`,
            { cause },
          );
        }
      }
    }
  });
});
