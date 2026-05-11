Feature: WebSocket proposal-status derived broadcast

  When the server appends a status-affecting event (`proposal` / `vote` /
  `commit` / `meta-disagreement-marked`) to `session_events` for a
  session, every WebSocket connection subscribed to that session
  receives — AFTER the `event-applied` broadcast — a derived
  `proposal-status` envelope carrying the current per-facet status for
  the affected proposal. Clients use the derived envelope to update
  their facet displays without re-running `deriveFacetStatus`
  themselves.

  The subscriber filters the bus to the four status-affecting kinds —
  irrelevant events (session-created, participant-joined, etc.) do NOT
  trigger a `proposal-status` envelope. Structural proposal sub-kinds
  (axiom-mark / decompose / interpretive-split / meta-move /
  break-edge / amend-node / annotate) also do not trigger one (no
  facet target). Both invariants are pinned by the Vitest unit suite
  under `apps/server/src/ws/broadcast/proposal-status.test.ts`; the
  cucumber surface here pins the end-to-end fan-out path through the
  real WS upgrade (`app.injectWS`) against pglite.

  Refinement: tasks/refinements/backend/ws_proposal_status_broadcast.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: After a vote, both subscribed clients receive a proposal-status envelope reflecting the current per-facet state
    Given a vote-ready session for "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01" and node id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab01" and pending proposal id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
    And a second authenticated WebSocket client connects to "/ws"
    And the second client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"
    And the client sends a vote envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01" with expectedSequence 5 on proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01" choosing "agree"
    Then the client receives a proposal-status envelope for proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01" at sequence 6 with classification status "proposed"
    And the second client receives a proposal-status envelope for proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac01" at sequence 6 with classification status "proposed"

  Scenario: After the moderator commits a unanimously-agreed facet, every subscribed client receives a proposal-status envelope with status committed
    Given a commit-ready session for "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02" and node id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab02" and pending proposal id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02" with all participants agreeing
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02"
    And a second authenticated WebSocket client connects to "/ws"
    And the second client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02"
    And the client sends a commit envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02" with expectedSequence 9 on proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02"
    Then the client receives a proposal-status envelope for proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02" at sequence 10 with classification status "committed"
    And the second client receives a proposal-status envelope for proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaac02" at sequence 10 with classification status "committed"

  Scenario: A non-status-affecting event (participant-joined-on-existing-session via subscribe-only setup) produces no proposal-status envelope
    Given a public session owned by "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03"
    And the server emits an event-applied broadcast for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03" with sequence 1
    Then the client receives no proposal-status envelope within 200ms
