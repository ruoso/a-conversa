// Synthetic-scenario descriptor — the small typed contract the
// test-mode generator's read endpoint returns and the test-mode gallery
// consumes.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
//
// **Why this lives in shared-types.** The generator route
// (`apps/server/src/test-mode/`) and the gallery view
// (`apps/test-mode/src/synthetic/`) live in two different workspace
// apps that cannot import each other. The descriptor shape is the wire
// contract between them — `GET /api/test-mode/synthetic-scenarios`
// returns `{ scenarios: SyntheticScenarioDescriptor[] }` and the gallery
// renders one affordance per descriptor — so it belongs in the only
// package both already depend on. Exported once here, consumed by both
// (Constraint §4 / Acceptance §1 of the refinement).
//
// **`title` / `description` are server-supplied English fallback.** The
// gallery localizes each scenario via the `testMode.synthetic.scenario.
// <key>.*` catalog keys, falling back to these server strings when a
// scenario the server offers has no catalog entry yet — so the surface
// stays genuinely data-driven (it can render a scenario it has no
// hard-coded knowledge of) without shipping un-localized text for the
// scenarios it does know.

/**
 * A single synthetic-scenario descriptor. `key` is the stable string
 * the generator's `POST` body references (`{ scenario: key }`); `title`
 * and `description` are short human-readable English strings the gallery
 * uses as localization fallbacks.
 */
export interface SyntheticScenarioDescriptor {
  /** Stable registry key — the `scenario` value the POST body carries. */
  readonly key: string;
  /** Short English title (localization fallback). */
  readonly title: string;
  /** One-line English description (localization fallback). */
  readonly description: string;
}

/**
 * The read endpoint's response envelope:
 * `GET /api/test-mode/synthetic-scenarios` → `{ scenarios: [...] }`.
 */
export interface SyntheticScenarioListResponse {
  readonly scenarios: readonly SyntheticScenarioDescriptor[];
}
