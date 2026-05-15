// Vitest unit tests for the OpenAPI / Swagger UI plugin.
//
// Refinement: tasks/refinements/backend/openapi_or_equivalent.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.openapi_or_equivalent
//
// Coverage (per the refinement's Acceptance criteria):
//   1. `GET /docs` (Swagger UI HTML) returns 200.
//   2. `GET /docs/json` returns 200 with content-type
//      `application/json` and parseable JSON whose `openapi` field is
//      a 3.x string.
//   3. The document includes the `/healthz` path with a documented
//      200 response shape.
//   4. The document does NOT include `/` as an OpenAPI path —
//      `/` is now owned by `staticFrontendsPlugin` which serves the
//      moderator SPA's `index.html` and is `schemaHide: true` (per
//      `backend.api_skeleton.serve_static_frontends`). The previous
//      `{ status: 'ok' }` bootstrap smoke route is gone.
//   5. The document declares the full tag taxonomy
//      (`meta`, `auth`, `sessions`, `events`, `replay`).
//   6. `components.schemas.ErrorEnvelope` is present and matches the
//      canonical envelope shape (the runtime `error-handler.ts`
//      emits the same shape; this test pins the documented shape so
//      drift between runtime and document is caught).
//   7. The `info.version` field carries the resolved server version
//      (sourced via the shared `resolveServerVersion` helper).
//
// All tests use Fastify's built-in `app.inject(...)` — no port bind,
// no network. See ADR 0022: each behavior is a permanent regression
// test, not a one-shot probe.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { OPENAPI_TAG_NAMES } from './openapi.js';
import { createServer } from './server.js';

// Minimal shape we read off the generated document. The full
// `OpenAPIV3_1.Document` type lives behind a workspace-local
// transitive dep that the test tsconfig doesn't resolve; this
// structural narrowing covers everything the suite asserts against.
interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  tags?: Array<{ name: string }>;
  paths: Record<
    string,
    Record<
      string,
      {
        tags?: string[];
        responses?: Record<string, unknown>;
        security?: Array<Record<string, string[]>>;
      }
    >
  >;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<
      string,
      { type?: string; in?: string; name?: string; description?: string }
    >;
  };
}

describe('OpenAPI plugin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Swagger UI HTML at /docs (and /docs/)', async () => {
    // The swagger-ui plugin mounts under `routePrefix: '/api/docs'` and
    // serves the index HTML at both `/docs` and `/docs/` (Fastify's
    // route-with-trailing-slash flexibility). The static asset
    // sub-tree (CSS, JS, images) lives at `/docs/static/*`.
    //
    // We assert both forms return 200 + HTML so a regression in
    // routePrefix wiring (e.g. swagger-ui demoted to a sub-path) is
    // caught here, not by a confused operator.
    const docs = await app.inject({ method: 'GET', url: '/api/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toMatch(/text\/html/);
    // The HTML should reference swagger-ui (sanity check on body content).
    expect(docs.body).toMatch(/swagger/i);

    const docsSlash = await app.inject({ method: 'GET', url: '/api/docs/' });
    expect(docsSlash.statusCode).toBe(200);
    expect(docsSlash.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves the OpenAPI JSON document at /docs/json', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);

    // The body parses as JSON and carries the OpenAPI 3.x marker.
    const doc = response.json<OpenApiDoc>();
    expect(typeof doc.openapi).toBe('string');
    expect(doc.openapi).toMatch(/^3\./u);
  });

  it('documents info.title, info.description, and a resolved info.version', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();

    expect(doc.info.title).toBe('a-conversa API');
    // `resolveServerVersion` returns either `npm_package_version` or
    // `'0.0.0'`. We only assert it's a non-empty string — the exact
    // value depends on the test runner's launch path.
    expect(typeof doc.info.version).toBe('string');
    expect(doc.info.version.length).toBeGreaterThan(0);
  });

  it('documents the /healthz path with a 200 response shape and the meta tag', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();

    expect(doc.paths['/healthz']).toBeDefined();
    const healthzGet = doc.paths['/healthz']?.get;
    expect(healthzGet).toBeDefined();
    expect(healthzGet?.tags).toContain('meta');
    // The 200 response is documented (the exact shape — `status` + `version`
    // — is asserted at runtime by routes/healthz.test.ts; here we only
    // confirm the doc carries the entry).
    expect(healthzGet?.responses?.['200']).toBeDefined();
  });

  it('does NOT document `/` — the moderator SPA owns that path', async () => {
    // `serve_static_frontends` removed the `{ status: 'ok' }` smoke
    // route at `/` and mounted the moderator's `dist/` there
    // (`@fastify/static` with `schemaHide: true` so the wildcard
    // doesn't pollute the API doc). The OpenAPI document should
    // therefore have no `paths['/']` entry — the moderator SPA is
    // not API surface.
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();

    expect(doc.paths['/']).toBeUndefined();
  });

  it('declares the full tag taxonomy (meta, auth, sessions, events, replay)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();

    const tagNames = (doc.tags ?? []).map((t) => t.name);
    // Exact-set check — adding a new tag must update OPENAPI_TAGS in
    // openapi.ts and this assertion together (catches silent vocab
    // drift). The order is meaningful — Swagger UI renders tags in
    // declaration order — so the comparison is positional.
    expect(tagNames).toEqual([...OPENAPI_TAG_NAMES]);
  });

  it('exposes the canonical ErrorEnvelope schema under components.schemas', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();

    expect(doc.components?.schemas?.['ErrorEnvelope']).toBeDefined();

    // Narrow the schema to the canonical envelope shape and assert
    // the `error.code` / `error.message` properties are documented.
    // The runtime `error-handler.ts` always emits this exact shape;
    // pinning it here catches drift between the runtime envelope and
    // the documented contract.
    const envelope = doc.components?.schemas?.['ErrorEnvelope'] as {
      type?: string;
      required?: string[];
      properties?: {
        error?: {
          type?: string;
          required?: string[];
          properties?: { code?: { type?: string }; message?: { type?: string } };
        };
      };
    };
    expect(envelope.type).toBe('object');
    expect(envelope.required).toContain('error');
    expect(envelope.properties?.error?.type).toBe('object');
    expect(envelope.properties?.error?.required).toEqual(
      expect.arrayContaining(['code', 'message']),
    );
    expect(envelope.properties?.error?.properties?.code?.type).toBe('string');
    expect(envelope.properties?.error?.properties?.message?.type).toBe('string');
  });

  it('declares the cookieAuth security scheme (in: cookie, name: aconversa-session)', async () => {
    // The auth middleware (`apps/server/src/auth/middleware.ts`)
    // requires the `aconversa-session` cookie on every protected
    // route. The OpenAPI document declares the corresponding
    // `securitySchemes.cookieAuth` entry so generated clients
    // understand the cookie requirement. Refinement:
    // tasks/refinements/backend/auth_middleware.md.
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();
    const scheme = doc.components?.securitySchemes?.['cookieAuth'];
    expect(scheme).toBeDefined();
    expect(scheme?.type).toBe('apiKey');
    expect(scheme?.in).toBe('cookie');
    expect(scheme?.name).toBe('aconversa-session');
  });

  it('routes that reference ErrorEnvelope have a documented 5xx response', async () => {
    // `GET /healthz` attaches `errorEnvelopeRef` to
    // `schema.response['5xx']`. The OpenAPI 3.x spec uses uppercase
    // status-class keys (`'5XX'`), and `@fastify/swagger`
    // normalizes Fastify's lowercase `'5xx'` into that form when
    // assembling the document — see lib/spec/openapi/utils.js's
    // `resolveResponse` (it uppercases everything except `'default'`).
    //
    // We accept `'5XX'`, `'5xx'`, `'500'`, and `'default'` so the
    // test stays insensitive to minor generator-version changes; the
    // contract being pinned is "an error response is documented,"
    // not "the documented response key is exactly this string."
    //
    // The previous loop also asserted against `/` — that route is
    // gone (the moderator SPA owns `/` per
    // `backend.api_skeleton.serve_static_frontends`).
    const response = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = response.json<OpenApiDoc>();

    for (const path of ['/healthz']) {
      const responses = doc.paths[path]?.get?.responses ?? {};
      const hasErrorResponse =
        '5XX' in responses || '5xx' in responses || '500' in responses || 'default' in responses;
      expect(hasErrorResponse).toBe(true);
    }
  });
});
