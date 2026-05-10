-- Session-annotations M-N join — which annotations a session has ever referenced.
--
-- Refinement: tasks/refinements/data-and-methodology/session_annotations_join_table.md
-- TaskJuggler: data_and_methodology.schema.session_annotations_join_table
-- Forward-only per ADR 0020 (no down migration).
--
-- Third sister to `session_nodes` (0007_session_nodes.sql) and
-- `session_edges` (0008_session_edges.sql); the refinement is explicit
-- that this follows the exact same shape and decisions. R26 added this
-- table in round 4 to close the asymmetry between annotations and the
-- other two graph entity kinds: annotations are first-class graph
-- entities (per docs/data-model.md — annotations) with their own
-- agreement workflow, and cross-session reference (per
-- docs/architecture.md — cross-session reference permissions) extends
-- to annotations symmetrically with nodes and edges. A session may
-- reference an annotation that originated in another session, just as
-- it can reference a node or edge.
--
-- Pure join: one row links one session to one (global) annotation. A
-- row is inserted when a session begins referencing an annotation —
-- either because the annotation was just created in this session or
-- because the session is importing it from another session per the
-- cross-session reference permission rules in docs/architecture.md.
--
-- **This table is an index into the event log, not a representation
-- of the visible-graph state (R10).** An annotation that is no longer
-- visible in the session's current rendering — e.g. it was withdrawn,
-- or its target node/edge was decomposed, interpretively-split, or
-- restructured-and-replaced — still has its `session_annotations`
-- row. The visible-graph state is computed from the session's event
-- log; this table only answers two questions:
--   1. Bootstrapping the projection — which global annotation rows
--      to fetch.
--   2. Cross-session permission checks — was this annotation ever in
--      this session?
-- Because the table is monotonic (R10), there is deliberately
-- **no `removed_at` column**. Removal-from-visible is an event-log
-- concern, not a row-mutation here.
--
-- Decisions captured by the refinement:
--   * **Composite primary key** on (session_id, annotation_id) (R9).
--     This is a deliberate departure from the project-wide UUID-PK
--     convention (CC1 in earlier refinements). M-N join tables are
--     the standard exception: the natural key *is* the pair of
--     foreign keys, a surrogate UUID would add nothing, and the
--     composite PK gives us duplicate-prevention and the primary
--     access path "rows for session X" in one B-tree.
--   * **No `removed_at`** (R10). See the monotonic-inclusion note
--     above.
--   * **Annotation parity with nodes and edges** (R26). The shape and
--     decisions here mirror `session_nodes` and `session_edges`
--     exactly; annotations are not piggy-backed on their target's
--     inclusion.
--   * `included_by` records who pulled the annotation into this
--     session (matches the `entity-included` event payload in
--     docs/data-model.md).
--   * `included_at` records when. Server clock at insert time.
--
-- ON DELETE RESTRICT on all three FKs: matches the soft-delete
-- convention on users from 0001_users.sql and the convention on
-- sessions/annotations from 0002_sessions.sql / 0006_annotations.sql.
-- The event log references inclusions, so none of session, annotation,
-- or including user can be hard-deleted while a session_annotations
-- row references them.
--
-- Inverse-lookup index on `annotation_id`: the composite PK already
-- covers "rows for this session" (its leading column is session_id),
-- but "in which sessions does this annotation appear?" — the
-- cross-session permission-check direction — needs an index on
-- annotation_id alone. R9 calls this out explicitly.
--
-- No `gen_random_uuid()` here: there is no surrogate id column.

CREATE TABLE IF NOT EXISTS session_annotations (
    -- The session this inclusion belongs to. Part of the composite
    -- PK; RESTRICT so a session cannot be hard-deleted while it has
    -- inclusion rows.
    session_id      UUID            NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,

    -- The (global) annotation included in this session. Part of the
    -- composite PK; RESTRICT so an annotation cannot be hard-deleted
    -- while any session references it.
    annotation_id   UUID            NOT NULL REFERENCES annotations(id) ON DELETE RESTRICT,

    -- The participant who included this annotation — either by
    -- creating it in this session or by importing it from another.
    -- RESTRICT so a user cannot be hard-deleted while their inclusion
    -- rows exist (matches the soft-delete convention on users from
    -- 0001_users.sql).
    included_by     UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- When the inclusion happened. Server clock at insert time.
    included_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Composite primary key (R9). The pair (session_id, annotation_id)
    -- is the natural key; an annotation can only be in a given session
    -- once.
    PRIMARY KEY (session_id, annotation_id)
);

-- Inverse-direction lookup — "in which sessions does this annotation
-- appear?". The composite PK's leading column is session_id, so the
-- forward direction is already indexed; this index covers the
-- backward direction used by cross-session permission checks (R9).
CREATE INDEX IF NOT EXISTS session_annotations_annotation_id_idx
    ON session_annotations (annotation_id);
