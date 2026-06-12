// Migration safety linter — enforces the ADR 0034 backward-compat
// invariant over apps/server/migrations/*.sql.
//
// Refinement: tasks/refinements/deployment/migration_safety_checks.md
// ADRs:        docs/adr/0034-releases-calendar-versioning-tag-deploy.md,
//              docs/adr/0020-migrations-node-pg-migrate-forward-only.md
// TaskJuggler: deployment.prod_migrations.migration_safety_checks
//
// **The invariant.** Rollback is image rollback, never migration
// rollback (ADR 0034): Railway redeploys the previous image while
// migrations stay applied. Therefore every migration must be
// tolerable by the immediately previous deployed image. A change the
// prior image cannot tolerate (dropping/renaming a column it reads,
// changing a type it writes, adding a NOT NULL it doesn't supply)
// must be split across two consecutive releases — the "two-tag
// dance" documented in the release runbook.
//
// **The escape hatch.** When a migration legitimately carries a
// flagged pattern (the N+1 half of the dance, or a provably safe
// type change), the author adds a per-rule marker comment with a
// mandatory justification:
//
//     -- migration-safety: allow drop-column: release v2026.07.01
//     --   stopped reading users.legacy_flag; this is the N+1 half.
//
// (The justification must be non-empty on the marker line itself; a
// marker for rule A does not silence rule B.)
//
// **Mechanism.** Regex rules over comment- and string-stripped SQL —
// deliberately not a SQL parser; see the refinement's Decisions.
// Invoked as `pnpm run lint:migrations` (wired into `pnpm run check`
// and the ci.yml Lint job). Exits non-zero on any finding. The rule
// core is exported for the vitest suite in
// tests/smoke/lint-migrations.test.ts (ADR 0022 — the linter's
// behavior is pinned by permanent tests, not by ad-hoc probes).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Rule identifiers — also the `<rule-id>` accepted by the marker. */
export type MigrationSafetyRuleId =
  | 'drop-table'
  | 'drop-column'
  | 'rename-table'
  | 'rename-column'
  | 'alter-column-type'
  | 'set-not-null'
  | 'add-not-null-without-default'
  | 'truncate';

export interface MigrationFinding {
  readonly rule: MigrationSafetyRuleId | 'invalid-marker';
  /** Human-oriented detail: the offending statement (trimmed) or marker problem. */
  readonly detail: string;
}

interface StatementRule {
  readonly id: MigrationSafetyRuleId;
  /** Fires when the regex matches a (stripped) SQL statement. */
  readonly pattern: RegExp;
  /**
   * Optional second gate evaluated on the same statement; the rule
   * fires only when this also returns true. Used by the
   * add-not-null-without-default compound rule.
   */
  readonly alsoRequire?: (statement: string) => boolean;
}

/**
 * The rule table. Patterns run against UPPERCASED, comment- and
 * string-stripped, whitespace-collapsed single statements, so `\s+`
 * never spans what was a comment and quoted prose can't trip a rule.
 */
export const MIGRATION_SAFETY_RULES: ReadonlyArray<StatementRule> = [
  { id: 'drop-table', pattern: /\bDROP\s+TABLE\b/ },
  { id: 'drop-column', pattern: /\bDROP\s+COLUMN\b/ },
  { id: 'rename-column', pattern: /\bRENAME\s+COLUMN\b/ },
  // RENAME TO covers table renames (ALTER TABLE x RENAME TO y) and
  // also constraint/index renames — all of them change names the
  // prior image may reference.
  { id: 'rename-table', pattern: /\bRENAME\s+TO\b/ },
  // Any column type change. `SET DATA TYPE` is the long form.
  { id: 'alter-column-type', pattern: /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/ },
  { id: 'set-not-null', pattern: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/ },
  {
    id: 'add-not-null-without-default',
    pattern: /\bADD\s+COLUMN\b[^,]*\bNOT\s+NULL\b/,
    // A DEFAULT anywhere in the same ADD COLUMN clause keeps the
    // prior image's INSERTs working (Postgres fills the value).
    alsoRequire: (statement) => {
      const addClauses = statement.match(/\bADD\s+COLUMN\b[^,]*/g) ?? [];
      return addClauses.some((c) => /\bNOT\s+NULL\b/.test(c) && !/\bDEFAULT\b/.test(c));
    },
  },
  { id: 'truncate', pattern: /\bTRUNCATE\b/ },
];

const RULE_IDS: ReadonlySet<string> = new Set(MIGRATION_SAFETY_RULES.map((r) => r.id));

/**
 * Marker grammar: `-- migration-safety: allow <rule-id>: <justification>`
 * The justification must be non-empty on the marker line.
 */
const MARKER_PATTERN = /^\s*--\s*migration-safety:\s*allow\s+(\S+)\s*:\s*(.*)$/;

/**
 * Strip line comments (`--`), block comments, and single-quoted
 * string literals (with `''` escapes) so rule patterns only ever see
 * structural SQL. Dollar-quoted strings are not handled — none exist
 * in the corpus and introducing one for DDL would be unusual enough
 * to warrant linter attention anyway.
 */
export function stripSqlProse(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Parse the allow-markers out of the RAW (unstripped) SQL. */
export function parseAllowMarkers(sql: string): {
  readonly allowed: ReadonlySet<string>;
  readonly invalid: ReadonlyArray<string>;
} {
  const allowed = new Set<string>();
  const invalid: string[] = [];
  for (const line of sql.split('\n')) {
    const match = MARKER_PATTERN.exec(line);
    if (match === null) {
      // Catch near-miss markers (wrong grammar) so a typo'd marker
      // fails loudly instead of silently not suppressing.
      if (/--\s*migration-safety:/.test(line)) {
        invalid.push(`unparseable marker: "${line.trim()}"`);
      }
      continue;
    }
    const [, ruleId, justification] = match;
    if (ruleId === undefined || !RULE_IDS.has(ruleId)) {
      invalid.push(`unknown rule id in marker: "${line.trim()}"`);
      continue;
    }
    if (justification === undefined || justification.trim().length === 0) {
      invalid.push(`marker for '${ruleId}' has an empty justification: "${line.trim()}"`);
      continue;
    }
    allowed.add(ruleId);
  }
  return { allowed, invalid };
}

/**
 * Lint one migration's SQL. Pure — the CLI main and the vitest suite
 * are both thin callers.
 */
export function lintMigrationSql(sql: string): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const { allowed, invalid } = parseAllowMarkers(sql);
  for (const problem of invalid) {
    findings.push({ rule: 'invalid-marker', detail: problem });
  }

  const stripped = stripSqlProse(sql).toUpperCase();
  const statements = stripped
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    for (const rule of MIGRATION_SAFETY_RULES) {
      if (!rule.pattern.test(statement)) continue;
      if (rule.alsoRequire !== undefined && !rule.alsoRequire(statement)) continue;
      if (allowed.has(rule.id)) continue;
      const excerpt = statement.length > 120 ? `${statement.slice(0, 117)}...` : statement;
      findings.push({ rule: rule.id, detail: excerpt });
    }
  }
  return findings;
}

/** Default corpus location, relative to this script. */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'apps', 'server', 'migrations');
}

function main(): void {
  const dir = process.argv[2] ?? migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let total = 0;
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const finding of lintMigrationSql(sql)) {
      total += 1;
      console.error(`${file}: ${finding.rule}: ${finding.detail}`);
    }
  }

  if (total > 0) {
    console.error(
      `\nlint-migrations: ${String(total)} finding(s). Every migration must be tolerable by the ` +
        'previous deployed image (ADR 0034 — rollback is image rollback). Either split the change ' +
        'across two releases (two-tag dance, see the release runbook) or, when the prior image ' +
        'provably tolerates it, add:\n' +
        '  -- migration-safety: allow <rule-id>: <justification>',
    );
    process.exit(1);
  }
  console.log(`lint-migrations: ${String(files.length)} migration(s) clean.`);
}

// Run only when invoked as a CLI (tsx scripts/lint-migrations.ts),
// not when imported by the test suite.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
