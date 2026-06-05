// Vitest unit tests for the static-frontends plugin.
//
// Refinement: tasks/refinements/backend/serve_static_frontends.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.serve_static_frontends
//
// Coverage:
//   1. `GET /` returns the moderator SPA's `index.html` with HTML
//      content-type and a `no-cache` directive.
//   2. `GET /assets/<file>` returns the bundle file with a content-
//      type matching its extension and an immutable cache-control
//      (per Vite's hash-named asset story).
//   3. `GET /healthz` still returns 200 + the canonical JSON envelope
//      (API route precedence pin — if the static plugin ever shadowed
//      it, this catches the regression).
//   4. `GET /auth/me` without an auth cookie returns 401 with the
//      canonical envelope (API route precedence pin — confirms the
//      static handler does NOT silently serve HTML for known API
//      paths).
//   5. `GET /unknown/spa/path` with `Accept: text/html` returns the
//      SPA's `index.html` at 200 (SPA fallback).
//   6. `GET /unknown/api/path` with `Accept: application/json` returns
//      the canonical 404 envelope (no SPA HTML in API path).
//   7. `GET /unknown/path` with no Accept header returns the canonical
//      404 envelope (default-to-JSON — see plugin docstring).
//   8. `POST /unknown` (non-GET) returns the canonical 404 envelope
//      regardless of Accept (SPA fallback only applies to GET/HEAD).
//   9. Missing `distDir` at registration throws — fail-fast at boot.
//  10. The `MODERATOR_DIST_DIR` env override is honored by the
//      resolver (unit test on `resolveModeratorDistDir`).
//
// Tests use Fastify's built-in `app.inject(...)` — no port bind, no
// network. See ADR 0022.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer } from '../server.js';
import {
  ROOT_DIST_DIR_ENV,
  MODERATOR_DIST_DIR_ENV,
  resolveRootDistDir,
  resolveModeratorDistDir,
  staticFrontendsPlugin,
} from './static-frontends.js';

describe('static-frontends plugin — root served at /', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // `createServer({ logger: false })` registers the plugin against
    // the default moderator dist (resolved from this module's
    // location). The CI / dev story: `pnpm -F @a-conversa/moderator
    // build` is a prerequisite for the Vitest suite; the same way
    // server.test.ts implicitly relies on `pnpm install` being run.
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns the root app index.html with no-cache', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    // The shipped index.html mounts at `<div id="root">` (Vite's
    // template); confirm we got the bundle's HTML, not something
    // else.
    expect(response.body).toContain('<div id="root"></div>');
  });

  it('GET /assets/<bundle.js> returns the bundle with immutable caching', async () => {
    // We don't know the hashed filename a priori — the bundler emits
    // a stable `assets/index-<hash>.js` per build. Fetch the index
    // first to discover the actual filename, then fetch the asset.
    const indexResp = await app.inject({ method: 'GET', url: '/' });
    const match = /\/assets\/(index-[\w-]+\.js)/.exec(indexResp.body);
    expect(match).not.toBeNull();
    const assetName = match![1];

    const assetResp = await app.inject({ method: 'GET', url: `/assets/${assetName}` });
    expect(assetResp.statusCode).toBe(200);
    expect(assetResp.headers['content-type']).toMatch(/application\/javascript|text\/javascript/);
    // Vite's hash-named assets are immutable across builds — the
    // plugin opts into `cache-control: immutable, max-age=1y` for the
    // entire dist tree.
    const cacheControl = String(assetResp.headers['cache-control'] ?? '');
    expect(cacheControl).toMatch(/max-age=/);
  });

  it('GET /_surfaces/manifest.json returns the moderator surface manifest with hash-busted URLs', async () => {
    // The manifest's role is to point the root shell at the current
    // moderator bundle. The exact filename carries a content hash
    // (`moderator-<hash>.js`, see `apps/moderator/vite.config.ts` and
    // the `static-frontends` plugin's `discoverSingleFile` boot scan)
    // — pin the prefix + extension so a regression in the discovery
    // or in the build's hashing fails here.
    const response = await app.inject({
      method: 'GET',
      url: '/_surfaces/manifest.json',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    // Manifest is served `no-cache` so a deploy's fresh URL reaches
    // returning browsers immediately — pin that too, since the whole
    // hash-bust story collapses if the manifest itself gets cached.
    expect(response.headers['cache-control']).toMatch(/no-cache/);
    const body = response.json<{
      surfaces?: { moderator?: { moduleUrl?: string; styleUrls?: string[] } };
    }>();
    expect(body.surfaces?.moderator?.moduleUrl).toMatch(
      /^\/_surfaces\/moderator\/moderator-[A-Za-z0-9_-]+\.js$/,
    );
    const styleUrls = body.surfaces?.moderator?.styleUrls ?? [];
    expect(styleUrls).toHaveLength(1);
    expect(styleUrls[0]).toMatch(/^\/_surfaces\/moderator\/assets\/moderator-[A-Za-z0-9_-]+\.css$/);
  });

  it('GET /_surfaces/manifest.json lists the participant surface with hash-busted URLs', async () => {
    // The participant entry is the second wired surface (after the
    // moderator). Per `tasks/refinements/participant-ui/part_app_skeleton.md`
    // the entry's filenames mirror the moderator's shape — pin the
    // same prefix + extension regex against the participant URL so a
    // regression in the discovery or in the build's hashing fails
    // here just like for the moderator. The CI / dev story: `pnpm -F
    // @a-conversa/participant build` is a prerequisite for this case,
    // the same way the moderator-equivalent above relies on a prior
    // `pnpm -F @a-conversa/moderator build`.
    const response = await app.inject({
      method: 'GET',
      url: '/_surfaces/manifest.json',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toMatch(/no-cache/);
    const body = response.json<{
      surfaces?: { participant?: { moduleUrl?: string; styleUrls?: string[] } };
    }>();
    expect(body.surfaces?.participant?.moduleUrl).toMatch(
      /^\/_surfaces\/participant\/participant-[A-Za-z0-9_-]+\.js$/,
    );
    const styleUrls = body.surfaces?.participant?.styleUrls ?? [];
    expect(styleUrls).toHaveLength(1);
    expect(styleUrls[0]).toMatch(
      /^\/_surfaces\/participant\/assets\/participant-[A-Za-z0-9_-]+\.css$/,
    );
  });

  it('GET /_surfaces/manifest.json lists the audience surface with hash-busted URLs', async () => {
    // The audience entry is the third wired surface (after moderator
    // and participant). Per `tasks/refinements/audience/aud_app_skeleton.md`
    // the entry's filenames mirror the participant + moderator shape —
    // pin the same prefix + extension regex against the audience URL
    // so a regression in the discovery or in the build's hashing fails
    // here just like for the other two surfaces. The CI / dev story:
    // `pnpm -F @a-conversa/audience build` is a prerequisite for this
    // case.
    const response = await app.inject({
      method: 'GET',
      url: '/_surfaces/manifest.json',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toMatch(/no-cache/);
    const body = response.json<{
      surfaces?: { audience?: { moduleUrl?: string; styleUrls?: string[] } };
    }>();
    expect(body.surfaces?.audience?.moduleUrl).toMatch(
      /^\/_surfaces\/audience\/audience-[A-Za-z0-9_-]+\.js$/,
    );
    const styleUrls = body.surfaces?.audience?.styleUrls ?? [];
    expect(styleUrls).toHaveLength(1);
    expect(styleUrls[0]).toMatch(/^\/_surfaces\/audience\/assets\/audience-[A-Za-z0-9_-]+\.css$/);
  });

  it('GET /_surfaces/manifest.json lists the test-mode surface with hash-busted URLs', async () => {
    // The test-mode entry is the fourth wired surface (after moderator,
    // participant, and audience). Per
    // `tasks/refinements/replay_test/test_mode_app.md` the entry's
    // filenames mirror the audience + participant + moderator shape —
    // pin the same prefix + extension regex against the test-mode URL
    // so a regression in the discovery or in the build's hashing fails
    // here just like for the other three surfaces. The CI / dev story:
    // `pnpm -F @a-conversa/test-mode build` is a prerequisite for this
    // case.
    const response = await app.inject({
      method: 'GET',
      url: '/_surfaces/manifest.json',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toMatch(/no-cache/);
    const body = response.json<{
      surfaces?: { 'test-mode'?: { moduleUrl?: string; styleUrls?: string[] } };
    }>();
    expect(body.surfaces?.['test-mode']?.moduleUrl).toMatch(
      /^\/_surfaces\/test-mode\/test-mode-[A-Za-z0-9_-]+\.js$/,
    );
    const styleUrls = body.surfaces?.['test-mode']?.styleUrls ?? [];
    expect(styleUrls).toHaveLength(1);
    expect(styleUrls[0]).toMatch(/^\/_surfaces\/test-mode\/assets\/test-mode-[A-Za-z0-9_-]+\.css$/);
  });

  it('GET <discovered moderator module URL> returns the surface bundle', async () => {
    // The actual filename is unknown a priori (it carries a content
    // hash). Read the manifest, then fetch the URL it advertises.
    const manifest = await app.inject({
      method: 'GET',
      url: '/_surfaces/manifest.json',
      headers: { accept: 'application/json' },
    });
    const body = manifest.json<{
      surfaces?: { moderator?: { moduleUrl?: string } };
    }>();
    const moduleUrl = body.surfaces?.moderator?.moduleUrl;
    expect(moduleUrl, 'manifest must advertise a moderator moduleUrl').toBeDefined();

    const response = await app.inject({ method: 'GET', url: moduleUrl as string });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/javascript|text\/javascript/);
    // Hashed bundle assets are immutable-cached for a year — that's
    // safe precisely because the URL changes on every build.
    expect(String(response.headers['cache-control'] ?? '')).toMatch(/max-age=/);
  });

  it('GET /healthz still returns the canonical JSON envelope (API precedence)', async () => {
    // Regression pin: if a future refactor accidentally registered
    // the static plugin BEFORE the api routes, the wildcard would
    // shadow `/healthz` and this test would fail.
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = response.json<{ status?: string }>();
    expect(body.status).toBe('ok');
  });

  it('GET /api/auth/me without auth returns the canonical 401 envelope (API precedence)', async () => {
    // The `/api/auth/me` route is registered when OIDC env is set —
    // in the test bootstrap it may be skipped (no OIDC config).
    // Either way, the static handler must NOT silently serve HTML
    // for the path — the response must be one of:
    //   - 401 from `app.authenticate` (route is registered),
    //   - 404 JSON envelope from the static-frontends not-found
    //     handler (route is not registered).
    // Both shapes are application/json and never HTML.
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { accept: 'application/json' },
    });
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect([401, 404]).toContain(response.statusCode);
  });

  it('GET /unknown/spa/path with Accept: text/html returns the SPA index.html', async () => {
    // After the `/api/*` migration any non-`/api/*` path falls through
    // to the SPA index when the client prefers HTML — the SPA owns the
    // entire non-API namespace under `/`. Refinement:
    //   tasks/refinements/backend/serve_static_frontends_path_collision_fix.md.
    const response = await app.inject({
      method: 'GET',
      url: '/sessions/abc/lobby',
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.body).toContain('<div id="root"></div>');
  });

  it('GET /unknown/api/path with Accept: application/json returns the 404 envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/this-does-not-exist',
      headers: { accept: 'application/json' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = response.json<{ error?: { code?: string; message?: string } }>();
    expect(body.error?.code).toBe('not-found');
    expect(body.error?.message).toBe('Route not found');
  });

  it('GET /unknown with no Accept header defaults to the JSON 404 envelope', async () => {
    // Default-to-JSON is the safer choice for headless / scripting
    // clients — a curl with no Accept header gets the canonical
    // envelope, not a stray HTML body.
    const response = await app.inject({
      method: 'GET',
      url: '/no-such-route',
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('POST /unknown returns the JSON 404 envelope regardless of Accept', async () => {
    // Non-GET unknown paths are API consumers with a wrong URL — the
    // SPA fallback applies to GET/HEAD only.
    const response = await app.inject({
      method: 'POST',
      url: '/does-not-exist',
      headers: { accept: 'text/html', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });
});

describe('static-frontends plugin — fail-fast at boot', () => {
  it('throws when a configured frontend distDir does not exist', async () => {
    // Pass a bespoke frontends option that points at a non-existent
    // directory; the plugin should throw at registration. We build a
    // tiny Fastify instance directly (rather than via createServer)
    // so the error surfaces cleanly without the rest of the bootstrap
    // path noise.
    const Fastify = (await import('fastify')).default;
    const app = Fastify({ logger: false });
    try {
      const missing = join(tmpdir(), 'a-conversa-test-missing-dist-' + Date.now());
      await expect(
        app.register(staticFrontendsPlugin, {
          frontends: [
            {
              urlPrefix: '/',
              distDir: missing,
              defaultIndex: 'index.html',
              label: 'moderator-missing',
            },
          ],
        }),
      ).rejects.toThrow(/distDir does not exist/);
    } finally {
      await app.close();
    }
  });

  it('throws when a configured frontend distDir exists but lacks the entry document', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify({ logger: false });
    const dir = mkdtempSync(join(tmpdir(), 'a-conversa-empty-dist-'));
    try {
      // The dir exists but has no `index.html` — fail-fast.
      await expect(
        app.register(staticFrontendsPlugin, {
          frontends: [
            {
              urlPrefix: '/',
              distDir: dir,
              defaultIndex: 'index.html',
              label: 'moderator-empty',
            },
          ],
        }),
      ).rejects.toThrow(/missing its entry document/);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when a surface distDir holds two files matching the module pattern (stale build)', async () => {
    // Regression pin for `discoverSingleFile`'s multiple-match throw.
    // A dist that holds bundles from two different commits would let
    // the manifest serve indeterministic URLs; failing fast at
    // registration surfaces the operator's missed `rm -rf dist/`.
    const Fastify = (await import('fastify')).default;
    const app = Fastify({ logger: false });
    const frontendDir = mkdtempSync(join(tmpdir(), 'a-conversa-frontend-stub-'));
    const surfaceDir = mkdtempSync(join(tmpdir(), 'a-conversa-surface-stale-'));
    try {
      // Minimal valid frontend so the plugin progresses to the surface
      // validation step.
      writeFileSync(join(frontendDir, 'index.html'), '<!doctype html><html></html>');
      // Two files match the same module pattern — the stale-dist case.
      writeFileSync(join(surfaceDir, 'moderator-aaaa1111.js'), '// build A');
      writeFileSync(join(surfaceDir, 'moderator-bbbb2222.js'), '// build B');
      await expect(
        app.register(staticFrontendsPlugin, {
          frontends: [
            {
              urlPrefix: '/',
              distDir: frontendDir,
              defaultIndex: 'index.html',
              label: 'root-stub',
            },
          ],
          surfaces: [
            {
              surfaceId: 'moderator',
              urlPrefix: '/_surfaces/moderator/',
              distDir: surfaceDir,
              moduleFilePattern: /^moderator-[A-Za-z0-9_-]+\.js$/,
              label: 'moderator-stale',
            },
          ],
        }),
      ).rejects.toThrow(/matched 2 files/);
    } finally {
      await app.close();
      rmSync(frontendDir, { recursive: true, force: true });
      rmSync(surfaceDir, { recursive: true, force: true });
    }
  });

  it('throws when a surface distDir holds no file matching the module pattern (missing build)', async () => {
    // Regression pin for `discoverSingleFile`'s zero-match throw. A
    // dist that lacks the expected bundle (mis-named output, broken
    // build, forgotten Dockerfile `COPY`) would otherwise serve 404s
    // for every manifest fetch; failing fast keeps the operator's
    // startup log readable.
    const Fastify = (await import('fastify')).default;
    const app = Fastify({ logger: false });
    const frontendDir = mkdtempSync(join(tmpdir(), 'a-conversa-frontend-stub-'));
    const surfaceDir = mkdtempSync(join(tmpdir(), 'a-conversa-surface-empty-'));
    try {
      writeFileSync(join(frontendDir, 'index.html'), '<!doctype html><html></html>');
      // A stray file that does NOT match the pattern — confirms the
      // scan walked the dir but found no match (vs. a directory-empty
      // edge case).
      mkdirSync(join(surfaceDir, 'assets'));
      writeFileSync(join(surfaceDir, 'assets', 'unrelated.txt'), 'noise');
      await expect(
        app.register(staticFrontendsPlugin, {
          frontends: [
            {
              urlPrefix: '/',
              distDir: frontendDir,
              defaultIndex: 'index.html',
              label: 'root-stub',
            },
          ],
          surfaces: [
            {
              surfaceId: 'moderator',
              urlPrefix: '/_surfaces/moderator/',
              distDir: surfaceDir,
              moduleFilePattern: /^moderator-[A-Za-z0-9_-]+\.js$/,
              label: 'moderator-missing',
            },
          ],
        }),
      ).rejects.toThrow(/did not match any file under/);
    } finally {
      await app.close();
      rmSync(frontendDir, { recursive: true, force: true });
      rmSync(surfaceDir, { recursive: true, force: true });
    }
  });
});

describe('resolveModeratorDistDir', () => {
  it('honors the ROOT_DIST_DIR env override when set (absolute path)', () => {
    const override = '/opt/a-conversa/root/dist';
    expect(resolveRootDistDir({ [ROOT_DIST_DIR_ENV]: override })).toBe(override);
  });

  it('honors the MODERATOR_DIST_DIR env override when set (absolute path)', () => {
    const override = '/opt/a-conversa/moderator/dist';
    expect(resolveModeratorDistDir({ [MODERATOR_DIST_DIR_ENV]: override })).toBe(override);
  });

  it('resolves a relative MODERATOR_DIST_DIR against process.cwd()', () => {
    const override = 'custom/moderator/dist';
    const resolved = resolveModeratorDistDir({ [MODERATOR_DIST_DIR_ENV]: override });
    // Relative paths are anchored to `process.cwd()`; the exact prefix
    // varies per environment, so assert the suffix instead.
    expect(resolved).toMatch(/custom\/moderator\/dist$/);
  });

  it('falls back to the source/compiled-symmetric path when the env is unset', () => {
    const resolved = resolveModeratorDistDir({});
    // The default path always ends in `moderator/dist` regardless of
    // whether the test runs against the source or compiled layout.
    expect(resolved).toMatch(/moderator\/dist$/);
  });
});
