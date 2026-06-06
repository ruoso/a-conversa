// `<ChapterMarker>` — the audience surface's live-broadcast chapter
// marker: a small, screen-fixed caption naming the current segment of
// the show, derived from the most-recent `snapshot-created` event.
//
// Refinement: tasks/refinements/audience/aud_chapter_marker_render.md
//   (Decision §1 — STATIC, persistent marker here; the transient
//    entrance cue belongs to the `aud_segment_break_animation` sibling,
//    which animates against this leaf's stable `audience-chapter-marker`
//    testid. Decision §2 — lives in `apps/audience`, mounted in
//    `<AudienceLiveRoute>`, NOT inside the shared `packages/graph-view`
//    canvas: this caption is session-level and screen-fixed, needing
//    none of the Cytoscape `Core` machinery the node/edge overlays need.
//    Decision §5 — persistent until superseded by a newer snapshot.
//    Decision §6 — bottom-left corner: node content and the diagnostic
//    halos cluster graph-center, so a corner avoids occlusion and echoes
//    the broadcast lower-third convention without colliding with the
//    top-anchored producer chrome OBS scenes typically place up top.)
//
// OBS-safety (Constraint §3 + `aud_obs_no_input_required.md`): the
// caption is inert — `pointer-events-none`, introduces no `<dialog>` /
// `[aria-modal]` / `<audio>` / `<video>` / `[data-requires-input]`, and
// assumes a transparent producer backdrop, so it renders dark text on a
// solid light chip (legible on an arbitrary scene) rather than
// light-on-transparent (`aud_obs_transparency.md`).
//
// Renders nothing until the first snapshot arrives (Constraint §2).
//
// Segment-break cue (`aud_segment_break_animation.md`): when the
// moderator labels a NEW snapshot mid-show, the marker gets a one-shot
// `aud-segment-break` entrance reveal (CSS `@keyframes`, commit tier).
// The cue is gated by `useSeenKeysGate([snapshot.snapshotId])` — the
// family's single "fire once per new key" source of truth — so the
// snapshot that was already current at page load seeds the gate and does
// NOT animate (Decision §2 + §6); only live, post-mount breaks fire. The
// root is keyed by `snapshotId` (Decision §4) so React remounts it on
// each supersession and the CSS animation re-runs (a class merely
// re-added to a reused element never re-triggers). Reduced-motion
// suppression lives in CSS, not here (Decision §7) — the class is always
// emitted by the render path.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useSeenKeysGate } from '@a-conversa/graph-view';

import { useAudienceLatestSnapshot } from '../state/useAudienceLatestSnapshot.js';

export function ChapterMarker({ sessionId }: { sessionId: string }): ReactElement | null {
  const { t } = useTranslation();
  const snapshot = useAudienceLatestSnapshot(sessionId);

  // The gate must be called before the early return (Rules of Hooks).
  // The empty-keys path (`[]`, no snapshot yet) leaves the gate un-seeded,
  // matching its lazy-seed-on-first-non-empty contract.
  const isNewSnapshot = useSeenKeysGate(snapshot === null ? [] : [snapshot.snapshotId]);

  // Absent until present — no empty caption chrome before the first
  // snapshot lands (Constraint §2).
  if (snapshot === null) {
    return null;
  }

  // `true` exactly once per snapshotId that arrives AFTER the marker is
  // live; `false` for the load-time snapshot (it seeds the gate) and for
  // unrelated re-renders carrying the same snapshotId.
  const isSegmentBreak = isNewSnapshot(snapshot.snapshotId);

  return (
    <div
      key={snapshot.snapshotId}
      data-testid="audience-chapter-marker"
      data-segment-break-anim=""
      className={`pointer-events-none absolute bottom-6 left-6 max-w-md rounded bg-white/95 px-3 py-1.5 text-sm font-medium text-slate-900 shadow${
        isSegmentBreak ? ' aud-segment-break' : ''
      }`}
    >
      {/* Visually-hidden chrome prefix — the only translated string; the
          moderator-typed label itself is passed through verbatim. Gives
          a screen reader "Current segment: <label>" context. */}
      <span className="sr-only">{t('audience.segmentMarker.prefix')}: </span>
      <span>{snapshot.label}</span>
    </div>
  );
}
