// `<AudienceReplayRoute>` — the replay-mode variant of the audience
// surface at `/replay/:sessionId` (and its locale-prefixed sibling
// `/:locale/replay/:sessionId`) under the surface's `/a` basename.
//
// Refinement: tasks/refinements/replay_test/replay_mode_audience_surface.md
//   (Decision §1 — mount the shared `@a-conversa/graph-view` `GraphView`
//    directly, NOT the WS-bound `AudienceGraphView` adapter; Decision §2 —
//    `useSessionEventLog` is the replay data source; Decision §3 — render
//    at the log head, no position/playback UI; Decision §5 — reuse
//    `PrivateSessionCta` verbatim for the unauthenticated / not-visible
//    state; Decision §6 — v1 is visibility-gated through the authenticated
//    `GET /sessions/:id/events` endpoint, anonymous public replay is the
//    named backend follow-up.)
// ADRs:
//   - 0039 (shared read-only graph-view package — the renderer this route
//           mounts data-source-agnostically: live WS for the live route,
//           a replayed log here);
//   - 0045 (audience replay surface auth posture — authenticated + visible
//           → graph; anonymous / not-visible → sign-in CTA);
//   - 0029 (existence-non-leak: a private/absent session is a 404 the hook
//           maps to `not-found`, indistinguishable from the outside);
//   - 0024 (react-i18next — the `audience.replay.*` keys);
//   - 0022 (the `data-testid` seams are the pinned regression surface for
//           the Vitest load-state matrix + the Playwright e2e).
//
// The route is the data-source twin of `<AudienceLiveRoute>`: same public
// posture, same locale convention, same `PrivateSessionCta` sign-in wall —
// but fed from a saved event *log* (the head/complete-session frame)
// instead of the live WebSocket stream.

import { type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useSessionEventLog } from '@a-conversa/shell';

import { useAudienceLogPosition } from '../state/index.js';
import { ReplayPlaybackContainer } from '../replay/ReplayPlaybackContainer.js';
import { PrivateSessionCta } from './PrivateSessionCta.js';

export function AudienceReplayRoute(): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const { status, events, retry } = useSessionEventLog(sessionId ?? '');
  // The route is the URL layer (it already reads `useParams`); read the
  // `?position=<sequence>` deep-link here and thread it into the
  // router-agnostic container as a prop (replay_url_position_loading
  // Decision §1). `null` for absent/invalid; the container clamps the value.
  const initialPosition = useAudienceLogPosition();

  if (status === 'loading') {
    return (
      <main
        data-testid="audience-replay-loading"
        role="status"
        aria-live="polite"
        className="mx-auto max-w-2xl p-6 text-sm italic text-slate-500"
      >
        {t('audience.replay.loading')}
      </main>
    );
  }

  if (status === 'not-found' || status === 'error') {
    // Both terminal failure states resolve through one tree, exactly like
    // the live route layers `<PrivateSessionCta>` over `<AudienceGraphView>`:
    //
    //   - `<PrivateSessionCta>` renders the sign-in overlay only for
    //     `unauthenticated` / `needs-screen-name` and `null` for
    //     `authenticated` / `loading`. So an anonymous (or not-visible)
    //     viewer gets the sign-in wall, honoring the existence-non-leak
    //     rule (ADR 0029/0045) — the UI never decides visibility.
    //   - An authenticated viewer who still cannot load sees the generic
    //     localized "unavailable" message underneath, with the hook's
    //     `retry` for the (transient) `error` case. A `not-found` for an
    //     authenticated viewer is terminal, so no retry is offered there.
    return (
      <div className="relative h-screen w-screen">
        <main
          data-testid="audience-replay-unavailable"
          role="alert"
          className="mx-auto flex max-w-2xl flex-col gap-3 p-6 text-sm text-slate-900"
        >
          <h2 className="text-lg font-semibold">{t('audience.replay.unavailableTitle')}</h2>
          <p className="text-slate-600">{t('audience.replay.unavailableBody')}</p>
          {status === 'error' && (
            <button
              type="button"
              data-testid="audience-replay-retry"
              onClick={() => {
                retry();
              }}
              className="self-start rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('audience.replay.retry')}
            </button>
          )}
        </main>
        <PrivateSessionCta />
      </div>
    );
  }

  // status === 'ready' — mount the playback container. It seeds the position
  // cursor from the URL `?position` deep-link when present, else the log
  // *head* (`replayHeadSequence`), so the no-deep-link view still shows the
  // complete session (ADR 0045's head-landing default), and layers the play /
  // pause / step controls over the viewport-filling `@a-conversa/graph-view`
  // renderer. The position/step/auto-advance machinery lives entirely in
  // `ReplayPlaybackContainer` (replay_playback_controls); this route owns only
  // the URL → prop read (replay_url_position_loading). The load / auth / CTA
  // branches above stay untouched (Constraint §7).
  return (
    <ReplayPlaybackContainer
      sessionId={sessionId ?? ''}
      events={events}
      initialPosition={initialPosition}
    />
  );
}

export default AudienceReplayRoute;
