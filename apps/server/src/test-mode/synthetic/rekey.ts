// Non-destructive, exhaustively-typed fixture re-keyer.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_scenario_library.md
// ADRs:        docs/adr/0042-runtime-fixture-reuse-via-vendored-module.md,
//              docs/adr/0041-synthetic-session-generation-dev-gated-seam.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0020-postgres-write-path-locking-and-event-ordering.md
// TaskJuggler: replay_test.test_mode.test_mode_synthetic_scenario_library
//
// `rekeyFixture(fixture, target)` instantiates a vendored test-fixture
// (the snake-case on-disk shape, vendored into the server as a committed
// TS module per ADR 0042) into a fresh synthetic session: it transforms
// each fixture event's snake-case row to the camelCase `EventEnvelope`
// (the same transform the test-fixtures loader runs — see
// `packages/test-fixtures/src/loader.ts:208`), validates it into a typed
// `Event`, then remaps **every** id-bearing field so the output is a
// brand-new session with no canonical fixture id surviving. The result
// is a fully-built `Event[]` the ADR-0041 scenario route appends through
// the production write path — so the `walkthrough` scenario plugs into
// the existing `ScenarioBuilder` registry exactly like `empty` /
// `structured`, with no route change.
//
// **Why a single string-keyed remap (Decision §1).** The fixture's
// cross-references are just repeated id *strings* — an edge's
// `source_node_id` is the same string as the referenced node's
// `node_id`. So one `Map<string,string>` that mints a fresh id on first
// sight and caches it preserves *every* reference automatically: the
// re-keyer never models reference semantics, only which *fields* are
// ids. The map is seeded with the one id that has a predetermined
// target — the fixture session id → the fresh `sessionId` — so the
// session re-keys consistently; every other entity id is genuinely
// fresh.
//
// **User fields are constrained, not minted (Decision §2 / Constraint
// §3).** User-bearing fields (`actor`, `host_user_id`, `created_by`,
// every `*_by`, `participant`, …) resolve only to the three seeded
// users — the operator (`hostUserId`, the moderator role) plus the two
// stable synthetic debaters. They are routed through `mapUser`, which
// **throws** on a user id not among the fixture's participants (a
// fixture with a fourth participant) rather than silently minting a
// dangling non-user id: fail loud, not corrupt. This is why users are a
// separate lookup from the entity remap — an unseeded entity id is
// fresh-minted, an unseeded *user* id is an error.
//
// **Exhaustively typed (Decision §2 / Constraint §4).** The remapping
// walk is a `switch (event.kind)` over the wire `Event` discriminated
// union with a `never` default (and a nested `never`-default switch over
// the proposal sub-kinds). A future event kind, proposal sub-kind, or a
// new id-bearing field becomes a compile error here, not a silent
// pass-through of an un-remapped id into a live session.

import { type Event, validateEvent } from '@a-conversa/shared-types';

import { SYNTHETIC_DEBATER_A, SYNTHETIC_DEBATER_B, type IdFactory } from './scenarios.js';

export type { IdFactory } from './scenarios.js';

// -- Vendored fixture shape ------------------------------------------
//
// The snake-case on-disk fixture shape, mirrored here so the vendored
// `*.data.ts` module (ADR 0042) is typed without importing the
// `@a-conversa/test-fixtures` devDependency at runtime. These mirror the
// `Fixture*` interfaces in `packages/test-fixtures/src/loader.ts`; the
// drift-guard test pins the vendored data against the canonical source.

export interface VendoredFixtureSession {
  readonly id: string;
  readonly host_user_id: string;
  readonly privacy: 'public' | 'private';
  readonly topic: string;
  readonly created_at: string;
}

export interface VendoredFixtureParticipant {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly role: 'moderator' | 'debater-A' | 'debater-B';
  readonly joined_at: string;
}

export interface VendoredFixtureEvent {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

/** A vendored fixture — the subset of the canonical fixture the re-keyer reads. */
export interface VendoredFixture {
  readonly session: VendoredFixtureSession;
  readonly participants: readonly VendoredFixtureParticipant[];
  readonly events: readonly VendoredFixtureEvent[];
}

/** The predetermined targets every generation re-keys a fixture onto. */
export interface RekeyTarget {
  /** The fresh session id minted by the route. */
  readonly sessionId: string;
  /** The operator (moderator role) — owns the generated session. */
  readonly hostUserId: string;
  /** Mints a fresh id per call (the route passes `randomUUID`). */
  readonly idFactory: IdFactory;
}

/** Compile-time exhaustiveness guard for the discriminated-union walks. */
function assertNever(value: never, context: string): never {
  throw new Error(`re-keyer: unhandled ${context}: ${JSON.stringify(value)}`);
}

/**
 * Map a fixture participant role onto its re-keyed user target: the
 * moderator becomes the operator; the two debaters become the stable
 * synthetic debaters. Exhaustive over the role enum (`never` default).
 */
function roleTarget(role: VendoredFixtureParticipant['role'], target: RekeyTarget): string {
  switch (role) {
    case 'moderator':
      return target.hostUserId;
    case 'debater-A':
      return SYNTHETIC_DEBATER_A.id;
    case 'debater-B':
      return SYNTHETIC_DEBATER_B.id;
    default:
      return assertNever(role, 'participant role');
  }
}

/** The id-remapping closures threaded through the per-kind walk. */
interface RekeyContext {
  /** Remap an entity/session/event-surrogate id — fresh on first sight, cached. */
  readonly mintId: (canonical: string) => string;
  /** Remap a user id — throws on a user not among the fixture's participants. */
  readonly mapUser: (canonical: string) => string;
  /** Remap the nullable envelope `actor` (null passes through). */
  readonly mapActor: (actor: string | null) => string | null;
}

/**
 * Re-key one validated fixture event into the output session. Pure: the
 * envelope id / sessionId / actor are remapped uniformly; the payload is
 * remapped by an exhaustive per-kind walk. `sequence` is the caller's
 * re-allocated contiguous value.
 */
function rekeyEvent(event: Event, sequence: number, ctx: RekeyContext): Event {
  const id = ctx.mintId(event.id);
  const sessionId = ctx.mintId(event.sessionId);
  const actor = ctx.mapActor(event.actor);
  const createdAt = event.createdAt;

  switch (event.kind) {
    case 'session-created':
      return {
        id,
        sessionId,
        sequence,
        kind: 'session-created',
        actor,
        createdAt,
        payload: { ...event.payload, host_user_id: ctx.mapUser(event.payload.host_user_id) },
      };
    case 'session-ended':
      return {
        id,
        sessionId,
        sequence,
        kind: 'session-ended',
        actor,
        createdAt,
        payload: { ...event.payload },
      };
    case 'session-restarted':
      // Empty payload (sl_restart_endpoint D2) — nothing to remap.
      return {
        id,
        sessionId,
        sequence,
        kind: 'session-restarted',
        actor,
        createdAt,
        payload: { ...event.payload },
      };
    case 'participant-joined':
      return {
        id,
        sessionId,
        sequence,
        kind: 'participant-joined',
        actor,
        createdAt,
        payload: { ...event.payload, user_id: ctx.mapUser(event.payload.user_id) },
      };
    case 'participant-left':
      return {
        id,
        sessionId,
        sequence,
        kind: 'participant-left',
        actor,
        createdAt,
        payload: { ...event.payload, user_id: ctx.mapUser(event.payload.user_id) },
      };
    case 'node-created':
      return {
        id,
        sessionId,
        sequence,
        kind: 'node-created',
        actor,
        createdAt,
        payload: {
          ...event.payload,
          node_id: ctx.mintId(event.payload.node_id),
          created_by: ctx.mapUser(event.payload.created_by),
        },
      };
    case 'edge-created': {
      const p = event.payload;
      return {
        id,
        sessionId,
        sequence,
        kind: 'edge-created',
        actor,
        createdAt,
        payload: {
          ...p,
          ...(p.source_node_id !== undefined
            ? { source_node_id: ctx.mintId(p.source_node_id) }
            : {}),
          ...(p.source_annotation_id !== undefined
            ? { source_annotation_id: ctx.mintId(p.source_annotation_id) }
            : {}),
          ...(p.target_node_id !== undefined
            ? { target_node_id: ctx.mintId(p.target_node_id) }
            : {}),
          ...(p.target_annotation_id !== undefined
            ? { target_annotation_id: ctx.mintId(p.target_annotation_id) }
            : {}),
          edge_id: ctx.mintId(p.edge_id),
          created_by: ctx.mapUser(p.created_by),
        },
      };
    }
    case 'annotation-created': {
      const p = event.payload;
      return {
        id,
        sessionId,
        sequence,
        kind: 'annotation-created',
        actor,
        createdAt,
        payload: {
          ...p,
          annotation_id: ctx.mintId(p.annotation_id),
          target_node_id: p.target_node_id === null ? null : ctx.mintId(p.target_node_id),
          target_edge_id: p.target_edge_id === null ? null : ctx.mintId(p.target_edge_id),
          created_by: ctx.mapUser(p.created_by),
        },
      };
    }
    case 'entity-included':
      return {
        id,
        sessionId,
        sequence,
        kind: 'entity-included',
        actor,
        createdAt,
        payload: {
          ...event.payload,
          entity_id: ctx.mintId(event.payload.entity_id),
          included_by: ctx.mapUser(event.payload.included_by),
        },
      };
    case 'proposal':
      return {
        id,
        sessionId,
        sequence,
        kind: 'proposal',
        actor,
        createdAt,
        payload: { proposal: rekeyProposal(event.payload.proposal, ctx) },
      };
    case 'vote': {
      const p = event.payload;
      if (p.target === 'facet') {
        return {
          id,
          sessionId,
          sequence,
          kind: 'vote',
          actor,
          createdAt,
          payload: {
            ...p,
            entity_id: ctx.mintId(p.entity_id),
            participant: ctx.mapUser(p.participant),
          },
        };
      }
      return {
        id,
        sessionId,
        sequence,
        kind: 'vote',
        actor,
        createdAt,
        payload: {
          ...p,
          proposal_id: ctx.mintId(p.proposal_id),
          participant: ctx.mapUser(p.participant),
        },
      };
    }
    case 'commit': {
      const p = event.payload;
      if (p.target === 'facet') {
        return {
          id,
          sessionId,
          sequence,
          kind: 'commit',
          actor,
          createdAt,
          payload: {
            ...p,
            entity_id: ctx.mintId(p.entity_id),
            committed_by: ctx.mapUser(p.committed_by),
          },
        };
      }
      return {
        id,
        sessionId,
        sequence,
        kind: 'commit',
        actor,
        createdAt,
        payload: {
          ...p,
          proposal_id: ctx.mintId(p.proposal_id),
          committed_by: ctx.mapUser(p.committed_by),
        },
      };
    }
    case 'meta-disagreement-marked': {
      const p = event.payload;
      if (p.target === 'facet') {
        return {
          id,
          sessionId,
          sequence,
          kind: 'meta-disagreement-marked',
          actor,
          createdAt,
          payload: {
            ...p,
            entity_id: ctx.mintId(p.entity_id),
            marked_by: ctx.mapUser(p.marked_by),
          },
        };
      }
      return {
        id,
        sessionId,
        sequence,
        kind: 'meta-disagreement-marked',
        actor,
        createdAt,
        payload: {
          ...p,
          proposal_id: ctx.mintId(p.proposal_id),
          marked_by: ctx.mapUser(p.marked_by),
        },
      };
    }
    case 'snapshot-created':
      // `log_position` is a sequence pointer, not an id; the re-allocated
      // sequences are contiguous from 1 over the ordered list, so it
      // stays valid without remapping (the fixture is already contiguous).
      return {
        id,
        sessionId,
        sequence,
        kind: 'snapshot-created',
        actor,
        createdAt,
        payload: { ...event.payload, snapshot_id: ctx.mintId(event.payload.snapshot_id) },
      };
    case 'entity-removed':
      return {
        id,
        sessionId,
        sequence,
        kind: 'entity-removed',
        actor,
        createdAt,
        payload: {
          ...event.payload,
          entity_id: ctx.mintId(event.payload.entity_id),
          removed_by: ctx.mapUser(event.payload.removed_by),
        },
      };
    case 'session-mode-changed':
      return {
        id,
        sessionId,
        sequence,
        kind: 'session-mode-changed',
        actor,
        createdAt,
        payload: { ...event.payload, changed_by: ctx.mapUser(event.payload.changed_by) },
      };
    case 'withdraw-agreement':
      return {
        id,
        sessionId,
        sequence,
        kind: 'withdraw-agreement',
        actor,
        createdAt,
        payload: {
          ...event.payload,
          entity_id: ctx.mintId(event.payload.entity_id),
          participant: ctx.mapUser(event.payload.participant),
        },
      };
    case 'proposal-withdrawn':
      return {
        id,
        sessionId,
        sequence,
        kind: 'proposal-withdrawn',
        actor,
        createdAt,
        payload: {
          ...event.payload,
          proposal_id: ctx.mintId(event.payload.proposal_id),
          withdrawn_by: ctx.mapUser(event.payload.withdrawn_by),
        },
      };
    default:
      return assertNever(event, 'event kind');
  }
}

/**
 * Re-key a proposal sub-payload. Exhaustive over the eleven proposal
 * sub-kinds (`never` default); the three sub-kinds carrying polymorphic
 * edge endpoints or component lists remap each nested id.
 */
function rekeyProposal(
  proposal: Extract<Event, { kind: 'proposal' }>['payload']['proposal'],
  ctx: RekeyContext,
): Extract<Event, { kind: 'proposal' }>['payload']['proposal'] {
  switch (proposal.kind) {
    case 'classify-node':
      return { ...proposal, node_id: ctx.mintId(proposal.node_id) };
    case 'capture-node':
      return {
        ...proposal,
        node_id: ctx.mintId(proposal.node_id),
        ...(proposal.edge !== undefined
          ? {
              edge: {
                ...proposal.edge,
                ...(proposal.edge.source_node_id !== undefined
                  ? { source_node_id: ctx.mintId(proposal.edge.source_node_id) }
                  : {}),
                ...(proposal.edge.source_annotation_id !== undefined
                  ? { source_annotation_id: ctx.mintId(proposal.edge.source_annotation_id) }
                  : {}),
                ...(proposal.edge.target_node_id !== undefined
                  ? { target_node_id: ctx.mintId(proposal.edge.target_node_id) }
                  : {}),
                ...(proposal.edge.target_annotation_id !== undefined
                  ? { target_annotation_id: ctx.mintId(proposal.edge.target_annotation_id) }
                  : {}),
                edge_id: ctx.mintId(proposal.edge.edge_id),
              },
            }
          : {}),
      };
    case 'set-node-substance':
      return { ...proposal, node_id: ctx.mintId(proposal.node_id) };
    case 'set-edge-substance':
      return {
        ...proposal,
        ...(proposal.source_node_id !== undefined
          ? { source_node_id: ctx.mintId(proposal.source_node_id) }
          : {}),
        ...(proposal.source_annotation_id !== undefined
          ? { source_annotation_id: ctx.mintId(proposal.source_annotation_id) }
          : {}),
        ...(proposal.target_node_id !== undefined
          ? { target_node_id: ctx.mintId(proposal.target_node_id) }
          : {}),
        ...(proposal.target_annotation_id !== undefined
          ? { target_annotation_id: ctx.mintId(proposal.target_annotation_id) }
          : {}),
        edge_id: ctx.mintId(proposal.edge_id),
      };
    case 'edit-wording':
      switch (proposal.edit_kind) {
        case 'reword':
          return { ...proposal, node_id: ctx.mintId(proposal.node_id) };
        case 'restructure':
          return {
            ...proposal,
            node_id: ctx.mintId(proposal.node_id),
            new_node_id: ctx.mintId(proposal.new_node_id),
          };
        default:
          return assertNever(proposal, 'edit-wording edit_kind');
      }
    case 'decompose':
      return {
        ...proposal,
        parent_node_id: ctx.mintId(proposal.parent_node_id),
        components: proposal.components.map((c) => ({ ...c, node_id: ctx.mintId(c.node_id) })),
      };
    case 'interpretive-split':
      return {
        ...proposal,
        parent_node_id: ctx.mintId(proposal.parent_node_id),
        readings: proposal.readings.map((r) => ({ ...r, node_id: ctx.mintId(r.node_id) })),
      };
    case 'axiom-mark':
      return {
        ...proposal,
        node_id: ctx.mintId(proposal.node_id),
        participant: ctx.mapUser(proposal.participant),
      };
    case 'meta-move':
      return { ...proposal, target_id: ctx.mintId(proposal.target_id) };
    case 'break-edge':
      return { ...proposal, edge_id: ctx.mintId(proposal.edge_id) };
    case 'amend-node':
      return { ...proposal, node_id: ctx.mintId(proposal.node_id) };
    case 'annotate':
      return { ...proposal, target_id: ctx.mintId(proposal.target_id) };
    default:
      return assertNever(proposal, 'proposal sub-kind');
  }
}

/**
 * Instantiate a vendored fixture into a fresh synthetic session.
 *
 * Returns a fully-built `Event[]` with every id remapped and all
 * cross-references preserved, sequences re-allocated contiguous
 * ascending from `1` over the ordered fixture events. Non-destructive
 * and re-runnable: two calls with distinct `sessionId` + `idFactory`
 * streams produce disjoint sessions (Constraint §1).
 *
 * @throws if the fixture carries a user id outside its declared
 *         participants (Constraint §3) or an unrecognised event kind /
 *         proposal sub-kind (caught at compile time by the exhaustive
 *         walks; the runtime throw is the belt-and-braces backstop).
 */
export function rekeyFixture(fixture: VendoredFixture, target: RekeyTarget): Event[] {
  // The entity/session remap, seeded with the one predetermined target.
  const remap = new Map<string, string>([[fixture.session.id, target.sessionId]]);
  const mintId = (canonical: string): string => {
    const existing = remap.get(canonical);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = target.idFactory();
    remap.set(canonical, fresh);
    return fresh;
  };

  // The user lookup: only the fixture's declared participants resolve.
  const userTargets = new Map<string, string>(
    fixture.participants.map((p) => [p.user_id, roleTarget(p.role, target)] as const),
  );
  const mapUser = (canonical: string): string => {
    const mapped = userTargets.get(canonical);
    if (mapped === undefined) {
      throw new Error(
        `re-keyer: user id '${canonical}' is not among the fixture's seeded participants ` +
          `(only the moderator + two debaters are mappable)`,
      );
    }
    return mapped;
  };
  const mapActor = (actor: string | null): string | null =>
    actor === null ? null : mapUser(actor);

  const ctx: RekeyContext = { mintId, mapUser, mapActor };

  return fixture.events.map((fe, index) => {
    // Snake-case row → camelCase envelope (same transform as the loader),
    // then validate into a typed `Event` so the per-kind walk narrows.
    const validated = validateEvent({
      id: fe.id,
      sessionId: fe.session_id,
      sequence: fe.sequence,
      kind: fe.kind,
      actor: fe.actor,
      payload: fe.payload,
      createdAt: fe.created_at,
    });
    return rekeyEvent(validated, index + 1, ctx);
  });
}
