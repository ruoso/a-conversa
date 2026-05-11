// Step definitions for tests/behavior/backend/openapi.feature.
//
// Refinement: tasks/refinements/backend/openapi_or_equivalent.md
// TaskJuggler: backend.api_skeleton.openapi_or_equivalent
//
// The shared http-server step defs already provide:
//   - `Given an HTTP server built from createServer`
//   - `When a GET request is sent to "..."`
//   - `Then the response status is <int>`
//   - `After`-hook teardown for `world.scratch.httpServer`
// We reuse them via the same `world.scratch.lastResponse` carrier the
// existing http-server.steps.ts owns. This file only adds the
// OpenAPI-specific assertions (parseable document, path present, tag
// list present, content-type check).
//
// No new World fields, no new teardown hook — the existing carriers
// cover everything.

import { Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import type { AConversaWorld } from '../support/world.js';

// Carrier shape established by `tests/behavior/steps/http-server.steps.ts`.
// Re-declared structurally (no import dance) so this step file's cast
// against `world.scratch` stays compatible with the rest of the suite.
interface InjectedResponse {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}

interface HttpScratch {
  lastResponse?: InjectedResponse;
}

function scratch(world: AConversaWorld): HttpScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as HttpScratch;
}

// Minimal structural view of the OpenAPI document — enough for the
// assertions in this step file. The full type lives behind a
// workspace-local transitive dep that the test tsconfig doesn't
// resolve.
interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; version?: string };
  tags?: Array<{ name?: string }>;
  paths?: Record<string, unknown>;
}

Then('the response body is a parseable OpenAPI document', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured — When step missing');
  // `JSON.parse` throws if the body isn't valid JSON; the throw IS the
  // assertion failure. We then verify the document carries the OpenAPI
  // version marker (3.x) so a randomly-shaped JSON body doesn't pass
  // by accident.
  const parsed = JSON.parse(res.body) as OpenApiDoc;
  assert.ok(
    typeof parsed.openapi === 'string' && /^3\./u.test(parsed.openapi),
    `expected an OpenAPI 3.x document; got openapi=${JSON.stringify(parsed.openapi)}`,
  );
  assert.ok(
    parsed.info && typeof parsed.info.title === 'string',
    'OpenAPI document missing info.title',
  );
});

Then(
  'the OpenAPI document includes the {string} path',
  function (this: AConversaWorld, path: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    const parsed = JSON.parse(res.body) as OpenApiDoc;
    const paths = parsed.paths ?? {};
    assert.ok(
      Object.hasOwn(paths, path),
      `OpenAPI document does not include path ${JSON.stringify(path)}; ` +
        `present paths: ${JSON.stringify(Object.keys(paths))}`,
    );
  },
);

Then(
  'the OpenAPI document declares the tag taxonomy {string}',
  function (this: AConversaWorld, csv: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    const parsed = JSON.parse(res.body) as OpenApiDoc;
    const expected = csv.split(',').map((s) => s.trim());
    const actual = (parsed.tags ?? [])
      .map((t) => t.name)
      .filter((n): n is string => typeof n === 'string');
    // Positional equality — the tag order is meaningful (Swagger UI
    // renders tags in declaration order, and consumers reading the doc
    // will see them in that order). A future addition to the taxonomy
    // requires updating both the source (`OPENAPI_TAGS` in openapi.ts)
    // and this scenario's expected list, so taxonomy drift is caught.
    assert.deepStrictEqual(
      actual,
      expected,
      `OpenAPI tag taxonomy drift — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  },
);

Then(
  'the response content-type is {string}',
  function (this: AConversaWorld, expectedPrefix: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    const contentType = res.headers['content-type'];
    assert.equal(
      typeof contentType,
      'string',
      `expected content-type header to be a string, got ${typeof contentType}`,
    );
    assert.ok(
      typeof contentType === 'string' && contentType.startsWith(expectedPrefix),
      `expected content-type to start with ${JSON.stringify(expectedPrefix)}, got ${JSON.stringify(contentType)}`,
    );
  },
);
