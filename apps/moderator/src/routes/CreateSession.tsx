// Create-session form route for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_create_session_form.md
// Backend contract: POST /sessions (apps/server/src/sessions/routes.ts) —
//   request `{ topic: string (1..256), privacy?: 'public' | 'private' }`;
//   response 201 `{ id, hostUserId, privacy, topic, createdAt, endedAt }`.
//   Validation failures land as 400 `validation-failed`; missing auth as
//   401 `auth-required`.
// TaskJuggler: moderator_ui.mod_session_setup.mod_create_session_form
//
// The moderator's entry point into a new debate. After authenticating
// and (for first-time users) setting a screen name, the moderator lands
// on `/sessions/new/setup` (gated `authenticated-only` via `<RequireAuth>`
// in `App.tsx`), fills in a topic, picks public/private, and on submit
// POSTs `/sessions`. The handler returns 201 with `{ id, ... }`; the
// form then `useNavigate`s to `/sessions/${id}/operate` with `replace:
// false` so the back button returns to the form (a "create another"
// affordance).
//
// The path is `/sessions/new/setup` rather than the refinement's stated
// `/sessions/new` because Fastify's `GET /sessions/:id` API route matches
// the latter (2-segment) form first and returns 400 `validation-failed`
// before the static-frontends SPA fallback ever fires. A 3-segment path
// has no registered backend route, lands on the SPA fallback's 404
// handler with an HTML accept, and serves `index.html` so the SPA
// mounts. See `apps/server/src/routes/static-frontends.ts` for the
// SPA-fallback discriminator.
//
// Shape and a11y wiring mirror `ScreenName.tsx` deliberately: same
// `useRef` + one-shot `useEffect` for focus-on-mount, same
// `aria-invalid` + `aria-describedby` linkage, same `role="alert"` +
// `aria-live="polite"` error region, same submit-disabled rule
// (`submitting || trimmed.length === 0`). No new dependencies introduced.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * The backend's body-schema cap on `topic`. Matches the
 * `createSessionBodySchema.properties.topic.maxLength` value from
 * `apps/server/src/sessions/routes.ts`. The input's `maxLength`
 * attribute enforces this at the input boundary so a user physically
 * cannot type more than 256 characters; the submit handler also re-
 * checks defensively (paste behaviour around `maxLength` is browser-
 * dependent).
 */
const MAX_TOPIC_LENGTH = 256;

/**
 * Discriminated privacy choice mirroring the backend's enum. The
 * default is `'public'` to match both the server-side handler default
 * (`body.privacy ?? 'public'` in `apps/server/src/sessions/routes.ts`)
 * and the DB column default (`migrations/0002_sessions.sql`).
 */
type Privacy = 'public' | 'private';

/**
 * Map a backend `ErrorEnvelope.code` (or fallback status) onto a
 * localization key under the `moderator.createSession.errors`
 * namespace. Unknown codes fall back to the generic message. The
 * mapping table lives in
 * `tasks/refinements/moderator-ui/mod_create_session_form.md`
 * (Constraints → POST behavior → "error-code mapping table").
 */
function errorCodeToI18nKey(code: string, status: number): string {
  if (code === 'validation-failed') {
    return 'moderator.createSession.errors.validation';
  }
  if (code === 'auth-required') {
    return 'moderator.createSession.errors.unauthenticated';
  }
  // Status 401 without a recognized code still surfaces as unauthenticated;
  // this protects against an envelope shape regression where the code
  // disappears but the status is correct.
  if (status === 401) {
    return 'moderator.createSession.errors.unauthenticated';
  }
  if (status === 400) {
    return 'moderator.createSession.errors.validation';
  }
  return 'moderator.createSession.errors.generic';
}

export function CreateSessionRoute(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<string>('');
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorKey, setErrorKey] = useState<string | undefined>(undefined);

  // Focus management. The route exists to capture a topic + privacy; the
  // topic input should be focused on mount so a keyboard or screen-reader
  // user lands ready to type. `useRef` + one-shot `useEffect` rather
  // than the React `autoFocus` attribute, which has known issues with
  // StrictMode double-mount + route-transition re-mounts (per the
  // `mod_screen_name_setup` Decisions block).
  const topicRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    topicRef.current?.focus();
  }, []);

  const trimmedTopic = topic.trim();
  // Disable submit on empty-after-trim OR when a request is in flight.
  // Other rejects (too-long) surface as inline errors when the user
  // submits — same UX choice the screen-name form made.
  const submitDisabled = submitting || trimmedTopic.length === 0;

  async function submit(): Promise<void> {
    setErrorKey(undefined);
    if (trimmedTopic.length === 0) {
      setErrorKey('moderator.createSession.errors.topicRequired');
      return;
    }
    if (trimmedTopic.length > MAX_TOPIC_LENGTH) {
      setErrorKey('moderator.createSession.errors.topicTooLong');
      return;
    }
    if (privacy !== 'public' && privacy !== 'private') {
      // Not reachable from the UI (only two radios exist), but the
      // discriminator gets asserted anyway so a future refactor that
      // introduces a third value gets caught here.
      setErrorKey('moderator.createSession.errors.privacyInvalid');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ topic: trimmedTopic, privacy }),
      });
      if (response.status === 201) {
        const body = (await response.json()) as { id?: unknown };
        // Narrow at the boundary — `id` is the server-generated UUID.
        if (typeof body.id !== 'string' || body.id.length === 0) {
          setErrorKey('moderator.createSession.errors.generic');
          topicRef.current?.focus();
          return;
        }
        // `replace: false` so the back button from /sessions/<id>/operate
        // returns to /sessions/new (a "create another" affordance) rather
        // than skipping past the form.
        void navigate(`/sessions/${body.id}/operate`, { replace: false });
        return;
      }
      // Non-201. Read the envelope's `error.code` if present, map to
      // i18n key.
      let code = 'unknown';
      try {
        const errBody: unknown = await response.json();
        if (
          errBody !== null &&
          typeof errBody === 'object' &&
          'error' in errBody &&
          typeof (errBody as { error?: unknown }).error === 'object' &&
          (errBody as { error: Record<string, unknown> }).error !== null &&
          typeof (errBody as { error: Record<string, unknown> }).error['code'] === 'string'
        ) {
          code = (errBody as { error: { code: string } }).error.code;
        }
      } catch {
        // Body wasn't JSON. Fall through to generic.
      }
      setErrorKey(errorCodeToI18nKey(code, response.status));
      topicRef.current?.focus();
    } catch {
      setErrorKey('moderator.createSession.errors.network');
      topicRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  const hasError = errorKey !== undefined;
  // `aria-describedby` points to both the helper (always present) and
  // the error region (conditional). Pointing to a non-existent id is a
  // no-op per ARIA — keeping the markup stable avoids id churn on
  // error toggles.
  const describedBy = 'create-session-helper create-session-error';

  return (
    <main data-testid="route-create-session" className="mx-auto max-w-xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold mb-4">
        {t('moderator.createSession.title')}
      </h1>
      <form
        data-testid="create-session-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor="create-session-topic"
            data-testid="create-session-topic-label"
            className="font-medium"
          >
            {t('moderator.createSession.topic.label')}
          </label>
          <input
            ref={topicRef}
            id="create-session-topic"
            data-testid="create-session-topic-input"
            type="text"
            value={topic}
            maxLength={MAX_TOPIC_LENGTH}
            autoComplete="off"
            inputMode="text"
            placeholder={t('moderator.createSession.topic.placeholder')}
            aria-invalid={hasError}
            aria-describedby={describedBy}
            className="rounded border border-gray-300 px-3 py-2"
            onChange={(event) => {
              setTopic(event.target.value);
              if (errorKey !== undefined) setErrorKey(undefined);
            }}
          />
        </div>
        <fieldset
          data-testid="create-session-privacy-fieldset"
          className="flex flex-col gap-2 border-0 p-0"
        >
          <legend data-testid="create-session-privacy-legend" className="font-medium">
            {t('moderator.createSession.privacy.label')}
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="privacy"
              value="public"
              data-testid="create-session-privacy-public"
              checked={privacy === 'public'}
              onChange={() => setPrivacy('public')}
            />
            <span data-testid="create-session-privacy-public-label">
              {t('moderator.createSession.privacy.public')}
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="privacy"
              value="private"
              data-testid="create-session-privacy-private"
              checked={privacy === 'private'}
              onChange={() => setPrivacy('private')}
            />
            <span data-testid="create-session-privacy-private-label">
              {t('moderator.createSession.privacy.private')}
            </span>
          </label>
        </fieldset>
        <p
          id="create-session-helper"
          data-testid="create-session-helper"
          className="text-sm text-gray-600"
        >
          {t('moderator.createSession.helper', {
            used: trimmedTopic.length,
            max: MAX_TOPIC_LENGTH,
          })}
        </p>
        {hasError && (
          <p
            id="create-session-error"
            data-testid="create-session-error"
            role="alert"
            aria-live="polite"
            aria-atomic="true"
            className="text-sm text-red-700"
          >
            {t(errorKey)}
          </p>
        )}
        <button
          type="submit"
          data-testid="create-session-submit"
          disabled={submitDisabled}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {t('moderator.createSession.submit')}
        </button>
      </form>
    </main>
  );
}
