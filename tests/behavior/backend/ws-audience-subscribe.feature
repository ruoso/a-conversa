Feature: WebSocket audience subscribe-only contract

  An audience-role client is functionally an authenticated WebSocket
  client that subscribes to a session and consumes broadcasts but does
  not send any write envelopes (no `propose`, no `vote`, no `commit`,
  no `withdraw-proposal`, no `mark-meta-disagreement`). On the wire
  this is the existing `subscribe` envelope verbatim — the audience
  framing is a UI-layer convention enforced by a TypeScript-narrowed
  workspace surface (`apps/audience/src/ws/index.ts` does not re-export
  the `send`-side surface). The server's existing role-agnostic
  handlers cover the audience's needs: `subscribe` accepts any
  authenticated client whose `canSeeSession` returns `true`; every
  write handler enforces a participant gate that rejects an audience
  client that does manage to raw-send a write envelope.

  Refinement: tasks/refinements/audience/aud_ws_client.md

  The refinement (Background section) sketched the cookie user as
  `alice-audience`; the existing
  `tests/behavior/steps/backend-ws-event-broadcast.steps.ts` step
  `the server emits an event-applied broadcast for session ... with
  sequence ...` hard-codes a `screen_name = 'alice-ws'` host lookup
  for the synthetic event payload. Cucumber's pglite is per-scenario
  (`tests/behavior/support/world.ts:57`), so reusing `alice-ws` here
  carries zero cross-feature interference risk. Renaming the
  hard-coded host in the broadcast step would have been a wider
  refactor outside this leaf's scope.

  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: An audience-role client subscribes to a public session and receives a subscribed ack
    Given a public session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111101"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111101"
    Then the client receives a subscribed ack referencing the subscribe envelope

  Scenario: An audience-role subscribed client receives event-applied broadcasts in real time
    Given a public session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111102"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111102"
    And the server emits an event-applied broadcast for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111102" with sequence 1
    Then the client receives an event-applied envelope for sequence 1

  Scenario: An audience-typed client that raw-sends a propose envelope is rejected by the participant gate
    Given a user with oauth_subject "authelia:bob-host-audience" exists with screen_name "bob-host-audience"
    And a propose-ready session hosted by another user "bob-host-audience" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111103" and node id "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab03" — the cucumber-world cookie user is NOT a participant
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111103"
    And the audience-typed client raw-sends a propose envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111103" with expectedSequence 3 targeting node "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab03"
    Then the audience-typed client receives an audience-publish rejection envelope

  # ---- Anonymous-WS scenarios (per ADR 0029 + aud_anonymous_ws_subscribe) ----
  #
  # The anonymous variants of the audience-role wire contract land in
  # the same feature file (Decision §6). The cookie-on-upgrade gate
  # now falls through to anonymous on missing/invalid cookie; the
  # subscribe handler routes via the new `canSeeSessionAnonymously`
  # predicate (strictly public + not-ended) and the write handlers
  # reject with `forbidden`. The Background's authenticated cookie
  # is established but unused by these scenarios — the anonymous
  # connect step deliberately omits it.

  Scenario: An anonymous (no-cookie) client subscribes to a public session and receives a subscribed ack and live event-applied broadcasts
    Given a public session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111201"
    When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111201"
    Then the client receives a subscribed ack referencing the subscribe envelope
    When the server emits an event-applied broadcast for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111201" with sequence 1
    Then the client receives an event-applied envelope for sequence 1

  Scenario: An anonymous client subscribing to a private session is rejected with not-found
    Given a private session owned by "alice-ws" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111203"
    When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111203"
    Then the client receives an error envelope with code "not-found" referencing the subscribe envelope

  Scenario: An anonymous client that subscribed and raw-sends a propose envelope is rejected with forbidden, connection stays open
    Given a user with oauth_subject "authelia:carol-host-audience" exists with screen_name "carol-host-audience"
    And a propose-ready session hosted by another user "carol-host-audience" exists with id "aaaa1111-aaaa-4aaa-8aaa-aaaa11111204" and node id "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab04" — the cucumber-world cookie user is NOT a participant
    When an anonymous (no-cookie) WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111204"
    And the audience-typed client raw-sends a propose envelope for session "aaaa1111-aaaa-4aaa-8aaa-aaaa11111204" with expectedSequence 3 targeting node "aaaa1111-aaaa-4aaa-8aaa-aaaa1111ab04"
    Then the anonymous client receives a forbidden error envelope referencing the propose envelope
    And the anonymous client connection is still open
