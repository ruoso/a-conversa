Feature: WebSocket catch-up (client → server, reconnection state catch-up)

  After a transient disconnect, a client opens a fresh WebSocket
  connection, re-authenticates via the upgrade-time gate, re-subscribes
  to each session it was tracking, and then sends a `catch-up`
  envelope with the last `sinceSequence` it observed. The server
  responds with either:

    1. A stream of `event-applied` envelopes (the exact same envelope
       type the live broadcast surface emits) covering the events
       `> sinceSequence` and `<= MAX(sequence)`, followed by a final
       `caught-up` ack with `fromSnapshot: false`. The slice-replay
       path.

    2. A single `snapshot-state` envelope (built via the same
       `serializeProjectionForWire` helper the snapshot handler uses),
       followed by a `caught-up` ack with `fromSnapshot: true`. The
       snapshot-fallback path; selected when the gap between
       `sinceSequence` and `MAX(sequence)` exceeds a configurable
       threshold (default 500 via env `WS_CATCHUP_MAX_EVENTS`; tests
       inject a small value to exercise both branches deterministically).

  Rejection paths surface as canonical `error` envelopes: a catch-up
  without a prior `subscribe` for that session yields
  `code: 'forbidden'`. The handler is **server-side only** — the
  client retry / backoff / re-auth / re-subscribe orchestration that
  drives the catch-up request lives in future participant / moderator /
  audience workspace tasks.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row plus
  participant rows plus a seeded event log are inserted, the catch-up
  envelope is sent on a subscribed connection, and the receiving
  client is inspected for the streamed frames + the final ack.

  Refinement: tasks/refinements/backend/ws_reconnection_handling.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server with catch-up threshold 2 is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: Client reconnects after sequence 2, catches up — receives event-applied frames + caught-up ack
    Given a snapshot-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777701" and node id "77777777-7777-4777-8777-77777777a701" and pending proposal id "77777777-7777-4777-8777-77777777b701"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777701"
    And the client sends a catch-up envelope for session "77777777-7777-4777-8777-777777777701" with sinceSequence 4
    Then the client receives event-applied catch-up frames with sequences "5"
    And the client receives a caught-up ack referencing the catch-up envelope with throughSequence 5 eventCount 1 fromSnapshot false

  Scenario: Stale sinceSequence (far behind) — snapshot-state arrives + caught-up ack with fromSnapshot:true
    Given a snapshot-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777702" and node id "77777777-7777-4777-8777-77777777a702" and pending proposal id "77777777-7777-4777-8777-77777777b702"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777702"
    And the client sends a catch-up envelope for session "77777777-7777-4777-8777-777777777702" with sinceSequence 0
    Then the client receives a snapshot-state catch-up envelope at sequence 5
    And the client receives a caught-up ack referencing the catch-up envelope with throughSequence 5 eventCount 0 fromSnapshot true

  Scenario: An unsubscribed client cannot catch up — receives a forbidden error envelope
    Given a snapshot-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777703" and node id "77777777-7777-4777-8777-77777777a703" and pending proposal id "77777777-7777-4777-8777-77777777b703"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a catch-up envelope for session "77777777-7777-4777-8777-777777777703" with sinceSequence 0
    Then the client receives an error envelope with code "forbidden" referencing the catch-up envelope

  Scenario: Catch-up at the current head — empty stream + caught-up ack eventCount 0
    Given a snapshot-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777704" and node id "77777777-7777-4777-8777-77777777a704" and pending proposal id "77777777-7777-4777-8777-77777777b704"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777704"
    And the client sends a catch-up envelope for session "77777777-7777-4777-8777-777777777704" with sinceSequence 5
    Then the client receives a caught-up ack referencing the catch-up envelope with throughSequence 5 eventCount 0 fromSnapshot false
