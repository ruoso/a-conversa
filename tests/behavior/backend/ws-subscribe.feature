Feature: WebSocket subscribe / unsubscribe

  An authenticated WebSocket client tells the server "I want event
  broadcasts for session X" via a `subscribe` envelope; the server
  gates the request through the same `canSeeSession` predicate the
  HTTP routes use, registers the (connection, session) tuple in the
  per-server-instance subscription registry, and replies with a
  `subscribed` ack whose `inResponseTo` echoes the originating
  envelope's `id`. `unsubscribe` mirrors the shape and is idempotent.
  Broadcast emission is NOT in scope — that's `ws_event_broadcast`.

  These scenarios cover the wire-level subscribe / unsubscribe flow
  end-to-end through the real upgrade path (`app.injectWS`) against a
  pglite-backed pool with a real `sessions` row. The not-visible
  path's regression coverage moved to `ws-error.feature` once
  `ws_error_message` landed (the wire shape is now an `error`
  envelope with `code: 'not-found'` — not a silent drop).

  Refinement: tasks/refinements/backend/ws_subscribe_to_session.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: Subscribing to a visible public session emits a subscribed ack
    Given a public session owned by "alice-ws" exists with id "55555555-5555-4555-8555-555555555501"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "55555555-5555-4555-8555-555555555501"
    Then the client receives a subscribed ack referencing the subscribe envelope

  Scenario: Unsubscribing emits an unsubscribed ack
    Given a public session owned by "alice-ws" exists with id "55555555-5555-4555-8555-555555555503"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "55555555-5555-4555-8555-555555555503"
    And the client sends an unsubscribe envelope for session "55555555-5555-4555-8555-555555555503"
    Then the client receives an unsubscribed ack referencing the unsubscribe envelope
