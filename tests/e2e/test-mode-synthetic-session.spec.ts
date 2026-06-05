// End-to-end spec for the test-mode synthetic-session generate→load flow.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
// TaskJuggler: replay_test.test_mode.test_mode_synthetic_session
//
// **What this spec pins (Decision §6).** The whole chain — real surface →
// real gated endpoint → real persisted log → real read path — through the
// mounted test-mode surface: navigate `/t/`, see the gallery, click
// generate on the **structured** scenario, and land on
// `/t/sessions/<id>` with the ready scrubber surface mounted over the
// generated log. One spec, en-US only, no fixture/mock.
//
// This is the non-empty persisted-log read path that
// `test_mode_load_session.md` §6 deferred to Vitest because it had no way
// to persist a rich log in e2e (the browser-store seed helpers hydrate the
// in-page WS store, not the DB). Synthetic generation persists a rich log
// through the production write path, so this e2e exercises the non-empty
// ready surface end-to-end against the real backend. The scrubber's
// stepping + snapshot-jump behaviour is pinned by `test-mode-scrubber.spec.ts`;
// here we only confirm generate → load lands on the scrubber surface.
//
// **Gating.** The synthetic generator only registers when
// `NODE_ENV !== 'production'`; `make up` (which `make test:e2e:compose`
// and CI's `e2e-playwright` job both use) flips the app container to
// `NODE_ENV=development`, so the gated endpoint is live here.
//
// **Auth.** The `chromium-test-mode-synthetic-session` project depends on
// the shared `setup-auth` project, so the context already carries the
// `aconversa-session` cookie before the first navigation; the spec does
// not drive its own OIDC dance. The authenticated caller becomes the host
// of the generated session, so `canSeeSession` admits it and the load
// route reads it.

import { expect, test } from './fixtures/no-scrollbars';

test.describe('Test-mode synthetic session — generate → load', () => {
  test('generating the structured scenario lands on the load route with the scrubber surface', async ({
    page,
  }) => {
    await page.goto('/t/');

    // The gallery mounts and lists the data-driven scenarios.
    await expect(
      page.getByTestId('test-mode-synthetic-gallery'),
      'the surface root renders the synthetic-session gallery',
    ).toBeVisible({ timeout: 15_000 });

    // Click generate on the structured scenario — the affordance keyed by
    // the scenario id the read endpoint advertised.
    await page.getByTestId('test-mode-synthetic-generate-structured').click({ timeout: 15_000 });

    // Real surface → POST /api/test-mode/synthetic-sessions (the gated
    // endpoint) → 201 { sessionId } → navigate to /t/sessions/<id>. Wait
    // for the URL to settle on the load route.
    await page.waitForURL(/\/t\/sessions\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // The ready scrubber surface renders over the persisted log the
    // generator wrote — surface → real REST fetch → real backend → real
    // read path. A non-empty log puts the scrubber head beyond the
    // baseline, so the surface opens with a traversable range and graph.
    await expect(
      page.getByTestId('test-mode-scrubber'),
      'the generated session loads its persisted log into the ready scrubber surface',
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('test-mode-scrubber-graph')).toBeVisible();
  });

  test('generating the walkthrough scenario lands on the load route with the scrubber surface', async ({
    page,
  }) => {
    await page.goto('/t/');

    await expect(
      page.getByTestId('test-mode-synthetic-gallery'),
      'the surface root renders the synthetic-session gallery',
    ).toBeVisible({ timeout: 15_000 });

    // The walkthrough affordance renders automatically from the new
    // descriptor — no gallery component change (ADR-0041 data-driven list).
    await page.getByTestId('test-mode-synthetic-generate-walkthrough').click({ timeout: 15_000 });

    // Real surface → gated endpoint → re-keyed persisted log → read path.
    await page.waitForURL(/\/t\/sessions\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    await expect(
      page.getByTestId('test-mode-scrubber'),
      'the generated walkthrough session loads its persisted log into the scrubber surface',
    ).toBeVisible({ timeout: 15_000 });

    // The walkthrough is the rich canonical fixture re-keyed into a fresh
    // session: it persists a deep log, so the scrubber head sits well beyond
    // the bootstrap range — a high head position proves the full re-keyed
    // log reached the real read path end-to-end.
    const head = await page
      .getByTestId('test-mode-scrubber-status')
      .getAttribute('data-head', { timeout: 15_000 });
    expect(Number(head)).toBeGreaterThan(200);
  });
});
