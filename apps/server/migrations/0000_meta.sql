-- Bootstrap migration: schema-version metadata table.
--
-- This is the very first migration to run against any a-conversa
-- database. It exists to (a) prove the migration runner is wired up
-- end-to-end against a fresh Postgres and (b) give us a tiny home
-- for any application-level metadata about the schema that we want
-- to record outside of node-pg-migrate's own `pgmigrations` tracking
-- table.
--
-- Forward-only policy (per ADR 0020): there is no "down" section.
-- To revert anything established here, write a new forward migration.
--
-- File-naming convention (also per ADR 0020): `NNNN_short_name.sql`
-- with a four-digit zero-padded prefix. Lexicographic order matches
-- intended apply order. node-pg-migrate orders by filename, so this
-- works as long as we don't exceed 9999 migrations (and at that point
-- we have larger problems).
--
-- Single-statement file with no `-- Up Migration` / `-- Down Migration`
-- markers — node-pg-migrate treats the whole content as the up step,
-- which is exactly what forward-only wants.

CREATE TABLE IF NOT EXISTS _aconversa_meta (
    schema_version  TEXT        PRIMARY KEY,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO _aconversa_meta (schema_version)
VALUES ('0000_meta')
ON CONFLICT (schema_version) DO NOTHING;
