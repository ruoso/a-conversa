// End-to-end spec for the test-mode per-event timeline scrubber.
//
// Refinement: tasks/refinements/replay_test/test_mode_timeline_scrubber.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0026-micro-frontend-root-app.md
//              docs/adr/0039-graph-view-package-boundary.md
//              docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
//              docs/adr/0043-client-side-replay-position-navigation-in-shell.md
// TaskJuggler: replay_test.test_mode.test_mode_timeline_scrubber
//
// **What this spec pins (Decision §6).** The whole live scrubber chain on a
// real backend: generate the **walkthrough** synthetic session (which
// deterministically yields a deep multi-event log AND a `snapshot-created`
// event at `log_position 265`), navigate to its `/t/sessions/:id`, and:
//
//   (a) the scrubber surface renders (controls + graph); stepping next/prev
//       and dragging the range move the position-status readout and the
//       graph re-renders;
//   (b) prev is disabled at position 0 and next is disabled at the head —
//       the boundary affordances backed by the `replay-position` contract;
//   (c) **inherited snapshot-jump debt (paid here):** the mounted snapshot
//       list renders the walkthrough's snapshot row; clicking it navigates
//       the scrubber to the snapshot's `logPosition` (265). This satisfies
//       the list-render → click row → jump-to-position spec forwarded from
//       `snapshot_list_ui.md` §4 / `snapshot_jump_ui.md` §4 to this leaf.
//
// One spec, en-US only, real backend + real surface, no moderator-gesture
// walkthrough — the synthetic generator supplies the deep log + snapshot
// deterministically.
//
// **Gating.** The synthetic generator only registers when
// `NODE_ENV !== 'production'`; `make up` (which `make test:e2e:compose` and
// CI's `e2e-playwright` job both use) runs the app under
// `NODE_ENV=development`, so the gated endpoint is live here.
//
// **Auth.** The `chromium-test-mode-scrubber` project depends on the shared
// `setup-auth` project, so the context already carries the
// `aconversa-session` cookie before the first navigation.

import { expect, test } from './fixtures/no-scrollbars';

// The walkthrough fixture's snapshot lands at this log position (Segment 1
// close — `position_navigation.md:42`).
const SNAPSHOT_LOG_POSITION = 265;

test.describe('Test-mode timeline scrubber — /t/sessions/:id scrubs the walkthrough log', () => {
  test('steps, drags, honours the boundaries, and jumps to a snapshot position', async ({
    page,
  }) => {
    await page.goto('/t/');

    await expect(
      page.getByTestId('test-mode-synthetic-gallery'),
      'the surface root renders the synthetic-session gallery',
    ).toBeVisible({ timeout: 15_000 });

    // Generate the walkthrough scenario — the deterministic deep-log +
    // snapshot fixture.
    await page.getByTestId('test-mode-synthetic-generate-walkthrough').click({ timeout: 15_000 });
    await page.waitForURL(/\/t\/sessions\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // The scrubber surface mounts over the loaded log.
    const scrubber = page.getByTestId('test-mode-scrubber');
    await expect(scrubber, 'the ready state mounts the scrubber surface').toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('test-mode-scrubber-graph')).toBeVisible();

    const status = page.getByTestId('test-mode-scrubber-status');
    const prev = page.getByTestId('test-mode-scrubber-prev');
    const next = page.getByTestId('test-mode-scrubber-next');

    // (d) The event inspector mounts as a sibling section reading the same
    // lifted position (test_mode_event_inspector §4).
    const inspector = page.getByTestId('test-mode-inspector');
    const inspectorSeq = page.getByTestId('test-mode-inspector-sequence');
    const inspectorKind = page.getByTestId('test-mode-inspector-kind');
    await expect(inspector, 'the inspector section renders beside the scrubber').toBeVisible();

    // (e) The changed-highlights panel mounts as the fourth sibling reading
    // the same lifted position (test_mode_changed_highlights §1).
    const changes = page.getByTestId('test-mode-changes');
    await expect(changes, 'the changes panel renders beside the scrubber').toBeVisible();

    // (f) The diagnostic inspector mounts as a sibling section reading the
    // same lifted position (test_mode_diagnostic_inspector §4). Unlike the
    // pure-client inspector/changes panels, it fetches a backend endpoint
    // (`GET /sessions/:id/diagnostics?position=N` — ADR 0044) for the position.
    // With that route now live, the panel renders the *real* diagnostics for
    // the projected state at this stop: at the head the walkthrough's
    // deterministic E15 finding — a `contradicts` edge from a node to a
    // cross-anchor annotation (sequence 264, included by log position 265 <
    // head) — surfaces as a `non-self-referential-annotation-contradicts`
    // coherency-hint under the *advisory* severity group. The contradiction
    // detector deliberately skips annotation endpoints, so the coherency-hint
    // detector raises the advisory instead
    // (test_mode_diagnostic_inspector_e2e_tracking Decision §1). The fixture's
    // entity ids are rekeyed per generation, so the entry is asserted
    // structurally — severity group + `data-kind` discriminant + non-empty ids
    // text — never on a hardcoded UUID (Decision §2).
    const diagnostics = page.getByTestId('test-mode-diagnostics');
    await expect(diagnostics, 'the diagnostics panel renders beside the scrubber').toBeVisible();
    await expect(
      page.getByTestId('test-mode-diagnostics-loading'),
      'the diagnostics fetch settles to a terminal state rather than hanging',
    ).toHaveCount(0, { timeout: 15_000 });

    // At the head the advisory group renders E15's coherency-hint.
    const advisory = page.getByTestId('test-mode-diagnostics-advisory');
    await expect(advisory, 'the advisory severity group renders at the head position').toBeVisible({
      timeout: 15_000,
    });
    const coherencyEntry = advisory.locator(
      '[data-testid="test-mode-diagnostics-entry"][data-kind="coherency-hint"]',
    );
    await expect(
      coherencyEntry,
      "E15's cross-anchor contradicts edge surfaces as a coherency-hint advisory",
    ).toBeVisible();
    expect(
      (
        (await coherencyEntry.getByTestId('test-mode-diagnostics-entry-ids').textContent()) ?? ''
      ).trim(),
      'the coherency-hint entry renders its affected ids verbatim',
    ).not.toBe('');
    // The live route means the panel renders the real result — never its error
    // readout, the unknown-kind fallback, or the empty state at the head.
    await expect(page.getByTestId('test-mode-diagnostics-fallback')).toHaveCount(0);
    await expect(page.getByTestId('test-mode-diagnostics-error')).toHaveCount(0);
    await expect(page.getByTestId('test-mode-diagnostics-empty')).toHaveCount(0);

    // (b) The surface opens at the head: next is disabled, prev is enabled.
    const head = Number(await status.getAttribute('data-head'));
    expect(head, 'the walkthrough head sequence is a deep, non-baseline position').toBeGreaterThan(
      200,
    );
    await expect(status).toHaveAttribute('data-position', String(head));
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();

    // (d) At the head the inspector shows the head event: its sequence tracks
    // the position and its raw `kind` discriminant renders.
    await expect(inspectorSeq).toHaveText(String(head));
    await expect(page.getByTestId('test-mode-inspector-payload')).toBeVisible();
    const headKind = (await inspectorKind.textContent())?.trim() ?? '';
    expect(headKind, 'the head event renders a non-empty kind discriminant').not.toBe('');

    // (a) Stepping prev moves the position-status readout back by one.
    await prev.click();
    await expect(status).toHaveAttribute('data-position', String(head - 1));
    await expect(next).toBeEnabled();

    // (d) The inspector tracks the step: it now shows the previous event.
    await expect(inspectorSeq).toHaveText(String(head - 1));

    // Stepping next returns to the head, re-disabling next.
    await next.click();
    await expect(status).toHaveAttribute('data-position', String(head));
    await expect(next).toBeDisabled();

    const range = page.getByTestId('test-mode-scrubber-range');

    // (e) Stepping the position re-renders the changes panel; the change it
    // reports for a step is consistent with the event the inspector shows at
    // that step. Scan the early log for a node-created event (a debate graph
    // always has them): at that stop the inspector kind is `node-created` and
    // the changes panel lists exactly that node id under "nodes added".
    const nodesAdded = page.getByTestId('test-mode-changes-nodes-added');
    let createdNodeId: string | null = null;
    for (let position = 1; position <= 60 && createdNodeId === null; position += 1) {
      await range.fill(String(position));
      await expect(status).toHaveAttribute('data-position', String(position));
      const kind = (await inspectorKind.textContent())?.trim() ?? '';
      if (kind !== 'node-created') {
        continue;
      }
      const payloadText =
        (await page.getByTestId('test-mode-inspector-payload').textContent()) ?? '{}';
      const payload = JSON.parse(payloadText) as { node_id?: string };
      createdNodeId = payload.node_id ?? null;
      await expect(
        nodesAdded,
        'the node-created step lists its node under "nodes added"',
      ).toBeVisible();
      await expect(nodesAdded).toContainText(createdNodeId ?? '');
    }
    expect(createdNodeId, 'the walkthrough log contains a node-created step').not.toBeNull();

    // (a) Dragging the range to the baseline disables prev (boundary), and
    // (b) prev is disabled at position 0.
    await range.fill('0');
    await expect(status).toHaveAttribute('data-position', '0');
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // (d) At the baseline stop the inspector shows its baseline readout (no
    // event has sequence 0) and no envelope fields (§3).
    await expect(page.getByTestId('test-mode-inspector-baseline')).toBeVisible();
    await expect(inspectorSeq).toHaveCount(0);

    // (e) At the baseline the changes panel shows its own baseline branch and
    // no change buckets render (test_mode_changed_highlights §5).
    await expect(page.getByTestId('test-mode-changes-baseline')).toBeVisible();
    await expect(nodesAdded).toHaveCount(0);
    await expect(page.getByTestId('test-mode-changes-nodes-changed')).toHaveCount(0);

    // (f) At the empty baseline the live endpoint returns `{ diagnostics: [] }`
    // and the panel settles to its clean empty state — never an error. The
    // head→0 transition (advisory entry present at head → empty here), driven
    // only by moving the scrubber position, is the "tracks position" guarantee
    // (test_mode_diagnostic_inspector_e2e_tracking Acceptance §3).
    await expect(
      page.getByTestId('test-mode-diagnostics-empty'),
      'the diagnostics panel settles to its clean empty state at position 0',
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('test-mode-diagnostics-error')).toHaveCount(0);

    // (c) Inherited snapshot-jump debt: the snapshot list renders the
    // walkthrough's snapshot row; clicking it jumps the scrubber to the
    // snapshot's logPosition (265).
    const snapshotRow = page
      .getByTestId('test-mode-scrubber-snapshots')
      .locator(`[data-log-position="${SNAPSHOT_LOG_POSITION}"]`);
    await expect(snapshotRow, 'the walkthrough snapshot row renders').toBeVisible({
      timeout: 15_000,
    });
    await snapshotRow.click();
    await expect(
      status,
      'clicking the snapshot row jumps the scrubber to the snapshot logPosition',
    ).toHaveAttribute('data-position', String(SNAPSHOT_LOG_POSITION));
  });
});
