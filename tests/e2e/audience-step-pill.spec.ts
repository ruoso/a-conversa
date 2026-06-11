// End-to-end spec for the per-facet STEP PILL on the audience surface's
// live session route at `/a/sessions/:sessionId`.
//
// Refinement: tasks/refinements/post_implementation_audits/per_facet_step_pill.md
//   (Acceptance criteria — four scenarios (a–d) pin the per-node HTML the
//   `cytoscape-node-html-label` migration made DOM-assertable for the
//   first time. Decision §13 — e2e lands now, in a dedicated spec rather
//   than growing `audience-live-session.spec.ts`; scenario (d) is the
//   recorded, agent-checkable half of the ADR 0004 2026-06-06
//   amendment's performance gate (Decision §11a — functional correctness
//   at ~40 nodes at the 1920×1080 OBS baseline; the subjective OBS
//   compositing half is a human checkpoint routed to
//   `tasks/parking-lot.md`, not WBS work).)
// ADRs:        docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//              docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md
//              docs/adr/0039-shared-read-only-graph-view-package.md
// TaskJuggler: post_implementation_audits.per_facet_step_pill
//
// **Seeding flavour.** `seedWsStore` / `seedParticipants` from
// `fixtures/wsStoreSeed.ts` against the dev-only
// `window.__aConversaWsStore` seam (the audience surface's `mount(props)`
// assigns its store onto the same window key when `import.meta.env.DEV`
// is true — see `audience-live-session.spec.ts`'s seeding note). A facet
// round seeds in proposal → votes → commit order, which `seedWsStore`'s
// loop ordering already honors.
//
// **Why the marks/labels are catalog-resolved.** The pill's facet /
// kind / substance labels resolve through `t('methodology.*')` in
// `GraphView`'s projection memo (refinement Decision §14); the spec
// resolves the same en-US catalog keys via the shared `lookup` helper so
// a copy edit updates the assertion rather than reddening a stale
// literal (ADR 0024 precedent from `landing-demo.spec.ts`).
//
// **User pool assignment.** Four scenarios → one distinct dev user each
// (nora, oscar, peter, quinn) so the file's tests run in parallel under
// Playwright's `fullyParallel: true` posture without racing on the
// shared per-session user-creation path (the `audience-live-session`
// pool precedent).

import { CATALOGS } from '@a-conversa/i18n-catalogs';

import { loginAs } from './fixtures/auth';
import { lookup } from './fixtures/locales';
import { seedParticipants, seedWsStore } from './fixtures/wsStoreSeed';
import {
  expect,
  expectNoScrollbars,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures/no-scrollbars';

// The localized labels the pill renders (Decision §14 — labels resolve
// at the GraphView projection memo; the `chromium-audience-step-pill`
// project pins locale en-US).
const FACET_WORDING = lookup(CATALOGS['en-US'], 'methodology.facet.wording');
const FACET_CLASSIFICATION = lookup(CATALOGS['en-US'], 'methodology.facet.classification');
const KIND_FACT = lookup(CATALOGS['en-US'], 'methodology.kind.fact');
const SUBSTANCE_AGREED = lookup(CATALOGS['en-US'], 'methodology.substance.agreed');

// The two debater slots (refinement Decision §3 — the checkbox roster is
// the two debaters, both always listed). Synthetic ids; screen names are
// what the pill renders.
const DEBATER_A_ID = 'dddddddd-aaaa-4ddd-8ddd-00000000000a';
const DEBATER_A_NAME = 'Dana';
const DEBATER_B_ID = 'dddddddd-bbbb-4ddd-8ddd-00000000000b';
const DEBATER_B_NAME = 'Remy';

const NODE_ID = '11111111-2222-4111-8111-000000000001';

/**
 * Create a public session via the same-origin API. Mirrors the
 * `audience-live-session.spec.ts` helper (itself mirroring
 * `participant-graph-render.spec.ts:72-83`).
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
 * Allocate a fresh browser context (project-level `setup-auth` jar is
 * intentionally overridden) that starts authenticated. Each scenario
 * gets its own context so concurrent scenarios do not share cookies.
 */
async function freshAuthedContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
}

/**
 * Login as `username`, create a public session, open its audience route,
 * and seed the two-debater roster. Returns the session id once the graph
 * root is visible (the dev-only window store attachment happens during
 * the SPA bootstrap, so seeding is safe from then on).
 */
async function openSeededSession(
  page: Page,
  opts: { username: string; topic: string },
): Promise<string> {
  await loginAs(page, { username: opts.username });
  const sessionId = await createSession(page, { topic: opts.topic, privacy: 'public' });

  await page.goto(`/a/sessions/${sessionId}`);
  await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

  await seedParticipants(page, {
    sessionId,
    participants: [
      { userId: DEBATER_A_ID, role: 'debater-A', screenName: DEBATER_A_NAME },
      { userId: DEBATER_B_ID, role: 'debater-B', screenName: DEBATER_B_NAME },
    ],
  });

  return sessionId;
}

/** The per-node HTML root for the (single-node scenarios') statement node. */
function gvNode(page: Page) {
  return page.locator('[data-testid="audience-graph-root"] .gv-node');
}

test.describe('audience step pill', () => {
  // Acceptance criterion (a): a seeded statement node renders `.gv-node`
  // with the WORDING pill and two empty debater boxes — the wording facet
  // carries its candidate inline from node creation, so the pill opens on
  // the wording step (Decision §2) with the full roster's empty boxes
  // (Decision §3: both slots always render).
  test('(a) a seeded statement node renders the WORDING pill with two empty debater boxes', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const sessionId = await openSeededSession(page, {
        username: 'nora',
        topic: 'Step pill: wording step with empty boxes',
      });

      await seedWsStore(page, {
        sessionId,
        nodes: [{ nodeId: NODE_ID, wording: 'UBI lifts the welfare floor' }],
      });

      const node = gvNode(page);
      await expect(node).toHaveCount(1, { timeout: 15_000 });

      // Line 1: the wording step shows just the facet label (no candidate
      // value — the wording text is already the node body).
      await expect(node.locator('.gv-pill--step .gv-pill__title')).toHaveText(FACET_WORDING);
      await expect(node.locator('.gv-node__body')).toHaveText('UBI lifts the welfare floor');

      // Line 2: one checkbox per debater, both empty, stable
      // debater-A → debater-B order.
      const names = node.locator('.gv-debater__name');
      await expect(names).toHaveCount(2);
      await expect(names.nth(0)).toHaveText(DEBATER_A_NAME);
      await expect(names.nth(1)).toHaveText(DEBATER_B_NAME);
      await expect(node.locator('.gv-mark--none')).toHaveCount(2);
      await expect(node.locator('.gv-mark--agree')).toHaveCount(0);
      await expect(node.locator('.gv-mark--dispute')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // Acceptance criterion (b): a classification proposal plus one agree +
  // one dispute vote advances the pill to `Classification: Fact` with the
  // ✓ / ✗ marks against the right debater names (Decision §2 — the
  // current step is the deepest STARTED facet, so the classify proposal
  // moves the pill off wording; Decision §5 — the vote glyphs).
  test('(b) classification proposal + split votes show the candidate value and per-debater marks', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const sessionId = await openSeededSession(page, {
        username: 'oscar',
        topic: 'Step pill: classification step with split votes',
      });

      await seedWsStore(page, {
        sessionId,
        nodes: [{ nodeId: NODE_ID, wording: 'UBI lifts the welfare floor' }],
        proposals: [
          { proposal: { kind: 'classify-node', node_id: NODE_ID, classification: 'fact' } },
        ],
        votes: [
          {
            entityKind: 'node',
            entityId: NODE_ID,
            facet: 'classification',
            participant: DEBATER_A_ID,
            choice: 'agree',
          },
          {
            entityKind: 'node',
            entityId: NODE_ID,
            facet: 'classification',
            participant: DEBATER_B_ID,
            choice: 'dispute',
          },
        ],
      });

      const node = gvNode(page);
      await expect(node).toHaveCount(1, { timeout: 15_000 });

      // Line 1: facet label + the candidate VALUE being voted on.
      await expect(node.locator('.gv-pill--step .gv-pill__title')).toHaveText(
        `${FACET_CLASSIFICATION}: ${KIND_FACT}`,
        { timeout: 15_000 },
      );

      // Line 2: the ✓ / ✗ marks land against the RIGHT debater names
      // (debater-A agreed, debater-B disputed).
      const debaters = node.locator('.gv-debater');
      await expect(debaters).toHaveCount(2);
      await expect(debaters.nth(0).locator('.gv-debater__name')).toHaveText(DEBATER_A_NAME);
      await expect(debaters.nth(0).locator('.gv-mark--agree')).toHaveText('✓');
      await expect(debaters.nth(1).locator('.gv-debater__name')).toHaveText(DEBATER_B_NAME);
      await expect(debaters.nth(1).locator('.gv-mark--dispute')).toHaveText('✗');
    } finally {
      await context.close();
    }
  });

  // Acceptance criterion (c): once classification AND substance are
  // committed the step pill is replaced by the compact settled summary
  // (`Fact · Holds ✓`, Decision §6). The wording facet's commit is
  // included to mirror the full capture flow even though settlement
  // hinges on the two deep facets only (Decision §2).
  test('(c) committed classification + substance replace the step pill with the settled chip', async ({
    browser,
  }) => {
    const context = await freshAuthedContext(browser);
    const page = await context.newPage();
    try {
      const sessionId = await openSeededSession(page, {
        username: 'peter',
        topic: 'Step pill: settled summary chip',
      });

      await seedWsStore(page, {
        sessionId,
        nodes: [{ nodeId: NODE_ID, wording: 'UBI lifts the welfare floor' }],
        proposals: [
          { proposal: { kind: 'classify-node', node_id: NODE_ID, classification: 'fact' } },
          { proposal: { kind: 'set-node-substance', node_id: NODE_ID, value: 'agreed' } },
        ],
        votes: [
          {
            entityKind: 'node',
            entityId: NODE_ID,
            facet: 'classification',
            participant: DEBATER_A_ID,
            choice: 'agree',
          },
          {
            entityKind: 'node',
            entityId: NODE_ID,
            facet: 'classification',
            participant: DEBATER_B_ID,
            choice: 'agree',
          },
          {
            entityKind: 'node',
            entityId: NODE_ID,
            facet: 'substance',
            participant: DEBATER_A_ID,
            choice: 'agree',
          },
          {
            entityKind: 'node',
            entityId: NODE_ID,
            facet: 'substance',
            participant: DEBATER_B_ID,
            choice: 'agree',
          },
        ],
        commits: [
          { entityKind: 'node', entityId: NODE_ID, facet: 'wording' },
          { entityKind: 'node', entityId: NODE_ID, facet: 'classification' },
          { entityKind: 'node', entityId: NODE_ID, facet: 'substance' },
        ],
      });

      const node = gvNode(page);
      await expect(node).toHaveCount(1, { timeout: 15_000 });

      // The settled chip joins the two decided values with a check…
      await expect(node.locator('.gv-pill--settled')).toHaveText(
        `${KIND_FACT} · ${SUBSTANCE_AGREED} ✓`,
        { timeout: 15_000 },
      );
      // …REPLACING the step pill (not stacking beside it).
      await expect(node.locator('.gv-pill--step')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // Acceptance criterion (d): the dense-graph OBS audit — the recorded,
  // agent-checkable half of the ADR 0004 performance gate (Decision
  // §11a). ~40 statement nodes with step pills at the 1920×1080 OBS
  // baseline: every `.gv-node` renders, no scrollbars, no console
  // errors. (Frame-time assertions were considered and rejected as
  // flaky-by-construction; the subjective compositing half is a human
  // checkpoint on real OBS hardware — `tasks/parking-lot.md`.)
  test.describe('(d) dense-graph OBS audit at 1920×1080', () => {
    // Match `DEFAULT_BROADCAST_DIMENSIONS` (1920×1080) from
    // `apps/audience/src/graph/layoutOptions.ts`, scoped to this
    // describe (the `audience-live-session.spec.ts` scenario-6 pattern).
    test.use({ viewport: { width: 1920, height: 1080 } });

    const DENSE_NODE_COUNT = 40;

    test('40 step-pill nodes all render with no scrollbars and no console errors', async ({
      browser,
    }) => {
      const context = await freshAuthedContext(browser);
      const page = await context.newPage();
      try {
        await loginAs(page, { username: 'quinn' });
        const sessionId = await createSession(page, {
          topic: 'Step pill: dense-graph OBS audit at 1080p',
          privacy: 'public',
        });

        // Track console / page errors across the graph mount AND the
        // dense seed + per-node HTML render that follows.
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => {
          pageErrors.push(err.message);
        });

        await page.goto(`/a/sessions/${sessionId}`);
        await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

        await seedParticipants(page, {
          sessionId,
          participants: [
            { userId: DEBATER_A_ID, role: 'debater-A', screenName: DEBATER_A_NAME },
            { userId: DEBATER_B_ID, role: 'debater-B', screenName: DEBATER_B_NAME },
          ],
        });

        // ~40 statement nodes in a connected chain; every other node
        // carries an in-flight classification round so the audit covers
        // both wording-step and classification-step pills (with marks).
        const nodeId = (i: number): string =>
          `aa000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`;
        const nodes = Array.from({ length: DENSE_NODE_COUNT }, (_, i) => ({
          nodeId: nodeId(i),
          wording: `Claim ${i + 1}: a statement dense enough to exercise the per-node HTML at broadcast scale`,
        }));
        const edges = Array.from({ length: DENSE_NODE_COUNT - 1 }, (_, i) => ({
          edgeId: `ab000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`,
          source: nodeId(i),
          target: nodeId(i + 1),
        }));
        const classified = nodes.filter((_, i) => i % 2 === 0);
        await seedWsStore(page, {
          sessionId,
          nodes,
          edges,
          proposals: classified.map((n) => ({
            proposal: { kind: 'classify-node', node_id: n.nodeId, classification: 'fact' },
          })),
          votes: classified.map((n) => ({
            entityKind: 'node' as const,
            entityId: n.nodeId,
            facet: 'classification' as const,
            participant: DEBATER_A_ID,
            choice: 'agree' as const,
          })),
        });

        // Every node's per-node HTML element renders, each with a pill.
        const gvNodes = page.locator('[data-testid="audience-graph-root"] .gv-node');
        await expect(gvNodes).toHaveCount(DENSE_NODE_COUNT, { timeout: 30_000 });
        await expect(page.locator('[data-testid="audience-graph-root"] .gv-pill')).toHaveCount(
          DENSE_NODE_COUNT,
          { timeout: 30_000 },
        );
        // …and the two step flavours both appear at density: 20 nodes on
        // the classification step (those carry Dana's ✓), 20 on wording.
        await expect(
          page.locator('[data-testid="audience-graph-root"] .gv-mark--agree'),
        ).toHaveCount(DENSE_NODE_COUNT / 2, { timeout: 30_000 });

        // No scrollbar-reserved strip at the OBS baseline (explicit call
        // on top of the auto fixture, per the OBS-audit precedent).
        await expectNoScrollbars(page);

        expect(
          consoleErrors,
          `console errors during dense render: ${consoleErrors.join(' | ')}`,
        ).toEqual([]);
        expect(pageErrors, `page errors during dense render: ${pageErrors.join(' | ')}`).toEqual(
          [],
        );
      } finally {
        await context.close();
      }
    });
  });
});
