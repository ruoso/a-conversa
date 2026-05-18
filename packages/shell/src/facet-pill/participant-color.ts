// Deterministic per-participant color hash for in-pill vote indicators
// (and, by extension, the moderator's `<AxiomMarkBadge>` / `<PendingAxiomMarkBadge>`
// which import the same hash from `@a-conversa/shell`).
//
// Refinement: tasks/refinements/shell-package/extract_facet_pill.md
//   Decision §3 — co-move the in-pill render-dependency chain alongside
//   `<FacetPill>` rather than ship a headless seam. The hash + palette +
//   color types lift wholesale; the moderator's `selectors.ts` keeps its
//   other exports (annotations / axiom-marks / votes-by-facet projection
//   helpers — those are moderator-graph-specific) and re-imports
//   `axiomMarkColorFor` + the palette types from `@a-conversa/shell`.
//
// Ported verbatim from `apps/moderator/src/graph/selectors.ts` lines
// 479-554 of the pre-lift moderator source (the `AxiomMarkColor` interface
// + the six-color palette + the deterministic hash function).

/**
 * The Tailwind color triple for a single per-participant axiom-mark
 * badge. Each entry is a complete Tailwind class string so the JIT
 * scanner picks them up at build time (Tailwind's content-aware
 * extraction can't see strings interpolated at runtime — every class
 * has to appear literally somewhere in the source).
 *
 * The shape is the public contract: `bg` paints the badge background,
 * `text` paints the centered "A" glyph, `ring` lays a 1-px halo so two
 * adjacent same-colored badges remain separable in the rare per-
 * participant collision (six buckets means a session with seven+
 * participants would alias — the halo keeps the visual stable).
 */
export interface AxiomMarkColor {
  readonly bg: string;
  readonly text: string;
  readonly ring: string;
}

/**
 * The six-color palette for per-participant axiom-marks. Chosen to (a)
 * be pairwise distinguishable, (b) not collide with the methodology-
 * state palette (slate / rose / violet) or the annotation badge (the
 * shape difference — rounded-square here vs. rounded-pill there — is
 * the primary seam, so amber 100/900 is acceptable to share with the
 * annotation badge as long as the shape stays distinct). See the
 * refinement's "Decisions" for the palette rationale.
 *
 * Indexed by hash bucket; `axiomMarkColorFor` selects by `hash(uuid) % 6`.
 * Frozen at module scope so the references stay stable across calls.
 */
const AXIOM_MARK_PALETTE: readonly AxiomMarkColor[] = Object.freeze([
  Object.freeze({ bg: 'bg-sky-100', text: 'text-sky-900', ring: 'ring-sky-300' }),
  Object.freeze({ bg: 'bg-amber-100', text: 'text-amber-900', ring: 'ring-amber-300' }),
  Object.freeze({ bg: 'bg-emerald-100', text: 'text-emerald-900', ring: 'ring-emerald-300' }),
  Object.freeze({ bg: 'bg-fuchsia-100', text: 'text-fuchsia-900', ring: 'ring-fuchsia-300' }),
  Object.freeze({ bg: 'bg-cyan-100', text: 'text-cyan-900', ring: 'ring-cyan-300' }),
  Object.freeze({ bg: 'bg-lime-100', text: 'text-lime-900', ring: 'ring-lime-300' }),
]);

/**
 * Number of color buckets in the per-participant palette. Exported via
 * `AXIOM_MARK_PALETTE.length` so the test suite can assert against the
 * canonical count without re-declaring it.
 */
export const AXIOM_MARK_PALETTE_SIZE = AXIOM_MARK_PALETTE.length;

/**
 * Deterministic per-participant color assignment.
 *
 * Hashes the UUID by summing its hex-digit values (after stripping the
 * dashes / non-hex characters) and picks a palette bucket via
 * `hash % AXIOM_MARK_PALETTE.length`. Same `participantId` always yields
 * the same color across renders / refreshes / browsers / surfaces — the
 * color is a stable property of the participant identity, not of the
 * session join order. Different participants typically get different
 * colors; the 6-bucket palette means a 7+-participant session aliases
 * (the ring halo keeps adjacent same-colored badges separable in that
 * rare case).
 *
 * The hash is stateless and decoupled from any cross-surface coordination
 * — the participant tablet, audience surface, and server-side diagnostic
 * snapshot all arrive at the same color for the same participant without
 * sharing a session-scoped palette assignment. See the refinement's
 * "Decisions" for why hash-based is preferred over a per-session palette.
 */
export function axiomMarkColorFor(participantId: string): AxiomMarkColor {
  let hash = 0;
  for (let i = 0; i < participantId.length; i++) {
    const ch = participantId.charCodeAt(i);
    // Sum hex-digit values only (0-9, a-f, A-F). Skip the dashes that
    // separate UUID groups. Non-hex characters in a well-formed UUID are
    // dashes; skipping them keeps the hash deterministic for any UUID
    // formatting variant (with / without dashes, upper / lower case).
    let digit: number;
    if (ch >= 48 && ch <= 57)
      digit = ch - 48; // '0'-'9' → 0-9
    else if (ch >= 97 && ch <= 102)
      digit = 10 + (ch - 97); // 'a'-'f' → 10-15
    else if (ch >= 65 && ch <= 70)
      digit = 10 + (ch - 65); // 'A'-'F' → 10-15
    else continue;
    hash = (hash + digit) >>> 0; // unsigned 32-bit; sum can't overflow for a 36-char UUID
  }
  // `palette[i] ?? palette[0]` keeps the return non-undefined for
  // TypeScript's strict-null mode; the index is always in range.
  const bucket = hash % AXIOM_MARK_PALETTE.length;
  return AXIOM_MARK_PALETTE[bucket] ?? AXIOM_MARK_PALETTE[0]!;
}
