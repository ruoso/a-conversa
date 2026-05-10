# Playwright test helpers

**TaskJuggler entry**: `foundation.test_infra.playwright_test_helpers` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 2d
**Inherited dependencies**: `playwright_setup` (settled)

## What and why

Shared helpers that Playwright tests in every frontend workspace import. Without these, every test re-implements common operations (login, create session, vote on facet).

## Decisions

- Lives in `packages/test-fixtures/playwright-helpers/` so all frontend Playwright suites share the same helpers.
- Helpers cover:
  - **`loginAs(page, user)`** — drives the Authelia login flow and ends up authenticated as the named dev user.
  - **`createSession(api, host, topic, privacy)`** — provisions a session via the backend API and returns its id.
  - **`joinSession(page, sessionId, role)`** — navigates the appropriate frontend (moderator/participant/audience) to the session.
  - **`proposeNode(page, wording, kind)`** — moderator-side helper to capture a statement.
  - **`voteOnFacet(page, facet, vote)`** — participant-side helper to vote on a facet.
  - **`commitProposal(page, proposalId)`** — moderator commit gesture.
  - **`waitForGraphState(page, predicate)`** — wait until the graph view matches a predicate (e.g., a node with given wording is visible).
  - **`loadFixture(api, fixtureName)`** — load a `packages/test-fixtures/` fixture into the test DB.
- All helpers are typed; they mirror the API surface that the application code expects.

## Acceptance criteria

- `packages/test-fixtures/playwright-helpers/` workspace with the helpers above.
- Used by at least one Playwright test (the `mod_pw_full_session_run` is the natural showcase).
- Documented inline; future test authors can compose from these.
