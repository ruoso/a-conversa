// `useNewProposalArrival` — arrival-detection hook that fires a
// one-shot, transient flash signal each time a NEW `proposal` event
// lands in the per-session event log.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
//              (Decisions §1 — single hook called once at the route,
//              not two parallel hooks for badge + graph; Decisions §2 —
//              all 11 proposal sub-kinds resolve a target via
//              `proposalTargetEntity`; Decisions §4 — flash fires for
//              ALL arrivals including the current participant's own
//              proposals.)
// ADRs:
//   - 0021 (event envelope shape — the upstream `proposal` event's wire
//           shape is validated at parse time; this consumer trusts the
//           discriminated-union narrowing).
//   - 0022 (committed verifications — the observable state transitions
//           are pinned in `useNewProposalArrival.test.ts`).
//
// What "new" means: the hook tracks the highest-seen `event.id` for
// proposal events across renders via a `useRef<Set<string>>`. A second
// render with the same events list does NOT re-fire the flash for the
// same id (Decision §1 — the seen-set persists across the consumer's
// re-render cycle). On hook unmount the set resets, so re-entering the
// route re-flashes any pending proposals (Decision §8).
//
// What the hook returns: `{ activeFlashes, isBadgeFlashing }`. The map
// is keyed by `entityId` (Cytoscape's element id space — both nodes
// and edges share one id namespace per the wire schema). Each entry
// carries the entity kind + a `clearAt` timestamp; the consumer
// (`projectGraph`'s `flashIndex` parameter) reads the map to stamp
// `data.isFlashing` on the matching element. `isBadgeFlashing` is true
// for the duration of the flash window after any new arrival —
// independent of whether the target resolved to a graph entity, so a
// defensive future zero-target sub-kind still pulses the badge.
//
// Timing: `performance.now()` (not `Date.now()`) so the timing is
// monotonic and immune to system-clock jumps mid-debate. `setTimeout`
// (not `requestAnimationFrame`) since the flash window is in the
// human-perception range (~1s), not animation-frame granularity.

import { useEffect, useRef, useState } from 'react';

import { useWsStore } from '../ws/wsStore';
import { proposalTargetEntity } from './proposalTargetEntity';

/**
 * Flash-window duration in milliseconds. Chosen per Decision §6 of
 * `part_proposal_notification`: long enough to register in peripheral
 * vision (>1s), short enough to not stack on rapid arrivals.
 */
export const FLASH_WINDOW_MS = 1200;

/**
 * Per-entity flash entry — the graph entity to ring-pulse and when to
 * stop.
 */
export interface ProposalFlashEntry {
  /** Element id (`node_id` or `edge_id` — same namespace). */
  readonly elementId: string;
  /** Which Cytoscape collection the element lives in. */
  readonly kind: 'node' | 'edge';
  /**
   * `performance.now()`-relative ms at which the flash should clear.
   * The consumer reads the entry as "flashing" iff `clearAt > now`.
   */
  readonly clearAt: number;
}

/**
 * The hook's return shape. `activeFlashes` keyed by element id;
 * `isBadgeFlashing` is the top-of-tab badge pulse flag.
 */
export interface NewProposalArrivalState {
  readonly activeFlashes: ReadonlyMap<string, ProposalFlashEntry>;
  readonly isBadgeFlashing: boolean;
}

/**
 * Stable empty-map reference for the no-arrival baseline. Returned
 * literally (not a fresh `new Map()`) so downstream `useMemo` dep
 * arrays bail out cleanly when the consumer has nothing to flash.
 */
export const EMPTY_FLASH_MAP: ReadonlyMap<string, ProposalFlashEntry> = Object.freeze(
  new Map<string, ProposalFlashEntry>(),
);

const EMPTY_STATE: NewProposalArrivalState = Object.freeze({
  activeFlashes: EMPTY_FLASH_MAP,
  isBadgeFlashing: false,
});

interface InternalState {
  readonly activeFlashes: ReadonlyMap<string, ProposalFlashEntry>;
  /**
   * Performance-time at which the badge pulse should stop. `0` for
   * "no active badge pulse". The badge can be flashing even if
   * `activeFlashes` is empty (defensive zero-target arrival arm).
   */
  readonly badgeClearAt: number;
}

const EMPTY_INTERNAL: InternalState = Object.freeze({
  activeFlashes: EMPTY_FLASH_MAP,
  badgeClearAt: 0,
});

/**
 * Subscribe to a session's WS event log; detect every NEW `proposal`
 * event arrival; return the per-entity + badge flash state for the
 * `FLASH_WINDOW_MS` window after each arrival.
 *
 * The hook is a pure consumer of the WS store — no mutations, no
 * dispatch, no `client.send(...)`. The flash machinery lives entirely
 * in React state + a single per-soonest-expiry `setTimeout`. The
 * upstream `events` array reference is replaced wholesale on each
 * `applyEvent` call (per `wsStore.ts:121`), so the Zustand selector's
 * reference-equality bailout drives the subscription cadence.
 */
export function useNewProposalArrival(sessionId: string): NewProposalArrivalState {
  const events = useWsStore((state) => state.sessionState[sessionId]?.events);
  const seenProposalEventIds = useRef<Set<string>>(new Set());
  const [internal, setInternal] = useState<InternalState>(EMPTY_INTERNAL);

  // Detect new arrivals on every events-array change.
  useEffect(() => {
    if (events === undefined) return;
    const now = performance.now();
    const additions: ProposalFlashEntry[] = [];
    let arrived = false;
    for (const event of events) {
      if (event.kind !== 'proposal') continue;
      if (seenProposalEventIds.current.has(event.id)) continue;
      seenProposalEventIds.current.add(event.id);
      arrived = true;
      const target = proposalTargetEntity(event.payload.proposal);
      if (target !== null) {
        additions.push({
          elementId: target.id,
          kind: target.kind,
          clearAt: now + FLASH_WINDOW_MS,
        });
      }
    }
    if (!arrived) return;
    setInternal((prev) => {
      const nextFlashes = new Map(prev.activeFlashes);
      // Drop expired entries before adding new ones — keeps the map
      // from accumulating over a long-running session.
      for (const [key, entry] of nextFlashes) {
        if (entry.clearAt <= now) nextFlashes.delete(key);
      }
      for (const add of additions) {
        nextFlashes.set(add.elementId, add);
      }
      return {
        activeFlashes: nextFlashes,
        badgeClearAt: now + FLASH_WINDOW_MS,
      };
    });
  }, [events]);

  // Soonest-expiry timer. Schedules a single `setTimeout` keyed on the
  // closest unexpired clearAt; on fire, drops every entry whose
  // clearAt has passed AND flips `badgeClearAt` to `0` when the badge
  // window has lapsed. The `setInternal` callback form keeps the
  // computation against the latest state (no stale-closure bug per
  // Decision §6's constraint).
  useEffect(() => {
    const now = performance.now();
    let soonest = Number.POSITIVE_INFINITY;
    if (internal.badgeClearAt > now && internal.badgeClearAt < soonest) {
      soonest = internal.badgeClearAt;
    }
    for (const entry of internal.activeFlashes.values()) {
      if (entry.clearAt > now && entry.clearAt < soonest) soonest = entry.clearAt;
    }
    if (!Number.isFinite(soonest)) return;
    const delay = Math.max(0, soonest - now);
    const id = setTimeout(() => {
      setInternal((prev) => {
        const t = performance.now();
        let droppedAny = false;
        const nextFlashes = new Map<string, ProposalFlashEntry>();
        for (const [key, entry] of prev.activeFlashes) {
          if (entry.clearAt > t) {
            nextFlashes.set(key, entry);
          } else {
            droppedAny = true;
          }
        }
        const nextBadge = prev.badgeClearAt > t ? prev.badgeClearAt : 0;
        if (!droppedAny && nextBadge === prev.badgeClearAt) {
          // Nothing actually changed — preserve the prior reference so
          // downstream consumers' memo bailouts hold.
          return prev;
        }
        if (nextFlashes.size === 0 && nextBadge === 0) {
          return EMPTY_INTERNAL;
        }
        return { activeFlashes: nextFlashes, badgeClearAt: nextBadge };
      });
    }, delay);
    return () => clearTimeout(id);
  }, [internal]);

  if (internal === EMPTY_INTERNAL) return EMPTY_STATE;
  return {
    activeFlashes: internal.activeFlashes,
    isBadgeFlashing: internal.badgeClearAt > 0,
  };
}
