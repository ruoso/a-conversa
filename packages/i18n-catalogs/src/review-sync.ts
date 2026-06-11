// Native-speaker review sheets — build/apply orchestration.
//
// Parking lot: tasks/parking-lot.md (2026-05-30 — Native-speaker review
//              of pt-BR + es-419 translations)
// ADR:         docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// The pure half of the review-sheet sync cycle (the markdown render/parse
// half lives in `review-md.ts`):
//
//   - `buildReviewEntries` assembles the not-yet-signed-off entry list
//     for one locale from the already-loaded catalog / tracker /
//     walkthrough JSON values;
//   - `applyReviewSheet` takes a parsed reviewer-edited sheet and applies
//     it to those values in place (catalog wording fixes, walkthrough
//     overlay wording fixes, tracker sign-offs).
//
// Neither function touches the filesystem — the CLI scripts
// (`scripts/export-review-md.ts`, `scripts/import-review-md.ts`) own all
// IO, so the whole sync cycle is unit-testable per ADR 0022
// (`review-sync.test.ts`).

import {
  extractPlaceholders,
  type ParsedReview,
  type ParsedReviewEntry,
  type ReviewEntry,
} from './review-md.js';

export type CatalogNode = { [key: string]: CatalogNode | string };

export interface SignOff {
  key: string;
  reviewer: string;
  date: string;
}

/**
 * The `*.review.json` tracker shape. `pending` is the closers' append
 * surface; `signed_off` is the review ledger this module maintains —
 * including `walkthrough.*` keys, which `pending` never carries.
 */
export interface ReviewTracker {
  pending: string[];
  signed_off: SignOff[];
  [extra: string]: unknown;
}

export interface WalkthroughEvent {
  readonly id: string;
  readonly sequence: number;
  readonly payload: Record<string, unknown>;
}

/** The overridable human-text fields of a walkthrough overlay entry. */
export type OverlayField = 'wording' | 'content' | 'new_wording';
export type Overlay = Record<string, Partial<Record<OverlayField, string>>>;

const OVERLAY_FIELD_LABEL: Record<OverlayField, string> = {
  wording: 'statement wording',
  content: 'annotation text',
  new_wording: 'reworded statement wording',
};

/** Leaf keys with values, in catalog (= en-US file) order. */
function collectLeaves(node: CatalogNode, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      out.push([path, value]);
    } else {
      out.push(...collectLeaves(value, path));
    }
  }
  return out;
}

function lookupLeaf(node: CatalogNode, dottedKey: string): string | undefined {
  let current: CatalogNode | string = node;
  for (const segment of dottedKey.split('.')) {
    if (typeof current === 'string') return undefined;
    const next: CatalogNode | string | undefined = current[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return typeof current === 'string' ? current : undefined;
}

function setLeaf(node: CatalogNode, dottedKey: string, value: string): void {
  const segments = dottedKey.split('.');
  let current: CatalogNode = node;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (next === undefined || typeof next === 'string') {
      throw new Error(`catalog key \`${dottedKey}\` does not resolve to a leaf`);
    }
    current = next;
  }
  const leaf = segments[segments.length - 1] ?? '';
  if (typeof current[leaf] !== 'string') {
    throw new Error(`catalog key \`${dottedKey}\` does not resolve to a leaf`);
  }
  current[leaf] = value;
}

/** `walkthrough.<event-id>.<field>` split, or null for catalog keys. */
function parseWalkthroughKey(key: string): { eventId: string; field: OverlayField } | null {
  const match = /^walkthrough\.([^.]+)\.(wording|content|new_wording)$/.exec(key);
  if (match === null) return null;
  return { eventId: match[1] ?? '', field: (match[2] ?? 'wording') as OverlayField };
}

/** The canonical English text for one overlay field of one event. */
function canonicalText(event: WalkthroughEvent, field: OverlayField): string | undefined {
  if (field === 'new_wording') {
    const proposal = event.payload['proposal'];
    if (proposal === null || typeof proposal !== 'object') return undefined;
    const wording = (proposal as Record<string, unknown>)['new_wording'];
    return typeof wording === 'string' ? wording : undefined;
  }
  const value = event.payload[field];
  return typeof value === 'string' ? value : undefined;
}

export interface ReviewSources {
  /** Parsed `en-US.json`. */
  readonly english: CatalogNode;
  /** Parsed `<locale>.json`. */
  readonly catalog: CatalogNode;
  /** Parsed `<locale>.review.json`. */
  readonly tracker: ReviewTracker;
  /** Parsed `walkthrough-events.json`. */
  readonly events: readonly WalkthroughEvent[];
  /** Parsed `overlays/<locale>.json`. */
  readonly overlay: Overlay;
  /** Locale tag, for error messages. */
  readonly locale: string;
}

/**
 * Every entry still awaiting review for one locale: each `en-US.json`
 * leaf key not yet in the tracker's `signed_off` list (deliberately the
 * full catalog rather than the tracker's `pending` list — the trackers
 * have drifted and the review pass must cover everything), plus every
 * walkthrough-overlay text, keyed `walkthrough.<event-id>.<field>`.
 */
export function buildReviewEntries(sources: ReviewSources): ReviewEntry[] {
  const { english, catalog, tracker, events, overlay, locale } = sources;
  const signedOff = new Set(tracker.signed_off.map((entry) => entry.key));

  const entries: ReviewEntry[] = [];
  for (const [key, englishValue] of collectLeaves(english)) {
    if (signedOff.has(key)) continue;
    const translation = lookupLeaf(catalog, key);
    if (translation === undefined) {
      // The parity check (`run check`) gates this; reaching here means it
      // was skipped. Fail loudly rather than emit a reviewable hole.
      throw new Error(`catalog key \`${key}\` has no ${locale} value — run the parity check`);
    }
    entries.push({ key, english: englishValue, translation });
  }

  const eventById = new Map(events.map((event) => [event.id, event]));
  const overlayEntries: ReviewEntry[] = [];
  for (const [eventId, fields] of Object.entries(overlay)) {
    const event = eventById.get(eventId);
    if (event === undefined) {
      throw new Error(`overlay ${locale} references unknown walkthrough event ${eventId}`);
    }
    for (const [field, translation] of Object.entries(fields) as [OverlayField, string][]) {
      const key = `walkthrough.${eventId}.${field}`;
      if (signedOff.has(key)) continue;
      const englishValue = canonicalText(event, field);
      if (englishValue === undefined) {
        throw new Error(`overlay ${locale} event ${eventId} field ${field} has no canonical text`);
      }
      overlayEntries.push({
        key,
        english: englishValue,
        translation,
        context: `Demo event ${String(event.sequence)}: ${OVERLAY_FIELD_LABEL[field]}`,
      });
    }
  }
  overlayEntries.sort((a, b) => {
    const seqA = eventById.get(parseWalkthroughKey(a.key)?.eventId ?? '')?.sequence ?? 0;
    const seqB = eventById.get(parseWalkthroughKey(b.key)?.eventId ?? '')?.sequence ?? 0;
    return seqA - seqB;
  });

  return [...entries, ...overlayEntries];
}

export interface ApplyResult {
  /** Keys signed off (and removed from `pending`) by this sheet. */
  readonly signedOff: number;
  /** Of those, how many carried an edited wording. */
  readonly reworded: number;
  /** FLAG entries, for human follow-up; not applied. */
  readonly flagged: readonly ParsedReviewEntry[];
  /**
   * Keys skipped because their English changed since the sheet was
   * exported — the draft the reviewer judged is not the one that ships.
   * They stay pending; the next export re-offers them.
   */
  readonly stale: readonly string[];
}

/**
 * Apply a parsed reviewer-edited sheet to the locale's sources, in
 * place: OK entries write their (possibly edited) translation into the
 * catalog or walkthrough overlay and append to the tracker's
 * `signed_off`; FLAG entries are returned for follow-up; PENDING entries
 * are ignored.
 *
 * Validation is all-or-nothing: unknown keys, double sign-offs, OK
 * entries with an empty translation or with ICU placeholders that do not
 * match the English source, and OK entries without a filled-in Reviewer
 * header all throw a single aggregated Error before anything mutates.
 */
export function applyReviewSheet(
  parsed: ParsedReview,
  sources: ReviewSources,
  today: string,
): ApplyResult {
  const { english, catalog, tracker, events, overlay } = sources;
  const eventById = new Map(events.map((event) => [event.id, event]));
  const alreadySignedOff = new Set(tracker.signed_off.map((entry) => entry.key));

  const errors: string[] = [];
  const stale: string[] = [];
  const flagged: ParsedReviewEntry[] = [];
  const toApply: ParsedReviewEntry[] = [];

  for (const entry of parsed.entries) {
    if (entry.status === 'pending') continue;

    const walkthrough = parseWalkthroughKey(entry.key);
    let currentEnglish: string | undefined;
    if (walkthrough !== null) {
      const event = eventById.get(walkthrough.eventId);
      currentEnglish =
        event !== undefined && overlay[walkthrough.eventId] !== undefined
          ? canonicalText(event, walkthrough.field)
          : undefined;
    } else {
      currentEnglish = lookupLeaf(english, entry.key);
    }
    if (currentEnglish === undefined) {
      errors.push(`unknown key \`${entry.key}\``);
      continue;
    }
    if (alreadySignedOff.has(entry.key)) {
      errors.push(`key \`${entry.key}\` is already signed off — re-export before re-reviewing`);
      continue;
    }
    if (currentEnglish !== entry.english) {
      stale.push(entry.key);
      continue;
    }

    if (entry.status === 'flag') {
      flagged.push(entry);
      continue;
    }

    if (entry.translation.trim() === '') {
      errors.push(`key \`${entry.key}\` is OK but its Translation line is empty`);
      continue;
    }
    const expected = extractPlaceholders(entry.english).join(', ');
    const actual = extractPlaceholders(entry.translation).join(', ');
    if (expected !== actual) {
      errors.push(
        `key \`${entry.key}\`: placeholders changed — English has [${expected}], translation has [${actual}]`,
      );
      continue;
    }
    toApply.push(entry);
  }

  if (toApply.length > 0 && parsed.reviewer === null) {
    errors.push('sheet has OK entries but the Reviewer line was not filled in');
  }
  if (errors.length > 0) {
    throw new Error(`not applied —\n  ${errors.join('\n  ')}`);
  }

  let reworded = 0;
  for (const entry of toApply) {
    const walkthrough = parseWalkthroughKey(entry.key);
    if (walkthrough !== null) {
      const fields = overlay[walkthrough.eventId];
      if (fields === undefined) {
        throw new Error(`overlay entry vanished for \`${entry.key}\``);
      }
      if (fields[walkthrough.field] !== entry.translation) reworded++;
      fields[walkthrough.field] = entry.translation;
    } else {
      if (lookupLeaf(catalog, entry.key) !== entry.translation) reworded++;
      setLeaf(catalog, entry.key, entry.translation);
    }
    tracker.signed_off.push({
      key: entry.key,
      reviewer: parsed.reviewer ?? '',
      date: today,
    });
  }
  const nowSignedOff = new Set(tracker.signed_off.map((entry) => entry.key));
  tracker.pending = tracker.pending.filter((key) => !nowSignedOff.has(key));

  return { signedOff: toApply.length, reworded, flagged, stale };
}
