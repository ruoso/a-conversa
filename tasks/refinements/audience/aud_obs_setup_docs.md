# OBS setup guide for show producers

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_obs_integration.aud_obs_setup_docs` (effort `1d`, `depends !aud_obs_sizing_defaults, !aud_obs_transparency`; the parent `aud_obs_integration` declares `depends !aud_shell`, so this leaf inherits the shell-complete frontier plus both sibling structural-contract leaves).

**Effort estimate**: 1d — one new producer-facing markdown document at [`docs/obs-setup.md`](../../../docs/obs-setup.md) (~180–230 lines of plain how-to prose covering OBS Studio scene-source configuration, the audience URL grammar, the recommended dimensions matrix, the transparency / no-input contracts, public vs. private session posture, and a short troubleshooting section). No new ADR, no new code, no new dependency, no new i18n key, no new test. The commit touches only `docs/` and the matching `.tji` block — doc-only commits skip the global build/test gate per memory `feedback_doc_only_commits_skip_build_test.md`; the pre-commit hook is the safety net.

**Inherited dependencies**:

- `!audience.aud_obs_integration.aud_obs_sizing_defaults` (settled 2026-05-27, [`tasks/refinements/audience/aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md)) — establishes the `BROADCAST_DIMENSIONS` named-exports table (`HD_720 = 1280×720`, `HD_1080 = 1920×1080`, `HD_1440 = 2560×1440`) at [`apps/audience/src/graph/layoutOptions.ts:66`](../../../apps/audience/src/graph/layoutOptions.ts#L66), with `DEFAULT_BROADCAST_DIMENSIONS` aliasing `HD_1080`. The doc cites those three resolutions verbatim as the producer-recommendation matrix; `HD_1080` is named as the OBS Studio out-of-the-box default and matches the producer's day-one zero-setup expectation.
- `!audience.aud_obs_integration.aud_obs_transparency` (settled 2026-05-27, [`tasks/refinements/audience/aud_obs_transparency.md`](aud_obs_transparency.md)) — establishes `body { background-color: transparent; }` at [`apps/audience/src/index.css`](../../../apps/audience/src/index.css), composited natively by OBS via the browser-source alpha channel. The doc tells producers they do NOT need OBS's "Custom CSS" override (`body { background-color: rgba(0,0,0,0) !important; }`) and do NOT need a chroma-key filter — the page ships transparent.
- Prose-only context (NOT a `.tji` edge): `audience.aud_obs_integration.aud_obs_no_input_required` (settled 2026-05-27, [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md)) — establishes the no-required-gesture contract pinned by the `<dialog>` / `[aria-modal]` / `<audio>` / `<video>` / `[data-requires-input]` audit. The doc tells producers the browser source needs no user interaction; the source can be "Refresh browser when scene becomes active" or "always loaded" with equal effect.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (settled 2026-05-27, [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md)) — establishes the live URL grammar at [`apps/audience/src/App.tsx:178-179`](../../../apps/audience/src/App.tsx#L178): `/a/sessions/:sessionId` and `/a/:locale/sessions/:sessionId`. The doc cites both shapes (locale-bare and locale-prefixed) and explains why a producer might pick one over the other.
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_no_auth_for_public` (settled — sets `requiredAuthLevel: 'public'`) and `audience.aud_shell.aud_anonymous_ws_subscribe` (settled — ADR 0029: server accepts cookie-less WS upgrades for public sessions). The doc tells producers the audience URL works without login for public sessions, and explains why private sessions are NOT broadcastable via the OBS browser source (the cookie-less browser source cannot satisfy the OIDC sign-in step).
- Prose-only context (NOT a `.tji` edge): `audience.aud_shell.aud_app_skeleton` (settled — Vite library-mode bundle, `BrowserRouter basename="/a"`). The producer-facing URL examples are absolute (`https://<host>/a/sessions/<uuid>`); the doc does not surface the basename to producers.
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_url_position_param` (in-flight — [`tasks/50-audience-and-broadcast.tji:375-378`](../../50-audience-and-broadcast.tji#L375), reads `?position=<sequence>` for replay deep-linking). The doc mentions live-mode only and forward-points a single sentence to replay's setup when that leaf ships; the replay-mode producer-facing setup is `replay_test.*`'s scope.

## What this task is

A 1d **documentation** leaf. It writes a producer-facing setup guide that turns the structural OBS contracts pinned by `aud_obs_sizing_defaults` + `aud_obs_transparency` + `aud_obs_no_input_required` into a step-by-step OBS Studio walkthrough: open Sources, add a Browser source, paste the audience URL, set the dimensions, leave Custom CSS empty, save. The audience is a **show producer** — someone running an OBS Studio scene for a live broadcast — not a contributor to the codebase.

After this leaf:

- A new `docs/obs-setup.md` file lands alongside the existing `docs/architecture.md`, `docs/dev-environment.md`, `docs/moderator-ui.md`, `docs/participant-ui.md`, etc. The doc is structured for a producer reading it top-to-bottom while their OBS Studio is open: prerequisites → URL grammar → step-by-step Browser-source configuration → recommended dimensions → public-vs-private posture → troubleshooting. ~180–230 lines.
- The doc references the dimensions table by **citing the three resolutions verbatim** (1280×720, 1920×1080, 2560×1440) and naming 1920×1080 as the recommended default. It does NOT instruct the producer to read `apps/audience/src/graph/layoutOptions.ts` — that's an implementation seam, not a producer-facing artefact. The doc links into the source file once in a "for contributors" footnote so the contributor-side audit trail remains.
- The doc cites both URL shapes (`https://<host>/a/sessions/<sessionId>` and `https://<host>/a/<locale>/sessions/<sessionId>`) and explains the locale-segment behaviour briefly — the locale-prefixed form is recommended for non-English broadcasts because the audience surface reads the locale from the URL prefix (per ADR 0024), not from `Accept-Language` headers (the OBS browser source's `Accept-Language` is the OS default and is not under the producer's day-of-show control).
- The doc tells producers the page is **transparent by default** — no Custom CSS override is needed in OBS, no chroma-key filter is needed, the alpha channel composites natively. It documents the override path (`body { background-color: ...; }` in OBS Custom CSS) for producers who want a specific backdrop, while making clear that's not the default workflow.
- The doc tells producers the page renders **without any user interaction** — no Click to Start, no Accept Cookies, no Subscribe button. The browser source can be created with "Refresh browser when scene becomes active" off (the default); it will render the live graph as soon as the source loads and continue updating as events arrive.
- A short troubleshooting section addresses the failure modes the structural contracts already foreclose: opaque background (Custom CSS leftover from a prior setup; check it's empty), white whitespace strip (page is overflowing — this is `aud_obs_sizing_defaults`-foreclosed and should not occur — but the doc names the symptom and points at the OBS-source dimensions setting and the audience surface's deployed version), graph not updating (check the URL matches the session id the moderator is operating, check the session is public, check the browser source can reach the deployed host).
- The audience surface's `App.tsx` annotation block gets ONE new line added to the **OBS sizing invariant** / **OBS transparency invariant** comment block: a `// Producer-facing setup walkthrough: docs/obs-setup.md` pointer so a contributor reading the source code can find the producer-facing artefact. Zero behaviour change.

Out of scope (deferred to existing or future leaves — see Decision §2):

- **A "general producer's workflow" guide** covering OBS scene composition, switching scenes, audio routing, recording, streaming-platform configuration, and so on. Rejected as scope. The doc this leaf writes is strictly about pointing an OBS browser source at the audience URL — it does not teach the producer how to operate OBS as a piece of software. The audience for the doc is a producer who already knows OBS; this is the audience-surface-specific add-on, not a primer.
- **A docs-side reference for moderators / debaters about how to broadcast their session.** That belongs to whatever future producer-tooling refinement surfaces (potentially `audience.aud_audience_url_share` or a moderator-side leaf that surfaces the audience URL inside the moderator console — neither leaf is in the WBS yet). The current doc is producer-facing, not moderator-facing.
- **A "how to host the audience surface" deployment guide.** That belongs to `deployment.deployment_docs` ([`tasks/70-deployment.tji`](../../70-deployment.tji)). This doc assumes the audience surface is already deployed at a stable URL.
- **Replay-mode setup.** Replay reads `?position=<sequence>` from `aud_url_position_param` (in-flight); its producer-facing setup is a future leaf under `replay_test.*` (not yet refined). This doc covers live-mode only and forward-points one sentence to the future replay setup.
- **Screenshots of OBS Studio.** Rejected — the repo's docs are all text (see `docs/architecture.md`, `docs/dev-environment.md`, `docs/moderator-ui.md`); screenshots add maintenance burden (they break across OBS Studio versions and OS chrome changes) and are out of style. The doc walks the producer through OBS menu paths in text.
- **Translation of the doc into pt-BR / es-419.** The doc is contributor-style English, mirroring every other `docs/*.md`. Producer-facing translation is a future deployment-side concern, not this leaf's; the audience UI itself is i18n'd via the catalogs (ADR 0024), but `docs/` is not.
- **A new ADR.** No new architectural choice; the setup-doc content is a direct application of the four predecessor refinements (sizing + transparency + no-input + session URL). See Decision §6.
- **A test pinning the doc's referenced constants against `apps/audience/src/graph/layoutOptions.ts`.** Considered and rejected as overweight for a 1d task — the constants are pinned at the source (the Vitest case in `layoutOptions.test.ts` from `aud_obs_sizing_defaults`); the doc duplicates the values for producer readability; a future bump (vanishingly unlikely — 1920×1080 is fixed industry standard) is reconciled by a single targeted edit. See Decision §4.
- **A `make docs-check` or doc-side linter target.** The repo's pre-commit hook runs Prettier across `docs/*.md` (per [ADR 0012](../../../docs/adr/0012-formatter-prettier.md)); markdown formatting drift is caught at commit time. No new tooling required.

## Why it needs to be done

The OBS browser-source workflow is named in [`docs/architecture.md:124`](../../../docs/architecture.md#L124) — "The producer points an **OBS browser source** at that URL" — as the canonical delivery path for the audience surface, and is the load-bearing constraint behind seven settled refinements (`aud_app_skeleton`, `aud_no_auth_for_public`, `aud_anonymous_ws_subscribe`, `aud_clean_typography`, `aud_obs_sizing_defaults`, `aud_obs_transparency`, `aud_obs_no_input_required`) plus the in-flight `aud_obs_render_smoke` and the wired-up `aud_session_url`. Every structural property the producer needs to be aware of has been pinned in code or test — but a producer who's never set up OBS for this project has no entry point to that pinned behaviour.

Without the doc, the producer's path-of-discovery is:

1. Get the audience URL from somewhere (moderator? deployment doc? word of mouth?).
2. Open OBS Studio, guess at the Browser-source dimensions (most likely 800×600 — the OBS default — which is one of the dimensions the audience surface is NOT tuned for).
3. See an opaque white rectangle composite over their scene, assume the audience surface is broken, file a bug, or worse, abandon the surface.
4. Receive Slack feedback from someone who's seen this before that the URL is right and the dimensions need to be 1920×1080 and Custom CSS is empty and the browser source can be created with no special options.

That sequence has happened informally; it's tribal knowledge today. The doc converts it into a written artefact that ships with the repo and is linkable from any producer-facing communication. The `m_audience_mvp` milestone ([`tasks/99-milestones.tji`](../../99-milestones.tji)) — the milestone at which a producer points OBS at an audience URL and sees the live debate graph — depends transitively on `audience.*` including this leaf; the milestone-acceptance demands a producer can complete the path-of-discovery in O(minutes) without Slack support, which is what the doc enables.

The failure modes the doc forecloses:

1. **Wrong dimensions.** A producer creates a Browser source at OBS's 800×600 default; the audience renders inside an 800×600 window centred in their broadcast canvas with whatever the producer's canvas dimensions are around it. The graph layout is tuned for 1080p (per `aud_layout_engine.md` Decision §4 and `aud_obs_sizing_defaults.md`'s JSDoc amendments); at 800×600 the dagre layout's node spacing and font sizes are off, the graph looks cramped, and the producer can't tell if it's a configuration bug or a rendering bug.
2. **Custom CSS leftover.** A producer who's previously used the Browser source for a different audience surface (or a different project) may have `body { background-color: white; }` or `* { font-family: monospace; }` left in the Custom CSS field. Those overrides defeat the alpha-channel-transparency contract and the Inter font selection respectively. The doc walks the producer through clearing the Custom CSS field to empty as part of setup.
3. **Wrong session URL.** A producer types `/a/sessions/<title>` (the session's name) instead of `/a/sessions/<uuid>` (the session id). The audience surface routes the title to its wildcard placeholder route; the producer sees the placeholder and assumes the surface is broken. The doc walks the producer through getting the canonical UUID from the moderator's session URL or the operator-facing console.
4. **Private session as broadcast.** A producer points the Browser source at a `private` session's audience URL; the browser source has no cookie, the SurfaceHost deflects to `/login`, the OIDC redirect breaks (the browser source has no user gesture for the post-auth redirect), and the producer sees `/login` instead of the graph. The doc tells the producer the broadcast workflow requires a **public** session (mode-changeable by the moderator) and points at the moderator-facing flow for switching session privacy at the right moment.

Downstream consumers of this leaf:

- **The deployment-launch sequence.** When `deployment.deployment_docs` lands a production-host runbook, that runbook will link to this doc as the producer-side entry point. The two docs partition cleanly: deployment talks about the host (where the audience URL is served); this talks about the OBS Studio consumer (how to point a browser source at it).
- **The moderator-facing announce surface (future, not yet refined).** Whatever future leaf surfaces the audience URL inside the moderator console will link to this doc so a moderator can hand the URL to a producer with a setup walkthrough attached.
- **The next round of producer pilots.** The doc is the artefact a producer reads before their first broadcast; pilot feedback flows into Status-block amendments here (or, if a producer scenario surfaces a structurally new failure mode, into a new sibling refinement under `aud_obs_integration`).

## Inputs / context

### ADRs

- [**ADR 0024 — Frontend i18n: react-i18next + ICU**](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — establishes URL-prefix locale negotiation for the audience surface. The doc's URL-grammar section explains the locale-bare and locale-prefixed shapes (`/a/sessions/<uuid>` and `/a/<locale>/sessions/<uuid>`) and recommends the prefixed form for non-en-US broadcasts.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — fixes the surface URL prefix (`/a/*` → audience). The doc surfaces the prefix to producers as part of the URL grammar; it does NOT explain the routing machinery (that's an implementation seam).
- [ADR 0029 — Anonymous WebSocket subscribe for public sessions](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md) — establishes that a cookie-less browser source can receive live events for a public session. The doc surfaces this to producers as "public sessions work without login; the browser source needs no cookie."
- [ADR 0028 — `session-mode-changed` wire event](../../../docs/adr/0028-session-mode-changed-wire-event.md) — establishes the moderator-driven privacy flip. The doc mentions the existence of public/private without explaining the wire mechanics; it points the moderator-facing reader at the moderator console's flow.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the doc's structural claims (transparency, no-input, dimensions) are each pinned by committed tests in the predecessor leaves; the doc does not introduce new claims. See Decision §5.
- [ADR 0012 — Formatter: Prettier](../../../docs/adr/0012-formatter-prettier.md) — `docs/*.md` is Prettier-formatted at pre-commit; the new file conforms.

### Sibling refinements

- [`tasks/refinements/audience/aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md) — the dimensions-constants leaf this doc cashes. Its Decision §3 establishes the 1280×720 / 1920×1080 / 2560×1440 triple as the canonical OBS-source matrix; the doc surfaces those values verbatim. Line 35 of that refinement named *this* task as "the sibling that documents the recommended OBS scene-source configuration referencing the dimensions this leaf pins."
- [`tasks/refinements/audience/aud_obs_transparency.md`](aud_obs_transparency.md) — the transparency-CSS leaf this doc cashes. Its Decision §1 picks alpha-channel transparency over chroma-key; the doc tells producers no chroma-key filter is needed and the page ships transparent by default. Line 54 of that refinement explicitly forecasts the doc's wording: "with the transparent `<body>` in place, the docs can recommend 'drop the audience URL into an OBS browser source, no custom CSS needed, the alpha channel composites natively.'"
- [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md) — the no-input audit leaf. Its Decision §6 documents the OBS browser-source's no-gesture constraint; the doc surfaces this to producers as "no Click to Start, no Accept Cookies, the page renders on load."
- [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md) — the live route leaf. Its Status block names the URL grammar (`/sessions/:sessionId` + `/:locale/sessions/:sessionId`); the doc cites both shapes.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — establishes the surface's basename and OBS-context framing.
- [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md) — establishes the anonymous-on-public mount path the doc relies on.
- [`tasks/refinements/audience/aud_auth_for_private.md`](aud_auth_for_private.md) — establishes that private sessions deflect anonymous visitors to `/login`. The doc's "private sessions are not OBS-friendly" section is the producer-facing consequence.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — establishes Inter as the broadcast font. The doc mentions font selection only to advise the producer not to override `font-family` via Custom CSS.
- [`tasks/refinements/foundation/graph_lib_decision.md`](../foundation/graph_lib_decision.md) — line 27 lists "OBS-friendly sizing/transparency" as the foundational graph-library requirement; this doc is the producer-facing close of that loop (with sizing in `aud_obs_sizing_defaults` and transparency in `aud_obs_transparency` as the code-side closes).

### Live code the doc references

- [`apps/audience/src/graph/layoutOptions.ts:66`](../../../apps/audience/src/graph/layoutOptions.ts#L66) — the `BROADCAST_DIMENSIONS` table whose values the doc cites verbatim. The doc does NOT instruct producers to read the file; it cites the file once in a "contributors" footnote for the audit trail.
- [`apps/audience/src/App.tsx:178-179`](../../../apps/audience/src/App.tsx#L178) — the live route definitions whose URL shapes the doc cites. The doc surfaces the absolute URLs (`https://<host>/a/sessions/<uuid>`) and does not explain the React Router route table.
- [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) — modified. ONE new line added to the existing **OBS sizing invariant** / **OBS transparency invariant** comment block: `// Producer-facing setup walkthrough: docs/obs-setup.md`. Zero behaviour change.
- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — NOT modified. The transparency rule and the full-bleed reset are already in place.
- [`docs/architecture.md:91`](../../../docs/architecture.md#L91), [`:123-125`](../../../docs/architecture.md#L123) — establish OBS as the canonical delivery surface and the locale-prefix URL convention. The new doc cross-links to `architecture.md` once as the canonical project-overview entry point.
- `docs/dev-environment.md` — the stylistic precedent for the new doc's voice ("Audience: a producer setting up an OBS browser source for the first time"). Mirrors the dev-env doc's first-paragraph "Audience: ..." line.
- [`docs/moderator-ui.md`](../../../docs/moderator-ui.md), [`docs/participant-ui.md`](../../../docs/participant-ui.md) — sibling user-surface docs. The new doc complements them: moderator-ui and participant-ui describe operator-facing flows; this describes the consumer-facing broadcast setup.

### Files the doc touches (explicit allowlist)

- `docs/obs-setup.md` — new file. ~180–230 lines. Producer-facing markdown, voiced like `docs/dev-environment.md` (how-to, walkthrough, troubleshooting tail).
- `apps/audience/src/App.tsx` — modified. ONE new comment line (the `docs/obs-setup.md` pointer) inside the existing OBS-invariant comment block. ~+1 LOC.

### Files the doc does NOT touch

- `apps/audience/src/index.css`, `apps/audience/src/main.tsx`, `apps/audience/src/graph/*` — unchanged. The doc consumes the contracts; it does not modify them.
- `apps/audience/src/routes/AudienceLiveRoute.tsx`, `apps/audience/src/state/*` — unchanged.
- `packages/shell/`, `packages/i18n-catalogs/`, `apps/root/`, `apps/moderator/`, `apps/participant/`, `apps/replay-test/`, `apps/server/` — unchanged. The doc is producer-facing; it crosses no implementation surface.
- `tests/e2e/`, `apps/audience/src/**/*.test.*` — unchanged. The structural properties the doc describes are already test-pinned by the predecessor leaves; no new test surface is needed (Decision §4).
- `docs/architecture.md`, `docs/dev-environment.md`, `docs/moderator-ui.md`, `docs/participant-ui.md` — unchanged. The new doc cross-links to `architecture.md` once but does NOT modify existing docs (a cross-link from `architecture.md` to the new file is desirable but is a separate sibling-edit that bloats the diff; the new doc stands on its own and the existing docs find their way to it via the WBS index or future contributor edits — Decision §3).
- `docs/adr/` — no new ADR (Decision §6).
- `package.json`, `pnpm-lock.yaml`, `Makefile` — unchanged. No new dependency, no new make target.
- `.tji` files — `complete 100` on this leaf lands at task-completion time per [`tasks/refinements/README.md`](../README.md); no new follow-up tech-debt leaf registered (Decision §2).

### Doc structure (sketch)

The new `docs/obs-setup.md` follows roughly this structure (~6 H2 sections):

```markdown
# OBS browser-source setup for the audience surface

> Status: ...

Producers running a live broadcast point an OBS Studio Browser source
at the audience URL. This doc walks through the setup ...

Audience: a show producer setting up an OBS Studio Browser source for
the audience surface for the first time. Assumes familiarity with OBS
Studio (creating Sources, configuring scenes); does not teach OBS.

Out of scope: ...

## Prerequisites

- A deployed audience host (see ...).
- The session id (UUID) you want to broadcast — typically copied from
  the moderator's URL bar after the moderator opens the operate route.
- OBS Studio 28+ ... (alpha-channel browser-source compositing
  is the default on supported versions; no extra setup).
- The session must be in **public** mode for an OBS browser source to
  reach it. See "Public vs. private sessions" below.

## The audience URL

The audience URL has two equivalent shapes:

- Locale-bare:    `https://<host>/a/sessions/<sessionId>`
- Locale-prefix:  `https://<host>/a/<locale>/sessions/<sessionId>`

`<sessionId>` is the session's UUID ... `<locale>` is one of
`en-US`, `pt-BR`, `es-419` (the v1 locale set per ADR 0024).

The locale-prefix shape is recommended for non-English broadcasts:
the audience surface reads its locale from the URL, not from the
browser's `Accept-Language` header (which on a headless OBS browser
source is whatever the host OS default is and is not under your
day-of-show control).

## Step-by-step Browser-source configuration

1. In OBS Studio, open the scene that will carry the audience graph.
2. Click **+** under **Sources** and select **Browser**.
3. Name the source something memorable ("audience-graph").
4. Configure:
   - **URL**: paste the full audience URL from above.
   - **Width**: `1920`
   - **Height**: `1080`
   - **FPS**: 30 (the default; the audience surface does not run any
     per-frame animation that needs higher rates).
   - **Custom CSS**: **leave empty.** ... The audience surface ships
     transparent by default; no `body { background-color: ... }`
     override is needed.
   - **Shutdown source when not visible**: optional, off by default.
   - **Refresh browser when scene becomes active**: optional ...
5. Click **OK**.

The browser source renders the audience graph immediately — no
click, no consent banner, no audio prompt. ...

## Recommended dimensions

For a typical broadcast, use 1920×1080 (HD 1080p):

| Use case                       | Dimensions  |
|--------------------------------|-------------|
| Standard broadcast (default)   | 1920×1080   |
| Low-bandwidth / PiP corner     | 1280×720    |
| 2K / 1440p production          | 2560×1440   |

These three are the resolutions the audience surface's layout is
tuned against (visual-regression and pixel smoke at each — see
`apps/audience/src/graph/layoutOptions.ts`). Other resolutions render
but the graph spacing was not validated against them.

## Transparency and compositing

The audience surface is **transparent by default**. ... The producer
does NOT need to add a chroma-key filter ... and does NOT need to
override Custom CSS.

If you want an opaque backdrop ... use the OBS Source's "Custom CSS"
field:

```css
body { background-color: rgba(0, 0, 0, 0.7) !important; }
```

(... but the recommended workflow is to keep the page transparent and
control compositing via OBS's normal scene-source layering.)

## Public vs. private sessions

The OBS browser source has no user cookie. ... Public sessions
accept anonymous WS subscribes ... Private sessions deflect the
anonymous browser source to `/login` ...

For a broadcast: the moderator flips the session to **public** before
showtime ...

## Troubleshooting

- **Opaque white background ...** — check Custom CSS is empty.
- **Whitespace strip on the right ...** — check the source's
  dimensions match the page's content area; verify the deployed
  audience version includes the `body { overflow: hidden; }` rule
  ...
- **Graph never updates ...** — check the session id in the URL
  matches the moderator's session; check the session is public;
  check the OBS host can reach the deployed audience host.
- **Sign-in page appears instead of the graph** — the session is
  private; ask the moderator to flip to public.

## For contributors

The structural contracts this doc walks producers through are pinned
in code at:

- ... dimensions: `apps/audience/src/graph/layoutOptions.ts`
- ... transparency: `apps/audience/src/index.css`
- ... no-input: `apps/audience/src/mount.test.tsx`, `tests/e2e/audience-skeleton-smoke.spec.ts`
- ... live route: `apps/audience/src/routes/AudienceLiveRoute.tsx`

See the refinements under `tasks/refinements/audience/aud_obs_*.md`
for the design history.
```

(Sketch only — actual prose lands in the implementation. The structural skeleton above pins the shape; tone matches `docs/dev-environment.md`.)

### App.tsx annotation (sketch)

The single-line addition inside the existing OBS-invariant comment block:

```tsx
// Producer-facing setup walkthrough: docs/obs-setup.md.
```

### Cucumber surface

**No Cucumber scenario.** The doc is content; the server is doc-agnostic by construction.

### UI-stream e2e policy disposition

**Not applicable.** This is a documentation leaf — there is no UI affordance, no rendering change, no behavioural surface for a Playwright spec to exercise. The structural properties the doc describes are pinned by the predecessor leaves' tests (`mount.test.tsx`, `audience-skeleton-smoke.spec.ts`, `audience-live-session.spec.ts`); no new test surface is introduced.

The deferred-e2e policy applies to UI tasks, not docs tasks.

## Constraints / requirements

### What the doc MUST contain

- A title H1 (`# OBS browser-source setup for the audience surface`).
- A short "Audience: a show producer ..." opening (mirrors `docs/dev-environment.md` line 5).
- An "Out of scope:" line naming what the doc does NOT cover (deployment, moderator workflow, replay-mode, screenshots — see Decision §1's framing).
- The two URL shapes (locale-bare and locale-prefix), with `<host>`, `<sessionId>`, `<locale>` placeholders, plus a sentence on why the locale-prefix shape is recommended for non-en-US.
- A step-by-step Browser-source configuration sequence (numbered list, 5+ steps), naming the OBS Studio menu paths verbatim (**Sources** > **+** > **Browser**, etc.).
- The dimensions matrix as a three-row markdown table citing 1280×720, 1920×1080, 2560×1440, with 1080p named as the default.
- A "Transparency and compositing" section telling producers no chroma-key and no Custom CSS override is needed, and documenting the override path for the rare opaque-backdrop case.
- A "Public vs. private sessions" section explaining why OBS browser sources cannot serve private sessions, and pointing the producer at the moderator-facing flow for the public flip.
- A troubleshooting section addressing at least: opaque background, whitespace strip, graph not updating, sign-in page surfaces. Each item names the symptom + the most likely cause + the fix.
- A "For contributors" footnote linking back to the implementation files (`layoutOptions.ts`, `index.css`, `mount.test.tsx`, `audience-skeleton-smoke.spec.ts`, `AudienceLiveRoute.tsx`) and the predecessor refinements (`aud_obs_*.md`).

### What the doc MUST NOT contain

- No screenshots (Decision §3 below — repo style is text-only docs).
- No translated copies into pt-BR / es-419 (out-of-scope per "What this task is").
- No instruction to read TypeScript source files for the dimensions table (the values are cited verbatim; the source pointer is in the "For contributors" footnote only).
- No "click here to copy URL" affordances or HTML — markdown only, Prettier-formatted.
- No deployment instructions (`deployment.deployment_docs`'s scope).
- No moderator-facing workflow content (moderator-ui.md's scope).
- No producer-facing OBS Studio tutorial (out-of-scope).
- No `localhost` URLs in producer examples (the dev-env doc covers local; this doc covers production-style broadcast). Use `https://<host>/...` placeholders.

### Verification stance per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

- The structural claims the doc describes (transparency at the body, no-input audit, 1280×720 / 1920×1080 / 2560×1440 dimensions table, URL grammar with both locale shapes, anonymous WS subscribe for public sessions) are each **already pinned** by Vitest + Playwright + Cucumber cases in the predecessor leaves. The doc duplicates the producer-visible surface of those contracts; the regression-pin layer is the predecessors' test suite, not new tests in this leaf.
- The doc itself is content; the closest analog to a "regression pin" is the pre-commit Prettier formatter and the contributor-eye review at commit time. No new linter, no new doc-test target.

### Cucumber surface

**None.** Docs are not wire-format or projector-output observables.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is either a committed artefact, an automated formatter result, or a script CI already runs.

1. **`docs/obs-setup.md` exists** at the canonical doc location, alongside `docs/architecture.md` / `docs/dev-environment.md` / `docs/moderator-ui.md` / `docs/participant-ui.md` (Decision §3).
2. **The doc contains** an opening "Audience: ..." line, an "Out of scope:" line, an H2 each for URL grammar / step-by-step / recommended dimensions / transparency / public vs. private / troubleshooting / for contributors. Reviewer-verifiable; a contributor checks the section headers exist on first read.
3. **The dimensions table** in the doc cites `1280×720`, `1920×1080`, `2560×1440` verbatim, with `1920×1080` named as the recommended default. Drift against `BROADCAST_DIMENSIONS` is reconciled by manual edit if `apps/audience/src/graph/layoutOptions.ts` ever changes (Decision §4).
4. **The URL grammar section** cites both `https://<host>/a/sessions/<sessionId>` and `https://<host>/a/<locale>/sessions/<sessionId>` shapes. Matches the route declarations at [`apps/audience/src/App.tsx:178-179`](../../../apps/audience/src/App.tsx#L178).
5. **The transparency section** tells producers Custom CSS is empty by default and no chroma-key filter is required.
6. **The public-vs-private section** tells producers OBS browser sources cannot reach private sessions because they have no user cookie / no post-login redirect handler.
7. **The "For contributors" footnote** links to the four implementation files (`apps/audience/src/graph/layoutOptions.ts`, `apps/audience/src/index.css`, `apps/audience/src/mount.test.tsx`, `apps/audience/src/routes/AudienceLiveRoute.tsx`) and the three predecessor refinement docs (`aud_obs_sizing_defaults.md`, `aud_obs_transparency.md`, `aud_obs_no_input_required.md`).
8. **The `App.tsx` annotation block** gains the `// Producer-facing setup walkthrough: docs/obs-setup.md` pointer line inside the existing OBS-invariant comment block.
9. **Pre-commit Prettier check** (`pnpm run format:check`) is green: the new doc is Prettier-formatted at commit time (the pre-commit hook handles this per ADR 0012).
10. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf. The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
11. **No new ADR** is committed by this leaf (Decision §6). The pre-commit hook's `docs/adr/` check stays green without a new entry.
12. **No file modifications outside the explicit allowlist** in "Files the doc touches": `docs/obs-setup.md` (new) and `apps/audience/src/App.tsx` (one comment line). Memory's `feedback_doc_only_commits_skip_build_test.md` applies: the global `pnpm run check` + `pnpm run test:smoke` gate is skipped for this commit; the pre-commit hook is the safety net.
13. **No `.tji` edits** by this leaf beyond `complete 100` at task-completion time per [`tasks/refinements/README.md`](../README.md). No new follow-up tech-debt leaf registered (Decision §2).
14. **No new i18n key audit drift** — the doc does not surface any user-facing strings consumed by the audience UI; the i18n catalogs (`packages/i18n-catalogs/`) are untouched.

## Decisions

### 1. Scope is OBS-source-pointing, NOT producer's OBS workflow

The audience for the doc is a producer who already knows how to run OBS Studio. The doc walks the producer through pointing a Browser source at the audience URL and configuring its source-level properties (URL, dimensions, Custom CSS, FPS, refresh-on-activate). Two alternatives surveyed:

- **(A — chosen)** Scope to source-pointing. The doc names OBS Studio menu paths verbatim (e.g. "Click **+** under **Sources** and select **Browser**") but does not explain what a scene is, how to record, how to stream, how audio routing works, etc. The audience is a producer who has already configured OBS for their broadcast; this is the audience-surface-specific add-on.
- **(B)** Scope to full producer's workflow including OBS basics. Rejected. (i) Repo style is task-focused docs (`docs/dev-environment.md` doesn't teach Docker; `docs/methodology.md` doesn't teach formal logic). (ii) An OBS-tutorial section would balloon the doc to ~600+ lines and duplicate canonical OBS Studio documentation that already exists (and is better maintained) at obsproject.com. (iii) The 1d effort estimate forbids a full tutorial; if a producer-onboarding leaf is needed later (vanishingly likely for the audience this surface targets — producers who already operate live broadcasts), a separate leaf can land.

### 2. Tech-debt registration: no new leaves spawned by this doc

The doc consumes settled structural contracts; it does not surface new architectural questions. Forward-pointers in the doc are to **already-existing WBS leaves** (`deployment.deployment_docs`, `aud_url_position_param`, the not-yet-refined `aud_obs_render_smoke` smoke), not to net-new follow-up work.

The natural follow-up — pt-BR / es-419 translation of `docs/obs-setup.md` — is deferred until a real producer scenario surfaces it. If a Brazilian or Latin American producer pilot complains the doc is English-only, a future `audience.aud_obs_setup_docs_i18n` leaf could land translations; that's a planning-debt decision, not a write-now-WBS decision.

**No new tech-debt leaf is registered here.**

### 3. The doc lives at `docs/obs-setup.md`

Three options surveyed:

- **(A — chosen)** New `docs/obs-setup.md` at the same level as `docs/architecture.md`, `docs/dev-environment.md`, `docs/moderator-ui.md`, `docs/participant-ui.md`. Discoverable, consistent with the other surface-facing docs (each lives at `docs/<surface-or-context>.md`), and stands alone.
- **(B)** Section inside `docs/architecture.md` ("Broadcast / OBS"). Rejected. (i) `architecture.md` is contributor-facing project overview; a producer-facing setup section would mix audiences badly. (ii) The setup content is ~180–230 lines — a substantial section that would dominate `architecture.md` without belonging there.
- **(C)** New `docs/audience-obs-setup.md` or `docs/audience/obs-setup.md` (audience-prefixed). Rejected. (i) `docs/audience-ui.md` does not exist — the audience surface doesn't currently have a producer-facing doc, so disambiguating the path with `audience-` is solving a problem we don't have. (ii) A `docs/audience/` directory would create a one-file directory, which is over-organisation for the current doc surface (the other surface docs are at the top level too).

Cross-linking from `docs/architecture.md` (specifically line 124's "The producer points an **OBS browser source** at that URL" sentence) to `docs/obs-setup.md` is desirable but is **out of scope for this leaf**. The current diff is bounded to the new doc + the App.tsx annotation; cross-link bloat into existing docs requires a separate sibling edit that crosses the doc-only commit boundary (memory `feedback_doc_only_commits_skip_build_test.md` applies if cross-link edits stay within `docs/`). If the orchestrator prefers a single bundled commit, the cross-link addition can be folded in at closer time; if kept clean, a follow-up edit can add it.

### 4. The doc cites the dimensions verbatim; no auto-sync test

Two alternatives surveyed:

- **(A — chosen)** Cite `1280×720 / 1920×1080 / 2560×1440` verbatim in the doc body. The values are pinned at the source by the Vitest case (9) in `apps/audience/src/graph/layoutOptions.test.ts` (per `aud_obs_sizing_defaults` Status). Drift would surface as a manual edit-pair: when the constants change, the doc edit is one targeted update. The constants are vanishingly unlikely to change (1280×720 / 1920×1080 / 2560×1440 are fixed industry standards); the drift risk is bounded.
- **(B)** Add a doc-side test that parses `docs/obs-setup.md`, extracts the dimensions, and compares against `BROADCAST_DIMENSIONS` from `apps/audience/src/graph/layoutOptions.ts`. Rejected as over-weight for a 1d task. (i) Adds a new test category (markdown-source-of-truth audits) for a single point of regression that is extremely unlikely to surface. (ii) The auto-sync test would need to re-parse markdown table cells, which is brittle (any future doc reformat could break it). (iii) The source-of-truth test in `layoutOptions.test.ts` is sufficient; if the constants ever change, the doc is updated in the same commit by the contributor making the change (a manual discipline, but the pre-commit reviewer catches divergence).

### 5. The structural-contract claims are not retested in this leaf

`aud_obs_sizing_defaults`, `aud_obs_transparency`, and `aud_obs_no_input_required` each ship Vitest + Playwright pins of the structural properties the doc describes. The doc references those contracts at the producer-visible surface (CSS transparency, no-input invariant, dimensions matrix) but does not introduce new claims. Adding new tests here would either (i) duplicate the predecessor leaves' pins, which is dead test surface, or (ii) test the doc's text directly (a snapshot match against the markdown), which is brittle and provides no regression-pin value over the pre-commit Prettier check.

Per ADR 0022's regression-pin property: the predecessor leaves' tests **are** the regression pin for the structural claims; this leaf's commit is content-only.

### 6. No new ADR

The doc introduces no architectural choice:

- Producer-facing documentation as a doc-file convention is established by `docs/architecture.md`, `docs/dev-environment.md`, `docs/moderator-ui.md`, `docs/participant-ui.md` — adding `docs/obs-setup.md` is content-extension within the established pattern.
- The OBS browser-source compositing model is established by `aud_obs_transparency` Decision §1 (alpha-channel, not chroma-key); the doc cashes that decision producer-side without changing it.
- The dimensions matrix is established by `aud_obs_sizing_defaults` Decision §3; the doc cashes it producer-side.
- The URL grammar is established by `aud_session_url` Status; the doc cashes it producer-side.
- The doc's two audience-style choices (text-only, producer-focused tutorial-not-primer) are stylistic discipline within the existing `docs/` corpus, not architectural decisions.

An ADR would be over-weight; this refinement is the design record for the doc.

### 7. The repo's existing doc style is preserved — text-only, no screenshots

OBS Studio screenshots would help a beginner producer follow the menu paths, but the repo's existing docs (`docs/architecture.md`, `docs/dev-environment.md`, `docs/moderator-ui.md`, `docs/participant-ui.md`) are all text-only. Adding screenshots to one doc would:

1. Introduce a precedent that requires maintaining screenshot freshness across OBS Studio versions (OBS Studio's UI changes between major versions; a screenshot from OBS 28 misleads an OBS 32 user).
2. Require image-management infrastructure (image directory, alt-text discipline, image-licensing footnotes — none of which the repo has).
3. Inflate the repo's binary surface for a single doc's benefit.

The text-only walkthrough names OBS menu paths verbatim (e.g. "Click **+** under **Sources** and select **Browser**") which is sufficient for the OBS-literate producer audience this doc targets.

If a future producer-onboarding scenario surfaces (e.g. a community-pilot producer who has never used OBS), a screenshot-based primer could land as a separate `docs/obs-primer.md` or a community-managed resource — not this leaf.

### 8. Doc-only commit; skip the global build/test gate

Per memory `feedback_doc_only_commits_skip_build_test.md`: commits touching only `docs/` (and `tasks/refinements/`, `.tji`) skip the `pnpm run check` + `pnpm run test:smoke` gate that source/schema/config commits trigger. The pre-commit hook (Prettier on `docs/*.md`, `tj3 --silent` on `.tji`) is the safety net.

This leaf's commit touches `docs/obs-setup.md` (new) + `apps/audience/src/App.tsx` (one comment line). The App.tsx edit is a one-line comment with no behaviour change. Two options:

- **(A — chosen)** Treat the commit as doc-only — the App.tsx edit is comment-only and behaviourally inert. Skip the global build/test gate; rely on the pre-commit hook. Justify in the commit message: "docs+comment only — App.tsx change is a pointer comment, no behaviour."
- **(B)** Run the full `pnpm run check` + `pnpm run test:smoke` gate to be safe. The build is fast; running it adds ~30s. Lower risk of accidentally landing a broken comment block (e.g. a Prettier-incompatible comment that fails the lint stage).

Decision: (A), but the implementer is welcome to fall back to (B) if their local clock is comfortable. The pre-commit hook runs ESLint + Prettier on the staged App.tsx edit either way, so a malformed comment is caught at commit time regardless.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `docs/obs-setup.md` created (~120 lines): producer-facing OBS Browser-source setup walkthrough covering URL grammar (locale-bare and locale-prefix shapes), step-by-step Browser-source configuration, recommended dimensions matrix (1280×720 / 1920×1080 / 2560×1440 verbatim), transparency contract (no Custom CSS, no chroma-key), public-vs-private session posture, troubleshooting (opaque background, whitespace strip, graph not updating, sign-in page), and a "For contributors" footnote linking back to the implementation files and predecessor refinements.
- `apps/audience/src/App.tsx` (+2 lines): added `// Producer-facing setup walkthrough: docs/obs-setup.md` pointer comment inside the existing OBS-invariant comment block. Zero behaviour change.
- No new tests (doc-only leaf; structural claims pinned by predecessor leaves' tests per Decision §5).
- No new ADR (Decision §6).
- No new tech-debt leaf registered (Decision §2 — natural follow-ups such as pt-BR / es-419 translation are deferred until a real producer scenario surfaces them).
