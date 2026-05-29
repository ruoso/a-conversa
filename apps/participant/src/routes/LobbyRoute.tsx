// `<LobbyRoute>` — the participant's pre-debate lobby at
// `/sessions/:id/lobby` under the surface's `/p` basename.
//
// Refinement: tasks/refinements/participant-ui/part_lobby_view.md
// Predecessors:
//   - tasks/refinements/participant-ui/part_invite_acceptance.md
//     (the inheritor named the `<LobbyPlaceholderRoute>` replacement
//     this leaf delivers; the placeholder is deleted alongside this
//     module landing).
//   - tasks/refinements/backend/list_session_participants_endpoint.md
//     (the HTTP prefetch source — `GET /api/sessions/:id/participants`
//     returns the authoritative cold-load slot map).
//   - tasks/refinements/backend/session_invite_self_claim_endpoint.md
//     (the upstream of the `participant-joined` event the WS overlay
//     consumes for the live-update path).
// ADRs:
//   - 0002 (cookie-only auth — both GETs rely on the same-origin
//     `aconversa-session` cookie via `credentials: 'include'`; no
//     `userId` field in any request),
//   - 0021 (event envelope shape — the slot reducer reads payloads
//     directly; the shell client validates incoming envelopes at the
//     dispatch boundary),
//   - 0022 (no throwaway verifications — every testid below is pinned
//     by `LobbyRoute.test.tsx` and the new `participant-lobby.spec.ts`
//     Playwright scenarios),
//   - 0024 (i18n via react-i18next — all user-facing strings under
//     `participant.lobby.*`),
//   - 0026 (host owns auth chrome; surface consumes `useAuth()` +
//     `useWsClient()` from the shell; no second auth fetch, no
//     surface-local WS client construction).
//
// Composition (per Decision §1 of the refinement):
//
//   - HTTP prefetch (`GET /api/sessions/:id/participants`) seeds the
//     slot map on mount with the server's authoritative active rows —
//     resolves the cold-load race a fresh tab opened on the lobby URL
//     would otherwise hit.
//   - WS subscription via `client.trackSession(id)` provides the
//     live-update overlay: `participant-joined` / `participant-left`
//     events from any source patch the slot map in real time. The
//     subscription is idempotent with the invite route's prior call
//     (per `ws-client.test.ts:547`), so the in-surface navigation
//     invite → lobby is clean.
//   - `mergeSlots(httpRows, wsOccupants)` composes both: HTTP seeds;
//     WS overlays (the WS slice carries the canonical `screen_name`
//     from the joined event payload, which the participants-list
//     endpoint does NOT denormalize today — the WS overlay is the
//     display-name source of truth).
//
// The route is observational only — no buttons that POST, no
// inline forms, no write paths on the WS subscription. The lobby
// gives way to the live debate surface via the auto-navigation
// handler added by `part_session_start_handoff` (the `useEffect`
// inside `<LobbyRouteAuthenticatedBody>` below): when a
// `session-mode-changed` event with `new_mode === 'operate'`
// arrives over the open WS subscription, the lobby
// `replace`-navigates the debater to `/sessions/${id}` so the
// operate route mounts. The predecessor's `CONTENT_EVENT_KINDS`
// heuristic (`node-created` / `edge-created` / `entity-included` /
// `proposal` / `commit`) is retained as a defense-in-depth
// fallback per ADR 0028 — replay-correctness for pre-event
// historical sessions + safety net for a moderator-side POST
// failure (`handleEnterSession` falls back to a local navigate on
// POST failure; the fallback predicate catches the moderator's
// first capture and gets the participant onto the operate route).

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  SLOT_ROLES,
  deriveSlotOccupants,
  mergeSlots,
  useAuth,
  useWsClient,
  type ParticipantRow,
  type SlotRole,
} from '@a-conversa/shell';
import type { EventKind } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';

/**
 * Event kinds whose arrival in the per-session events slice proves the
 * moderator has transitioned the session out of the lobby and into the
 * operate canvas. Triggers the participant lobby's auto-navigation to
 * `/sessions/${id}` (the operate route).
 *
 * The five kinds in this list are emitted exclusively by the
 * moderator's operate-mode capture / propose / commit flows — no
 * lobby / invite / create-session route in the app can produce them.
 * Their arrival is a sufficient proxy for "the moderator is in
 * operate mode" without requiring a dedicated `debate-started` wire
 * event (which would be a multi-day protocol addition per
 * `part_session_start_handoff.md` Decision §1).
 *
 * Per ADR 0027, `node-created` / `edge-created` fire at propose-time,
 * so the very first propose in operate triggers the handoff — which is
 * the correct semantics (the debater needs to be watching the proposal
 * the moment it is made).
 */
const CONTENT_EVENT_KINDS: readonly EventKind[] = [
  'node-created',
  'edge-created',
  'entity-included',
  'proposal',
  'commit',
];

interface SessionHeader {
  readonly id: string;
  readonly topic: string;
  readonly privacy: 'public' | 'private';
  readonly endedAt: string | null;
}

type FetchStatus = 'loading' | 'loaded' | 'error';

export function LobbyRoute(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const client = useWsClient();

  // Per-session subscription lifecycle. Idempotent with the invite
  // route's prior `client.trackSession` call (per
  // `ws-client.test.ts:547`); the cleanup pairs trackSession with
  // untrackSession so the server's subscription registry stays
  // clean. Mirrors the moderator's pattern at
  // `apps/moderator/src/routes/InviteParticipants.tsx:189-195` and
  // the invite route's pattern at
  // `apps/participant/src/routes/InviteAcceptanceRoute.tsx:90-96`.
  useEffect(() => {
    if (id === '') return;
    void client.trackSession(id);
    return () => {
      void client.untrackSession(id);
    };
  }, [client, id]);

  return (
    <ParticipantLayout
      header={<ParticipantChrome />}
      main={<LobbyRouteBody id={id} />}
      footer={<ParticipantStatusIndicator />}
    />
  );
}

function LobbyRouteBody({ id }: { id: string }): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  // Belt-and-suspenders mid-mount auth guard. The chrome's identity
  // row + the host's `SurfaceHost` cleanup are the primary defenses
  // against a status-flip; this branch keeps `.screenName` access
  // safe if React re-renders the body between the auth flip and the
  // host's tear-down (mirrors the invite route's shape at
  // `apps/participant/src/routes/InviteAcceptanceRoute.tsx:125-137`).
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <div
        data-testid="route-lobby"
        data-state="not-authenticated"
        className="mx-auto max-w-2xl p-6"
      >
        <p data-testid="participant-not-authenticated" className="text-sm text-slate-600">
          {t('participant.notAuthenticated.body')}
        </p>
      </div>
    );
  }

  return <LobbyRouteAuthenticatedBody id={id} callerUserId={auth.user.userId} />;
}

interface LobbyRouteAuthenticatedBodyProps {
  readonly id: string;
  readonly callerUserId: string;
}

function LobbyRouteAuthenticatedBody(props: LobbyRouteAuthenticatedBodyProps): ReactElement {
  const { id, callerUserId } = props;
  const { t } = useTranslation();

  // ── HTTP fetch: session header ──────────────────────────────────
  const [headerStatus, setHeaderStatus] = useState<FetchStatus>('loading');
  const [header, setHeader] = useState<SessionHeader | undefined>(undefined);
  const [headerRetryNonce, setHeaderRetryNonce] = useState<number>(0);

  useEffect(() => {
    if (id === '') return;
    let cancelled = false;
    setHeaderStatus('loading');
    setHeader(undefined);
    void (async () => {
      try {
        const resp = await fetch(`/api/sessions/${id}`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (resp.status !== 200) {
          setHeaderStatus('error');
          return;
        }
        const body = (await resp.json()) as unknown;
        if (cancelled) return;
        if (
          body === null ||
          typeof body !== 'object' ||
          typeof (body as { topic?: unknown }).topic !== 'string'
        ) {
          setHeaderStatus('error');
          return;
        }
        setHeader(body as SessionHeader);
        setHeaderStatus('loaded');
      } catch {
        if (!cancelled) setHeaderStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, headerRetryNonce]);

  // ── HTTP fetch: participants list ───────────────────────────────
  const [participantsStatus, setParticipantsStatus] = useState<FetchStatus>('loading');
  const [httpRows, setHttpRows] = useState<readonly ParticipantRow[]>([]);
  const [participantsRetryNonce, setParticipantsRetryNonce] = useState<number>(0);

  useEffect(() => {
    if (id === '') return;
    let cancelled = false;
    setParticipantsStatus('loading');
    setHttpRows([]);
    void (async () => {
      try {
        const resp = await fetch(`/api/sessions/${id}/participants`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (resp.status !== 200) {
          setParticipantsStatus('error');
          return;
        }
        const body = (await resp.json()) as unknown;
        if (cancelled) return;
        if (
          body === null ||
          typeof body !== 'object' ||
          !Array.isArray((body as { participants?: unknown }).participants)
        ) {
          setParticipantsStatus('error');
          return;
        }
        const rawParticipants = (body as { participants: readonly unknown[] }).participants;
        const rows: ParticipantRow[] = [];
        for (const raw of rawParticipants) {
          if (raw === null || typeof raw !== 'object') continue;
          const row = raw as {
            userId?: unknown;
            role?: unknown;
            leftAt?: unknown;
            // The participants-list endpoint does not denormalize
            // `screen_name` today (see refinement Inputs / live
            // code §1); the WS event overlay is the canonical
            // display-name source. We accept the optional key for
            // forward compatibility (a future endpoint amendment
            // that adds the denormalization will populate it).
            screenName?: unknown;
          };
          if (typeof row.userId !== 'string') continue;
          if (typeof row.role !== 'string') continue;
          if (!(SLOT_ROLES as readonly string[]).includes(row.role)) continue;
          // Skip historical rows; the active-only filter is the
          // client's job per the endpoint's contract.
          if (row.leftAt !== null) continue;
          rows.push({
            userId: row.userId,
            role: row.role as SlotRole,
            screenName: typeof row.screenName === 'string' ? row.screenName : '',
          });
        }
        setHttpRows(rows);
        setParticipantsStatus('loaded');
      } catch {
        if (!cancelled) setParticipantsStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, participantsRetryNonce]);

  // ── WS event-derived slot occupants ─────────────────────────────
  // The selector returns the per-session events array verbatim — no
  // `?? []` inside the selector, which would mint a fresh empty
  // array on every render and trip Zustand's reference-equality
  // bailout. Same convention the moderator's invite view follows.
  const events = useWsStore((state) => state.sessionState[id]?.events);
  const wsOccupants = useMemo(() => deriveSlotOccupants(events ?? []), [events]);
  const slots = useMemo(
    () => mergeSlots(httpRows, wsOccupants, events ?? []),
    [httpRows, wsOccupants, events],
  );

  // ── Auto-navigation handoff to the operate route ────────────────
  // Watches the per-session WS `events` slice for the primary
  // trigger — a `session-mode-changed` event with `new_mode ===
  // 'operate'` (per ADR 0028) — OR the fallback heuristic — any
  // event whose kind is in `CONTENT_EVENT_KINDS` (per
  // `part_session_start_handoff`'s Decision §2 — the predecessor's
  // first-content-event heuristic). On either match the lobby
  // `replace`-navigates the debater from `/sessions/${id}/lobby`
  // to `/sessions/${id}` so the operate route mounts.
  //
  // Triggered off the existing WS subscription the lobby installed
  // via `client.trackSession` — no new subscription, no new HTTP
  // fetch.
  //
  // **Primary vs. fallback ordering** (per
  // `part_session_start_handoff_dedicated_event` Decision §7 +
  // ADR 0028): the primary `session-mode-changed` predicate
  // short-circuits the fallback; the fallback only runs when no
  // matching primary event is present in the slice. Both paths are
  // pinned individually by Vitest cases. The fallback stays in
  // place as defense-in-depth for (a) replay of historical sessions
  // without the new event and (b) the moderator-side POST failing
  // (Decision §3 — `handleEnterSession` silently falls back to a
  // local navigate; the fallback predicate catches the moderator's
  // first capture).
  //
  // `useRef<boolean>` exactly-once guard catches the case where a
  // subsequent event arrives between this effect running and React
  // Router actually unmounting the lobby (the navigate is
  // idempotent; the guard is belt-and-suspenders against a wasted
  // call AND against the primary+fallback double-fire — both
  // predicates writing through the same guard).
  const navigate = useNavigate();
  const handoffFiredRef = useRef<boolean>(false);
  useEffect(() => {
    if (handoffFiredRef.current) return;
    if (id === '') return;
    const eventsList = events ?? [];
    // Primary trigger: a dedicated `session-mode-changed` event
    // with `new_mode: 'operate'` is the canonical signal that the
    // moderator has advanced the session out of the lobby. The
    // payload-shape narrowing (`event.kind === 'session-mode-changed'`)
    // gives TypeScript the discriminated-union slice needed to read
    // `.payload.new_mode` directly.
    const modeChanged = eventsList.some(
      (event) => event.kind === 'session-mode-changed' && event.payload.new_mode === 'operate',
    );
    // Fallback trigger: the predecessor's first-content-event
    // heuristic. Short-circuited under the primary so the
    // exactly-once guard isn't relied on to suppress a double-fire
    // — the predicates are mutually exclusive within a single
    // effect run.
    const contentTriggered =
      !modeChanged &&
      eventsList.some((event) => (CONTENT_EVENT_KINDS as readonly string[]).includes(event.kind));
    if (!modeChanged && !contentTriggered) return;
    handoffFiredRef.current = true;
    void navigate(`/sessions/${id}`, { replace: true });
  }, [events, id, navigate]);

  const debaterAPresent = slots['debater-A'] !== undefined;
  const debaterBPresent = slots['debater-B'] !== undefined;
  const bothDebatersPresent = debaterAPresent && debaterBPresent;
  // Empty state: the caller is one of the two debater slots AND the
  // OTHER debater slot is empty (per Decision §4 of the refinement).
  // The wording references the caller specifically; the condition
  // narrows to the case where the wording is accurate.
  const onlyMeAsDebater =
    (callerUserId === slots['debater-A']?.userId && !debaterBPresent) ||
    (callerUserId === slots['debater-B']?.userId && !debaterAPresent);

  // ── Loading-state render ────────────────────────────────────────
  if (headerStatus === 'loading' || participantsStatus === 'loading') {
    return (
      <div
        data-testid="route-lobby"
        data-state="loading"
        aria-busy="true"
        className="mx-auto max-w-2xl p-6"
      >
        {/*
          The loading indicator is intentionally text-free — the
          refinement scopes 12 new keys under `participant.lobby.*`
          and the loading state's transient nature is signalled
          structurally via `aria-busy="true"` + the dedicated
          testid. A non-localized ellipsis avoids minting a 13th
          key purely for transient affordance text.
        */}
        <p data-testid="lobby-loading" aria-live="polite" className="text-sm text-slate-600">
          …
        </p>
      </div>
    );
  }

  // ── Error-state render ──────────────────────────────────────────
  if (headerStatus === 'error' || participantsStatus === 'error') {
    return (
      <div data-testid="route-lobby" data-state="error" className="mx-auto max-w-2xl p-6">
        {headerStatus === 'error' ? (
          <div
            data-testid="lobby-error-header"
            role="alert"
            aria-live="polite"
            className="flex flex-col gap-2"
          >
            <p className="text-sm text-red-700">
              {t('participant.lobby.errors.sessionFetchFailed')}
            </p>
            <button
              type="button"
              data-testid="lobby-retry-header"
              onClick={() => setHeaderRetryNonce((n) => n + 1)}
              className="self-start rounded bg-blue-600 px-4 py-2 text-white"
            >
              {t('participant.lobby.errors.retry')}
            </button>
          </div>
        ) : null}
        {participantsStatus === 'error' ? (
          <div
            data-testid="lobby-error-participants"
            role="alert"
            aria-live="polite"
            className="mt-4 flex flex-col gap-2"
          >
            <p className="text-sm text-red-700">
              {t('participant.lobby.errors.participantsFetchFailed')}
            </p>
            <button
              type="button"
              data-testid="lobby-retry-participants"
              onClick={() => setParticipantsRetryNonce((n) => n + 1)}
              className="self-start rounded bg-blue-600 px-4 py-2 text-white"
            >
              {t('participant.lobby.errors.retry')}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Loaded render ───────────────────────────────────────────────
  return (
    <div data-testid="route-lobby" data-state="loaded" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.lobby.title')}</h1>
      {header !== undefined ? (
        <p data-testid="lobby-topic" className="mt-2 text-sm text-slate-700">
          {t('participant.lobby.topicLabel')} {header.topic}
        </p>
      ) : null}
      <h2 className="mt-6 text-sm font-medium text-slate-600">
        {t('participant.lobby.participantsHeading')}
      </h2>
      <ul data-testid="lobby-participants-list" className="mt-2 space-y-1">
        {SLOT_ROLES.map((role) => {
          const slot = slots[role];
          if (slot === undefined) return null;
          const badgeKey =
            role === 'moderator'
              ? 'participant.lobby.roleBadges.moderator'
              : role === 'debater-A'
                ? 'participant.lobby.roleBadges.debaterA'
                : 'participant.lobby.roleBadges.debaterB';
          return (
            <li
              key={role}
              data-testid={`lobby-participant-${role}`}
              data-user-id={slot.userId}
              className="flex items-center justify-between"
            >
              <span data-testid={`lobby-participant-${role}-name`}>{slot.screenName}</span>
              <span
                data-testid={`lobby-participant-${role}-badge`}
                className="text-xs text-slate-500"
              >
                {t(badgeKey)}
              </span>
            </li>
          );
        })}
      </ul>
      {bothDebatersPresent ? (
        <p data-testid="lobby-both-debaters-present" className="mt-4 text-sm text-slate-600">
          {t('participant.lobby.bothDebatersPresent')}
        </p>
      ) : !debaterAPresent ? (
        <p data-testid="lobby-waiting-for-debater" className="mt-4 text-sm text-slate-600">
          {t('participant.lobby.waitingForDebater', {
            role: t('participant.lobby.roleBadges.debaterA'),
          })}
        </p>
      ) : !debaterBPresent ? (
        <p data-testid="lobby-waiting-for-debater" className="mt-4 text-sm text-slate-600">
          {t('participant.lobby.waitingForDebater', {
            role: t('participant.lobby.roleBadges.debaterB'),
          })}
        </p>
      ) : null}
      {onlyMeAsDebater ? (
        <p data-testid="lobby-empty-state" className="mt-2 text-xs text-slate-500">
          {t('participant.lobby.emptyState')}
        </p>
      ) : null}
    </div>
  );
}
