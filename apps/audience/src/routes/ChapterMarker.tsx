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

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useAudienceLatestSnapshot } from '../state/useAudienceLatestSnapshot.js';

export function ChapterMarker({ sessionId }: { sessionId: string }): ReactElement | null {
  const { t } = useTranslation();
  const snapshot = useAudienceLatestSnapshot(sessionId);

  // Absent until present — no empty caption chrome before the first
  // snapshot lands (Constraint §2).
  if (snapshot === null) {
    return null;
  }

  return (
    <div
      data-testid="audience-chapter-marker"
      className="pointer-events-none absolute bottom-6 left-6 max-w-md rounded bg-white/95 px-3 py-1.5 text-sm font-medium text-slate-900 shadow"
    >
      {/* Visually-hidden chrome prefix — the only translated string; the
          moderator-typed label itself is passed through verbatim. Gives
          a screen reader "Current segment: <label>" context. */}
      <span className="sr-only">{t('audience.segmentMarker.prefix')}: </span>
      <span>{snapshot.label}</span>
    </div>
  );
}
