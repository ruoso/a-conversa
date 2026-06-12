-- Edges table — polymorphic source/target annotation endpoints.
--
-- Refinement: tasks/refinements/data-and-methodology/edges_table_polymorphic_endpoint_migration.md
-- TaskJuggler: data_and_methodology.schema.edges_table_polymorphic_endpoint_migration
-- Forward-only per ADR 0020 (no down migration).
--
-- Mirrors the edge-created wire-schema widening
-- (data_and_methodology.event_types.edge_target_annotation_schema_extension,
-- packages/shared-types/src/events.ts): an edge endpoint may be a
-- node OR an annotation, each endpoint independently polymorphic.
-- Follows 0006_annotations.sql's polymorphic-FK pattern — typed
-- nullable FK columns + an exactly-one XOR CHECK per endpoint —
-- rather than a kind/id discriminator pair, preserving DB-level FK
-- integrity.
--
-- Backward-compat (ADR 0034 image-rollback invariant): the previous
-- deployed image never INSERTs into the global `edges` table (the
-- table is dormant in production), and even a node-node insert from
-- older code satisfies both XOR CHECKs and the new uniqueness
-- semantics unchanged. The safety linter is clean on this file by
-- construction (no drops/renames/type changes of anything an older
-- image reads).
--
-- Uniqueness note: the inline UNIQUE constraint from 0005 spanned
-- three NOT NULL columns. With the endpoint columns now nullable, a
-- plain unique index would treat NULLs as distinct and stop
-- deduplicating node-node edges; NULLS NOT DISTINCT (Postgres 15+;
-- prod pins postgres:16-alpine per ADR 0016) restores the original
-- semantics over the widened five-column tuple. The reverse
-- direction remains a different tuple, so symmetric `contradicts`
-- stays two distinct rows (0005's F9 decision is preserved).

ALTER TABLE edges
    -- Endpoints become polymorphic: exactly one of the node /
    -- annotation column per endpoint is set (XOR CHECKs below).
    ALTER COLUMN source_node_id DROP NOT NULL,
    ALTER COLUMN target_node_id DROP NOT NULL,

    -- Annotation-side endpoint columns. RESTRICT matches every other
    -- entity FK in the schema (an annotation cannot be hard-deleted
    -- while edges reference it).
    ADD COLUMN source_annotation_id UUID NULL REFERENCES annotations(id) ON DELETE RESTRICT,
    ADD COLUMN target_annotation_id UUID NULL REFERENCES annotations(id) ON DELETE RESTRICT,

    -- Exactly one source endpoint and exactly one target endpoint.
    -- Mirrors the wire schema's per-endpoint .refine() blocks and
    -- 0006_annotations.sql's XOR pattern.
    ADD CONSTRAINT edges_source_endpoint_xor
        CHECK ((source_node_id IS NOT NULL) <> (source_annotation_id IS NOT NULL)),
    ADD CONSTRAINT edges_target_endpoint_xor
        CHECK ((target_node_id IS NOT NULL) <> (target_annotation_id IS NOT NULL));

-- Replace the three-column inline UNIQUE constraint with a
-- five-column NULLS NOT DISTINCT unique index over the polymorphic
-- endpoint tuple. The first name is the auto-name Postgres actually
-- assigns to 0005's inline constraint (verified against a live
-- catalog); the second is the name 0005's header comment guessed —
-- dropped defensively with IF EXISTS so this migration is immune to
-- either history.
ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_role_source_node_id_target_node_id_key;
ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_role_source_target_key;

CREATE UNIQUE INDEX IF NOT EXISTS edges_role_endpoints_key
    ON edges (role, source_node_id, source_annotation_id, target_node_id, target_annotation_id)
    NULLS NOT DISTINCT;

-- Lookup indexes for annotation-endpoint traversal, mirroring the
-- node-endpoint indexes from 0005. Partial: the columns are NULL on
-- every node-node edge (the common case), so a full index would be
-- almost entirely NULL entries.
CREATE INDEX IF NOT EXISTS edges_source_annotation_id_idx
    ON edges (source_annotation_id)
    WHERE source_annotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS edges_target_annotation_id_idx
    ON edges (target_annotation_id)
    WHERE target_annotation_id IS NOT NULL;
