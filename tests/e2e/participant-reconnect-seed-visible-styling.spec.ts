// End-to-end Playwright spec — participant operate route's pending-
// proposal chip styling survives a WS kill + reconnect mid-decompose,
// re-built from the server's `proposal-status` seed envelopes.
//
// Refinement: tasks/refinements/participant-ui/part_pw_reconnect_seed_visible_styling.md
// Predecessor: tasks/refinements/participant-ui/part_migrate_to_pending_proposal_facet_status.md
//              (D6 — deferred this reconnect sub-step pending the
//              moderator-side `WsClient.killWebSocket()` shim, which
//              landed via `mod_pw_reconnect_seed_visible_styling` commit
//              `ecb70df`).
// Sibling:    tasks/refinements/moderator-ui/mod_pw_reconnect_seed_visible_styling.md
//              (the moderator-side reconnect sub-step in
//              `moderator-proposed-entity-canvas-visibility.spec.ts`
//              Scenario 3 — same kill+poll+flash-watcher shape lifted
//              here verbatim from the participant pane's perspective).
// ADRs:
//   - docs/adr/0008-e2e-framework-playwright.md
//   - docs/adr/0022-no-throwaway-verifications.md
//   - docs/adr/0027-entity-and-facet-layers-strict-separation.md
//
// **What this spec pins.** A real participant browser that loses its
// WS connection mid-decompose rebuilds the pending-proposal chip
// styling from the server's `proposal-status` seed envelopes on
// reconnect, without the chips' `data-facet-status` flashing to
// `null` / `''` / `'undefined'` / `'awaiting-proposal'` during the
// catch-up window. The cross-surface shape (moderator context drives a
// REAL 2-component decompose propose; participant context observes,
// kills, asserts) pins a stronger contract than the moderator's
// Scenario 3 reconnect sub-step: that the server's broadcast to a
// SECOND-surface subscriber carries the per-component seed envelopes on
// a reconnect-initiated catch-up. The moderator's Scenario 3 reconnects
// the SAME context that proposed; this spec reconnects a DIFFERENT
// context that's been subscribed in the steady state.
//
// **Why a real-server propose** (per refinement D3). The participant's
// existing pending-proposals spec uses `__aConversaWsStore.applyProposalStatus`
// client-side seeding — that survives a same-context store mutation but
// NOT a WS reconnect, because the catch-up handler re-emits state from
// the server projection and the client-only seed never reached the
// projection. To pin the seed-on-reconnect contract, the proposal must
// be a real server-side record; the cross-surface flow has the
// moderator context drive the actual decompose-propose UI chain so the
// server projection holds the proposal at reconnect time.
//
// **Locale.** en-US only; cross-locale matrix is covered at the catalog
// level.

import { expect, test, type Page } from './fixtures/no-scrollbars';

import { authedContext } from './fixtures/authed-context';
import { seedParticipants } from './fixtures/wsStoreSeed';

const TOPIC =
  'Participant operate route reconnect-seed visible styling (cross-surface decompose propose)';

// Synthetic debater seeds let the moderator's Enter-session gate open
// without standing up a third real browser context. Mirrors the moderator
// scenario 3 pattern at
// `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts:46-63`.
// Ben (real debater-A) claims his slot via the participant invite flow;
// the synthetic debater-B seed only affects alice's local store, so
// there is no DB-level collision with ben's real claim.
const GATE_DEBATER_A_USER_ID = '00000000-0000-4000-8000-0000000000a2';
const GATE_DEBATER_B_USER_ID = '00000000-0000-4000-8000-0000000000b2';

async function createPublicSession(page: Page, topic: string): Promise<string> {
  const response = await page.request.post('/api/sessions', {
    data: { topic, privacy: 'public' },
  });
  expect(response.status(), 'createPublicSession: POST /api/sessions must return 201').toBe(201);
  const body = (await response.json()) as { id: string };
  expect(body.id, 'createPublicSession: response body must carry a string id').toBeTruthy();
  return body.id;
}

/**
 * Drive the moderator-side invite → seed-gate → operate chain so alice
 * lands on `/m/sessions/:id/operate`. The synthetic gate-seed mirrors
 * scenario 3's pattern in
 * `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts` —
 * affects alice's local store only; the server is unaware.
 */
async function moderatorEnterOperate(alicePage: Page, sessionId: string): Promise<void> {
  await alicePage.goto(`/m/sessions/${sessionId}/invite`);
  await expect(alicePage.getByTestId('route-invite-participants')).toBeVisible({
    timeout: 15_000,
  });
  await seedParticipants(alicePage, {
    sessionId,
    participants: [
      { userId: GATE_DEBATER_A_USER_ID, role: 'debater-A', screenName: 'gate-a' },
      { userId: GATE_DEBATER_B_USER_ID, role: 'debater-B', screenName: 'gate-b' },
    ],
  });
  await alicePage.getByTestId('invite-enter-session').click();
  await alicePage.waitForURL(/\/m\/sessions\/[0-9a-f-]+\/operate$/, { timeout: 15_000 });
  await expect(alicePage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
}

/**
 * Drive the participant-side claim → operate-route navigation so ben
 * lands on `/p/sessions/:id`. Ben enters as debater-A; the participant
 * operate route's WS subscription kicks in immediately and starts
 * receiving the broadcasts the moderator's propose chain emits.
 */
async function participantEnterOperate(benPage: Page, sessionId: string): Promise<void> {
  await benPage.goto(`/p/sessions/${sessionId}/invite?role=debater-A`);
  await expect(benPage.getByTestId('route-invite-acceptance')).toBeVisible({ timeout: 15_000 });
  await benPage.getByTestId('invite-acceptance-join-button').click();
  await benPage.waitForURL((url) => url.pathname === `/p/sessions/${sessionId}/lobby`, {
    timeout: 15_000,
  });
  // Navigate directly to the operate route rather than waiting on the
  // auto-handoff. Alice's enter-session above used a synthetic gate
  // seed, so the server-side `/api/sessions/:id/start` would not fire
  // an authoritative `session-mode-changed` event for ben's lobby to
  // pivot on. Direct navigation is the simplest reach to the operate
  // surface that owns the test seam this spec drives.
  await benPage.goto(`/p/sessions/${sessionId}`);
  await expect(benPage.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
}

test.describe('Participant operate route — reconnect-seed visible styling', () => {
  test('cross-surface: moderator decompose-proposes, participant observes the per-facet chips, kill+reconnect re-renders them from the seed envelopes without flash-to-undefined', async ({
    browser,
  }) => {
    // Two real contexts (alice = moderator, ben = participant /
    // debater-A). `authedContext` loads each user's pre-seeded jar from
    // `global-auth.setup.ts` so no OIDC dance happens at test runtime;
    // the rate-limit risk that motivated the dev-pool expansion does
    // not apply (mirrors `tests/e2e/cross-surface-lobby-start.spec.ts`).
    const aliceContext = await authedContext(browser, 'alice');
    const alicePage = await aliceContext.newPage();
    const benContext = await authedContext(browser, 'ben');
    const benPage = await benContext.newPage();

    try {
      // Step 1 — alice creates a public session via the same-origin API
      // (mirrors the cross-surface lobby spec's `createSession` shape).
      const sessionId = await createPublicSession(alicePage, TOPIC);

      // Step 2 — alice navigates to the moderator invite view, seeds
      // the two synthetic debaters to open the gate, and enters the
      // operate route.
      await moderatorEnterOperate(alicePage, sessionId);

      // Step 3 — ben (debater-A) claims his slot via the participant
      // invite flow and navigates to the operate route. The route's
      // mount installs `window.__testHooks.killWebSocket` per refinement
      // D1 (sibling `useEffect` to the `trackSession` effect at
      // `apps/participant/src/routes/OperateRoute.tsx`).
      await participantEnterOperate(benPage, sessionId);

      // Pre-condition: the test seam is installed on the participant
      // page. (The eventual kill step asserts this too, but probing
      // here pins the install effect's mount-time behavior at the e2e
      // layer — a regression in the install effect surfaces here as a
      // clear failure rather than later as a kill-step throw.)
      await benPage.waitForFunction(
        () => {
          const w = window as unknown as { __testHooks?: { killWebSocket?: () => void } };
          return typeof w.__testHooks?.killWebSocket === 'function';
        },
        undefined,
        { timeout: 10_000, polling: 50 },
      );

      // Step 4 — alice proposes a parent statement (free-floating
      // capture-node), then opens decompose mode on it and fills two
      // component rows. Mirrors moderator
      // `moderator-proposed-entity-canvas-visibility.spec.ts` Scenario 3.
      const parentWording = 'Workers should earn a living wage and receive fair benefits.';
      const aliceTextarea = alicePage.getByTestId('capture-text-input-textarea');
      await aliceTextarea.fill(parentWording);
      const submitKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
      await aliceTextarea.press(submitKey);
      await expect(aliceTextarea).toHaveValue('');

      const parentNode = alicePage.getByTestId(/^statement-node-[0-9a-f-]+$/);
      await expect(parentNode).toHaveCount(1, { timeout: 15_000 });
      await parentNode.first().click({ button: 'right' });
      await expect(alicePage.getByTestId('graph-context-menu')).toBeVisible();
      await alicePage.getByTestId('graph-context-menu-item-propose-decompose').click();
      await expect(alicePage.getByTestId('decompose-component-row-0')).toBeVisible();
      await alicePage
        .getByTestId('decompose-component-text-0')
        .fill('Workers should earn a living wage.');
      await alicePage.getByTestId('decompose-component-classification-0-button-value').click();
      await alicePage
        .getByTestId('decompose-component-text-1')
        .fill('Workers should receive fair benefits.');
      await alicePage.getByTestId('decompose-component-classification-1-button-normative').click();
      await alicePage.getByTestId('propose-decomposition-action-button').click();

      // Step 5 — on the participant page, switch to the Proposals tab
      // and expand the decompose row. The pane's source-of-truth for
      // rows is the events-derived projection; the propose envelope
      // arrived via the WS broadcast alice's propose triggered.
      await benPage.getByTestId('participant-proposals-tabbar-proposals').click();
      await expect(benPage.getByTestId('participant-pending-proposals-pane')).toBeVisible({
        timeout: 15_000,
      });
      const rows = benPage.locator('[data-testid="participant-pending-proposal-row"]');
      await expect(rows).toHaveCount(1, { timeout: 15_000 });
      const row = rows.first();
      const header = row.locator('[data-testid="participant-pending-proposal-row-header"]');
      await header.click();
      await expect(row).toHaveAttribute('data-expanded', 'true');

      // Pre-reconnect assertion — per refinement D4. The participant
      // pane today renders a single synthetic `'proposal'` chip for a
      // decompose proposal (the per-component chip surface is owned by
      // the sibling debt task `part_pw_multi_component_decompose_per_component_breakdown`);
      // when that lands, this assertion will surface N component chips
      // instead. Either way: at least one `proposed` chip is attached
      // and every chip rendered carries `data-facet-status="proposed"`.
      const proposedChips = row.locator(
        '[data-testid="participant-pending-proposal-row-facet"][data-facet-status="proposed"]',
      );
      await expect(proposedChips.first()).toBeAttached({ timeout: 15_000 });
      const allChips = row.locator('[data-testid="participant-pending-proposal-row-facet"]');
      const initialChipCount = await allChips.count();
      expect(initialChipCount).toBeGreaterThanOrEqual(1);
      // Every chip rendered must be `proposed` — no chip lingering in a
      // pre-proposal `awaiting-proposal` state past the propose round-
      // trip.
      const initialStatuses = await allChips.evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-facet-status')),
      );
      for (const status of initialStatuses) {
        expect(status).toBe('proposed');
      }

      // ───────────────────────────────────────────────────────────────────
      // Reconnect sub-step — refinement D5 + D6. Capture the chip
      // attributes pre-kill so the post-reconnect re-assertion and the
      // flash-to-undefined watcher poll the SAME elements through the
      // reconnect window even if React re-mounts the wrapping nodes.
      // ───────────────────────────────────────────────────────────────────

      const preKillFacetNames = await allChips.evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-facet-name') ?? ''),
      );
      expect(preKillFacetNames.length).toBe(initialChipCount);

      // Force-close the underlying WS socket via the participant-
      // installed test seam (refinement D1 — `OperateRoute` exposes
      // `window.__testHooks.killWebSocket` on mount, deletes on
      // unmount; the underlying `WsClient.killWebSocket()` triggers the
      // natural onclose → `scheduleReconnect()` path without flipping
      // `explicitlyClosed`).
      await benPage.evaluate(() => {
        const w = window as unknown as { __testHooks?: { killWebSocket?: () => void } };
        const kill = w.__testHooks?.killWebSocket;
        if (kill === undefined) {
          throw new Error(
            'window.__testHooks.killWebSocket was not installed by participant OperateRoute',
          );
        }
        kill();
      });

      // Wait for the connection to recover to 'open' (the post-hello,
      // pre-seed-envelope sliver is what the seed-ordering pin guards
      // against; the visible status flip is the cue to re-assert).
      // `__aConversaWsStore` is exposed on the participant surface per
      // `apps/participant/src/main.tsx:50`.
      await benPage.waitForFunction(
        () => {
          const w = window as unknown as {
            __aConversaWsStore?: { getState: () => { connectionStatus: string } };
          };
          return w.__aConversaWsStore?.getState().connectionStatus === 'open';
        },
        undefined,
        { timeout: 15_000, polling: 50 },
      );

      // Post-reconnect: the row is still expanded (UI state persists)
      // and the same set of `proposed` chips is re-rendered after the
      // catch-up handler re-applies the snapshot + seed envelopes. A
      // generous timeout absorbs the catch-up round-trip.
      const reconnectedRow = benPage.locator('[data-testid="participant-pending-proposal-row"]');
      await expect(reconnectedRow).toHaveCount(1, { timeout: 15_000 });
      const reconnectedChips = reconnectedRow
        .first()
        .locator(
          '[data-testid="participant-pending-proposal-row-facet"][data-facet-status="proposed"]',
        );
      await expect(reconnectedChips).toHaveCount(initialChipCount, { timeout: 15_000 });

      // Flash-to-undefined watcher — refinement D5. Sample the captured
      // chips' `data-facet-status` every 50ms for a 2.5s window after
      // the connection returns. Reject if any sampled iteration
      // observes `null` / `''` / `'undefined'` / `'awaiting-proposal'`.
      // The seed-ordering guarantee (seed envelopes go AFTER
      // `snapshot-state`, per the migration's D7) would surface here as
      // a sampled-bad-status failure. The watcher runs AFTER the
      // headline assertion because the catch-up sliver is sub-100ms in
      // practice — we're confirming no future render tick regresses.
      const observedBadStatuses: string[] = [];
      await expect
        .poll(
          async () => {
            const statuses = await benPage.evaluate((facetNames: readonly string[]) => {
              const chips = Array.from(
                document.querySelectorAll('[data-testid="participant-pending-proposal-row-facet"]'),
              );
              // Match each captured pre-kill chip by `data-facet-name`
              // so the watcher polls the SAME chips even if the DOM
              // re-mounted (the chip set is small — a flat scan is
              // fine and cheaper than maintaining a key→element map
              // across the reconnect boundary).
              return facetNames.map((name) => {
                const match = chips.find((el) => el.getAttribute('data-facet-name') === name);
                return match === undefined
                  ? '__missing__'
                  : match.getAttribute('data-facet-status');
              });
            }, preKillFacetNames);
            for (const s of statuses) {
              if (s === null || s === '' || s === 'undefined' || s === 'awaiting-proposal') {
                observedBadStatuses.push(s ?? 'null');
              }
            }
            return observedBadStatuses.length;
          },
          { intervals: Array.from({ length: 40 }, () => 50), timeout: 2_500 },
        )
        .toBe(0);
    } finally {
      await benContext.close();
      await aliceContext.close();
    }
  });
});
