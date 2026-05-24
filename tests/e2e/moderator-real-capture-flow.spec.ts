// End-to-end coverage of the moderator's canonical capture protocol —
// wording → classification → propose → server broadcast → canvas render —
// driven through the real UI with NO `seedWsStore` short-circuit.
//
// Refinements:
//   - tasks/refinements/moderator-ui/mod_capture_text_input.md
//   - tasks/refinements/moderator-ui/mod_classification_palette.md
//   - tasks/refinements/moderator-ui/mod_propose_action.md
//   - tasks/refinements/backend/ws_propose_message.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0027-propose-emits-entity-events.md
//
// **Why this spec.** The audit of the e2e suite found that every
// canvas-rendering spec under `tests/e2e/moderator-*.spec.ts` reaches
// "a node is on the canvas" via `seedWsStore`, which injects synthetic
// `node-created` events into the moderator's Zustand WS store via
// `window.__aConversaWsStore` (the dev-only test seam). That short-
// circuit bypasses the server-side propose handler entirely, so a
// regression in any of:
//
//   - the WS `propose` envelope's request/ack round-trip,
//   - the server emitting `node-created` (+ the matching `proposal`
//     event per ADR 0027) at propose-time,
//   - the broadcast reaching the originator's own socket,
//   - the moderator's WS client applying the inbound envelope to the
//     store via `applyEvent`,
//   - the canvas projection observing the new event and rendering the
//     proposed node,
//
// could leave every existing canvas spec green while a human moderator
// stares at a frozen canvas. This spec drives the full chain in the
// browser — one click on the Propose button — and pins the canonical
// success state: the typed wording surfaces on the canvas. Any
// regression in the chain above turns this spec red.
//
// **Why not duplicate setup elsewhere.** The lobby gate (Enter-session
// click after both debaters self-claim) is exercised by
// `tests/e2e/cross-surface-lobby-start.spec.ts`. The session-creation
// POST is covered by `tests/e2e/create-session-flow.spec.ts`. This
// spec scopes itself to the *operate-canvas capture protocol* and
// reaches `/operate` via direct navigation after a same-origin POST,
// keeping the per-run wall-clock cost low while pinning the chain the
// audit flagged as untested.
//
// **Scope discipline.** Free-floating proposal only (no target /
// edge-role). The connecting-case round-trip (two sequential `propose`
// envelopes with `expectedSequence` tracking across them) is an
// adjacent concern that warrants its own spec once this canonical
// chain has independent coverage; until then, `useProposeAction.test`
// already pins the per-envelope ordering at the unit layer.

import { expect, test } from './fixtures/no-scrollbars';

import { loginAs } from './fixtures/auth';

test.describe('Moderator capture protocol — real wording → propose → broadcast → render chain (wording-only per ADR 0030 §1)', () => {
  test('alice types a wording, clicks propose; the canvas renders the server-minted proposed node', async ({
    page,
  }) => {
    // ── Step 1. Authenticate alice. The project-level storageState
    //    already pre-seeds her jar; `loginAs` short-circuits via the
    //    `/api/auth/me === 200` probe (see `fixtures/auth.ts:260`). ──
    await loginAs(page, { username: 'alice' });

    // ── Step 2. Create a public session via the same-origin API. The
    //    UI session-creation flow is independently covered by
    //    `create-session-flow.spec.ts`; duplicating it here would
    //    only delay the assertion that matters. ─────────────────────
    const createResponse = await page.request.post('/api/sessions', {
      data: {
        topic: 'Real capture-protocol regression check (e2e).',
        privacy: 'public',
      },
    });
    expect(createResponse.status(), 'createSession: POST /api/sessions must return 201').toBe(201);
    const { id: sessionId } = (await createResponse.json()) as { id: string };
    expect(sessionId).toBeTruthy();

    // ── Step 3. Land on the operate canvas directly. The lobby gate
    //    is exercised by `cross-surface-lobby-start.spec.ts`; this
    //    spec scopes itself to the capture protocol on the operate
    //    canvas. The route's `<RequireAuth mode="authenticated-only">`
    //    only checks auth — no participant-count gate at the route
    //    level — so direct navigation is the legitimate path for a
    //    moderator who has already passed the lobby. ────────────────
    await page.goto(`/m/sessions/${sessionId}/operate`);
    await expect(page.getByTestId('route-operate')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('graph-canvas-root')).toBeVisible({ timeout: 15_000 });

    // ── Step 4. Drive the capture UI. Type wording. Per
    //    `pf_mod_capture_pane_wording_only` (ADR 0030 §1) the
    //    capture-pane gesture is wording-only — the classification
    //    palette is no longer mounted in the bottom strip, and the
    //    propose-action validation gate no longer requires a
    //    classification pick. Playwright's auto-wait on `.click()`
    //    handles the WS-connect race. ────────────────────────────────
    const wording = 'The Earth orbits the Sun.';
    await page.getByTestId('capture-text-input-textarea').fill(wording);

    // ── Step 5. Click Propose. This fires the real WS `propose`
    //    envelope (`capture-node` proposal kind per ADR 0030 §1,
    //    wording inline per ADR 0027). The server emits
    //    `node-created` + `entity-included` + `proposal` events at
    //    propose-time; the moderator's WS client applies each via
    //    `wsStore.applyEvent`; the canvas projection re-derives and
    //    emits a `<StatementNode>` for the new node. ────────────────
    await page.getByTestId('propose-action-button').click();

    // ── Step 6. The canonical proof the protocol works end-to-end:
    //    the canvas renders a statement node whose wording carries the
    //    text we typed. The node id is server-minted (the moderator's
    //    propose hook mints a client-side id but the server's
    //    `node-created` event uses that same id; either way we don't
    //    bind to it here — locating by the wording text keeps the
    //    assertion robust to id-generation changes). ────────────────
    const nodeWording = page.locator('[data-testid^="statement-node-wording-"]', {
      hasText: wording,
    });
    await expect(nodeWording).toBeVisible({ timeout: 15_000 });

    // ── Step 7. The capture inputs cleared after a successful propose
    //    (Decision §4 of `mod_propose_action`: optimistic-clear with
    //    snapshot-restore-on-failure). The cleared state is the visible
    //    cue the round-trip resolved without error — if the server
    //    rejected, the snapshot would restore and the wording would
    //    still be in the textarea. ──────────────────────────────────
    await expect(page.getByTestId('capture-text-input-textarea')).toHaveValue('');
  });
});
