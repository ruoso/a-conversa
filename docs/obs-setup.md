# OBS browser-source setup for the audience surface

Producers running a live broadcast point an OBS Studio Browser source at the audience URL; the source renders the live debate graph over a transparent background and composites into the producer's scene through OBS's normal source-layering. This doc walks through the setup, names the recommended dimensions, and addresses the failure modes that usually surface on a first attempt.

Audience: a show producer setting up an OBS Studio Browser source for the audience surface for the first time. Assumes familiarity with OBS Studio (creating Sources, configuring scenes, adjusting source properties); does not teach OBS.

Out of scope: deploying the audience host (owned by [`deployment.deployment_docs`](../tasks/70-deployment.tji)), the moderator-facing flow that flips a session between public and private (see [moderator-ui.md](moderator-ui.md)), replay-mode deep-linking (a future leaf under `replay_test.*`), and a general OBS Studio tutorial (use [obsproject.com](https://obsproject.com/) for that). No screenshots — the repo's docs are text-only by convention (see [`docs/architecture.md`](architecture.md) for the project overview).

## Prerequisites

- A deployed audience host. This doc uses `https://<host>` as the placeholder; substitute the URL your deployment lives at.
- The **session id** (UUID) you want to broadcast. The session id is the canonical identifier in the audience URL — not the session's title. The moderator can copy it from their own URL bar after opening the session's operate route, or from the operator-facing console.
- **OBS Studio 28 or newer.** Alpha-channel compositing on the Browser source is the default on supported versions; no extra OBS configuration is required.
- The session must be in **public** mode for an OBS Browser source to reach it. See [Public vs. private sessions](#public-vs-private-sessions) below for the reasoning.

## The audience URL

The audience URL has two equivalent shapes:

- **Locale-bare:** `https://<host>/a/sessions/<sessionId>`
- **Locale-prefix:** `https://<host>/a/<locale>/sessions/<sessionId>`

`<sessionId>` is the session's UUID (e.g. `b1d4f6a0-2c8e-4f3a-9b21-3f5d9e7c4a10`). `<locale>` is one of `en-US`, `pt-BR`, `es-419` — the v1 locale set established by [ADR 0024](adr/0024-frontend-i18n-react-i18next-with-icu.md).

The locale-prefix shape is recommended for non-English broadcasts. The audience surface reads its locale from the URL prefix, not from the browser's `Accept-Language` header. An OBS Browser source's `Accept-Language` is whatever the host OS default happens to be — that's not under your day-of-show control, and you don't want the locale of the rendered graph to depend on the host OS's regional settings. Putting `<locale>` in the URL pins it.

For an English broadcast the locale-bare shape is fine; the surface falls back to `en-US` when no prefix is present.

## Step-by-step Browser-source configuration

1. In OBS Studio, open the scene that will carry the audience graph.
2. Click **+** under **Sources** and select **Browser**.
3. In the **Create/Select Source** dialog, choose **Create new**, name the source something memorable (`audience-graph`), and click **OK**.
4. In the properties panel that opens, configure:
   - **URL**: paste the full audience URL (one of the two shapes from [The audience URL](#the-audience-url)).
   - **Width**: `1920`
   - **Height**: `1080`
   - **FPS**: `30` (the default). The audience surface does not run any per-frame animation that needs higher rates; the rendering is event-driven.
   - **Custom CSS**: **leave empty.** Clear any default CSS that OBS may have pre-filled. The audience surface ships transparent by default — no `body { background-color: ... }` override is needed. See [Transparency and compositing](#transparency-and-compositing).
   - **Shutdown source when not visible**: optional. Off is fine; leaving the source loaded keeps the graph state warm between scene switches.
   - **Refresh browser when scene becomes active**: optional. The audience surface re-subscribes cleanly on reload, so toggling this is safe either way.
5. Click **OK** to commit the source.

The Browser source renders the audience graph immediately — there is no Click to Start affordance, no Accept Cookies banner, and no audio prompt to dismiss. As soon as the source loads it connects to the deployed audience host's WebSocket endpoint and begins receiving the session's event stream. Subsequent events arrive in real time and the graph re-layouts as they do.

If you resize or move the source within your scene, OBS scales the rendered page; the underlying graph layout is computed for the **source's pixel dimensions**, not the scene's. Keep the Width × Height matched to one of the [Recommended dimensions](#recommended-dimensions) below for the layout tuning to apply.

## Recommended dimensions

For a typical broadcast, use **1920 × 1080** (HD 1080p). It is OBS Studio's out-of-the-box Browser-source size and the audience surface's default layout-tuning target.

| Use case                     | Dimensions  |
| ---------------------------- | ----------- |
| Standard broadcast (default) | 1920 × 1080 |
| Low-bandwidth / PiP corner   | 1280 × 720  |
| 2K / 1440p production        | 2560 × 1440 |

These three are the resolutions the audience surface's layout is tuned and tested against — the `breadthfirst` node-spacing constants (`SPACING_FACTOR`, `PADDING`) and the broadcast typography are picked for 1080p, and the surface is exercised at the other two as part of the OBS-sizing regression suite. Other resolutions render but the graph spacing has not been validated against them, and very narrow or very tall aspect ratios may cause node labels to crowd or wrap awkwardly.

If you need a non-standard size (a wide vertical sidebar, an unusual ratio), match it to the closest entry in the table for the **source pixel dimensions** and rely on OBS's scene-level scaling for the final composite.

## Transparency and compositing

The audience surface is **transparent by default.** The page's `<body>` ships `background-color: transparent`, which OBS's Browser source composites through the source's alpha channel onto whatever you have layered beneath in your scene — your camera feed, a background image, a colour fill, anything.

You do **not** need to add a chroma-key filter to the Browser source.

You do **not** need to add a Custom CSS override to make the background transparent.

Both of those workarounds are common in OBS Browser-source recipes online for pages that ship with an opaque body, and both are unnecessary here. If you encounter advice telling you to set `body { background-color: rgba(0, 0, 0, 0) !important; }` in Custom CSS, ignore it for this surface — it has no effect (the body is already transparent) and clutters your source configuration.

Node fills and edge strokes inside the graph are intentionally opaque (white-fill nodes with slate-text labels — see [`apps/audience/src/graph/stylesheet.ts`](../apps/audience/src/graph/stylesheet.ts)). That is a legibility decision for label text on arbitrary producer scenes; it is not a page-level paint, and it does not affect the transparency contract.

### Opaque backdrop, if you want one

If, for a specific show, you want the audience graph to render against a semi-opaque or fully opaque backdrop (e.g. a coloured wash that helps the graph read against a busy scene), use the OBS source's **Custom CSS** field to inject a background:

```css
body {
  background-color: rgba(0, 0, 0, 0.7) !important;
}
```

This overrides the page's transparent default for **this source only** — the deployed audience surface is unchanged for everyone else. The recommended workflow remains keeping the page transparent and composing the backdrop with normal scene-source layering, but the override is available if you need it.

## Public vs. private sessions

An OBS Browser source has no user cookie and no way to complete an interactive sign-in flow. Pointing it at a **public** session works because the deployed audience host accepts anonymous WebSocket subscribes for public sessions (see [ADR 0029](adr/0029-anonymous-ws-subscribe-for-public-sessions.md)).

Pointing it at a **private** session does not work. The server deflects the anonymous Browser source to the sign-in page; the source has no user gesture available for the post-sign-in redirect, no cookie jar to persist a session against, and no way to complete OIDC. The producer sees a sign-in page instead of the graph.

For a broadcast: the moderator flips the session to **public** before showtime, and back to private (or leaves it public, as appropriate) afterwards. The privacy flip is a moderator-side gesture in the moderator console; see [moderator-ui.md](moderator-ui.md) for the moderator-facing flow. The flip is live — once it commits, the audience surface in the Browser source connects on its next subscribe attempt without any producer-side action.

## Troubleshooting

- **Opaque white background instead of the producer's scene.** The most common cause is leftover Custom CSS from a previous use of the Browser source — a `body { background-color: white }` or similar rule. Open the source's properties, clear the **Custom CSS** field, and click OK.

- **A vertical whitespace strip on the right edge.** The page should fill the source edge-to-edge; the audience surface's stylesheet sets `body { overflow: hidden }` to suppress any scrollbar-reserved space. If you see a strip, check that the source's Width / Height match the resolutions in [Recommended dimensions](#recommended-dimensions) and that the deployed audience version is current (an out-of-date deploy may predate the overflow-hidden rule).

- **Graph never updates / page renders blank.** Three things to check, in order: (1) the URL contains the session **id** (UUID), not the session's title or any other identifier — open the moderator's URL bar and copy the UUID segment verbatim; (2) the session is in **public** mode — ask the moderator to confirm and flip if needed; (3) the OBS host can reach the deployed audience host on the network — open the audience URL in a regular browser on the same machine to verify connectivity.

- **Sign-in page surfaces instead of the graph.** The session is in private mode. An OBS Browser source cannot complete sign-in. Ask the moderator to flip the session to public; see [Public vs. private sessions](#public-vs-private-sessions).

- **Graph renders but text looks wrong (wrong font, sizing off).** The audience surface uses [Inter](https://rsms.me/inter/) as the broadcast font. If you have Custom CSS overriding `font-family` (perhaps a legacy `* { font-family: monospace }` rule from a previous Browser-source use), clear the Custom CSS field. The deployed audience host loads Inter from Google Fonts; if your OBS host has no internet egress, the surface falls back to the platform sans-serif chain — recognizable but not the broadcast-tuned appearance.

## For contributors

The structural contracts this doc walks producers through are pinned in code:

- **Dimensions.** [`apps/audience/src/graph/layoutOptions.ts`](../apps/audience/src/graph/layoutOptions.ts) — the `BROADCAST_DIMENSIONS` named export holds the canonical `{ HD_720, HD_1080, HD_1440 }` table; `DEFAULT_BROADCAST_DIMENSIONS` aliases `HD_1080`. The Vitest case in `layoutOptions.test.ts` is the regression pin.
- **Transparency.** [`apps/audience/src/index.css`](../apps/audience/src/index.css) — `body { background-color: transparent }`. Pinned by a Vitest mount audit in [`apps/audience/src/mount.test.tsx`](../apps/audience/src/mount.test.tsx) and a Playwright assertion in [`tests/e2e/audience-live-session.spec.ts`](../tests/e2e/audience-live-session.spec.ts).
- **No required input.** Pinned by the same `mount.test.tsx` audit (forbids `<dialog>`, `[aria-modal]`, `<audio>` / `<video>`, `[data-requires-input="true"]`) and the Playwright audit in [`tests/e2e/audience-skeleton-smoke.spec.ts`](../tests/e2e/audience-skeleton-smoke.spec.ts).
- **Live route.** [`apps/audience/src/routes/AudienceLiveRoute.tsx`](../apps/audience/src/routes/AudienceLiveRoute.tsx) and the route declarations in [`apps/audience/src/App.tsx`](../apps/audience/src/App.tsx) (`/sessions/:sessionId` and `/:locale/sessions/:sessionId`).

The design history is in the predecessor refinements: [`tasks/refinements/audience/aud_obs_sizing_defaults.md`](../tasks/refinements/audience/aud_obs_sizing_defaults.md), [`tasks/refinements/audience/aud_obs_transparency.md`](../tasks/refinements/audience/aud_obs_transparency.md), [`tasks/refinements/audience/aud_obs_no_input_required.md`](../tasks/refinements/audience/aud_obs_no_input_required.md), and [`tasks/refinements/audience/aud_session_url.md`](../tasks/refinements/audience/aud_session_url.md).
