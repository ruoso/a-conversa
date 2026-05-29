// Audience-local React hooks that lift the rAF-batched Cytoscape-event
// commit machinery + the lazy-init-on-non-empty-keys seen-Set gate out
// of the four `apps/audience/src/graph/*Overlay.tsx` siblings:
//   - `<AudiencePerFacetPillOverlay>` (PerFacetPillOverlay.tsx)
//   - `<AudienceAxiomMarkOverlay>`    (AxiomMarkOverlay.tsx)
//   - `<AudienceAnnotationOverlay>`   (AnnotationOverlay.tsx)
//   - `<AudienceNodeAppearOverlay>`   (NodeAppearOverlay.tsx)
//
// Refinement: tasks/refinements/audience/aud_dom_overlay_extraction.md
//              (Decision §1 — two hooks rather than a render-prop /
//              configure-by-props component primitive; the four
//              overlays' render geometries diverge enough that a single
//              component primitive would either introduce a render-prop
//              pattern the codebase has zero precedent for OR push N
//              configuration props through a primitive whose surface
//              eventually matches the source code it was meant to
//              absorb. Hooks parameterize lifecycle and state without
//              claiming any opinion on render shape.
//              Decision §2 — home is `apps/audience/src/graph/`, not
//              `packages/shell/`. Only the audience consumes the rAF +
//              `cy.on(...)` scaffolding today; the moderator uses
//              ReactFlow (different event vocabulary) and the
//              participant has no current Cytoscape overlay surface.
//              Shell lift waits for the third-caller trigger.
//              Decision §3 — names: `useCytoscapeOverlayPlacements` +
//              `useSeenKeysGate`. The `.tji` note's
//              `KeyedCytoscapeNodeOverlay` label is incorrect ("Node"
//              excludes the AnnotationOverlay's `cy.edges()`
//              iteration; "Overlay" suggests a component).
//              Decision §4 — `commit` is a caller-supplied callback
//              captured through a `commitRef` "latest-ref" pattern;
//              the `useEffect` dep array is `[cy]` only so re-renders
//              with inline-arrow commits do NOT tear down and
//              re-establish Cytoscape subscriptions. The four current
//              callers pass module-scope pure functions, but the
//              latest-ref pattern future-proofs the hook for render-
//              scope-closure commits without forcing a `useCallback`
//              ceremony.
//              Decision §5 — the four existing overlay test files
//              (`PerFacetPillOverlay.test.tsx`, `AxiomMarkOverlay.test.tsx`,
//              `AnnotationOverlay.test.tsx`, `NodeAppearOverlay.test.tsx`)
//              pass byte-unchanged; that is the behavior-preservation
//              regression pin. The dedicated `cytoscapeOverlayHooks.test.tsx`
//              pins the consolidation properties that the extraction
//              ADDS (rAF batching, subscription cleanup, latest-ref
//              commit, lazy-init timing, `isNew` side-effect idempotency).
//              Decision §6 — no new Playwright debt added to the
//              `aud_session_url` chain; the refactor is behavior-
//              preserving, so the per-overlay scenarios already queued
//              there continue to apply unchanged.)
//
// Source-of-debt: tasks/refinements/audience/aud_node_appear_animation.md
//              Decision §2 explicitly registered THIS task as the
//              rule-of-three-or-four extraction destination after the
//              fourth duplicate of the overlay scaffolding landed.
//
// ADRs:        0004 (Cytoscape.js — the canonical event vocabulary
//              `render pan zoom resize` + `position node` +
//              `add remove data` is preserved verbatim);
//              0022 (no throwaway verifications — the dedicated hook
//              test is a permanent consolidation-property pin);
//              0026 (micro-frontend root app — the hooks ship inside
//              the audience artifact, not in any shell package).

import { useEffect, useRef, useState } from 'react';
import type { Core } from 'cytoscape';

/**
 * Subscribe to Cytoscape's `render pan zoom resize` + `position node`
 * + `add remove data` events; on each event, schedule a singleton
 * `requestAnimationFrame` that runs the caller-supplied `commit(cy)`
 * and stores the result via `useState`. Returns the current placement
 * snapshot.
 *
 * The caller's `commit` MUST be effectively pure with respect to the
 * Cytoscape snapshot: it reads `cy.nodes()` (and/or `cy.edges()`),
 * computes positions / derived values, and returns the placement array.
 * The hook re-subscribes whenever `cy` changes identity (the
 * `useEffect` dep array is `[cy]`). The `commit` callback is captured
 * through a `commitRef` "latest-ref" so callers can pass inline arrows
 * closing over render-scope state WITHOUT retriggering subscription
 * churn — every render writes the latest commit into the ref, and the
 * rAF closure reads it at fire time.
 *
 * Starts as `[]`; the first commit fires synchronously inside the
 * effect (via `scheduleUpdate()`), so the initial snapshot lands as
 * soon as the rAF fires.
 */
export function useCytoscapeOverlayPlacements<P>(
  cy: Core | null,
  commit: (cy: Core) => readonly P[],
): readonly P[] {
  const [placements, setPlacements] = useState<readonly P[]>([]);
  const frameRef = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (cy === null) return undefined;

    const runCommit = (): void => {
      frameRef.current = null;
      setPlacements(commitRef.current(cy));
    };

    const scheduleUpdate = (): void => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(runCommit);
    };

    scheduleUpdate();

    cy.on('render pan zoom resize', scheduleUpdate);
    cy.on('position', 'node', scheduleUpdate);
    cy.on('add remove data', scheduleUpdate);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      cy.off('render pan zoom resize', scheduleUpdate);
      cy.off('position', 'node', scheduleUpdate);
      cy.off('add remove data', scheduleUpdate);
    };
  }, [cy]);

  return placements;
}

/**
 * Lazy-init-on-non-empty-keys seen-Set gate.
 *
 * Returns an `isNew(key)` predicate. The predicate has a side effect:
 * on a `true` return, the key is added to the internal seen-Set, so a
 * repeat call of `isNew(sameKey)` returns `false`. This matches the
 * inline idiom the predecessor overlays used (`const isNew =
 * !seen.has(k); if (isNew) seen.add(k)`), just lifted into the hook.
 *
 * The seen-Set is lazily seeded on the FIRST render where
 * `currentKeys.length > 0` — when the placements first carry content,
 * every existing key is seeded as "seen" and the predicate returns
 * `false` for all of them. Subsequent renders with new keys return
 * `true` once per new key (then `false` thereafter).
 *
 * Empty-`currentKeys` renders leave the set un-seeded; the FIRST
 * non-empty render does the seeding. This is the Decision §4 contract
 * from `aud_axiom_mark_animation.md` and `aud_node_appear_animation.md`
 * — seeding on the literal first render (when placements is empty
 * because the rAF hasn't fired yet) would leave the set empty and
 * incorrectly animate every initially-present element on the first
 * non-empty commit.
 *
 * While the set is still un-seeded, the predicate returns `false`
 * unconditionally (no key has yet been "seen"; we deliberately do NOT
 * mark anything as new until the set has been seeded from a real
 * non-empty placement snapshot).
 */
export function useSeenKeysGate<K>(currentKeys: readonly K[]): (key: K) => boolean {
  const seenRef = useRef<Set<K> | null>(null);

  if (seenRef.current === null && currentKeys.length > 0) {
    seenRef.current = new Set<K>(currentKeys);
  }

  return (key: K): boolean => {
    const seen = seenRef.current;
    if (seen === null) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
