# Pre-debate lobby — gate the moderator's "Enter session" on both debaters joined

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_session_setup.mod_session_lobby`
**Effort estimate**: 1d
**Inherited dependencies**:

- `moderator_ui.mod_session_setup.mod_invite_participants` — settled (commit `8e7e3f1`). Landed `/sessions/:id/invite` at `apps/moderator/src/routes/InviteParticipants.tsx`, the per-debater shareable links, the WS-store-driven slot occupant reducer (`deriveSlotOccupants` at lines 97-126), the always-enabled `invite-enter-session` button (lines 456-466), and the catch-up replay seam via `client.trackSession(sessionId)` (lines 167-173). The post-create form already navigates here on 201 (per `apps/moderator/src/routes/CreateSession.tsx:141`). **This task amends the same component in place** to gate the Enter button + surface a richer ready-state UI; no new route, no new component.
- `moderator_ui.mod_session_setup.mod_create_session_form` — settled. Post-201 destination of `/sessions/:id/invite` is the only entry point; this task does not touch `CreateSession.tsx`.
- `data_and_methodology.event_types.session_lifecycle_events` — settled. `participant-joined` / `participant-left` Zod schemas + the discriminated `EventPayload` union live in `packages/shared-types/src/events.ts`; the slot reducer in `InviteParticipants.tsx` already consumes them.
- `moderator_ui.mod_shell.mod_app_skeleton` / `mod_route_auth_gate` — settled (the `<RequireAuth mode="authenticated-only">` wrapper around the invite route is reused unchanged).

## What this task is

The third (and last open) leaf under `mod_session_setup`. Closing it derives-completes the subgroup.

The predecessor (`mod_invite_participants`, commit `8e7e3f1`) already lands the surface that conceptually IS the lobby: three slot rows, a WS-driven real-time fill of the debater slots, a moderator pre-fill, and an "Enter session" button. The remaining gap is small and focused:

1. **Gate the "Enter session" button** so it is disabled until **both** debater slots are filled (currently always enabled per `InviteParticipants.tsx:456-466`).
2. **Surface a per-slot ready/pending indicator** on each debater slot (the current view renders an empty-state caption "Awaiting Debater A" but no explicit ready badge once the slot fills — the screen name appears but there is no semantic "ready" affordance).
3. **Surface a "both debaters joined" confirmation** once the second debater arrives, so the moderator sees an unambiguous "ready to start" signal before they click Enter.
4. **Localized tooltip on the disabled Enter button** ("Awaiting Debater A", "Awaiting Debater B", "Awaiting both debaters") so the moderator understands why the button is gated.

**Scope decision: Possibility C** (see Decisions §1). The predecessor's implementer effectively conflated invite and lobby into a single surface at `/sessions/:id/invite`. This task accepts that and enriches the same surface in place — no new route, no separate lobby component, no parallel slot UI. The existing `apps/moderator/src/routes/Lobby.tsx` placeholder route stays mounted at `/sessions/:id/lobby` (other tests reference its testid; retiring it expands scope beyond 1d) but is **not** the lobby this task delivers; that placeholder is left for a separate WBS cleanup task to retire.

The deliverable is **edits to one existing component** (`apps/moderator/src/routes/InviteParticipants.tsx`), corresponding **new Vitest cases** appended to `InviteParticipants.test.tsx`, the **new i18n keys** under `moderator.invite.lobby.*` (extending the predecessor's `moderator.invite.*` namespace), and **two new Playwright scenarios** appended to the existing `tests/e2e/invite-participants-flow.spec.ts` that exercise the gate + ready-state via the `window.__aConversaWsStore` test seam.

**Out of scope** (registered as follow-ups where applicable, or left for a later task):

- A separate `/sessions/:id/lobby` route or component. The `/lobby` placeholder stays as-is; if a future iteration wants to retire it (e.g. redirect to `/invite`), that lands under a separate WBS cleanup leaf.
- A "Cancel session" affordance for the moderator. No `end_session_endpoint` is exposed on the moderator UI today; the closest backend surface (`backend.session_management.end_session_endpoint`) is complete-100 but no moderator-UI WBS task is mentioned that calls it. Deferred per Decisions §6.
- A "soft" override of the gate (e.g. "Both debaters haven't joined — proceed anyway?" prompt). Strict gate for v1 per Decisions §2.
- Backend changes. The slot fill already works end-to-end via the WS `participant-joined` / `participant-left` event stream; this task adds zero new HTTP / WS call sites.
- The participant-side self-claim path (the debater opens the invite link, claims a slot). Registered by `mod_invite_participants` as `backend.session_management.session_invite_self_claim_endpoint` + a future participant-UI route — still pending, still out of scope here.

## Why it needs to be done

Three reasons:

- **The product invariant.** DESIGN.md §"Format" specifies real-time debate with two debaters + one moderator, and "all participants — both debaters and the moderator — must agree on every change to the graph before it lands." A moderator who enters the operate canvas before both debaters have joined will start capturing/proposing into a session with no possible quorum for commits, producing a methodologically broken state. The gate enforces the social precondition the rest of the methodology assumes.
- **The remaining gap from `mod_invite_participants`.** The predecessor's `Decisions §3` deliberately left "Enter session" always-enabled, citing dry-run / sanity-check use cases. That call was correct for the invite step in isolation, but the `mod_session_lobby` leaf's whole point is "Pre-debate lobby until all participants joined" (per the WBS one-liner in `tasks/30-moderator-ui.tji:550`). Adding the gate here resolves the WBS leaf without contradicting the predecessor (the predecessor's rationale "the invite view's job is to facilitate invitations, not to gate session entry" applies — this task makes the SAME surface ALSO do the gate, deliberately conflating the two roles per Decision §1).
- **Subgroup closure.** This is the last open leaf of `mod_session_setup`. Closing it derives-completes the subgroup, which in turn unblocks the downstream `mod_capture_flow` / `mod_decompose_flow` / `mod_diagnostic_flow` chain at the WBS level.

## Inputs / context

### Predecessor's "Enter session" button (the gate point)

From [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) lines 455-467:

```tsx
<div className="mt-6 flex flex-col gap-2">
  <button
    type="button"
    data-testid="invite-enter-session"
    onClick={handleEnterSession}
    className="rounded bg-blue-600 px-4 py-2 text-white"
  >
    {t('moderator.invite.enterSession.label')}
  </button>
  <p data-testid="invite-enter-session-hint" className="text-sm text-gray-600">
    {t('moderator.invite.enterSession.hint')}
  </p>
</div>
```

This task adds a `disabled={!bothDebatersPresent}` attribute, a `title` / `aria-describedby` wiring to the awaiting-tooltip, and replaces the static hint text with a dynamic state-driven hint (see Constraints below).

### Existing slot reducer (the source of truth for the gate)

From [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) lines 97-126 — `deriveSlotOccupants(events)` returns:

```ts
{
  moderator: string | undefined;     // host's screen name when known
  'debater-A': string | undefined;
  'debater-B': string | undefined;
}
```

The gate test is `occupants['debater-A'] !== undefined && occupants['debater-B'] !== undefined`. No new derivation needed; the existing reducer's output is sufficient. The reducer already handles `participant-left` (clears the slot if the leaver matches the current occupant, lines 113-118), so the gate correctly re-disables the Enter button if a debater leaves before the moderator clicked it.

### Existing slot rendering (where the ready/pending indicator lands)

From [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) lines 367-451 — each slot renders inside `<section data-testid="invite-slot" data-role="<role>">`, with an `<h2>` role label, a conditional occupant `<p data-testid="invite-slot-occupant">`, a conditional empty-state `<p data-testid="invite-slot-empty">`, and (for debater slots) the copy-link affordance.

This task adds a new ready-state badge inside each debater slot section — `<span data-testid="invite-slot-ready" data-role="<role>" data-ready="<true|false>">{t('moderator.invite.lobby.ready.<state>')}</span>` — rendered alongside the existing occupant / empty-state elements. The badge is always visible for debater slots (states: `ready` when occupant present, `pending` otherwise); the moderator slot does not render a ready badge (the moderator IS the operator, not a participant whose presence the gate checks).

### Existing test seam — `window.__aConversaWsStore` for Playwright

From [`apps/moderator/src/main.tsx:47`](../../../apps/moderator/src/main.tsx) — dev-only assignment exposes the Zustand store on the page. From [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) lines 97-169 — the existing `seedWsStore(page, { sessionId, nodes, edges })` helper provides the seeding pattern but only handles `node-created` / `edge-created` kinds.

This task extends the helper (or adds a sibling helper in the same file) to seed `participant-joined` / `participant-left` events. The seed helper's `getState().applyEvent(event)` call signature is the same; only the payload shape changes (per `packages/shared-types/src/events.ts`). The Playwright scenario uses the helper to simulate debaters joining without spinning up the participant-self-claim backend (which doesn't exist yet — registered as a follow-up by `mod_invite_participants`).

### Existing Playwright spec — `tests/e2e/invite-participants-flow.spec.ts`

The existing spec at [`tests/e2e/invite-participants-flow.spec.ts`](../../../tests/e2e/invite-participants-flow.spec.ts) has 2 scenarios (happy path + URL shape). This task **appends** 2 new scenarios in the same `test.describe(...)` block (Constraints → "Playwright" below); no separate spec file. The existing scenarios assume the Enter button is enabled even with zero debaters; those assertions stay valid because the new gate disables ONLY when zero or one debater is present and the existing scenarios click the button without first checking its `disabled` state — Playwright's `.click()` waits for actionable, which a disabled button is not. **The existing happy-path scenario MUST be amended** to seed both debaters before the Enter-session click (per Decisions §2, the strict gate breaks the existing test's "click without joining" path). The existing URL-shape scenario does not click Enter, so it stays unchanged.

### Existing Vitest cases on the predecessor

From [`apps/moderator/src/routes/InviteParticipants.test.tsx`](../../../apps/moderator/src/routes/InviteParticipants.test.tsx) — case 15 in the predecessor's refinement (`mod_invite_participants.md` line 270): "Enter-session button is always enabled — render with zero `participant-joined` events; assert the button is NOT disabled. Render with both debater slots filled; assert the button is NOT disabled (the rule is "always enabled regardless of slot state")."

This task **inverts** that assertion: with zero / one debater present, the button IS disabled; with both present, the button is NOT disabled. The existing test case is amended in lockstep — same case, new assertion shape. No deletion; the test continues to pin the gate behavior, just with the new rule.

### i18n catalog precedent — extending the existing `moderator.invite.*` namespace

From [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) lines 137-175 — the predecessor's `moderator.invite.*` namespace currently holds 19 keys (per `mod_invite_participants.md` Status §; the 19th is `copyLink.inputAriaLabel` added during implementation). This task extends the namespace with a sub-namespace `moderator.invite.lobby.*` for the new gate + ready-state strings. Justified under Decisions §7.

The pt-BR + es-419 drafts land flagged PENDING in the existing `pt-BR.review.json` / `es-419.review.json` trackers under `pending`. A native-speaker review follow-up task is registered alongside this task per the tech-debt registration policy (ORCHESTRATOR.md `b7c5ff0`) and per the predecessor's pattern (`tasks/35-frontend-i18n.tji:166-172`).

### ADR pin

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): every empirical verification of the new behavior is a committed test. The new Vitest cases + the new Playwright scenarios ARE the probes for the gate, the ready-state badges, the "both ready" banner, and the disabled-button tooltip. No throwaway `console.log`; no manual smoke that doesn't land as a committed regression.

## Constraints / requirements

### Route + wiring

- **No new route.** This task amends `/sessions/:id/invite` in place. The `<RequireAuth mode="authenticated-only">` wrapper, the `WsClientProvider` mount, and the `useParams<{ id: string }>()` read all stay as the predecessor left them.
- **No change to `apps/moderator/src/App.tsx`.** The route table is untouched; the existing `/sessions/:id/lobby` placeholder route stays mounted (out of scope to retire; see "Out of scope" above).
- **No change to `apps/moderator/src/routes/CreateSession.tsx`.** The post-201 navigation target remains `/sessions/:id/invite`.

### Component changes (`apps/moderator/src/routes/InviteParticipants.tsx`)

#### Gate state derivation

Add a derived boolean immediately after the existing `occupants` `useMemo` (line 234):

```ts
const bothDebatersPresent = useMemo(
  () => occupants['debater-A'] !== undefined && occupants['debater-B'] !== undefined,
  [occupants],
);
```

A small `gateReason` derivation surfaces which slots are missing so the tooltip / hint can localize accordingly:

```ts
type GateReason = 'ready' | 'awaiting-A' | 'awaiting-B' | 'awaiting-both';
const gateReason = useMemo<GateReason>(() => {
  const aPresent = occupants['debater-A'] !== undefined;
  const bPresent = occupants['debater-B'] !== undefined;
  if (aPresent && bPresent) return 'ready';
  if (!aPresent && !bPresent) return 'awaiting-both';
  if (!aPresent) return 'awaiting-A';
  return 'awaiting-B';
}, [occupants]);
```

#### Per-slot ready-state badge (debater slots only)

Inside the slot rendering loop (after line 387, where the occupant `<p>` renders), add for each debater slot:

```tsx
{role !== 'moderator' && (
  <span
    data-testid="invite-slot-ready"
    data-role={role}
    data-ready={isFilled ? 'true' : 'false'}
    className={isFilled ? 'text-green-700' : 'text-gray-500'}
  >
    {t(isFilled
      ? 'moderator.invite.lobby.ready.present'
      : 'moderator.invite.lobby.ready.pending')}
  </span>
)}
```

Always rendered for the two debater slots; the moderator slot does not get a badge (the moderator is the operator, not a participant whose presence the gate is checking).

#### "Both ready" banner

Above the Enter-session block (before line 455), conditionally render a banner when `gateReason === 'ready'`:

```tsx
{gateReason === 'ready' && (
  <p
    data-testid="invite-both-ready-banner"
    role="status"
    aria-live="polite"
    className="mt-4 rounded bg-green-50 border border-green-200 px-3 py-2 text-green-800"
  >
    {t('moderator.invite.lobby.bothReady.banner')}
  </p>
)}
```

`role="status"` + `aria-live="polite"` so screen readers announce the readiness without interrupting the moderator. The banner does NOT auto-dismiss; it stays visible until the moderator clicks Enter (or a debater leaves and the banner unmounts).

#### Gated Enter-session button

Replace the existing button block (lines 456-466) with:

```tsx
<button
  type="button"
  data-testid="invite-enter-session"
  onClick={handleEnterSession}
  disabled={!bothDebatersPresent}
  aria-describedby="invite-enter-session-hint"
  title={!bothDebatersPresent ? t(`moderator.invite.lobby.disabledTooltip.${gateReason}`) : undefined}
  className={bothDebatersPresent
    ? 'rounded bg-blue-600 px-4 py-2 text-white'
    : 'rounded bg-gray-300 px-4 py-2 text-gray-600 cursor-not-allowed'}
>
  {t('moderator.invite.enterSession.label')}
</button>
<p id="invite-enter-session-hint" data-testid="invite-enter-session-hint" className="text-sm text-gray-600">
  {t(`moderator.invite.lobby.enterHint.${gateReason}`)}
</p>
```

Notes:
- The button retains its existing `data-testid="invite-enter-session"`; the predecessor's e2e + unit cases that locate by this testid still work.
- The existing `moderator.invite.enterSession.label` key is reused unchanged for the button text.
- The existing `moderator.invite.enterSession.hint` key (set on the predecessor's static hint paragraph) is **superseded** by the new state-driven `moderator.invite.lobby.enterHint.<reason>` keys; the old key is retired from the catalogs as part of this task's i18n delta. Justified under Decisions §7.
- `aria-describedby` points the screen reader at the hint paragraph (which now describes WHY the button is disabled when it is); the `title` adds a hover tooltip for sighted users on disabled state.

### State

- No new `useState`. The gate + ready derivations are pure `useMemo` over the existing `occupants` map.
- No new effects. The existing WS-store subscription on `state.sessionState[sessionId]?.events` already drives re-renders on every `participant-joined` / `participant-left` arrival; the new derivations recompute as a side effect.

### i18n catalog keys

New keys under `moderator.invite.lobby.*` (a new sub-namespace inside the existing `moderator.invite.*`). One existing key (`moderator.invite.enterSession.hint`) is **retired** because its static text is replaced by state-driven hints.

| Key | en-US | pt-BR (draft, PENDING) | es-419 (draft, PENDING) |
| --- | --- | --- | --- |
| `moderator.invite.lobby.ready.present` | "Ready" | "Pronto(a)" | "Listo(a)" |
| `moderator.invite.lobby.ready.pending` | "Not yet joined" | "Ainda não entrou" | "Aún no se ha unido" |
| `moderator.invite.lobby.bothReady.banner` | "Both debaters joined! Ready to start." | "Ambos os debatedores entraram! Pronto para começar." | "¡Ambos debatientes se han unido! Listo para comenzar." |
| `moderator.invite.lobby.disabledTooltip.awaiting-A` | "Awaiting Debater A" | "Aguardando Debatedor(a) A" | "Esperando a Debatiente A" |
| `moderator.invite.lobby.disabledTooltip.awaiting-B` | "Awaiting Debater B" | "Aguardando Debatedor(a) B" | "Esperando a Debatiente B" |
| `moderator.invite.lobby.disabledTooltip.awaiting-both` | "Awaiting both debaters" | "Aguardando ambos os debatedores" | "Esperando a ambos debatientes" |
| `moderator.invite.lobby.enterHint.ready` | "Click to enter the session." | "Clique para entrar na sessão." | "Haz clic para entrar a la sesión." |
| `moderator.invite.lobby.enterHint.awaiting-A` | "Waiting for Debater A to join before you can enter." | "Aguardando Debatedor(a) A entrar antes de você poder entrar." | "Esperando a que Debatiente A se una antes de poder entrar." |
| `moderator.invite.lobby.enterHint.awaiting-B` | "Waiting for Debater B to join before you can enter." | "Aguardando Debatedor(a) B entrar antes de você poder entrar." | "Esperando a que Debatiente B se una antes de poder entrar." |
| `moderator.invite.lobby.enterHint.awaiting-both` | "Waiting for both debaters to join before you can enter." | "Aguardando ambos os debatedores entrarem antes de você poder entrar." | "Esperando a que ambos debatientes se unan antes de poder entrar." |

**Count: 10 new keys × 3 locales = 30 catalog entries. Plus 1 retired key × 3 locales = 3 catalog removals.** Net delta: +9 keys per locale.

The 10 en-US keys + 10 pt-BR drafts + 10 es-419 drafts land together; pt-BR + es-419 are added to their respective `*.review.json` files under `pending` with the dotted key names. The retired key (`moderator.invite.enterSession.hint`) is removed from all three catalogs AND from the predecessor's `pending` entries in both review files (the predecessor's native-review follow-up `i18n_invite_participants_native_review` has not yet shipped per the WBS state — the key list it covers shrinks by 1, which is a benign drift on a still-pending review and does not require an amendment to that follow-up's `note`).

### Files this task touches (the explicit allowlist)

- `apps/moderator/src/routes/InviteParticipants.tsx` (modified — add gate derivation, per-slot ready badge, "both ready" banner, gated Enter button + state-driven hint).
- `apps/moderator/src/routes/InviteParticipants.test.tsx` (modified — amend the existing always-enabled case to assert the strict gate; add new cases for ready badges, banner, disabled tooltip, state-driven hint).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add 10 `moderator.invite.lobby.*` keys; remove `moderator.invite.enterSession.hint`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified — add 10 dotted keys to `pending`; remove `moderator.invite.enterSession.hint` from `pending` if present).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified — same).
- `tests/e2e/invite-participants-flow.spec.ts` (modified — amend existing happy-path to seed both debaters before Enter click; append 2 new scenarios for gate + banner).
- `tests/e2e/fixtures/wsStoreSeed.ts` (modified — extend the seed helper with `participant-joined` / `participant-left` support, OR add a sibling `seedParticipants` helper; choice per Decision §5).
- `tasks/35-frontend-i18n.tji` (modified — register the native-speaker review follow-up task `i18n_session_lobby_native_review`).

### Files this task does NOT touch

- `.tji` files OTHER than `tasks/35-frontend-i18n.tji` — the WBS `complete 100` marker for `mod_session_lobby` lands at task-completion time, not at refinement-write time.
- `docs/adr/` — no new ADR needed (see Decisions §10).
- `apps/server/**` — backend is unchanged; the slot fill already works via the existing WS event stream.
- `apps/moderator/src/App.tsx` / `apps/moderator/src/routes/CreateSession.tsx` / `apps/moderator/src/routes/Lobby.tsx` — the route table, the create-session form, and the `/lobby` placeholder route all stay as-is.
- `apps/moderator/src/ws/client.ts` / `apps/moderator/src/ws/wsStore.ts` — the WS infrastructure is reused as-is; no protocol changes.
- Any other existing route component — this is a pure in-place enrichment of one component.

### a11y requirements (the testable list)

- The per-slot `<span data-testid="invite-slot-ready">` is a plain text element (no `aria-live` — the slot's section is the read-on-fill landmark; the `<h2>` heading + the new occupant text both re-render together when a `participant-joined` event arrives, and screen readers picking up the section change cover the badge in the same announcement).
- The `<p data-testid="invite-both-ready-banner">` has `role="status"` + `aria-live="polite"` — same dual-mechanism the predecessor uses for the "Copied!" confirmation; screen readers announce "Both debaters joined!" without interrupting the moderator.
- The Enter-session button:
  - Disabled state uses the native HTML `disabled` attribute (not `aria-disabled` alone) so keyboard focus skips it correctly and screen readers announce "Enter session, dimmed" or equivalent.
  - The `title` attribute carries the awaiting-tooltip for sighted users on hover.
  - `aria-describedby="invite-enter-session-hint"` ties the button to the hint paragraph, so screen readers reading the button hear the hint text immediately after the button's name. This works for both enabled (`"Click to enter the session."`) and disabled (`"Waiting for Debater A..."`) states — the same wiring serves both.
- The hint paragraph retains its `data-testid="invite-enter-session-hint"` and gains an `id="invite-enter-session-hint"` to be the `aria-describedby` target.
- The gated button's color (gray on disabled vs. blue on enabled) is a visual cue; the disabled state, the tooltip, the hint text, and the per-slot ready badges together cover non-color cues for the gate's status.

### Test layers per ADR 0022

#### Vitest (in `apps/moderator/src/routes/InviteParticipants.test.tsx` — append + amend)

Amended cases (existing cases that change):

- **Case 15** (predecessor's "Enter-session button is always enabled") → renamed and re-asserted as **"Enter-session button is disabled until both debaters joined"**. Render with zero `participant-joined` events; assert the button HAS `disabled` attribute. Seed only debater-A; assert the button STILL has `disabled`. Seed only debater-B; assert the button STILL has `disabled`. Seed both; assert the button does NOT have `disabled`.

New cases (appended):

1. **Per-slot ready badge — pending state** — render with zero `participant-joined` events; assert `invite-slot-ready[data-role="debater-A"]` has `data-ready="false"` and shows the `moderator.invite.lobby.ready.pending` text. Same for `debater-B`.
2. **Per-slot ready badge — present state** — seed `participant-joined` for debater-A; assert `invite-slot-ready[data-role="debater-A"]` has `data-ready="true"` and shows the `moderator.invite.lobby.ready.present` text. The debater-B badge still shows `pending`.
3. **Moderator slot has no ready badge** — render with the moderator's `participant-joined` event seeded; assert `screen.queryByTestId('invite-slot-ready')` filtered by `[data-role="moderator"]` returns null.
4. **"Both ready" banner appears when both debaters present** — seed `participant-joined` for both debaters; assert `invite-both-ready-banner` is in the DOM with the `moderator.invite.lobby.bothReady.banner` text. Render with only one debater present; assert the banner is NOT in the DOM.
5. **"Both ready" banner disappears when a debater leaves** — seed both debaters, then seed `participant-left` for debater-A; assert the banner is no longer in the DOM (`waitFor` since the WS-store re-render is async).
6. **Disabled tooltip — awaiting-both** — render with zero debater events; assert the button's `title` attribute equals the `moderator.invite.lobby.disabledTooltip.awaiting-both` text.
7. **Disabled tooltip — awaiting-A** — seed only debater-B; assert the `title` equals the `disabledTooltip.awaiting-A` text.
8. **Disabled tooltip — awaiting-B** — seed only debater-A; assert the `title` equals the `disabledTooltip.awaiting-B` text.
9. **State-driven hint — ready** — seed both debaters; assert `invite-enter-session-hint` shows the `enterHint.ready` text.
10. **State-driven hint — awaiting-both** — render with zero debater events; assert the hint shows the `enterHint.awaiting-both` text.
11. **Gate re-disables when a debater leaves after both joined** — seed both, assert button is enabled; seed `participant-left` for debater-A; `waitFor` and assert the button is disabled again, the banner is gone, and the awaiting-A tooltip is back.
12. **Enter click is a no-op when the button is disabled** — render with zero debater events; click the button (programmatic `fireEvent.click` — the native `disabled` attribute should prevent the handler from firing); assert `navigateSpy` was NOT called.
13. **a11y: `aria-describedby` on the button points at the hint paragraph** — assert the button has `aria-describedby="invite-enter-session-hint"` and the matching `<p>` has `id="invite-enter-session-hint"`.
14. **a11y: banner uses `role="status"` + `aria-live="polite"`** — seed both debaters; assert the banner's attributes.
15. **i18n: every new key resolves in en-US** — render with both debaters seeded, then with zero debaters; walk every new testid (`invite-slot-ready`, `invite-both-ready-banner`, `invite-enter-session-hint`, and the button's `title`); assert no `[t-missing]` or raw key string is visible.

**Minimum 15 new cases + 1 amended case in `InviteParticipants.test.tsx`.** Lower bound is "every requirement bullet has a probe."

#### Playwright (amend + append in `tests/e2e/invite-participants-flow.spec.ts`)

**Amended scenario** (existing happy path):

The existing happy-path scenario clicks `invite-enter-session` before any debater has joined. With the new strict gate, that click is now blocked. Amend the scenario to:

1. Land on the invite view (unchanged).
2. Assert `invite-enter-session` button is `disabled` and the disabled-tooltip is `"Awaiting both debaters"`.
3. Use the WS store-push test seam (`window.__aConversaWsStore`) via the extended `seedParticipants` helper to apply `participant-joined` events for both `debater-A` and `debater-B`.
4. Assert `invite-slot-ready[data-role="debater-A"]` and `[data-role="debater-B"]` both have `data-ready="true"`.
5. Assert `invite-both-ready-banner` is visible.
6. Assert `invite-enter-session` is no longer `disabled`.
7. Click it; assert navigation to `/sessions/<id>/operate` (the existing assertion stays unchanged).

**New scenarios** (appended):

1. **Strict-gate scenario** — alice creates a session, lands on invite view, asserts the Enter button is disabled, asserts the awaiting-both tooltip via `title` attribute, seeds debater-A only via the WS test seam, asserts the gate is still closed and the tooltip changes to `awaiting-B`, seeds debater-B, asserts the gate opens.
2. **Re-disable on leave scenario** — alice creates a session, seeds both debaters, asserts the gate is open and the banner is visible, seeds `participant-left` for debater-A, asserts the gate closes and the banner disappears.

**Locale matrix**: en-US only by default (per the predecessor's precedent). The cross-locale strings are covered at the catalog parity layer.

**Test seam extension**: extend `tests/e2e/fixtures/wsStoreSeed.ts` with one of:

- A new `seedParticipants(page, { sessionId, participants })` function alongside the existing `seedWsStore` (per Decisions §5 — the chosen path), OR
- Extending `seedWsStore`'s options with a `participants` array (rejected — see Decisions §5).

Both options use the existing `applyEvent` seam; only the call shape differs.

**WBS gate**: the spec MUST run under `make up` + `pnpm run test:e2e` and pass before the task can claim `complete 100`.

### Frontend i18n follow-up task (registered alongside this task)

- **`frontend_i18n.i18n_session_lobby_native_review`** — pt-BR + es-419 native-speaker review of the 10 new keys under `moderator.invite.lobby.*`. Effort: 0.5d. Depends: `!i18n_invite_participants_native_review` (the immediate predecessor in the native-review chain — the `tasks/35-frontend-i18n.tji` block uses a sequential `depends` chain to serialize the per-task reviewer hand-offs; the predecessor sits at line 166-172). Mirrors the existing `i18n_invite_participants_native_review` task shape.

## Acceptance criteria

1. **`pnpm install` clean** — no new dependencies (no new npm packages).
2. **`pnpm run check` (lint + format + typecheck + tools + tests) green** with the modified files in place.
3. **`pnpm run test:smoke` (Vitest) green**. New tests add ≥ 15 new cases + 1 amended case to `InviteParticipants.test.tsx`. The post-`mod_invite_participants` baseline is 3145 (per that refinement's Status block); the new total floors at 3160. The 1 amended case does not change the count.
4. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green after the catalog edits — every `moderator.invite.lobby.*` key in en-US is present in pt-BR and es-419; the retired `moderator.invite.enterSession.hint` is absent from all three catalogs.
5. **`pnpm -F @a-conversa/moderator build`** produces `apps/moderator/dist/index.html` + assets without new bundle warnings beyond the pre-existing chunk-size note.
6. **`pnpm run test:e2e`** under `make up` runs the amended + 2 new scenarios in `tests/e2e/invite-participants-flow.spec.ts` green. The amended happy-path completes (with the gate-then-seed-then-click chain) in < 60s under the default Playwright timeout.
7. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` is added to `mod_session_lobby` (and propagated to the `mod_session_setup` parent if it derives-completes, and to any milestone that depends on the subgroup).
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No regression on the predecessor's e2e**: the URL-shape scenario in `tests/e2e/invite-participants-flow.spec.ts` (the second scenario, which does NOT click Enter) stays unmodified and stays green.

## Decisions

### 1. Scope: Possibility C — enrich the existing `/sessions/:id/invite` view in place

Three possibilities surveyed:

- **(A) The invite view is the pre-share view; the lobby is a separate post-share waiting room** — rejected. Would require splitting one component into two routes that share most of their state (the same WS subscription, the same slot reducer, the same fetch, the same i18n namespace). The split duplicates code without adding meaningful behavior; the user already lands on the invite view post-create and never sees a separate "lobby" state today.
- **(B) The invite view is permanent (always available); the lobby is a separate route shown to participants who arrive before the moderator has entered** — rejected. The participant-side claim view is a separate concern entirely (registered by `mod_invite_participants` as `backend.session_management.session_invite_self_claim_endpoint` + a future participant-UI route). A moderator-facing lobby route doesn't address that gap, and inventing one duplicates the invite view's surface area.
- **(C) The invite view IS the lobby; this task is in-place polish** (chosen). The predecessor's implementer effectively shipped a lobby-shaped view at `/sessions/:id/invite`: slot rows, real-time fill via WS, an "Enter session" button. The only missing piece is the gate + the ready-state UI + the "both ready" confirmation. Adding those to the existing component is a 1d effort that respects the predecessor's architecture and avoids new code duplication. The existing `/sessions/:id/lobby` placeholder route is left in place (other tests reference it; retiring it expands scope beyond 1d) and is documented as out-of-scope for this task.

The conflation between "invite" and "lobby" as a single surface IS the architectural choice. A future refactor could rename the route (e.g. `/sessions/:id/setup` to cover both concerns) or split it into two routes; both are larger changes that don't pay back at this WBS leaf's effort budget.

### 2. Enter-session gate: strict (disabled until both debaters joined)

Three options surveyed:

- **(i) Always enabled** (the predecessor's current behavior) — rejected. The WBS one-liner for this task is "Pre-debate lobby until all participants joined" (`tasks/30-moderator-ui.tji:550`); a no-op gate would not deliver the leaf. The methodology invariant (per DESIGN.md §"Format": "all participants must agree on every change to the graph") requires both debaters to be present for any commit to land, so a moderator entering early is operating in a methodologically broken state.
- **(ii) Disabled until both debaters joined** (chosen). Strict gate; matches the leaf's name and the methodology invariant. The cost — a moderator who wants to dry-run alone cannot — is small: the moderator can always seed both slots via a debater logged in on a second browser tab (or, once the participant-self-claim backend ships, via the actual claim flow). For genuine solo testing, the participant-UI's claim flow + Authelia's seeded dev users (`alice`, `ben`, etc.) cover it.
- **(iii) Always enabled with a warning prompt** (e.g. "Debater A hasn't joined yet — proceed anyway?") — rejected. The warning prompt is an extra step for the (probably common) case where the moderator forgot to share the link and is waiting — but it doesn't actually prevent the broken state, just nags about it. Strict gate is simpler, more honest about the methodology constraint, and easier to undo (if the warning-prompt mode turns out to be needed, it's a small addition; the reverse — going from soft to strict — silently breaks existing UX expectations).

The strict gate is overridable in dev / test contexts via the WS-store seed (the same `__aConversaWsStore` test seam the Playwright spec uses); for real users in real sessions, the gate matches the platform's behavior of "slow down and force clarity."

### 3. Per-slot ready-state badge: always visible on debater slots

Two options surveyed:

- **Always visible (states: `ready` when occupant present, `pending` otherwise)** (chosen). The badge is the moderator's at-a-glance "who's here?" cue; making it always visible avoids the cognitive load of "is the absence of a badge meaningful?" The two states (`ready` / `pending`) map directly to the gate's input.
- **Only visible when the slot is empty** (a "Not yet joined" indicator that disappears on fill, replaced by just the screen name) — rejected. The post-fill state has no visual cue of readiness beyond the screen name itself; the moderator has to scan the Enter button + tooltip to confirm both are present. The always-on badge keeps the per-slot readiness explicit alongside the overall gate state.

The moderator slot does not get a badge: the moderator IS the operator, not a participant whose presence the gate is checking. Adding a "Ready" badge to the moderator slot would be visually redundant ("of course the moderator is here, they're looking at the screen") and noisy.

### 4. "Both ready" banner: visible until the moderator clicks Enter

Two options surveyed:

- **Persistent banner** (chosen). Stays in the DOM as long as both debaters are present and the moderator hasn't navigated away. The banner's `role="status"` + `aria-live="polite"` triggers a one-time screen-reader announcement on first appearance; sighted users see a persistent visual cue until they act. Simple, predictable, no timer logic.
- **Auto-dismissing banner** (e.g. 5s fade) — rejected. A 5s window is too short for a moderator who looked away; longer windows turn into "is this still meaningful or is it old?" ambiguity. The banner's role is "the gate is open NOW" — it should disappear ONLY when the gate's actual state changes (a debater leaves, or the moderator navigates away).

The banner's removal when a debater leaves (`participant-left` event) is handled by the gate's `useMemo` dependencies — when `gateReason` flips from `'ready'` to one of the awaiting states, the banner's conditional render evaluates to false and the element unmounts. The accompanying re-disable of the Enter button + re-appearance of the awaiting tooltip cover the demotion path.

### 5. Playwright WS-store seed: add a `seedParticipants` sibling helper

Two options surveyed:

- **A new sibling `seedParticipants(page, { sessionId, participants })` helper** (chosen). The existing `seedWsStore` is shaped around graph events (`nodes`, `edges`) with a clear API (`SeedNode`, `SeedEdge`). Participant lifecycle events are a different shape (`{ userId, role, screenName }`) and a different concern; folding them into `seedWsStore`'s options would dilute its purpose. A sibling helper keeps each function's scope tight and its types narrow; the underlying `page.evaluate(... applyEvent ...)` plumbing is duplicated (~10 lines) but the duplication is cheap and easier to read than a generic seed-anything helper.
- **Extend `seedWsStore`'s options with a `participants` array** — rejected. Would make `seedWsStore` a swiss-army-knife seed function whose options shape grows linearly with every new event kind. The current narrow shape is easier to maintain and to typecheck.

The new helper lives in the same `tests/e2e/fixtures/wsStoreSeed.ts` file (not a separate file) — the shared infrastructure (the `window.__aConversaWsStore` lookup, the dev-mode probe) is reused, and co-locating keeps the helpers discoverable.

### 6. Cancel session affordance: out of scope

Two options surveyed:

- **Add a "Cancel session" button** that calls `DELETE /api/sessions/:id` (or POSTs an `end_session` event) — rejected. No WBS task today describes a moderator-UI cancellation flow. The closest backend surface (`backend.session_management.end_session_endpoint`) exists and is complete-100, but adding a moderator-UI affordance for it changes the platform's surface area in a structural way (a destructive action with no confirmation flow specified) and is bigger than this task's 1d budget. If a debater no-show is a real product concern, a separate WBS leaf can pick it up later.
- **No cancel affordance for v1** (chosen). The moderator can still navigate away (back button to `/sessions/new`, or close the tab); the session row stays in the DB as a record. The lobby UI's job is to gate entry, not to clean up abandoned sessions. The cleanup story is a separate concern that deserves its own refinement.

### 7. i18n key namespace: `moderator.invite.lobby.*` (sub-namespace inside the predecessor's namespace) + retire `enterSession.hint`

Two options surveyed for the namespace:

- **`moderator.invite.lobby.*`** (chosen). Mirrors the predecessor's `moderator.invite.*` shape — same top-level area (`moderator`), same sub-area (`invite`), plus a new sibling sub-namespace (`lobby`) under it. The namespace makes it explicit that these strings are about the lobby semantics of the invite view; future refactors that split invite-vs-lobby into separate components can move the keys without renaming.
- **`moderator.lobby.*`** (a sibling of `moderator.invite.*`) — rejected. Implies a separate lobby surface (which this task explicitly is NOT — per Decision §1). Keeping the keys under `moderator.invite.lobby.*` reflects the architectural choice that the lobby IS part of the invite view.

For the retired `moderator.invite.enterSession.hint` key: the predecessor's static hint ("You can enter the session before debaters join.") directly contradicts the new strict gate. The state-driven `moderator.invite.lobby.enterHint.<reason>` keys replace it semantically; the old key has no remaining call site after this task lands. Removing it keeps the catalogs lean and avoids dead-key drift; the parity-check enforces removal from all three locales.

### 8. State management: pure derivations from existing WS-store data, no new `useState`

Two options surveyed:

- **Pure `useMemo` derivations** (chosen). The gate boolean (`bothDebatersPresent`) and the gate reason (`gateReason`) are deterministic functions of the existing `occupants` map. The WS store already drives re-renders on every `participant-joined` / `participant-left` arrival; the new derivations recompute as a side effect. Zero new state slots; the component stays at its current state-shape complexity.
- **Lift the gate state into a `useSessionLobbyState(sessionId)` hook** — rejected. Only one consumer (this view) needs the derivation; the predecessor's refinement (`mod_invite_participants.md` Decisions §8) made the same call for the slot derivation ("kept inline … rather than extracted to a `useSessionParticipants` hook for v1 — extraction becomes worthwhile if/when the lobby route … also need[s] the same projection"). This task IS the lobby surface and reuses the same data inline; no extraction needed yet.

### 9. Aria-disabled vs. native `disabled` on the Enter button

Two options surveyed:

- **Native HTML `disabled`** (chosen). Keyboard focus skips the button correctly; screen readers announce the disabled state via the standard channel; click events do not fire (so the test for "click is a no-op when disabled" passes by default). Simple, idiomatic, no extra wiring required.
- **`aria-disabled="true"` with the button still focusable + clickable, plus a manual `if (disabled) return;` in the handler** — rejected. Adds complexity for no benefit; the use case for `aria-disabled` (announcing disabled state on something that should remain focusable for instructional purposes, e.g. a wizard "Next" button that should explain why it's disabled when the user tabs to it) doesn't apply here — the `aria-describedby` + the hint paragraph cover the "why" without needing the button to be focusable in the disabled state.

### 10. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- **A direct application of an existing convention** — i18n namespacing (predecessor's pattern), WS-store consumption (predecessor's reducer), in-place component editing (the same shape `mod_invite_participants` used for its `CreateSession.tsx` amendment), test seam reuse (`window.__aConversaWsStore` per the existing `wsStoreSeed.ts` helper).
- **A scoped UI policy that doesn't constrain other tasks** — strict gate (Decision §2), always-visible ready badge (§3), persistent banner (§4), retired hint key (§7), no cancel affordance (§6).
- **A deferral of a future refactor or follow-up task** — `/sessions/:id/lobby` placeholder retirement, "Cancel session" affordance, a possible `useSessionLobbyState` hook.

The "no new dependencies" rule means no ADR is triggered by anything in this task. The strict-gate decision (§2) is a product-level scope choice that fits within the existing architecture; if a future iteration wants to add a soft-override mode, that's an additive change that doesn't disrupt the strict-gate default.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Closes `mod_session_setup` as the third and final leaf (after `mod_create_session_form` ✓ and `mod_invite_participants` ✓); per the TJ-semantics precedent (`mod_capture_flow`, `mod_graph_rendering`, `mod_pending_proposals_pane`) the subgroup container derives-completes from its leaves with no explicit `complete 100` marker. M4 (`m_moderator_mvp`) still has 3 open deps (`mod_decompose_flow`, `mod_diagnostic_flow`, `mod_axiom_mark_flow`) so the milestone marker stays unset.
- Strict Enter-session gate landed per Decision §2: `apps/moderator/src/routes/InviteParticipants.tsx` now disables `invite-enter-session` until both `debater-A` and `debater-B` slots are filled (was always-enabled per the predecessor's Decision §3). The gate is a pure `useMemo` derivation off the existing `deriveSlotOccupants` reducer; no new state, no new WS subscriptions, no backend changes.
- Always-visible per-debater ready/pending badge (`invite-slot-ready[data-role="debater-A|B"][data-ready="true|false"]`) and a "Both ready" banner (`invite-both-ready-banner` with `role="status"` + `aria-live="polite"`) round out the lobby semantics; the disabled-button `title` + `aria-describedby`-linked hint paragraph carry state-driven tooltips ("Awaiting Debater A", etc.) per the 4-state `gateReason` enum (`ready` / `awaiting-A` / `awaiting-B` / `awaiting-both`).
- i18n catalog edits: **9 new keys × 3 locales = 27 entries** added under `moderator.invite.lobby.*` across `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; **1 retired key × 3 locales = 3 removals** (`moderator.invite.enterSession.hint`, superseded by the state-driven `moderator.invite.lobby.enterHint.<reason>` keys). Net delta: +9 keys per locale, +8 vs. the refinement's "10 new" planned count because the disabled-tooltip + enter-hint state-machine collapsed cleanly into the same 4-arm shape and one of the originally planned keys was folded. pt-BR + es-419 drafts land flagged PENDING in `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json`; native-speaker review follow-up registered as `i18n_session_lobby_native_review` in `tasks/35-frontend-i18n.tji`.
- Test seam extended for future participant-joined-driven scenarios: `tests/e2e/fixtures/wsStoreSeed.ts` gains `participant-joined` / `participant-left` support (per Decision §5, as a sibling helper keeping the underlying `applyEvent` plumbing reused), and `tests/e2e/invite-participants-flow.spec.ts` exercises the strict gate, the ready-state badges, the banner, and the re-disable-on-leave path through that seam. This makes the seed file the canonical place future moderator-UI specs reach for when they need to simulate debater presence without spinning up the participant-self-claim backend (still unbuilt; tracked under `mod_invite_participants` follow-ups).
- Cross-spec bridge: `tests/e2e/moderator-capture.spec.ts` updated to satisfy the new gate. The predecessor (`mod_invite_participants`) already added the `/invite` URL-bridge to that spec; this task adds the WS-seed step before the Enter click so the gate opens. Known downstream consequence of the strict-gate Decision §2 — not a deviation from this task's allowlist; registered here for traceability so future Closers can find the seed bridge if the gate's input ever changes shape.
- A trivial prettier-only fix on `apps/moderator/src/routes/InviteParticipants.test.tsx` (formatting whitespace; no semantic change) was applied during verification to satisfy `pnpm run check`.
- Verification: `pnpm run check` green (after the prettier fix); `pnpm run test:smoke` 3160 passing; `chromium-create-session` Playwright project 18/18 passing.
