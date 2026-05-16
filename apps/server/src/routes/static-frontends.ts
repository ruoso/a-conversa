// Fastify plugin serving the root app and surface bundles from the same
// process as the JSON API.
//
// Refinement: tasks/refinements/backend/serve_static_frontends.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md
// TaskJuggler: backend.api_skeleton.serve_static_frontends
//
// **Single-origin deployment.** Production ships one Docker image that
// listens on one port. The same `http://host:3000` answers `GET /` with
// the moderator's `index.html`, `GET /assets/<hash>.js` with the
// bundle, `POST /sessions` with a JSON API, and `GET /ws` with a
// WebSocket upgrade. Browsers see a single origin — no CORS for
// fetch(), no third-party-cookie pain, no extra TLS cert.
//
// **Route precedence (load-bearing).** Fastify matches routes in
// REGISTRATION order. API routes (`/healthz`, `/api/auth/*`,
// `/api/sessions/*`, `/api/ws`, `/api/docs`) are registered BEFORE this
// plugin in `server.ts`. This plugin is registered LAST so the
// wildcard static handler can't shadow any API surface — `GET /api/auth/me`
// always reaches the auth route, never an `api/auth/me` file under
// the moderator's dist.
//
// **Post-migration invariant** (per
// tasks/refinements/backend/serve_static_frontends_path_collision_fix.md):
// every URL is now either `/api/*` (backend), `/healthz` (ops liveness),
// or non-`/api/*` (SPA). The static-frontends fallback can fire for
// any non-`/api/*` path without risk of a sibling params validator
// shadowing it.
//
// **SPA fallback.** The moderator app is client-routed via React
// Router. A direct hit on `/sessions/abc/lobby` would 404 against the
// static dist (no such file) but the SPA's `index.html` knows how to
// render it. We override `setNotFoundHandler` to discriminate by
// `Accept`:
//
//   - `Accept: text/html` (or no Accept, defaulting to browser) →
//     serve the SPA's `index.html` at 200. The SPA's client router
//     takes over and renders the right route.
//   - Anything else (API clients sending `Accept: application/json`,
//     `*/*` without HTML preference, etc.) → defer to the canonical
//     JSON 404 envelope from `error-handler.ts`. This is what an API
//     consumer hitting `/sessions/wrong-id` expects.
//
// The discriminator runs only on `GET` requests — a stray
// `POST /sessions/nonexistent/end` from an API consumer should not
// return HTML.
//
// **Extensibility.** The plugin reads a `frontends` option which is a
// list of `{ urlPrefix, distDir, defaultIndex }` entries. Today only
// the moderator is wired (participant, audience, replay have no
// `dist/` yet — they're stubs). Adding the participant app is a
// one-line entry once `apps/participant/src/` is real and its
// `vite build` produces `dist/`. The list shape is intentional: each
// future SPA gets its own URL prefix (e.g. `/participant/*`) and the
// SPA-fallback handler picks the right `index.html` per prefix.
//
// **Dist directory resolution.** Each frontend's `distDir` is resolved
// relative to the server's own compiled location with an env override:
//
//   - `MODERATOR_DIST_DIR` — absolute path to the moderator's `dist/`
//     directory. Used in the runtime container (where the Dockerfile
//     copies `apps/moderator/dist` to a known location) and in any
//     bespoke deployment that lays the bundles elsewhere.
//   - Falls back to `<server-dist>/../moderator/dist` resolved against
//     the compiled `apps/server/dist/routes/static-frontends.js` —
//     which in the runtime image is `/app/apps/server/dist/routes/`
//     and resolves to `/app/apps/moderator/dist/`. Symmetrical for
//     local `pnpm --filter @a-conversa/server start` invocations.
//
// **Fail-fast at boot.** If a configured `distDir` is missing or its
// `index.html` is unreadable, the plugin throws at registration time.
// The server never binds the port without a usable bundle — better to
// see "moderator dist missing" in the startup log than a flood of
// 404s once traffic arrives. The runtime image deliberately copies
// the bundle in `apps/moderator/dist`; a stripped image without it
// would crash at boot rather than silently serve a JSON-only API.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { sendNotFoundEnvelope } from '../error-handler.js';

/**
 * One entry per frontend app whose static files should be served.
 */
export interface FrontendEntry {
  /**
   * URL prefix the SPA mounts under. The moderator uses `'/'` so it
   * is the default landing page; future frontends may use a sub-path
   * (e.g. `'/participant'`). Trailing slash is normalized by
   * `@fastify/static` — both `'/'` and `'/participant'` are valid.
   */
  readonly urlPrefix: string;
  /**
   * Absolute filesystem path to the SPA's built `dist/` directory.
   * Resolved at plugin construction (not at request time) so the
   * fail-fast check below sees a stable path.
   */
  readonly distDir: string;
  /**
   * The filename inside `distDir` that serves as the SPA fallback for
   * unknown client-routed paths. Usually `'index.html'` — exposed as
   * an option so a SPA with a non-standard entry can override.
   */
  readonly defaultIndex: string;
  /**
   * Optional human-readable label used in fail-fast errors and log
   * messages. Defaults to the URL prefix.
   */
  readonly label?: string;
}

/**
 * Options to the plugin. Defaults to the moderator-only list resolved
 * from `process.env`; tests pass a bespoke list to bypass the env.
 *
 * `surfaces` mirrors `frontends`: if omitted, the plugin falls back to
 * `resolveDefaultSurfaces(process.env)`; tests pass a bespoke list to
 * exercise the discovery + fail-fast paths against a fixture `distDir`
 * without depending on a real workspace `vite build`.
 */
export interface StaticFrontendsPluginOptions {
  readonly frontends?: readonly FrontendEntry[];
  readonly surfaces?: readonly SurfaceEntry[];
}

/**
 * One surface served as a micro-frontend module (loaded by the root
 * shell via `import(moduleUrl)`).
 *
 * The module + style filenames are content-hashed at build time so the
 * browser cache invalidates when the bundle changes (per ADR-class
 * concern: a fixed `moderator.js` cached `max-age=1y immutable` would
 * pin returning users to stale code for up to a year after a deploy).
 * The server resolves the actual hashed filenames at boot by scanning
 * `distDir` against each pattern; exactly one file must match per
 * pattern. The discovered names then flow into the surface manifest at
 * `/_surfaces/manifest.json`, which is itself served `no-cache` so the
 * fresh names reach returning browsers on their next visit.
 */
export interface SurfaceEntry {
  readonly surfaceId: string;
  readonly urlPrefix: string;
  readonly distDir: string;
  /**
   * Regex matched against POSIX-style file paths relative to `distDir`
   * (forward slashes, no leading `./`). Must match exactly one file.
   */
  readonly moduleFilePattern: RegExp;
  /**
   * Zero or more regexes for stylesheets that accompany the module.
   * Each pattern must match exactly one file under `distDir`.
   */
  readonly styleFilePatterns?: readonly RegExp[];
  readonly label?: string;
}

/**
 * A `SurfaceEntry` after `validateAndResolveSurface` has resolved each pattern
 * against the on-disk dist. The plugin threads these (not the raw
 * patterns) into the manifest builder.
 */
interface ResolvedSurface {
  readonly entry: SurfaceEntry;
  readonly moduleFile: string;
  readonly styleFiles: readonly string[];
}

export interface SurfaceManifestEntry {
  readonly moduleUrl: string;
  readonly styleUrls?: readonly string[];
}

export interface SurfaceManifest {
  readonly surfaces: Readonly<Record<string, SurfaceManifestEntry>>;
}

/**
 * Env var name production reads to override the resolver's default
 * path to the moderator's `dist/`. Exported so tests assert against
 * the same constant the resolver consults.
 */
export const ROOT_DIST_DIR_ENV = 'ROOT_DIST_DIR';
export const MODERATOR_DIST_DIR_ENV = 'MODERATOR_DIST_DIR';

/**
 * Compile-time location of this module. Used to resolve the default
 * `dist/` paths relative to the server's own compiled output. Under
 * `tsc -b`, this file lands at
 * `apps/server/dist/routes/static-frontends.js`; under Vitest it lands
 * under a TypeScript-source path. Either way, the moderator's dist
 * lives at `../../../moderator/dist` relative to this module under
 * the source layout (the worktree's `apps/<app>` siblings), and at
 * `../../../moderator/dist` again under the runtime image (where
 * everything is `cp -r`'d under `/app/apps/`). The compiled `dist/`
 * vs `src/` only differ by one segment (`dist` vs `src`), which is
 * absorbed by the unconditional jump up to `apps/`.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the moderator's dist directory: env override wins; otherwise
 * the symmetric source / compiled fallback. Pulled out so tests can
 * assert the env override and the fallback shape separately.
 *
 * The fallback walks up from `<this-file>` three levels to land at
 * `apps/<app>` and then descends into `moderator/dist`. The walk
 * works under both `apps/server/dist/routes/static-frontends.js` and
 * `apps/server/src/routes/static-frontends.ts` because both layouts
 * share the same three-up-then-into-moderator topology.
 */
function resolveWorkspaceDistDir(
  envKey: string,
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[envKey];
  if (typeof override === 'string' && override.length > 0) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  return resolve(__dirname, '..', '..', '..', appName, 'dist');
}

export function resolveRootDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveWorkspaceDistDir(ROOT_DIST_DIR_ENV, 'root', env);
}

export function resolveModeratorDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveWorkspaceDistDir(MODERATOR_DIST_DIR_ENV, 'moderator', env);
}

/**
 * The default list of frontends, resolved from the environment. Today
 * only the moderator is wired (the other three apps don't have a
 * buildable `dist/` yet). Exported so a test or a deployment can
 * inspect what would be served.
 */
export function resolveDefaultFrontends(
  env: NodeJS.ProcessEnv = process.env,
): readonly FrontendEntry[] {
  return [
    {
      urlPrefix: '/',
      distDir: resolveRootDistDir(env),
      defaultIndex: 'index.html',
      label: 'root',
    },
  ];
}

export function resolveDefaultSurfaces(
  env: NodeJS.ProcessEnv = process.env,
): readonly SurfaceEntry[] {
  return [
    {
      surfaceId: 'moderator',
      urlPrefix: '/_surfaces/moderator/',
      distDir: resolveModeratorDistDir(env),
      // Vite library mode emits the entry as `moderator-<hash>.js` at
      // the dist root and the CSS as `assets/moderator-<hash>.css` —
      // see `apps/moderator/vite.config.ts`. The hashes are base64-url
      // (alnum + `_` + `-`), typically 8 chars; the patterns accept
      // any non-empty alnum/`_`/`-` run to stay tolerant of Rollup's
      // hash-length tuning.
      moduleFilePattern: /^moderator-[A-Za-z0-9_-]+\.js$/,
      styleFilePatterns: [/^assets\/moderator-[A-Za-z0-9_-]+\.css$/],
      label: 'moderator',
    },
  ];
}

/**
 * Throw if a configured frontend's dist directory or fallback index
 * is missing. Called at plugin registration so the server fail-fasts
 * at boot rather than serving 404s for every HTML request.
 *
 * Two checks per frontend:
 *
 *   1. `distDir` exists and is a directory — catches misconfigured
 *      env vars and forgotten Dockerfile copy steps.
 *   2. `<distDir>/<defaultIndex>` exists — catches a half-built
 *      bundle (the directory is there but the bundler errored before
 *      emitting `index.html`).
 */
function validateFrontend(entry: FrontendEntry): void {
  const label = entry.label ?? entry.urlPrefix;
  if (!existsSync(entry.distDir)) {
    throw new Error(
      `serve_static_frontends: frontend "${label}" distDir does not exist: ${entry.distDir}. ` +
        `Set ${MODERATOR_DIST_DIR_ENV} or run \`pnpm -F @a-conversa/moderator build\`.`,
    );
  }
  const stats = statSync(entry.distDir);
  if (!stats.isDirectory()) {
    throw new Error(
      `serve_static_frontends: frontend "${label}" distDir is not a directory: ${entry.distDir}.`,
    );
  }
  const indexPath = resolve(entry.distDir, entry.defaultIndex);
  if (!existsSync(indexPath)) {
    throw new Error(
      `serve_static_frontends: frontend "${label}" is missing its entry document: ${indexPath}. ` +
        `The dist directory exists but the SPA bundler did not emit ${entry.defaultIndex}.`,
    );
  }
}

/**
 * Walk `distDir` recursively and yield every regular file as a POSIX
 * path relative to `distDir`. Used by `discoverSingleFile` to scan for
 * the hashed surface bundle. Synchronous + tiny scope — the surface
 * dists hold a handful of files (entry, css, sourcemap, occasional
 * asset). Node 20's `readdirSync({ recursive: true })` would do the
 * same job but its return shape (a flat string list) gives less
 * control over how directories are descended.
 */
function* walkRelFiles(distDir: string, subPath = ''): Generator<string> {
  const absDir = subPath === '' ? distDir : join(distDir, subPath);
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = subPath === '' ? entry.name : `${subPath}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkRelFiles(distDir, rel);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

/**
 * Find the single file under `distDir` whose POSIX-relative path
 * matches `pattern`. Throws on zero or multiple matches so a misnamed
 * bundle or a stale dist surfaces at boot rather than as a runtime 404
 * (zero matches) or an indeterministic manifest URL (multiple matches
 * — a sign that the dist dir was not cleaned between builds and now
 * holds bundles from two different commits).
 */
function discoverSingleFile(distDir: string, pattern: RegExp, label: string, kind: string): string {
  const matches: string[] = [];
  for (const rel of walkRelFiles(distDir)) {
    if (pattern.test(rel)) {
      matches.push(rel);
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `serve_static_frontends: surface "${label}" ${kind} pattern ${String(pattern)} did not match any file under ${distDir}. ` +
        `Rebuild the surface (\`pnpm -F @a-conversa/moderator build\`) or fix the pattern.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `serve_static_frontends: surface "${label}" ${kind} pattern ${String(pattern)} matched ${String(matches.length)} files under ${distDir}: ${matches.join(', ')}. ` +
        `The dist directory likely holds bundles from more than one build — clean it and rebuild.`,
    );
  }
  return matches[0] as string;
}

function validateAndResolveSurface(entry: SurfaceEntry): ResolvedSurface {
  const label = entry.label ?? entry.surfaceId;
  if (!existsSync(entry.distDir)) {
    throw new Error(
      `serve_static_frontends: surface "${label}" distDir does not exist: ${entry.distDir}. ` +
        `Set ${MODERATOR_DIST_DIR_ENV} or run \`pnpm -F @a-conversa/moderator build\`.`,
    );
  }
  const stats = statSync(entry.distDir);
  if (!stats.isDirectory()) {
    throw new Error(
      `serve_static_frontends: surface "${label}" distDir is not a directory: ${entry.distDir}.`,
    );
  }
  const moduleFile = discoverSingleFile(entry.distDir, entry.moduleFilePattern, label, 'module');
  const styleFiles = (entry.styleFilePatterns ?? []).map((pattern) =>
    discoverSingleFile(entry.distDir, pattern, label, 'style'),
  );
  return { entry, moduleFile, styleFiles };
}

function buildSurfaceManifest(surfaces: readonly ResolvedSurface[]): SurfaceManifest {
  const entries: Record<string, SurfaceManifestEntry> = {};
  for (const surface of surfaces) {
    entries[surface.entry.surfaceId] = {
      moduleUrl: `${surface.entry.urlPrefix}${surface.moduleFile}`,
      styleUrls: surface.styleFiles.map((fileName) => `${surface.entry.urlPrefix}${fileName}`),
    };
  }
  return { surfaces: entries };
}

/**
 * True iff the inbound `Accept` header prefers HTML over JSON. The
 * discriminator the SPA-fallback handler uses to decide between
 * "return the SPA's index.html for client routing" and "return the
 * canonical JSON 404 envelope."
 *
 * Heuristic, not a full RFC-7231 q-value parser. The cases we need to
 * distinguish are:
 *
 *   - A browser hitting an unknown SPA path. The browser sends
 *     `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*\/*;q=0.8`
 *     (or similar). `text/html` is the prefix — match it.
 *   - A fetch / curl with `Accept: application/json`. No HTML prefix
 *     in the header — don't match.
 *   - A curl with no Accept header at all (defaults to `*\/*`). Treat
 *     as JSON — the canonical 404 is safer than serving HTML to a
 *     scripting client that didn't ask for it.
 *
 * The exact rule: `text/html` (or `application/xhtml+xml`) appears
 * somewhere in the header before any `;q=0` qualifier.
 */
function prefersHtml(accept: string | undefined): boolean {
  if (typeof accept !== 'string' || accept.length === 0) return false;
  // Case-insensitive — `Accept: TEXT/HTML` is rare but RFC-legal.
  const lower = accept.toLowerCase();
  // The simple discriminator: any direct mention of html. A trailing
  // `;q=0` would technically disqualify, but no real browser sends
  // `text/html;q=0` and an attacker forging the header doesn't get a
  // privileged response — the SPA's `index.html` is public.
  return lower.includes('text/html') || lower.includes('application/xhtml+xml');
}

/**
 * Send the SPA's `index.html` at 200 with `Content-Type: text/html`.
 * Used by the SPA-fallback not-found handler when the inbound Accept
 * header prefers HTML. Reads from disk on each request — the OS
 * filesystem cache makes this cheap, and the alternative (caching at
 * the Node layer) couples reload semantics to the server process.
 *
 * The cache-control header is `no-cache, must-revalidate` — the SPA's
 * `index.html` references hash-named asset bundles (`assets/index-<hash>.js`),
 * so on every deploy a fresh `index.html` must reach the browser.
 * `no-cache` lets the browser keep the file but forces a revalidate
 * round-trip; the hash-named assets are immutable-cached separately
 * by `@fastify/static`'s defaults.
 */
async function sendSpaIndex(
  reply: FastifyReply,
  distDir: string,
  defaultIndex: string,
): Promise<void> {
  const indexPath = resolve(distDir, defaultIndex);
  const html = await readFile(indexPath, 'utf8');
  reply
    .status(200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-cache, must-revalidate')
    .send(html);
}

/**
 * Pick the frontend whose `urlPrefix` matches the inbound request URL.
 * Used by the SPA-fallback handler when multiple frontends are wired
 * (a future state — today only the moderator at `'/'`).
 *
 * The match is longest-prefix-wins so a `/participant/anything` URL
 * goes to the participant SPA before falling through to the root
 * moderator SPA. `'/'` always matches as the implicit last resort.
 */
function pickFrontendFor(
  url: string,
  frontends: readonly FrontendEntry[],
): FrontendEntry | undefined {
  let best: FrontendEntry | undefined;
  let bestLen = -1;
  for (const f of frontends) {
    const prefix = f.urlPrefix;
    if (prefix === '/') {
      // Root fallback — only counts if nothing more specific wins.
      if (bestLen < 0) {
        best = f;
        bestLen = 0;
      }
      continue;
    }
    if (
      url === prefix ||
      url.startsWith(prefix + '/') ||
      url.startsWith(prefix + '?') ||
      url === prefix + '/'
    ) {
      if (prefix.length > bestLen) {
        best = f;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}

/**
 * The plugin body. Registers `@fastify/static` for each configured
 * frontend and installs an SPA-aware `setNotFoundHandler` that
 * discriminates by `Accept` header.
 *
 * The order matters: `@fastify/static` registers a wildcard handler
 * inside its plugin scope which fires for every GET under the prefix
 * with a matching file. `setNotFoundHandler` is installed AFTER so
 * any request that the static handler did not satisfy (no such file
 * under the dist) reaches the SPA-aware fallback.
 */
const staticFrontendsPluginAsync: FastifyPluginAsync<StaticFrontendsPluginOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const frontends = opts.frontends ?? resolveDefaultFrontends(process.env);
  const surfaces = opts.surfaces ?? resolveDefaultSurfaces(process.env);
  if (frontends.length === 0) {
    // Still own the root-scope not-found handler — errorHandlerPlugin
    // deliberately does NOT install one (see error-handler.ts), so we
    // must install one here to keep the canonical JSON 404 envelope
    // for unknown routes. Without this, Fastify falls back to its
    // default text 404 ("Route GET:/x not found"), which breaks the
    // frontend's single-shape error parser.
    app.log.warn(
      'serve_static_frontends: no frontends configured; the server will not serve any SPA bundles',
    );
    app.setNotFoundHandler(sendNotFoundEnvelope);
    return;
  }

  // Fail-fast: every configured frontend must have a real dist on
  // disk. Catches the Dockerfile copy step regressing or a misset
  // env var BEFORE the server binds a port. Surface validation also
  // discovers the actual hashed bundle filenames (see ResolvedSurface).
  for (const entry of frontends) {
    validateFrontend(entry);
  }
  const resolvedSurfaces = surfaces.map(validateAndResolveSurface);

  // Register a @fastify/static plugin for each frontend. The first
  // registration decorates `reply.sendFile`; subsequent ones pass
  // `decorateReply: false` so the decoration is not duplicated (which
  // throws `FST_ERR_DEC_ALREADY_PRESENT`).
  let first = true;
  for (const entry of frontends) {
    await app.register(fastifyStatic, {
      root: entry.distDir,
      prefix: entry.urlPrefix,
      // Don't list directory contents — defense in depth even though
      // the dist directory only contains the bundle and assets.
      list: false,
      // Don't redirect `/prefix` → `/prefix/` when prefix is `/` (a
      // no-op there) but @fastify/static needs `index` set so the
      // root request returns `index.html`.
      index: entry.defaultIndex,
      // Wildcard at the prefix routes every GET under it through the
      // static handler. With `wildcard: false` the plugin registers
      // a route per file at registration time which is fine for tiny
      // dists but doesn't generalize; `true` is the same default the
      // upstream docs use for SPA serving.
      wildcard: false,
      // Reasonable conservative defaults — keep dotfiles off the wire,
      // honor Range requests (cheap streaming for large assets), and
      // let send.js compute the correct content-type from the file
      // extension.
      dotfiles: 'deny',
      acceptRanges: true,
      contentType: true,
      // Aggressive caching of hash-named bundle assets is safe — Vite
      // emits `assets/<name>-<hash>.<ext>` files; the hash changes on
      // every build. The `index.html` itself is served via the
      // SPA-fallback handler below with `no-cache`.
      cacheControl: true,
      maxAge: '1y',
      immutable: true,
      // Only the first registration decorates `reply.sendFile`.
      decorateReply: first,
      // Tell @fastify/swagger NOT to include the static routes in the
      // generated OpenAPI document — they're not API surface and the
      // wildcard would clutter the docs.
      schemaHide: true,
    });
    first = false;
  }

  for (const surface of resolvedSurfaces) {
    await app.register(fastifyStatic, {
      root: surface.entry.distDir,
      prefix: surface.entry.urlPrefix,
      list: false,
      wildcard: false,
      dotfiles: 'deny',
      acceptRanges: true,
      contentType: true,
      cacheControl: true,
      maxAge: '1y',
      immutable: true,
      decorateReply: false,
      schemaHide: true,
    });
  }

  const manifest = buildSurfaceManifest(resolvedSurfaces);

  app.get('/_surfaces/manifest.json', async (_request, reply) => {
    reply
      .status(200)
      .type('application/json; charset=utf-8')
      .header('Cache-Control', 'no-cache, must-revalidate')
      .send(manifest);
  });

  // Install the SPA-aware not-found handler. Fastify's
  // `setNotFoundHandler` accepts a single handler at the root scope;
  // calling it here REPLACES the one installed by `errorHandlerPlugin`
  // (registered earlier in `server.ts`). The replacement keeps the
  // canonical JSON envelope for non-HTML requests by delegating to
  // `sendNotFoundEnvelope` — the JSON 404 contract is unchanged.
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply): void | Promise<void> => {
    // Method discriminator: SPA fallback applies to GET (and HEAD)
    // only. A POST/PUT/PATCH/DELETE against an unknown path is an API
    // consumer with a wrong URL — the JSON envelope is the right
    // answer regardless of Accept.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendNotFoundEnvelope(request, reply);
      return;
    }
    // Accept discriminator: anything that isn't an HTML preference
    // gets the JSON 404. Curl with no Accept, fetch with
    // `application/json`, etc. — all fall through here.
    const acceptHeader = request.headers['accept'];
    if (!prefersHtml(acceptHeader)) {
      sendNotFoundEnvelope(request, reply);
      return;
    }
    const target = pickFrontendFor(request.url, frontends);
    if (target === undefined) {
      sendNotFoundEnvelope(request, reply);
      return;
    }
    return sendSpaIndex(reply, target.distDir, target.defaultIndex);
  });
};

/**
 * The plugin. Registered LAST in `server.ts` so API routes take
 * precedence and the SPA-fallback handler only sees requests no
 * earlier route satisfied.
 */
export const staticFrontendsPlugin: FastifyPluginAsync<StaticFrontendsPluginOptions> =
  staticFrontendsPluginAsync;
