// Vitest pins for the migration safety linter (ADR 0034
// backward-compat invariant).
//
// Refinement: tasks/refinements/deployment/migration_safety_checks.md
// ADRs:        docs/adr/0034-releases-calendar-versioning-tag-deploy.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.prod_migrations.migration_safety_checks
//
// Coverage:
//   1. Each rule fires on a minimal offending statement.
//   2. Additive DDL (the shape every existing migration uses) passes.
//   3. The allow-marker silences exactly its rule, only with a
//      non-empty justification; typo'd markers are findings.
//   4. The strip pass: pattern text inside comments / string
//      literals does not false-positive.
//   5. Baseline pin: the real migration corpus under
//      apps/server/migrations/ is clean.
//
// The `tests/` cross-workspace tree is the sanctioned home for
// reaching into repo-root `scripts/` via relative import (see
// coherency-hint-kind-parity.test.ts for the convention note).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { lintMigrationSql, type MigrationFinding } from '../../scripts/lint-migrations.js';

function rules(findings: MigrationFinding[]): string[] {
  return findings.map((f) => f.rule);
}

describe('lint-migrations — rules fire on backward-incompatible DDL', () => {
  it('flags DROP TABLE', () => {
    expect(rules(lintMigrationSql('DROP TABLE users;'))).toEqual(['drop-table']);
  });

  it('flags DROP COLUMN', () => {
    expect(rules(lintMigrationSql('ALTER TABLE users DROP COLUMN legacy_flag;'))).toEqual([
      'drop-column',
    ]);
  });

  it('flags RENAME COLUMN', () => {
    expect(rules(lintMigrationSql('ALTER TABLE users RENAME COLUMN a TO b;'))).toEqual([
      'rename-column',
    ]);
  });

  it('flags table RENAME TO', () => {
    expect(rules(lintMigrationSql('ALTER TABLE users RENAME TO members;'))).toEqual([
      'rename-table',
    ]);
  });

  it('flags ALTER COLUMN TYPE (short and long forms)', () => {
    expect(rules(lintMigrationSql('ALTER TABLE users ALTER COLUMN name TYPE text;'))).toEqual([
      'alter-column-type',
    ]);
    expect(
      rules(lintMigrationSql('ALTER TABLE users ALTER COLUMN name SET DATA TYPE text;')),
    ).toEqual(['alter-column-type']);
  });

  it('flags SET NOT NULL', () => {
    expect(rules(lintMigrationSql('ALTER TABLE users ALTER COLUMN name SET NOT NULL;'))).toEqual([
      'set-not-null',
    ]);
  });

  it('flags ADD COLUMN ... NOT NULL without DEFAULT', () => {
    expect(rules(lintMigrationSql('ALTER TABLE users ADD COLUMN age int NOT NULL;'))).toEqual([
      'add-not-null-without-default',
    ]);
  });

  it('flags TRUNCATE', () => {
    expect(rules(lintMigrationSql('TRUNCATE users;'))).toEqual(['truncate']);
  });

  it('reports one finding per offending statement', () => {
    const sql = 'DROP TABLE a;\nALTER TABLE b DROP COLUMN c;';
    expect(rules(lintMigrationSql(sql)).sort()).toEqual(['drop-column', 'drop-table']);
  });
});

describe('lint-migrations — additive DDL passes', () => {
  it('passes CREATE TABLE with NOT NULL columns', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS things (
        id uuid PRIMARY KEY,
        label text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX things_label_idx ON things (label);
    `;
    expect(lintMigrationSql(sql)).toEqual([]);
  });

  it('passes ADD COLUMN with NOT NULL + DEFAULT', () => {
    expect(
      lintMigrationSql("ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'member';"),
    ).toEqual([]);
  });

  it('passes nullable ADD COLUMN', () => {
    expect(lintMigrationSql('ALTER TABLE users ADD COLUMN nickname text;')).toEqual([]);
  });

  it('passes ADD COLUMN with NULL allowed plus CHECK constraint', () => {
    expect(
      lintMigrationSql('ALTER TABLE users ADD COLUMN age int CHECK (age IS NULL OR age >= 0);'),
    ).toEqual([]);
  });
});

describe('lint-migrations — allow markers', () => {
  const DROP_WITH_MARKER = `
    -- migration-safety: allow drop-column: release v2026.07.01 stopped reading users.legacy_flag (N+1 half of the two-tag dance)
    ALTER TABLE users DROP COLUMN legacy_flag;
  `;

  it('a justified marker silences exactly its rule', () => {
    expect(lintMigrationSql(DROP_WITH_MARKER)).toEqual([]);
  });

  it('a marker for rule A does not silence rule B', () => {
    const sql = `${DROP_WITH_MARKER}\nDROP TABLE legacy_audit;`;
    expect(rules(lintMigrationSql(sql))).toEqual(['drop-table']);
  });

  it('a marker with an empty justification is itself a finding and silences nothing', () => {
    const sql = `
      -- migration-safety: allow drop-column:
      ALTER TABLE users DROP COLUMN legacy_flag;
    `;
    expect(rules(lintMigrationSql(sql)).sort()).toEqual(['drop-column', 'invalid-marker']);
  });

  it('a marker with an unknown rule id is a finding and silences nothing', () => {
    const sql = `
      -- migration-safety: allow drop-colunm: typo'd rule id
      ALTER TABLE users DROP COLUMN legacy_flag;
    `;
    expect(rules(lintMigrationSql(sql)).sort()).toEqual(['drop-column', 'invalid-marker']);
  });

  it('a near-miss marker (wrong grammar) is a finding', () => {
    const sql = '-- migration-safety: allowed drop-column because reasons\nSELECT 1;';
    expect(rules(lintMigrationSql(sql))).toEqual(['invalid-marker']);
  });
});

describe('lint-migrations — strip pass (no false positives from prose)', () => {
  it('ignores rule keywords inside line comments', () => {
    const sql = '-- this migration deliberately does not DROP TABLE anything\nSELECT 1;';
    expect(lintMigrationSql(sql)).toEqual([]);
  });

  it('ignores rule keywords inside block comments', () => {
    const sql = '/* a future release may DROP COLUMN old_name */\nSELECT 1;';
    expect(lintMigrationSql(sql)).toEqual([]);
  });

  it('ignores rule keywords inside string literals', () => {
    const sql = "INSERT INTO _aconversa_meta (schema_version) VALUES ('drop table note');";
    expect(lintMigrationSql(sql)).toEqual([]);
  });
});

describe('lint-migrations — baseline: the real corpus is clean', () => {
  it('every migration under apps/server/migrations passes', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = resolve(here, '..', '..', 'apps', 'server', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .map((file) => ({
        file,
        findings: lintMigrationSql(readFileSync(join(dir, file), 'utf8')),
      }))
      .filter((entry) => entry.findings.length > 0);

    expect(offenders).toEqual([]);
  });
});
