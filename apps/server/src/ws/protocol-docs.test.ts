// Documentation-coverage test for the WS protocol reference.
//
// Refinement: tasks/refinements/backend/ws_protocol_documentation.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_protocol_documentation
//
// **What this test owns.**
//
// `docs/ws-protocol.md` is the canonical end-user WebSocket protocol
// reference. Two invariants the reference must keep:
//
//   1. **Message-type coverage** — every key in the runtime
//      `wsMessagePayloadSchemas` registry (from `@a-conversa/shared-types`)
//      MUST appear in the markdown as either a heading or a code-fenced
//      literal. The registry is exhaustive over the closed
//      `WsMessageType` union (TypeScript enforces the `Record<…>`
//      keys); if a new type lands in the schema, the test refuses to
//      pass until the doc names it. This is the audit method described
//      in the refinement's Decisions: "the discriminated-union audit
//      walked every `WsMessageType` literal in `ws-envelope.ts` against
//      the doc to ensure 100% coverage."
//
//   2. **Error-code vocabulary** — every code the doc names in its
//      "Error envelope reference" section MUST be in the union of:
//      - the HTTP `ApiError` factory codes (a fixed set of seven
//        kebab strings),
//      - the methodology `RejectionReason` union (currently 23
//        entries; widening tracked in this test's local literal),
//      - and the two WS-specific extensions
//        (`unknown-message-type`, `malformed-envelope`).
//
//      The codes are scraped from the doc's three small tables (HTTP
//      taxonomy / WS-specific / methodology) by finding every
//      backtick-quoted kebab-shaped string inside table rows. The
//      assertion is set-membership: every claimed code MUST be in the
//      union of the three allowed sets.
//
// **Why this test exists (vs. eyeballing the doc).** Per ADR 0022 the
// probe IS the test. The first run of this test answers the question
// "does the doc cover every committed `WsMessageType`?" AND pins the
// answer for every future change. The alternative (a one-shot script
// against `grep` at review time) is exactly the throwaway-probe
// pattern ADR 0022 rules out.
//
// **Test layer.** Vitest, pure-logic — reads the doc from disk via
// `fs.readFileSync`, imports the runtime registry, walks. No Fastify
// instance, no DB, no I/O beyond the one file read.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { wsMessagePayloadSchemas, type WsMessageType } from '@a-conversa/shared-types';

import type { RejectionReason } from '../methodology/types.js';

// Resolve the doc path from this test file's location. The doc lives
// at the repo root under `docs/`; this test lives at
// `apps/server/src/ws/`, so the relative path is four levels up.
const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = resolve(HERE, '../../../../docs/ws-protocol.md');

/**
 * HTTP `ApiError` factory codes (kebab-case) from
 * `apps/server/src/errors.ts`. Hard-coded here rather than derived
 * because the factories are class statics — there's no runtime list
 * to import. If a new factory lands in `errors.ts`, this set MUST be
 * updated in lockstep; the doc lists the same set in its HTTP table.
 *
 * The HTTP factory set is small + stable (seven codes since the
 * api-skeleton task landed); the maintenance burden of keeping this
 * literal in sync is negligible compared to the protection it gives
 * against doc drift.
 */
const HTTP_API_ERROR_CODES = new Set<string>([
  'bad-request',
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'unprocessable-entity',
  'internal-error',
]);

/**
 * WS-specific codes — the two transport-level discriminators that are
 * not in the HTTP taxonomy. Mirrors the exported constants in
 * `error-envelope.ts`; duplicated here as literals so the test stays
 * self-contained and so a future rename of either constant fails this
 * test rather than silently passing under the new name.
 */
const WS_SPECIFIC_CODES = new Set<string>(['unknown-message-type', 'malformed-envelope']);

/**
 * `RejectionReason` union from `apps/server/src/methodology/types.ts`.
 * Hard-coded because the union is a TypeScript type (vanishes at
 * runtime) — there's no `as const` array to import.
 *
 * The `satisfies Record<RejectionReason, true>` annotation below makes
 * the literal a compile-time contract: adding a new `RejectionReason`
 * without extending this map breaks the build, exactly the same way
 * `statusCodeForRejection` in `errors.ts` does. The TypeScript narrowing
 * is the audit; the runtime set is built from the keys.
 */
const REJECTION_REASON_MAP = {
  // Universal.
  'not-a-participant': true,
  'sequence-mismatch': true,
  'session-mismatch': true,
  // Role-gated.
  'not-a-moderator': true,
  // Proposal-reference.
  'proposal-not-found': true,
  'proposal-not-pending': true,
  'proposal-already-committed': true,
  'proposal-already-meta-disagreement': true,
  // Entity-reference.
  'target-entity-not-found': true,
  // Vote-specific.
  'already-voted': true,
  'no-prior-agree': true,
  'self-vote-not-allowed': true,
  'unanimous-agree-required': true,
  // Propose-axiom-mark specific.
  'axiom-mark-not-self': true,
  // Methodology-flow.
  'inapplicable-to-facet': true,
  'illegal-state-transition': true,
  'methodology-not-exhausted': true,
  // Participant-assignment.
  'role-already-filled': true,
  'user-already-joined': true,
  'user-not-found': true,
  'cannot-remove-moderator': true,
  // Entity-inclusion.
  'entity-not-referenceable': true,
  'entity-already-included': true,
} satisfies Record<RejectionReason, true>;

const REJECTION_REASONS = new Set<string>(Object.keys(REJECTION_REASON_MAP));

/**
 * Union of every code legitimately appearing in the doc's error-code
 * tables. Constructed by union of the three sources.
 */
const ALLOWED_ERROR_CODES = new Set<string>([
  ...HTTP_API_ERROR_CODES,
  ...WS_SPECIFIC_CODES,
  ...REJECTION_REASONS,
]);

/**
 * Read the doc once per test file. Throws (loudly) if the file is
 * missing — the failure mode is "the test cannot do its job" which
 * SHOULD halt CI, not silently pass.
 */
function readDoc(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

/**
 * Match a kebab-case literal `code` value the way the doc writes
 * them inside its error-code tables. The doc's tables use the shape
 * `| \`code\` |` for each row's first cell; this regex finds every
 * backtick-quoted kebab-shaped string that appears in any line
 * starting with `|` (i.e. inside a markdown table).
 *
 * Kebab predicate: lowercase letters + digits separated by single
 * hyphens; no leading/trailing hyphens; minimum length 3 (to skip
 * accidental matches like `\`id\`` or `\`ok\`` that aren't error
 * codes). The doc's actual codes are all longer than 3 chars.
 */
const TABLE_ROW_REGEX = /^\|.*$/gm;
const BACKTICK_CODE_REGEX = /`([a-z][a-z0-9]+(?:-[a-z0-9]+)+)`/g;

/**
 * Scan the doc's "Error envelope reference" section's three tables
 * and return every kebab-case code claimed by a table-row cell.
 * Scoped to that section so the message-type catalog's `code` field
 * mentions (e.g. the example JSON's `"code": "not-found"`) don't
 * pollute the scan — those live OUTSIDE the section header.
 */
function extractErrorCodesFromDoc(doc: string): Set<string> {
  // Slice to the "Error envelope reference" section. Header line
  // identified by the H2 anchor `## Error envelope reference`. The
  // section ends at the next H2.
  const sectionStart = doc.indexOf('## Error envelope reference');
  if (sectionStart < 0) {
    throw new Error(
      'protocol-docs: docs/ws-protocol.md is missing the "## Error envelope reference" section',
    );
  }
  const afterStart = doc.slice(sectionStart);
  const nextH2 = afterStart.slice(2).search(/^## /m);
  const sectionEnd = nextH2 < 0 ? afterStart.length : nextH2 + 2;
  const section = afterStart.slice(0, sectionEnd);

  const codes = new Set<string>();
  for (const tableRow of section.match(TABLE_ROW_REGEX) ?? []) {
    // First cell only — that's where the doc puts the code. The
    // doc's tables shape rows as `| \`<code>\` | meaning | typical |`,
    // so the first cell's backtick-pair is the code.
    const firstCellEnd = tableRow.indexOf('|', 1);
    const firstCell = firstCellEnd < 0 ? tableRow : tableRow.slice(0, firstCellEnd + 1);
    for (const match of firstCell.matchAll(BACKTICK_CODE_REGEX)) {
      codes.add(match[1]!);
    }
  }
  return codes;
}

describe('docs/ws-protocol.md — message-type catalog coverage', () => {
  it('the doc file exists and is readable', () => {
    // Trivial smoke check — if the path is wrong, every other test
    // would fail with the same opaque ENOENT; pin the file-read here
    // so a path drift is immediately recognisable.
    const doc = readDoc();
    expect(doc.length).toBeGreaterThan(0);
  });

  it('every WsMessageType literal in the runtime registry appears as a heading or fenced literal in the doc', () => {
    const doc = readDoc();
    // The registry is exhaustive over the closed union — every
    // `WsMessageType` key MUST be present. The doc's catalog uses
    // either ` ### `<literal>` ` headings OR backtick-quoted literals
    // inside paragraphs / JSON examples. We check for either by
    // searching for the literal surrounded by backticks OR appearing
    // verbatim as a string-literal inside double quotes (`"<key>"`).
    const keys = Object.keys(wsMessagePayloadSchemas) as WsMessageType[];
    expect(keys.length).toBeGreaterThan(0);

    const missing: WsMessageType[] = [];
    for (const key of keys) {
      const backticked = `\`${key}\``;
      const quoted = `"${key}"`;
      if (!doc.includes(backticked) && !doc.includes(quoted)) {
        missing.push(key);
      }
    }
    expect(
      missing,
      `docs/ws-protocol.md is missing entries for the following WsMessageType literals: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every WsMessageType literal has a dedicated heading anchor (### `<type>`)', () => {
    // Stronger guarantee than the previous test: every literal MUST
    // have its own catalog entry (### heading), not just a passing
    // mention in another section. The dispatcher's `register(...)`
    // signature uses `### \`<type>\`` as the catalog convention; any
    // new type that ships without a dedicated entry is a doc bug.
    const doc = readDoc();
    const keys = Object.keys(wsMessagePayloadSchemas) as WsMessageType[];
    const missingHeading: WsMessageType[] = [];
    for (const key of keys) {
      const heading = `### \`${key}\``;
      if (!doc.includes(heading)) {
        missingHeading.push(key);
      }
    }
    expect(
      missingHeading,
      `docs/ws-protocol.md is missing a "### \`<type>\`" catalog heading for: ${missingHeading.join(', ')}`,
    ).toEqual([]);
  });
});

describe('docs/ws-protocol.md — error-code vocabulary', () => {
  it('every code claimed in the error-envelope tables is in HTTP ApiError ∪ RejectionReason ∪ {unknown-message-type, malformed-envelope}', () => {
    const doc = readDoc();
    const claimed = extractErrorCodesFromDoc(doc);
    expect(claimed.size).toBeGreaterThan(0);

    const unknown: string[] = [];
    for (const code of claimed) {
      if (!ALLOWED_ERROR_CODES.has(code)) {
        unknown.push(code);
      }
    }
    expect(
      unknown,
      `docs/ws-protocol.md claims error code(s) not in the allowed union: ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('the doc claims at least one code from each of the three source sets', () => {
    // Sanity — if the doc forgot the methodology table entirely, the
    // previous test would still pass (an empty subset is trivially a
    // subset). This ensures the doc covers each source class at
    // least once.
    const doc = readDoc();
    const claimed = extractErrorCodesFromDoc(doc);

    const httpHit = [...claimed].some((c) => HTTP_API_ERROR_CODES.has(c));
    const wsHit = [...claimed].some((c) => WS_SPECIFIC_CODES.has(c));
    const rejectionHit = [...claimed].some((c) => REJECTION_REASONS.has(c));

    expect(httpHit, 'doc does not mention any HTTP ApiError factory code').toBe(true);
    expect(wsHit, 'doc does not mention any WS-specific code').toBe(true);
    expect(rejectionHit, 'doc does not mention any methodology RejectionReason').toBe(true);
  });
});
