// Invite-participants route for `/sessions/:id/invite` — the moderator's
// post-create surface for handing out per-debater shareable links and
// the pre-debate lobby that gates entry to the operate canvas.
//
// Refinements:
//   - tasks/refinements/moderator-ui/mod_invite_participants.md
//   - tasks/refinements/moderator-ui/mod_session_lobby.md (Possibility C —
//     enrich this surface in place with a strict gate, per-slot ready
//     badges, a "both ready" banner, and state-driven disabled hints)
// TaskJuggler:
//   - moderator_ui.mod_session_setup.mod_invite_participants
//   - moderator_ui.mod_session_setup.mod_session_lobby
//
// After `POST /api/sessions` returns 201, `CreateSession.tsx` navigates
// here. The view fetches the session metadata (topic + privacy) via
// `GET /api/sessions/:id`, mounts the WS client to receive
// `participant-joined` / `participant-left` events, and renders three
// slots in fixed order: `moderator` (always filled — the host row was
// inserted at session creation per `participant_assignment`), `debater-A`,
// `debater-B`. Each debater slot carries a copy-to-clipboard invite link
// shaped `<origin>/sessions/<id>/invite?role=<role>` and an always-
// visible ready/pending badge. The "Enter session" button is strict-
// gated (disabled until both debater slots are filled, per
// `mod_session_lobby` Decision §2) and navigates to
// `/sessions/<id>/operate` on click; the gate reason drives a localized
// disabled tooltip + hint paragraph and a "both ready" banner appears
// once both debaters have joined.
//
// **Backend dependencies still pending** (registered as follow-ups in
// `tasks/20-backend.tji` per the refinement's Backend follow-up tasks):
//
//   - `GET /api/sessions/:id/participants` — explicit participants list
//     for refresh-on-tab-return + initial-load shape. Today the slot
//     state is derived purely from the WS event stream
//     (`client.trackSession` + the store's `applyEvent` reducer); a
//     moderator hard-reloading the page picks up the state via the WS
//     catch-up replay (`sinceSequence: 0`) per the existing
//     `mod_ws_client` precedent.
//   - `POST /api/sessions/:id/participants/self-claim` — the debater's
//     self-claim path from "I opened the invite link" to "I am now
//     assigned to slot debater-A". Out of scope for this task — the
//     moderator-facing surface is complete and copies a valid SPA URL
//     even though the debater's claim view doesn't exist yet.
//
// Shape mirrors `OperateRoute` (a view-with-affordances) rather than a
// form: `<WsClientProvider>` mounts unconditionally and an inner
// component reads `useWsClient()` + the per-session slice of
// `useWsStore`. The slot reducer walks `participant-joined` /
// `participant-left` events into a `{ moderator, debater-A, debater-B }`
// occupant map per the `proposalFacets.deriveCurrentParticipants` idiom.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/useAuth';
import { WsClientProvider, useWsClient } from '../ws/WsClientProvider';
import { useWsStore } from '../ws/wsStore';
import type { Event } from '@a-conversa/shared-types';

/**
 * The roles displayed as slot rows, in render order. The moderator row
 * is always first; the two debater rows below it. The exact order is
 * load-bearing for screen-reader navigation and for the e2e spec's
 * `data-role` filters.
 */
const SLOT_ROLES = ['moderator', 'debater-A', 'debater-B'] as const;
type SlotRole = (typeof SLOT_ROLES)[number];

/**
 * The shape `GET /api/sessions/:id` returns (the camelCase
 * `SessionResponse` schema from `apps/server/src/sessions/routes.ts`).
 * Narrowed inline here — the moderator app has no central API-typings
 * package today (the abstraction threshold is "the fourth caller" per
 * `mod_create_session_form.md`).
 */
interface SessionResponse {
  readonly id: string;
  readonly hostUserId: string;
  readonly privacy: 'public' | 'private';
  readonly topic: string;
  readonly createdAt: string;
  readonly endedAt: string | null;
}

/**
 * Per-slot occupant — the screen name of the user currently assigned
 * to the role. `undefined` means the slot is empty (only meaningful
 * for the two debater roles; the moderator slot is always filled).
 */
type SlotOccupants = Readonly<Record<SlotRole, string | undefined>>;

/**
 * Walk the session's event log once and collapse `participant-joined`
 * / `participant-left` events into the per-role occupant map.
 *
 * Semantics mirror `proposalFacets.deriveCurrentParticipants`:
 * `participant-left` cancels a prior `participant-joined` for the same
 * user id; a subsequent rejoin re-adds them. Unlike that helper, this
 * one keeps the moderator's role (the invite view's whole point is to
 * surface the moderator row alongside the two debater rows).
 *
 * The map is keyed by role rather than user id because the invite
 * view's UI is role-shaped — one row per slot. If the same role is
 * filled twice (a backend regression), the latest event wins, which
 * matches the existing `proposalFacets` "rejoin re-adds" semantic.
 */
function deriveSlotOccupants(events: readonly Event[]): SlotOccupants {
  // Track the user id currently assigned to each role plus that user's
  // screen name. The pair allows `participant-left` to clear the slot
  // only when the leaver matches the current occupant (otherwise a
  // stale `participant-left` could erase a fresh `participant-joined`
  // for a different user in the same role).
  const occupants: { [K in SlotRole]?: { userId: string; screenName: string } } = {};
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      const role = event.payload.role;
      occupants[role] = {
        userId: event.payload.user_id,
        screenName: event.payload.screen_name,
      };
      continue;
    }
    if (event.kind === 'participant-left') {
      for (const role of SLOT_ROLES) {
        if (occupants[role]?.userId === event.payload.user_id) {
          delete occupants[role];
        }
      }
    }
  }
  return {
    moderator: occupants.moderator?.screenName,
    'debater-A': occupants['debater-A']?.screenName,
    'debater-B': occupants['debater-B']?.screenName,
  };
}

export function InviteParticipantsRoute(): ReactElement {
  const auth = useAuth();
  const { id = '' } = useParams<{ id: string }>();
  // Mount the provider unconditionally — same posture as `OperateRoute`.
  // The provider's internal `useEffect` no-ops when
  // `auth.status !== 'authenticated'`, so router-level tests that
  // bypass the gate still render cleanly.
  return (
    <WsClientProvider auth={{ status: auth.status }}>
      <InviteParticipantsRouteInner sessionId={id} />
    </WsClientProvider>
  );
}

/**
 * The HTTP-fetch lifecycle for the session header. Pre-fetch is
 * `'loading'`; on 200 the session lands on `'loaded'`; on any failure
 * the view shows the error region + retry button.
 */
type FetchStatus = 'loading' | 'loaded' | 'error';

interface InviteParticipantsRouteInnerProps {
  readonly sessionId: string;
}

function InviteParticipantsRouteInner(props: InviteParticipantsRouteInnerProps): ReactElement {
  const { sessionId } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const client = useWsClient();

  // ── WS subscription lifecycle ────────────────────────────────────
  //
  // Pair `trackSession(sessionId)` on mount with `untrackSession` on
  // unmount so the server's subscription registry stays clean. The
  // catch-up replay inside `trackSession` (sinceSequence: 0 when the
  // store has no events for the session yet) populates the per-session
  // event slice so the slot reducer below renders the correct state on
  // first paint after a hard reload.
  useEffect(() => {
    if (sessionId === '') return;
    void client.trackSession(sessionId);
    return () => {
      void client.untrackSession(sessionId);
    };
  }, [client, sessionId]);

  // ── HTTP fetch for session header ────────────────────────────────
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>('loading');
  const [session, setSession] = useState<SessionResponse | undefined>(undefined);
  // Bump to trigger a re-fetch from the retry button without
  // re-mounting the whole component.
  const [retryNonce, setRetryNonce] = useState<number>(0);

  useEffect(() => {
    if (sessionId === '') return;
    let cancelled = false;
    setFetchStatus('loading');
    setSession(undefined);
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        });
        if (cancelled) return;
        if (response.status !== 200) {
          setFetchStatus('error');
          return;
        }
        const body = (await response.json()) as unknown;
        if (cancelled) return;
        if (
          body === null ||
          typeof body !== 'object' ||
          typeof (body as { id?: unknown }).id !== 'string' ||
          typeof (body as { topic?: unknown }).topic !== 'string' ||
          typeof (body as { privacy?: unknown }).privacy !== 'string'
        ) {
          setFetchStatus('error');
          return;
        }
        setSession(body as SessionResponse);
        setFetchStatus('loaded');
      } catch {
        if (cancelled) return;
        setFetchStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, retryNonce]);

  // ── Slot occupants — derived from the WS event stream ────────────
  // Subscribing to the per-session event slice keeps the view in sync
  // with live `participant-joined` / `participant-left` broadcasts AND
  // the catch-up replay that `trackSession` triggers above. The
  // selector returns the per-session events array verbatim (no `?? []`
  // inside the selector, which would mint a fresh empty array on every
  // render and trip Zustand's reference-equality bailout — same
  // convention `PendingProposalsPane.tsx` follows).
  const events = useWsStore((state) => state.sessionState[sessionId]?.events);
  const occupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);

  // ── Gate derivations for mod_session_lobby ───────────────────────
  //
  // The Enter-session button is strict-gated: disabled until BOTH
  // debater slots are filled (per `mod_session_lobby` Decision §2 and
  // the methodology invariant in DESIGN.md §"Format" — a moderator
  // entering before both debaters are present is operating in a
  // methodologically broken state with no possible quorum for commits).
  //
  // `gateReason` surfaces WHICH slots are missing so the tooltip /
  // hint / banner can localize accordingly. Pure derivations off the
  // existing `occupants` map — no new state slots, no new effects.
  const bothDebatersPresent = useMemo(
    () => occupants['debater-A'] !== undefined && occupants['debater-B'] !== undefined,
    [occupants],
  );
  type GateReason = 'ready' | 'awaiting-A' | 'awaiting-B' | 'awaiting-both';
  const gateReason = useMemo<GateReason>(() => {
    const aPresent = occupants['debater-A'] !== undefined;
    const bPresent = occupants['debater-B'] !== undefined;
    if (aPresent && bPresent) return 'ready';
    if (!aPresent && !bPresent) return 'awaiting-both';
    if (!aPresent) return 'awaiting-A';
    return 'awaiting-B';
  }, [occupants]);

  // ── Copy-to-clipboard per-slot transient state ────────────────────
  // Map role -> "Copied!" confirmation visibility. The auto-clear
  // timeout id is held in a ref so we can cancel an outstanding clear
  // when the user clicks copy again before the previous timeout fires.
  type CopyStatus = 'idle' | 'copied' | 'failed';
  const [copyStatus, setCopyStatus] = useState<Record<SlotRole, CopyStatus>>({
    moderator: 'idle',
    'debater-A': 'idle',
    'debater-B': 'idle',
  });
  const copyTimers = useRef<Partial<Record<SlotRole, ReturnType<typeof setTimeout>>>>({});

  // Clear all pending timers on unmount so a quickly-unmounted view
  // doesn't try to setState into a dead component.
  useEffect(() => {
    return () => {
      for (const role of SLOT_ROLES) {
        const handle = copyTimers.current[role];
        if (handle !== undefined) clearTimeout(handle);
      }
    };
  }, []);

  const inviteUrlFor = useCallback(
    (role: SlotRole): string => {
      // Compute from `window.location.origin` so a tunneled / port-forwarded
      // dev URL still produces a copyable working link. The query-string
      // role hint is what the future self-claim flow reads.
      const origin =
        typeof window !== 'undefined' && typeof window.location !== 'undefined'
          ? window.location.origin
          : '';
      return `${origin}/sessions/${sessionId}/invite?role=${role}`;
    },
    [sessionId],
  );

  const handleCopy = useCallback(
    async (role: SlotRole): Promise<void> => {
      const url = inviteUrlFor(role);
      // Reset any prior timer for this role so the auto-clear lines
      // up with the latest click.
      const existing = copyTimers.current[role];
      if (existing !== undefined) clearTimeout(existing);
      try {
        await navigator.clipboard.writeText(url);
        setCopyStatus((prev) => ({ ...prev, [role]: 'copied' }));
        copyTimers.current[role] = setTimeout(() => {
          setCopyStatus((prev) => ({ ...prev, [role]: 'idle' }));
          delete copyTimers.current[role];
        }, 2000);
      } catch {
        setCopyStatus((prev) => ({ ...prev, [role]: 'failed' }));
        // No auto-clear for the failed state — the fallback hint stays
        // visible until the user retries (clicks copy again).
      }
    },
    [inviteUrlFor],
  );

  const handleEnterSession = useCallback((): void => {
    if (sessionId === '') return;
    // Defense-in-depth: the button carries `disabled={!bothDebatersPresent}`
    // so the native attribute already blocks click events when the
    // gate is closed; this guard keeps the handler honest in case a
    // future refactor swaps the native disabled attribute for
    // `aria-disabled` (which doesn't block clicks).
    if (!bothDebatersPresent) return;
    void navigate(`/sessions/${sessionId}/operate`, { replace: false });
  }, [bothDebatersPresent, navigate, sessionId]);

  const handleRetry = useCallback((): void => {
    setRetryNonce((n) => n + 1);
  }, []);

  return (
    <main data-testid="route-invite-participants" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold mb-4">
        {t('moderator.invite.title')}
      </h1>

      {fetchStatus === 'loading' && (
        <p data-testid="invite-loading" aria-live="polite" className="text-gray-700">
          {t('moderator.invite.loading')}
        </p>
      )}

      {fetchStatus === 'error' && (
        <div className="flex flex-col gap-2">
          <p
            data-testid="invite-error"
            role="alert"
            aria-live="polite"
            className="text-sm text-red-700"
          >
            {t('moderator.invite.errors.fetchFailed')}
          </p>
          <button
            type="button"
            data-testid="invite-retry"
            onClick={handleRetry}
            className="self-start rounded bg-blue-600 px-4 py-2 text-white"
          >
            {t('moderator.invite.retry')}
          </button>
        </div>
      )}

      {fetchStatus === 'loaded' && session !== undefined && (
        <>
          <section data-testid="invite-session-header" className="mb-6">
            <p data-testid="invite-session-topic" className="text-lg font-medium">
              {session.topic}
            </p>
            <span
              data-testid="invite-session-privacy"
              className="inline-block mt-1 text-sm rounded bg-gray-100 px-2 py-1"
            >
              {t(`moderator.invite.privacy.${session.privacy}`)}
            </span>
          </section>

          <div className="flex flex-col gap-4">
            {SLOT_ROLES.map((role) => {
              const occupantScreenName = occupants[role];
              const isFilled = occupantScreenName !== undefined;
              const showCopyAffordance = role !== 'moderator';
              // The empty-state caption is only meaningful for the
              // debater slots (per the refinement: "only applicable to
              // debater-A / debater-B"). The moderator slot is filled
              // at session creation per `participant_assignment`; if
              // the WS catch-up hasn't replayed the event yet, the
              // slot renders the role header without a body rather
              // than misleading "Awaiting Moderator" copy.
              const showEmptyState = !isFilled && role !== 'moderator';
              const url = inviteUrlFor(role);
              const status = copyStatus[role];
              return (
                <section
                  key={role}
                  data-testid="invite-slot"
                  data-role={role}
                  className="rounded border border-gray-200 p-4"
                >
                  <h2
                    data-testid={`invite-slot-role-${role}`}
                    className="text-base font-semibold mb-2"
                  >
                    {t(`moderator.invite.slot.${role}.label`)}
                  </h2>
                  {isFilled && (
                    <p
                      data-testid="invite-slot-occupant"
                      data-role={role}
                      className="text-gray-800"
                    >
                      {occupantScreenName}
                    </p>
                  )}
                  {showEmptyState && (
                    <p
                      data-testid="invite-slot-empty"
                      data-role={role}
                      className="text-gray-500 italic"
                    >
                      {t('moderator.invite.slot.empty', {
                        role: t(`moderator.invite.role.${role}`),
                      })}
                    </p>
                  )}
                  {/*
                    Per-slot ready-state badge for `mod_session_lobby`.
                    Always visible on debater slots (states: `ready`
                    when occupant present, `pending` otherwise) so the
                    moderator's at-a-glance "who's here?" cue stays
                    explicit alongside the overall gate state. The
                    moderator slot does not get a badge — the moderator
                    IS the operator, not a participant whose presence
                    the gate checks (per Decisions §3).
                  */}
                  {role !== 'moderator' && (
                    <span
                      data-testid="invite-slot-ready"
                      data-role={role}
                      data-ready={isFilled ? 'true' : 'false'}
                      className={
                        isFilled
                          ? 'inline-block mt-2 text-sm text-green-700'
                          : 'inline-block mt-2 text-sm text-gray-500'
                      }
                    >
                      {t(
                        isFilled
                          ? 'moderator.invite.lobby.ready.present'
                          : 'moderator.invite.lobby.ready.pending',
                      )}
                    </span>
                  )}
                  {showCopyAffordance && (
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input
                          data-testid="invite-link-input"
                          data-role={role}
                          type="text"
                          value={url}
                          readOnly
                          aria-label={t('moderator.invite.copyLink.inputAriaLabel', {
                            role: t(`moderator.invite.role.${role}`),
                          })}
                          className="flex-1 rounded border border-gray-300 px-3 py-2 font-mono text-sm"
                        />
                        <button
                          type="button"
                          data-testid="invite-link-copy"
                          data-role={role}
                          onClick={() => {
                            void handleCopy(role);
                          }}
                          className="rounded bg-blue-600 px-4 py-2 text-white"
                        >
                          {t('moderator.invite.copyLink.label')}
                        </button>
                      </div>
                      {status === 'copied' && (
                        <span
                          data-testid="invite-link-copied"
                          data-role={role}
                          role="status"
                          aria-live="polite"
                          className="text-sm text-green-700"
                        >
                          {t('moderator.invite.copyLink.copied')}
                        </span>
                      )}
                      {status === 'failed' && (
                        <span
                          data-testid="invite-link-fallback"
                          data-role={role}
                          role="status"
                          aria-live="polite"
                          className="text-sm text-amber-700"
                        >
                          {t('moderator.invite.copyLink.fallbackHint')}
                        </span>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {/*
            "Both ready" banner (mod_session_lobby Decision §4) —
            visible while both debaters are present. `role="status"` +
            `aria-live="polite"` triggers a one-time screen-reader
            announcement on first appearance without interrupting the
            moderator. The banner persists until the gate state changes
            (a debater leaves, or the moderator clicks Enter and
            navigates away).
          */}
          {gateReason === 'ready' && (
            <p
              data-testid="invite-both-ready-banner"
              role="status"
              aria-live="polite"
              className="mt-4 rounded bg-green-50 border border-green-200 px-3 py-2 text-green-800"
            >
              {t('moderator.invite.lobby.bothReady.banner')}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            {/*
              Strict-gated Enter-session button (mod_session_lobby
              Decision §2). Native HTML `disabled` (per Decision §9)
              so keyboard focus skips it correctly and screen readers
              announce the disabled state via the standard channel.
              `aria-describedby` ties the button to the state-driven
              hint paragraph below; `title` adds the awaiting tooltip
              for sighted users on hover when disabled.
            */}
            <button
              type="button"
              data-testid="invite-enter-session"
              onClick={handleEnterSession}
              disabled={!bothDebatersPresent}
              aria-describedby="invite-enter-session-hint"
              title={
                bothDebatersPresent
                  ? undefined
                  : t(`moderator.invite.lobby.disabledTooltip.${gateReason}`)
              }
              className={
                bothDebatersPresent
                  ? 'rounded bg-blue-600 px-4 py-2 text-white'
                  : 'rounded bg-gray-300 px-4 py-2 text-gray-600 cursor-not-allowed'
              }
            >
              {t('moderator.invite.enterSession.label')}
            </button>
            <p
              id="invite-enter-session-hint"
              data-testid="invite-enter-session-hint"
              className="text-sm text-gray-600"
            >
              {t(`moderator.invite.lobby.enterHint.${gateReason}`)}
            </p>
          </div>
        </>
      )}
    </main>
  );
}
