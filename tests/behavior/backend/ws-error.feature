Feature: WebSocket canonical server → client error envelope

  The backend WebSocket route emits a canonical `error` envelope on
  the wire whenever (a) a client sends a frame with a `type` no
  handler is registered for, (b) a client sends a malformed frame
  that fails `parseWsEnvelopeJson`, or (c) a registered handler
  rejects the request (e.g. the subscribe handler's visibility check
  rejects a non-visible session). The envelope shape mirrors the
  HTTP `ApiError` body minus the status code:

    `{ type: 'error', id, inResponseTo?, payload: { code, message, details? } }`

  The unified `code` vocabulary reuses the HTTP `ApiError.code`
  taxonomy where applicable (`unauthorized`, `forbidden`,
  `not-found`, `bad-request`, `conflict`, `unprocessable-entity`,
  `internal-error`) plus the WS-specific `unknown-message-type` and
  `malformed-envelope`. Future methodology `RejectionReason` values
  ride the same surface once the five message-type tasks
  (propose / vote / commit / meta-disagreement / snapshot) land.

  **Connection-stays-open invariant.** A malformed frame produces an
  error envelope and the SAME socket continues to accept further
  frames — a per-frame parse failure is a client bug recoverable by
  re-sending, not a connection-state problem.

  Refinement: tasks/refinements/backend/ws_error_message.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-err" exists with screen_name "alice-err"
    And the cucumber world has a valid session cookie for that user

  Scenario: A server-only `type` sent by a client produces an `unknown-message-type` error envelope correlating to the request
    # The dispatcher's `onUnknownType` seam fires for any envelope whose
    # `type` is in the closed `WsMessageType` enum but has no registered
    # handler. Server-emitted-only types (`subscribed`, `unsubscribed`,
    # `event-applied`, `error`, `hello`) parse cleanly through the
    # envelope schema but reach the dispatcher with no matching handler.
    # A fully-unknown discriminator value (e.g. `"banana"`) would be
    # rejected at the envelope-schema stage and hit the malformed-envelope
    # path instead — covered by the next scenario.
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends an envelope with type "subscribed"
    Then the client receives an error envelope with code "unknown-message-type" referencing the previous envelope

  Scenario: Malformed JSON produces a `malformed-envelope` error and the same connection still works
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a malformed frame "{ not valid json" and waits for the error envelope
    Then the client receives an error envelope with code "malformed-envelope" with no inResponseTo
    And the WebSocket connection is still open

  Scenario: Subscribe to a non-visible private session produces a `not-found` error envelope
    Given a user with oauth_subject "authelia:bob-err" exists with screen_name "bob-err"
    And a private session owned by "bob-err" exists with id "66666666-6666-4666-8666-666666666601"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "66666666-6666-4666-8666-666666666601"
    Then the client receives an error envelope with code "not-found" referencing the subscribe envelope
