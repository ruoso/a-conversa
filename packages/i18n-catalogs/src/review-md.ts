// Native-speaker review sheets — markdown render/parse.
//
// Parking lot: tasks/parking-lot.md (2026-05-30 — Native-speaker review
//              of pt-BR + es-419 translations)
// ADR:         docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// The review pass is done by non-technical native speakers, so the
// `*.review.json` trackers and catalog JSON are not the review surface.
// Instead, `scripts/export-review-md.ts` renders every not-yet-signed-off
// string into a per-locale markdown sheet (English original + draft
// translation + a Status field per entry); the reviewer edits the sheet
// in a PR, and `scripts/import-review-md.ts` parses it back, applies
// wording fixes to the catalogs / walkthrough overlays, and records
// sign-offs in the `*.review.json` trackers.
//
// This module holds the pure render/parse halves so the round-trip is
// unit-testable (`review-md.test.ts`); the CLI scripts own all file IO.
//
// Round-trip contract: the parser is line-anchored (`### ` headings,
// `- **Field:** ` bullets), and catalog values are single-line, so a
// rendered value parses back verbatim with no escaping. Reviewers only
// touch the Translation / Status / Comment lines and the Reviewer header.

/** One string offered for review. */
export interface ReviewEntry {
  /**
   * Dotted catalog key (`methodology.kind.fact`) or a walkthrough
   * overlay key (`walkthrough.<event-id>.<field>`).
   */
  readonly key: string;
  readonly english: string;
  readonly translation: string;
  /** Optional human context line ("Demo event 6: statement wording"). */
  readonly context?: string;
}

/** A reviewer-facing grouping of entries, keyed by top-level prefix. */
export interface ReviewSectionDef {
  /** First dotted segment of the keys this section collects. */
  readonly id: string;
  readonly title: string;
  /** Where in the product these strings appear. */
  readonly description: string;
  /** Extra reviewer guidance rendered as a blockquote, if any. */
  readonly note?: string;
}

/**
 * Section order is the review order: the two sections that need the most
 * care (methodology vocabulary, walkthrough narrative) come first, while
 * the reviewer is fresh. Keys whose prefix matches no entry here fall
 * into a trailing generated section per unknown prefix — new top-level
 * namespaces degrade to "still reviewed", never to "silently dropped".
 */
export const SECTION_DEFS: readonly ReviewSectionDef[] = [
  {
    id: 'methodology',
    title: 'Methodology vocabulary',
    description:
      'The labels and descriptions for statement kinds, edge roles, facet states, ' +
      'votes, annotations, and diagnostics. They appear everywhere participants ' +
      'classify and connect statements.',
    note:
      '**Take special care in this section.** These are precise quasi-philosophical ' +
      'terms, not casual UI labels — participants will use them to reason about each ' +
      "other's arguments, so the chosen word must carry the exact meaning, not just " +
      'sound natural. If you are unsure whether the translated term means precisely ' +
      'the same thing as the English one, set Status to FLAG and describe what the ' +
      'term connotes to you — that flag is as valuable as a fix.',
  },
  {
    id: 'walkthrough',
    title: 'Landing-page walkthrough (demo debate content)',
    description:
      'The example debate ("Should zoos exist?") played as an interactive tutorial ' +
      'on the landing page. These are full sentences from the demo discussion — ' +
      'statement wordings and annotation texts. Read them as a story; if possible, ' +
      'review with the walkthrough open in your language.',
  },
  {
    id: 'landing',
    title: 'Landing page',
    description: 'The public landing page: tutorial controls, captions, and calls to action.',
  },
  {
    id: 'chrome',
    title: 'Application shell',
    description: 'Strings in the shared application frame.',
  },
  {
    id: 'root',
    title: 'Application shell (host page)',
    description: 'Strings on the host page that embeds the apps.',
  },
  {
    id: 'auth',
    title: 'Sign-in screens',
    description: 'Login, logout, and session-expiry messages.',
  },
  {
    id: 'moderator',
    title: 'Moderator app',
    description:
      'Everything the session moderator sees: the graph, menus, proposal and ' +
      'commit flows, session management.',
  },
  {
    id: 'participant',
    title: 'Participant app',
    description: 'Everything a debate participant sees: voting, proposals, history, and filters.',
  },
  {
    id: 'audience',
    title: 'Audience view',
    description: 'The read-only view shown to a watching audience.',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics panel',
    description:
      'Methodology diagnostics shown to the moderator (cycles, orphans, and similar ' +
      'structural findings). Uses the methodology vocabulary — same care applies.',
  },
  {
    id: 'snapshotList',
    title: 'Snapshot list',
    description: 'The list of saved session snapshots.',
  },
  {
    id: 'errors',
    title: 'Error messages',
    description: 'Errors shown when something goes wrong (connection loss, rejected actions).',
  },
  {
    id: 'testMode',
    title: 'Test mode',
    description:
      'The internal rehearsal-mode banner and controls. Only shown to crews running ' +
      'a test session, but translated all the same.',
  },
];

/** The section a key belongs to: its first dotted segment. */
export function sectionIdForKey(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

export type ReviewStatus = 'pending' | 'ok' | 'flag';

export interface ParsedReviewEntry {
  readonly key: string;
  readonly english: string;
  readonly translation: string;
  readonly status: ReviewStatus;
  readonly comment?: string;
}

export interface ParsedReview {
  readonly locale: string;
  /** null when the Reviewer header was left as the placeholder. */
  readonly reviewer: string | null;
  readonly entries: readonly ParsedReviewEntry[];
}

const REVIEWER_PLACEHOLDER = '_(replace this with your name)_';

export interface RenderInput {
  readonly locale: string;
  /** Human name of the locale, e.g. "Português (Brasil)". */
  readonly localeTitle: string;
  readonly entries: readonly ReviewEntry[];
}

const INSTRUCTIONS = `## How to review

Each entry below shows the English original and our draft translation,
under a heading saying where in the app the text appears. For every entry,
do ONE of these:

1. **The translation is good as-is** — change its \`Status\` line from
   \`PENDING\` to \`OK\`.
2. **The translation needs a fix** — edit the text on the \`Translation\`
   line directly (keep it on one line), then set \`Status\` to \`OK\`.
3. **You are unsure** — set \`Status\` to \`FLAG\` and add a line
   \`- **Comment:** your concern here\` explaining what bothers you.

Leave anything you did not get to as \`PENDING\` — a partial review is
fine, the remaining entries simply stay in the queue.

Rules of thumb:

- The translation should sound like something a real app in your language
  would say — natural phrasing beats word-for-word fidelity.
- Anything in curly braces like \`{step}\` or \`{count, plural, ...}\` is a
  placeholder the app fills in. Keep it exactly as written, including the
  braces, and make sure the sentence around it still works.
- Do not edit the **English** lines — they are the reference text.
- First name the labels consistently: if you change how a term is
  translated in one entry, look for the other entries using the same term.`;

function renderEntry(entry: ReviewEntry): string {
  const lines: string[] = [`### \`${entry.key}\``, ''];
  if (entry.context !== undefined) {
    lines.push(`- **Where:** ${entry.context}`);
  }
  lines.push(
    `- **English:** ${entry.english}`,
    `- **Translation:** ${entry.translation}`,
    `- **Status:** PENDING`,
  );
  return lines.join('\n');
}

/**
 * Render the review sheet for one locale. Entries are grouped into
 * `SECTION_DEFS` order; entries whose prefix matches no section are
 * appended in trailing per-prefix sections.
 */
export function renderReviewMarkdown(input: RenderInput): string {
  const bySection = new Map<string, ReviewEntry[]>();
  for (const entry of input.entries) {
    const id = sectionIdForKey(entry.key);
    const bucket = bySection.get(id);
    if (bucket === undefined) {
      bySection.set(id, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const parts: string[] = [
    '<!--',
    '  Generated by `pnpm --filter @a-conversa/i18n-catalogs run review:export`.',
    '  This file is machine-read on import: keep the `### ` headings and the',
    '  `- **Field:** ` line structure intact. Edit only the Translation, Status,',
    '  and Comment lines — and the Reviewer line just below.',
    '-->',
    '',
    `# Translation review — ${input.localeTitle}`,
    '',
    `**Locale:** \`${input.locale}\` _(do not change this line)_`,
    '',
    `**Reviewer:** ${REVIEWER_PLACEHOLDER}`,
    '',
    INSTRUCTIONS,
  ];

  const renderSection = (def: ReviewSectionDef, entries: readonly ReviewEntry[]): void => {
    parts.push('', '---', '', `## ${def.title}`, '', `_${def.description}_`);
    if (def.note !== undefined) {
      parts.push('', `> ${def.note}`);
    }
    for (const entry of entries) {
      parts.push('', renderEntry(entry));
    }
  };

  for (const def of SECTION_DEFS) {
    const entries = bySection.get(def.id);
    if (entries !== undefined) {
      renderSection(def, entries);
      bySection.delete(def.id);
    }
  }
  // Unknown prefixes: still rendered, in first-seen order.
  for (const [id, entries] of bySection) {
    renderSection(
      { id, title: `Other: ${id}`, description: `Strings under the \`${id}\` namespace.` },
      entries,
    );
  }

  parts.push('');
  return parts.join('\n');
}

function parseStatus(raw: string): ReviewStatus | null {
  switch (raw.trim().toUpperCase()) {
    case 'PENDING':
      return 'pending';
    case 'OK':
    case 'APPROVED':
      return 'ok';
    case 'FLAG':
    case 'FLAGGED':
      return 'flag';
    default:
      return null;
  }
}

interface EntryDraft {
  key: string;
  line: number;
  english?: string;
  translation?: string;
  status?: string;
  comment?: string;
}

/**
 * Parse a (possibly reviewer-edited) review sheet back into structured
 * entries. Throws a single Error aggregating every structural problem —
 * unknown status values, duplicate keys, entries missing their fields —
 * so a reviewer's mistakes surface in one pass.
 */
export function parseReviewMarkdown(text: string): ParsedReview {
  const lines = text.split('\n');
  const errors: string[] = [];
  const entries: ParsedReviewEntry[] = [];
  const seenKeys = new Set<string>();
  let locale: string | null = null;
  let reviewer: string | null = null;
  let draft: EntryDraft | null = null;

  const finishDraft = (): void => {
    if (draft === null) return;
    const { key, line } = draft;
    if (seenKeys.has(key)) {
      errors.push(`line ${String(line)}: duplicate entry for key \`${key}\``);
      draft = null;
      return;
    }
    seenKeys.add(key);
    if (
      draft.english === undefined ||
      draft.translation === undefined ||
      draft.status === undefined
    ) {
      const missing = [
        draft.english === undefined ? 'English' : null,
        draft.translation === undefined ? 'Translation' : null,
        draft.status === undefined ? 'Status' : null,
      ].filter((f): f is string => f !== null);
      errors.push(
        `line ${String(line)}: entry \`${key}\` is missing its ${missing.join(' / ')} line(s)`,
      );
      draft = null;
      return;
    }
    const status = parseStatus(draft.status);
    if (status === null) {
      errors.push(
        `line ${String(line)}: entry \`${key}\` has unknown status ${JSON.stringify(draft.status.trim())} — use PENDING, OK, or FLAG`,
      );
      draft = null;
      return;
    }
    entries.push({
      key,
      english: draft.english,
      translation: draft.translation,
      status,
      ...(draft.comment !== undefined ? { comment: draft.comment } : {}),
    });
    draft = null;
  };

  const setField = (
    field: 'english' | 'translation' | 'status' | 'comment',
    label: string,
    value: string,
    lineNo: number,
  ): void => {
    if (draft === null) return;
    if (draft[field] !== undefined) {
      errors.push(`line ${String(lineNo)}: entry \`${draft.key}\` has more than one ${label} line`);
      return;
    }
    draft[field] = value;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    const heading = /^### `(.+)`\s*$/.exec(line);
    if (heading !== null) {
      finishDraft();
      draft = { key: heading[1] ?? '', line: lineNo };
      continue;
    }
    if (line.startsWith('## ')) {
      finishDraft();
      continue;
    }

    const localeMatch = /^\*\*Locale:\*\*\s*`([^`]+)`/.exec(line);
    if (localeMatch !== null && locale === null) {
      locale = localeMatch[1] ?? null;
      continue;
    }
    const reviewerMatch = /^\*\*Reviewer:\*\*\s*(.*)$/.exec(line);
    if (reviewerMatch !== null && reviewer === null) {
      const raw = (reviewerMatch[1] ?? '').trim();
      reviewer = raw === '' || raw === REVIEWER_PLACEHOLDER ? null : raw;
      continue;
    }

    const field = /^- \*\*(English|Translation|Status|Comment):\*\* ?(.*)$/.exec(line);
    if (field !== null && draft !== null) {
      const label = field[1] ?? '';
      const value = field[2] ?? '';
      switch (label) {
        case 'English':
          setField('english', 'English', value, lineNo);
          break;
        case 'Translation':
          setField('translation', 'Translation', value, lineNo);
          break;
        case 'Status':
          setField('status', 'Status', value, lineNo);
          break;
        case 'Comment':
          setField('comment', 'Comment', value, lineNo);
          break;
      }
    }
  }
  finishDraft();

  if (locale === null) {
    errors.push('no `**Locale:** `\\`<tag>\\`` header line found — was it edited or removed?');
  }
  if (errors.length > 0) {
    throw new Error(`review sheet parse failed:\n  ${errors.join('\n  ')}`);
  }
  return { locale: locale ?? '', reviewer, entries };
}

/**
 * The ICU placeholder names used in a catalog value, sorted and
 * de-duplicated. Matches both simple arguments (`{step}`) and the
 * argument name of complex ones (`{count, plural, ...}`); used on import
 * to reject an edited translation that drops or mistypes a placeholder.
 */
export function extractPlaceholders(value: string): readonly string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(/\{\s*([A-Za-z0-9_]+)/g)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names].sort();
}
