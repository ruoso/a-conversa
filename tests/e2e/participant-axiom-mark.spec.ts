// Focused end-to-end spec for the participant axiom-mark button — pins
// the click → real wire round-trip leg that lives buried inside
// `methodology-full-flow.spec.ts` Phase 7.1 (a 12-phase serial test).
//
// Refinements: tasks/refinements/participant-ui/part_axiom_mark_proposal.md
//              tasks/refinements/participant-ui/part_mark_axiom_action.md
//              tasks/refinements/participant-ui/part_axiom_mark_decoration.md
//              tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0017-mock-oauth-authelia-users-file.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//
// **What this spec pins.** The chain a participant walks when she taps
// a node on her tablet and clicks the "Mark as my axiom" button:
//
//   1. ivan creates a public session via the same-origin API.
//   2. julia claims debater-A via the invite-acceptance route + lands
//      on the lobby; she then navigates to the operate route with the
//      `?aconversaTestMode=1` flag so `<GraphView>` exposes the live
//      Cytoscape `Core` on `window.__aConversaCyInstance`.
//   3. The spec seeds one `node-created` event into julia's per-session
//      WS store via the `window.__aConversaWsStore` test seam (per
//      Decision §4 of the refinement — the moderator-capture UI flow
//      is not the system under test; seeding the ingredient keeps the
//      block well within the 30s wall-clock budget).
//   4. The spec synthesises a tap on the seeded node via the
//      `__aConversaCyInstance` seam so the `EntityDetailPanel` mounts
//      with julia's `participant-axiom-mark-button` for that node.
//   5. The spec asserts the button is visible + enabled + in the
//      `data-axiom-mark-state="enabled"` initial state.
//   6. The spec clicks the button; the wire round-trip is the system
//      under test. Per Decision §6 the in-flight visual transition is
//      best-effort — the load-bearing assertion is the settled state
//      (`data-axiom-mark-state="enabled"`, no
//      `participant-axiom-mark-button-wire-error` region) + the events
//      stream contains the canonical `kind: 'proposal'` envelope whose
//      inner proposal is the `axiom-mark` against the seeded node id
//      and the authenticated user id.
//
// **Pair claim.** ivan + julia, per Decision §5 of the refinement and
// [`tests/e2e/fixtures/dev-users.ts`](./fixtures/dev-users.ts). The
// pair-uniqueness rule guards against the in-file (same-worker) per-
// session users-upsert race; cross-file claims are partitioned by
// worker.
//
// **What the spec MUST NOT do** (per the refinement's "What this spec
// MUST NOT do" list):
//   - No new component/hook/route/i18n code — the button is already
//     built; this is a coverage-only leaf.
//   - No `applyEvent`-seeded axiom-mark proposal — the proposal MUST
//     travel the real wire (Decision §3).
//   - No new selector contracts — every testid / data-* the spec
//     queries was locked by `part_mark_axiom_action` or
//     `part_axiom_mark_decoration`.
//   - No `test.describe.serial(…)` — the spec is one parallel
//     `test()` in its own file, mirroring the
//     `participant-graph-render.spec.ts` block-3 posture.

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';

/**
 * Create a session via the same-origin API. Mirrors the helper used by
 * `participant-graph-render.spec.ts` / `participant-lobby.spec.ts`.
 */
async function createSession(
  page: Page,
  opts: { topic: string; privacy: 'public' | 'private' },
): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic: opts.topic, privacy: opts.privacy },
  });
  expect(response.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

/**
 * Log the current user out and drop every cookie so the next `loginAs`
 * drives a fresh OIDC dance.
 */
async function logoutAndClearAllCookies(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/logout');
  expect([200, 204], 'logoutAndClearAllCookies: unexpected status').toContain(response.status());
  await page.context().clearCookies();
}

/**
 * Allocate a fresh browser context with an empty cookie jar so the
 * setup-auth project's alice JWT does not contaminate the dance.
 */
async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

test.describe('Participant axiom-mark button — focused wire round-trip', () => {
  test('ivan creates a session, julia claims debater-A, taps a seeded node, clicks the axiom-mark button, the proposal envelope lands on the per-session events stream', async ({
    browser,
  }) => {
    const context = await freshContext(browser);
    const page = await context.newPage();
    try {
      const TOPIC = 'Axiom-mark button reaches the participant tablet (focused)';
      const N1_WORDING = 'Liberty is the ultimate value';

      // 1. ivan creates the session.
      const ivan = await loginAs(page, { username: 'ivan' });
      expect(ivan.screenName.toLowerCase()).toBe('ivan');
      const sessionId = await createSession(page, { topic: TOPIC, privacy: 'public' });

      // 2. Log out + drop cookies so the next dance is fresh.
      await logoutAndClearAllCookies(page);

      // 3. julia authenticates and claims debater-A through the invite
      //    acceptance flow.
      const julia = await loginAs(page, { username: 'julia' });
      expect(julia.screenName.toLowerCase()).toBe('julia');
      await page.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
      await expect(page.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
      const joinButton = page.getByTestId('invite-acceptance-join-button');
      await expect(joinButton).toBeEnabled();
      await joinButton.click();
      await page.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
        timeout: 15_000,
      });
      await expect(page.getByTestId('route-lobby')).toBeVisible({ timeout: 15_000 });

      // 4. Navigate to the operate route WITH the test-mode flag so
      //    `<GraphView>` exposes the live cy instance on
      //    `window.__aConversaCyInstance`. The synthetic tap below
      //    relies on that seam (same pattern as block-9 / block-10 of
      //    `participant-graph-render.spec.ts`).
      await page.goto(`/p/sessions/${sessionId}?aconversaTestMode=1`);
      await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('participant-detail-panel')).toBeVisible({ timeout: 15_000 });

      // 5. Seed the ingredient node via the `__aConversaWsStore`
      //    test seam (per Decision §4 the moderator-capture UI flow is
      //    out of scope; seeding the node keeps the block well under
      //    the 30s wall-clock budget). The axiom-mark proposal itself
      //    is NOT seeded — it travels the real wire on the button
      //    click (per Decision §3).
      const N1_ID = '11111111-1111-4111-8111-111111111111';
      const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
      await page.evaluate(
        (seed: { sessionId: string; nodeId: string; actorId: string; wording: string }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  applyEvent: (event: unknown) => void;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) {
            throw new Error('__aConversaWsStore is not exposed on window');
          }
          const apply = store.getState().applyEvent.bind(store.getState());
          // High sequence number guards against the WS store's dedup
          // branch — the live subscription has already played lifecycle
          // events (session-created + participant-joined for julia), so
          // `lastAppliedSequence` is > 0. Using 1_000_000+ keeps the
          // seed above the live high-water mark without coordinating
          // with server state.
          apply({
            id: '33333333-3333-4333-8333-333333333333',
            sessionId: seed.sessionId,
            sequence: 1_000_001,
            kind: 'node-created',
            actor: seed.actorId,
            payload: {
              node_id: seed.nodeId,
              wording: seed.wording,
              created_by: seed.actorId,
              created_at: '2026-05-27T00:00:00.000Z',
            },
            createdAt: '2026-05-27T00:00:00.000Z',
          });
        },
        { sessionId, nodeId: N1_ID, actorId: ACTOR_ID, wording: N1_WORDING },
      );

      // 6. Tap the seeded node via the live cy seam so the panel
      //    selects it. `autoSelectionFromEvent` only selects on
      //    proposal envelopes, not raw `node-created`; the tap is the
      //    canonical participant-side selection path (block-9 +
      //    block-10 of `participant-graph-render.spec.ts` use the
      //    same seam).
      await page.evaluate((nodeId: string) => {
        const cy = (
          window as unknown as {
            __aConversaCyInstance?: {
              getElementById: (id: string) => { emit: (event: string) => unknown };
            };
          }
        ).__aConversaCyInstance;
        if (!cy) {
          throw new Error('__aConversaCyInstance is not exposed on window');
        }
        cy.getElementById(nodeId).emit('tap');
      }, N1_ID);

      const panel = page.getByTestId('participant-detail-panel');
      await expect(panel).toHaveAttribute('data-state', 'detail', { timeout: 15_000 });
      await expect(panel).toHaveAttribute('data-entity-id', N1_ID);
      await expect(panel).toHaveAttribute('data-entity-kind', 'node');

      // 7. **Scenario 1 — button visible for own participant on node
      //    selection.** The selector contract is locked by
      //    `part_mark_axiom_action`: testid +
      //    `data-node-id` + `data-axiom-mark-state="enabled"` initial.
      const axiomBtn = page.locator(
        `[data-testid="participant-axiom-mark-button"][data-node-id="${N1_ID}"]`,
      );
      await expect(axiomBtn).toBeVisible({ timeout: 15_000 });
      await expect(axiomBtn).toBeEnabled();
      await expect(axiomBtn).toHaveAttribute('data-axiom-mark-state', 'enabled');

      // 8. **Scenario 2 — click dispatches the proposal event.** Per
      //    Decision §6 the in-flight visual transition is best-effort
      //    (sub-200ms under a fast network); the load-bearing assertion
      //    is settled `"enabled"` + populated events stream. The
      //    wire-error region MUST NOT surface on success.
      await axiomBtn.click();
      await expect(axiomBtn).toHaveAttribute('data-axiom-mark-state', 'enabled', {
        timeout: 15_000,
      });
      await expect(
        page.locator(
          `[data-testid="participant-axiom-mark-button-wire-error"][data-node-id="${N1_ID}"]`,
        ),
      ).toHaveCount(0);

      // 9. The events-stream read pins the wire round-trip — the
      //    proposal envelope produced by the click reached the server,
      //    was validated (rule 3 `axiom-mark-not-self` passes because
      //    julia marks her own axiom), broadcast back, and applied to
      //    julia's per-session slice via the live subscription. The
      //    `find` tolerates other events in the stream (subscription
      //    acks, the seeded `node-created`, etc.) and does NOT depend
      //    on the axiom-mark proposal being last.
      await expect
        .poll(
          async () =>
            page.evaluate(
              ({ sid, nodeId }: { sid: string; nodeId: string }) => {
                const store = (
                  window as unknown as {
                    __aConversaWsStore?: {
                      getState: () => {
                        sessionState: Record<
                          string,
                          {
                            events: {
                              kind: string;
                              payload: { proposal?: { kind: string; node_id?: string } };
                            }[];
                          }
                        >;
                      };
                    };
                  }
                ).__aConversaWsStore;
                if (!store) return false;
                const session = store.getState().sessionState[sid];
                if (!session) return false;
                return session.events.some(
                  (event) =>
                    event.kind === 'proposal' &&
                    event.payload?.proposal?.kind === 'axiom-mark' &&
                    event.payload?.proposal?.node_id === nodeId,
                );
              },
              { sid: sessionId, nodeId: N1_ID },
            ),
          { timeout: 15_000 },
        )
        .toBe(true);

      // Now narrow the canonical envelope's `participant` field —
      // the engine fills it from `connection.user.id`; the spec asserts
      // it equals julia's authenticated user id (so the rule-3 pass is
      // verified at the projection level, not just trusted).
      const participantOnProposal = await page.evaluate(
        ({ sid, nodeId }: { sid: string; nodeId: string }) => {
          const store = (
            window as unknown as {
              __aConversaWsStore?: {
                getState: () => {
                  sessionState: Record<
                    string,
                    {
                      events: {
                        kind: string;
                        payload: {
                          proposal?: { kind: string; node_id?: string; participant?: string };
                        };
                      }[];
                    }
                  >;
                };
              };
            }
          ).__aConversaWsStore;
          if (!store) return null;
          const session = store.getState().sessionState[sid];
          if (!session) return null;
          const proposal = session.events.find(
            (event) =>
              event.kind === 'proposal' &&
              event.payload?.proposal?.kind === 'axiom-mark' &&
              event.payload?.proposal?.node_id === nodeId,
          );
          return proposal?.payload?.proposal?.participant ?? null;
        },
        { sid: sessionId, nodeId: N1_ID },
      );
      expect(participantOnProposal).toBe(julia.userId);
    } finally {
      await context.close();
    }
  });
});
