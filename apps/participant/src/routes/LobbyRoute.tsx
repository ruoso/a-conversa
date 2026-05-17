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
// gives way to the live debate surface in a future leaf when the
// moderator triggers a start-debate event; this leaf installs the
// substrate (open WS subscription) the future handler will sit on.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useWsClient } from '@a-conversa/shell';
import type { Event } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { ParticipantLayout } from '../layout/ParticipantLayout';
import { ParticipantChrome } from '../layout/ParticipantChrome';
import { ParticipantStatusIndicator } from '../layout/ParticipantStatusIndicator';

/**
 * The roles displayed as slot rows, in render order. The moderator
 * row is always first; the two debater rows below it. Mirrors the
 * moderator's `SLOT_ROLES` constant at
 * `apps/moderator/src/routes/InviteParticipants.tsx:67`.
 */
const SLOT_ROLES = ['moderator', 'debater-A', 'debater-B'] as const;
type SlotRole = (typeof SLOT_ROLES)[number];

interface SlotOccupant {
  readonly userId: string;
  readonly screenName: string;
}

type SlotOccupants = { [K in SlotRole]?: SlotOccupant };

interface ParticipantRow {
  readonly userId: string;
  readonly role: SlotRole;
  readonly screenName: string;
}

interface SessionHeader {
  readonly id: string;
  readonly topic: string;
  readonly privacy: 'public' | 'private';
  readonly endedAt: string | null;
}

type FetchStatus = 'loading' | 'loaded' | 'error';

/**
 * Walk the event log and collapse `participant-joined` /
 * `participant-left` events into a role-keyed occupant map.
 *
 * Mirrors the moderator's reducer at
 * `apps/moderator/src/routes/InviteParticipants.tsx:108-137`
 * line-for-line; per Decision §6 of the refinement this copy stays
 * inline next to its single caller rather than being extracted to
 * `@a-conversa/shell` (a future leaf can lift both copies into the
 * shell substrate when a third caller surfaces).
 *
 * Semantics: `participant-left` clears the slot ONLY when the
 * leaver's `user_id` matches the current occupant's `userId` — a
 * stale `participant-left` arriving after a rejoin must not erase
 * the fresh slot. The same semantic the moderator's reducer holds;
 * pinned by Vitest case (i) below.
 */
function deriveSlotOccupants(events: readonly Event[]): SlotOccupants {
  const occupants: SlotOccupants = {};
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      // The payload's `role` is the canonical `EventPayloadMap`
      // `'moderator' | 'debater-A' | 'debater-B'` union, which IS
      // `SlotRole`; no cast needed.
      occupants[event.payload.role] = {
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
  return occupants;
}

/**
 * Merge the HTTP-prefetch row set into the WS-derived slot map. The
 * HTTP prefetch is the cold-load source of truth (it tells us which
 * slots are filled even before the WS catch-up replay arrives); the
 * WS event stream is the live overlay (its events carry the
 * canonical `screen_name` from the joined-payload, and they reflect
 * every subsequent change). Both are merged into a single per-render
 * slot map — WS wins on collisions, since its events are more recent
 * than the HTTP snapshot.
 */
function mergeSlots(
  httpRows: readonly ParticipantRow[],
  wsOccupants: SlotOccupants,
): SlotOccupants {
  const merged: SlotOccupants = {};
  for (const row of httpRows) {
    merged[row.role] = { userId: row.userId, screenName: row.screenName };
  }
  for (const role of SLOT_ROLES) {
    const wsSlot = wsOccupants[role];
    if (wsSlot !== undefined) merged[role] = wsSlot;
  }
  return merged;
}

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
  const slots = useMemo(() => mergeSlots(httpRows, wsOccupants), [httpRows, wsOccupants]);

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
