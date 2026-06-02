# Expand the Authelia dev user pool beyond 12 so future participant e2e blocks can stay parallel

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_e2e_user_pool_expansion_v2` (block at L251–272).

**Effort estimate**: 0.5d

**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_entity_detail_panel_annotation_view` (settled — 2026-05-30, see [refinement Status](./part_entity_detail_panel_annotation_view.md#status)). This is the leaf that registered the present task. Its annotation-view Playwright cover could **not** take a fresh `{ creator, debater }` pair: it was folded into the existing block 12 (a `leo + kate` role-swap) because the 12-user pool was already fully recycled across all 12 blocks of [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts). That deviation note ("the 12-user pool is now fully recycled … any future participant e2e block that needs an OIDC dance requires either pool expansion or accepting a `.serial` regression") is the debt this leaf pays down. The follow-up was wired to milestone **M10** at registration time.
- Prose-only context (NOT a `.tji` edge): the predecessor expansion `participant_ui.part_graph_view.part_e2e_user_pool_expansion` (v1, settled 2026-05-17 — [`tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`](./part_e2e_user_pool_expansion.md), v1 landing commit `d4f3247`). v1 grew the pool **6 → 12** to drop `test.describe.serial` off the participant-graph spec. This leaf is the second turn of the same crank (12 → 18) and reuses v1's Decisions verbatim where they still hold: shared argon2id hash (§4), `'<Capitalized> Example'` displaynames (§5), `groups: [dev]` (§6), the `DEV_USER_POOL` single-source-of-truth export (§7), and the "no round-robin helper" scope line (§1). The only material differences are documented below: there is **no `.serial` to revert** this time (v1 already restored `fullyParallel`), the `DEV_USER_POOL` constant has since moved to its own module, and the static pool is now being stretched by a role-swap doubling trick that this refinement makes explicit.
- Prose-only context (NOT a `.tji` edge): ADR 0017 [`docs/adr/0017-mock-oauth-authelia-users-file.md`](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) §"Consequences" bullet 2 carves out the amendment posture this leaf sits inside: *"The shared-password decision is a dev-quality-of-life trade and is the natural amendment point if Playwright tests later need per-user credential isolation … config rotation does not require a new ADR."* Adding more shared-password users of the same shape is exactly that config rotation — **no new ADR**.

## What this task is

Grow the local-dev Authelia user database — currently the 12-user pool `alice` / `ben` / `maria` / `dave` / `erin` / `frank` / `grace` / `henry` / `ivan` / `julia` / `kate` / `leo` — by adding **three more user pairs** (6 new users, taking the pool to 18), bump the `DEV_USER_POOL` single-source-of-truth constant, update the Vitest pin that guards it, and confirm the participant e2e suite stays green under `fullyParallel: true`. The work is e2e-test-infrastructure plumbing, NOT a UI rendering feature: a `participant_ui.*` leaf only by WBS placement (the wall keeps being hit in the participant-UI stream's graph-render spec; the consumer of the expanded pool is cross-cutting across every UI surface's Playwright suite — see §"Why" for `audience-live-session.spec.ts`, which already burns 9 of the 12).

Concretely the deliverable is:

- **Six new entries in [`infra/authelia/users.yml`](../../../infra/authelia/users.yml)** — `nora`, `oscar`, `peter`, `quinn`, `rosa`, `sam` — appended below `leo` (the last current entry, ending at [users.yml:99](../../../infra/authelia/users.yml#L99)), each with the same four-field shape as the existing twelve (`displayname: '<Capitalized> Example'`, `password` = the verbatim shared argon2id hash of `aconversa-dev`, `email: <name>@aconversa.local`, `groups: [dev]`). The file-header comment block ([users.yml:1-25](../../../infra/authelia/users.yml#L1)) updates the count "Twelve dev accounts" → "Eighteen dev accounts" and adds a cross-link to this refinement alongside the existing v1 cross-link.
- **A bump of `DEV_USER_POOL`** in [`tests/e2e/fixtures/dev-users.ts:40-53`](../../../tests/e2e/fixtures/dev-users.ts#L40) to carry all 18 names in `users.yml` source order. (Note: v1's refinement said this constant lived in `auth.ts`; it has since been extracted to the playwright-free `dev-users.ts` module — see the module header at [dev-users.ts:8-17](../../../tests/e2e/fixtures/dev-users.ts#L8) — and re-exported from [`auth.ts:109`](../../../tests/e2e/fixtures/auth.ts#L109). This leaf edits the canonical definition in `dev-users.ts`; the re-export is untouched.)
- **An update to the Vitest pin** [`tests/smoke/dev-user-pool.test.ts`](../../../tests/smoke/dev-user-pool.test.ts): the length assertion at [L32-34](../../../tests/smoke/dev-user-pool.test.ts#L32) (`toHaveLength(12)` → `toHaveLength(18)`, with the `it(...)` title updated to name the 12→18 expansion), and the source-order list at [L46-64](../../../tests/smoke/dev-user-pool.test.ts#L46) extended to all 18 names. The regex pin ([L36-40](../../../tests/smoke/dev-user-pool.test.ts#L36)) and no-duplicates pin ([L42-44](../../../tests/smoke/dev-user-pool.test.ts#L42)) need no edit — the new names already satisfy `/^[a-z]+$/` and are distinct. Per ADR 0022 this committed test is the regression detector: a future PR that drops/renames/diacritic-izes a user goes red here.
- **A trim of the `LoginAsOptions.username` JSDoc** at [`auth.ts:114-122`](../../../tests/e2e/fixtures/auth.ts#L114): replace the hard-coded 12-name enumeration with a reference to `DEV_USER_POOL` (which the same JSDoc already names as the canonical roster at [auth.ts:121](../../../tests/e2e/fixtures/auth.ts#L121)). This removes the second hard-coded roster copy so future expansions touch `dev-users.ts` + the smoke pin only, never this JSDoc (Decision §3).
- **A refresh of the dev-user roster in [`infra/authelia/README.md:92-106`](../../../infra/authelia/README.md#L92)** — "Twelve dev users" → "Eighteen dev users", the six new names appended to the bold list, and a cross-link to this refinement.
- **A refresh of the stale top-of-describe comment** in [`tests/e2e/participant-graph-render.spec.ts:109-134`](../../../tests/e2e/participant-graph-render.spec.ts#L109): the comment opens with "The four `test()` blocks below" but the spec now has **twelve** blocks; the pair-assignment map lists the 6 pairs and their role-swaps but stops at block 12. This leaf corrects "four" → "twelve", appends a line noting the pool now stands at 18 with three spare pairs (`nora+oscar`, `peter+quinn`, `rosa+sam`) reserved for blocks 13+, and cross-links this refinement. **No behavioural change to any block, no new block, no `loginAs` pair change** — the comment is the only spec edit (Decision §5).

Out of scope (deferred to existing posture or surfaced to the parking lot):

- **A principled dynamic-allocation auth helper** (`fixtures/userPool.ts` freelist that hands out `{ creator, debater }` pairs and blocks on contention). Explicitly out of scope per the v2 task note ("same posture as v1") and v1 Decision §1. It is a larger seam change (it rewrites how every spec acquires users) that deserves its own refinement and an explicit human decision, not an auto-registered leaf. The forward-looking question "is the cheap path still the right one?" is surfaced in this refinement's return summary for the parking lot — **not** encoded as a WBS audit task (per ORCHESTRATOR.md's no-audit-task rule).
- **Consuming the new pairs in a new Playwright block.** No current feature leaf needs block 13; adding a block that only logs in as `nora`/`oscar` with no feature behind it would be a throwaway verification (ADR 0022). The new users are pre-provisioned headroom, validated by Authelia's startup YAML parse + the smoke pin, and consumed by the future feature leaf that lands block 13 — exactly how v1 left `ivan`/`julia`/`kate`/`leo` dormant until later leaves consumed them. See §Acceptance "Why no new Playwright spec".
- **A `users.yml` ↔ `DEV_USER_POOL` drift cross-check test.** Tempting (the two rosters are hand-synced and the smoke pin only checks the TS array, not the YAML), but adding a YAML parse — and likely a parser dependency — into a smoke test is scope beyond this 0.5d config rotation and beyond v1's precedent. Surfaced to the parking lot instead (Decision §6).
- **Per-user credential isolation, group/role redesign, OIDC-client whitelist edits, compose/Dockerfile changes, production user-store changes.** All identical to v1's out-of-scope list and unchanged by this leaf. `users.yml` is `# DEV ONLY`, bind-mounted read-only ([compose.yaml:152](../../../compose.yaml#L152)), and picked up by Authelia's `refresh_interval: '5 minutes'` ([configuration.yml:78](../../../infra/authelia/configuration.yml#L78)) or a `make down && make up` restart; the OIDC client carries `authorization_policy: one_factor` with no per-user allowlist ([configuration.yml:233](../../../infra/authelia/configuration.yml#L233)).

## Why it needs to be done

The 12-user pool is **fully consumed**. [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) now runs **twelve** `test()` blocks under `fullyParallel: true`, and every one of the six pairs is used in **both role orderings** to reach that count:

| pair | block (creator+debater) | role-swap block |
| --- | --- | --- |
| alice / ben | 1 (alice+ben) | 7 (ben+alice) |
| maria / dave | 2 (maria+dave) | 8 (dave+maria) |
| frank / erin | 3 (frank+erin) | 9 (erin+frank) |
| grace / henry | 4 (grace+henry) | 10 (henry+grace) |
| ivan / julia | 5 (ivan+julia) | 11 (julia+ivan) |
| kate / leo | 6 (kate+leo) | 12 (leo+kate) |

With 12 users (6 pairs) and the role-swap trick, **12 block-slots are the ceiling** — a 13th distinct block needs a 7th pair (there is no third ordering of two users). That ceiling is precisely what bit the predecessor: `part_entity_detail_panel_annotation_view` had to graft its annotation assertions onto block 12 instead of taking its own block. The next participant-UI feature leaf that wants its own block faces the same wall — pool-expand or eat a `.serial` regression.

The cheap fix (three more pairs) buys **six more block-slots** (blocks 13–18 via the same pair + role-swap doubling) and unblocks the next several feature leaves without revisiting the test-auth seam. The pressure is real and cross-cutting, not participant-only:

- **[`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts)** already consumes **9** distinct dev users — it is the next spec likely to hit the wall, and it inherits the expanded pool for free.
- Any future `mod_*` Playwright block that needs a fresh OIDC dance draws from the same shared pool.

The principled fix (a dynamic round-robin allocator) stays out of scope per the task note — but note this is the **second** static expansion, and the role-swap doubling is itself a sign the static pool is being stretched. That observation is carried to the parking lot (see return summary) so a hypothetical v3 reconsiders the helper rather than mechanically expanding to 24.

## Inputs / context

### ADRs

- [ADR 0017 — Mock OAuth in dev: Authelia in users-file mode](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) — the seam this expansion sits inside. §"Decision" commits to shared-password dev users; §"Consequences" bullet 2 explicitly classes "config rotation" (more users, same shape, same password) as **not** requiring a new ADR. This leaf is that rotation.
- [ADR 0008 — Playwright as the e2e framework](../../../docs/adr/0008-e2e-framework-playwright.md) — the framework whose `fullyParallel: true` posture the participant-graph spec already runs under (no `.serial` to restore this time).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the updated `dev-user-pool.test.ts` pin (length 18 + 18-name source-order list) is the committed regression detector; the existing 12-block spec re-running green under `fullyParallel` is the e2e confirmation. No throwaway block is added.
- No new ADR. Config rotation within ADR 0017's amendment carve-out, identical posture to v1.

### Sibling / predecessor refinements

- [`tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`](./part_e2e_user_pool_expansion.md) (v1) — the template this leaf mirrors. v1 Decisions §2 (continue with readable ASCII Western first names), §3 (ASCII-only, no diacritics), §4 (reuse the shared hash byte-for-byte), §5 (`'<Capitalized> Example'` displaynames), §6 (`groups: [dev]`), §7 (`DEV_USER_POOL` export, don't refactor callers) carry forward unchanged. v1 Decisions §9 (`.serial` revert) and §10 (block-4 user swap) do **not** apply — there is no `.serial` and no block change this time.
- [`tasks/refinements/participant-ui/part_entity_detail_panel_annotation_view.md`](./part_entity_detail_panel_annotation_view.md) — the immediate predecessor; its Status (2026-05-30) documents the pool-exhaustion deviation that registered this task and the M10 wiring.

### Live code the leaf plugs into

- [`infra/authelia/users.yml:1-99`](../../../infra/authelia/users.yml#L1) — header comment (L1-25) + the 12 current entries (L27-99). Append the six new entries below `leo` (last block ends L99); bump the header count + add the cross-link.
- [`tests/e2e/fixtures/dev-users.ts:27`](../../../tests/e2e/fixtures/dev-users.ts#L27) (`AUTHELIA_DEV_PASSWORD`), [`:40-53`](../../../tests/e2e/fixtures/dev-users.ts#L40) (`DEV_USER_POOL`, 12 entries today). The module header [L8-17](../../../tests/e2e/fixtures/dev-users.ts#L8) explains why the roster lives here (playwright-free, so the smoke pin can import it without tripping `vitest.setup.ts`'s console gate). This leaf edits `DEV_USER_POOL` only.
- [`tests/e2e/fixtures/auth.ts:109`](../../../tests/e2e/fixtures/auth.ts#L109) — `export { AUTHELIA_DEV_PASSWORD, DEV_USER_POOL } from './dev-users';` (re-export, unchanged). [`:114-142`](../../../tests/e2e/fixtures/auth.ts#L114) — `LoginAsOptions`; the `username` JSDoc at L116-121 carries the redundant 12-name list this leaf trims to a `DEV_USER_POOL` reference. The `loginAs` body accepts an arbitrary `username: string` — no runtime change.
- [`tests/smoke/dev-user-pool.test.ts:31-65`](../../../tests/smoke/dev-user-pool.test.ts#L31) — the four `it(...)` pins. L32-34 (length) and L46-64 (source-order list) are edited; L36-40 (regex) and L42-44 (dups) are not.
- [`tests/e2e/participant-graph-render.spec.ts:109-134`](../../../tests/e2e/participant-graph-render.spec.ts#L109) — stale top-of-describe pair-assignment comment ("four" → "twelve" + headroom note). [`:135`](../../../tests/e2e/participant-graph-render.spec.ts#L135) — `test.describe(...)` (already NOT `.serial`; unchanged).
- [`infra/authelia/README.md:92-106`](../../../infra/authelia/README.md#L92) — the dev-user roster prose ("Twelve dev users" → "Eighteen", six new names, cross-link).

### What the surface MUST NOT do

- **No new password hash.** Reuse the shared argon2id hash of `aconversa-dev` (the one already on every entry, e.g. [users.yml:30](../../../infra/authelia/users.yml#L30)) byte-for-byte across all six new entries (v1 §4).
- **No per-user password, no new groups, no OIDC-client edits, no compose/Dockerfile edits, no reshape of the existing 12 entries.** Identical to v1's MUST-NOT list.
- **No new Playwright block, no `loginAs` pair change, no `.serial` flip.** The participant-graph spec is touched only in its comment.
- **No edit to `dev-users.ts` other than the `DEV_USER_POOL` array.** The password constant and module header are unchanged (except the header already cross-links v1; optionally add the v2 cross-link).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `infra/authelia/users.yml` — six new entries (`nora`, `oscar`, `peter`, `quinn`, `rosa`, `sam`) in source order below `leo`; header count + cross-link.
- `infra/authelia/README.md` — count + six names + cross-link.
- `tests/e2e/fixtures/dev-users.ts` — `DEV_USER_POOL` extended to 18 names in `users.yml` source order. (Optional: add the v2 refinement cross-link to the module header / `DEV_USER_POOL` JSDoc.)
- `tests/e2e/fixtures/auth.ts` — `LoginAsOptions.username` JSDoc trimmed to reference `DEV_USER_POOL` instead of re-listing names. No other change (the re-export at L109 stays).
- `tests/smoke/dev-user-pool.test.ts` — length pin → 18 (+ title), source-order list → 18 names. Regex + dups pins unchanged.
- `tests/e2e/participant-graph-render.spec.ts` — top-of-describe comment only (count fix + headroom note + cross-link). No code change.

### Files this task does NOT touch

- `infra/authelia/configuration.yml`, `compose.yaml`, `infra/authelia/tls/`, `infra/authelia/data/` — unchanged (bind-mount + refresh interval pick up the new users).
- Every `tests/e2e/*.spec.ts` other than the comment in `participant-graph-render.spec.ts` — unchanged. `audience-live-session.spec.ts` benefits from the larger pool but needs no edit (it is below the ceiling at 9 users).
- `apps/**`, `packages/**` — no application code involved.
- `docs/adr/` — no new ADR.
- `.tji` files — `complete 100` on `part_e2e_user_pool_expansion_v2` + M10 propagation lands at task-completion time per the [tasks/refinements/README.md](../README.md) ritual (the Closer owns it).

### Component shape (sketches the Implementer ports verbatim)

**`infra/authelia/users.yml` — appended entries (sketch; same hash as every existing entry)**

```yaml
  nora:
    displayname: 'Nora Example'
    password: '$argon2id$v=19$m=65536,t=3,p=4$JpiWZ31afMmtrS72rVRXrA$jy30rqZRty9UwAL/7WVCmC1nK7N9FlgW/J3fQ021BPs'
    email: nora@aconversa.local
    groups:
      - dev
  oscar:
    displayname: 'Oscar Example'
    # ... same hash, email oscar@aconversa.local, groups: [dev] ...
  peter:
    displayname: 'Peter Example'
    # ... same hash, email peter@aconversa.local ...
  quinn:
    displayname: 'Quinn Example'
    # ... same hash, email quinn@aconversa.local ...
  rosa:
    displayname: 'Rosa Example'
    # ... same hash, email rosa@aconversa.local ...
  sam:
    displayname: 'Sam Example'
    # ... same hash, email sam@aconversa.local ...
```

**`tests/e2e/fixtures/dev-users.ts` — bumped constant (sketch)**

```ts
export const DEV_USER_POOL: readonly string[] = [
  'alice', 'ben', 'maria', 'dave', 'erin', 'frank',
  'grace', 'henry', 'ivan', 'julia', 'kate', 'leo',
  'nora', 'oscar', 'peter', 'quinn', 'rosa', 'sam',
] as const;
```

**`tests/e2e/fixtures/auth.ts` — trimmed JSDoc (sketch, replacing the hard-coded list at L116-121)**

```ts
  /**
   * Authelia username. Must be one of the seeded dev users in
   * `infra/authelia/users.yml`; the canonical roster lives in
   * {@link DEV_USER_POOL} (per ADR 0017 +
   * `tasks/refinements/participant-ui/part_e2e_user_pool_expansion_v2.md`).
   */
  readonly username: string;
```

## Acceptance criteria

The check that says "done":

- `infra/authelia/users.yml` contains **18** top-level user entries (the original 12 + `nora`, `oscar`, `peter`, `quinn`, `rosa`, `sam`), each with `displayname` / `password` / `email` / `groups` matching the existing convention and the shared argon2id hash. The header comment reflects "Eighteen dev accounts" and cross-links this refinement. **Authelia comes up cleanly with the new users** — the Implementer runs `make up` (or `docker compose restart authelia`) and tails the container log for `Startup complete` with no YAML-parse error (this is the verification that the six dormant users are well-formed and authorizable; it replaces a dedicated login test per ADR 0022, exactly as v1 validated its dormant pairs).
- `DEV_USER_POOL` in `tests/e2e/fixtures/dev-users.ts` carries all 18 names in `users.yml` source order; `auth.ts` re-exports it unchanged.
- `tests/smoke/dev-user-pool.test.ts` asserts `toHaveLength(18)` and an 18-name source-order list; the regex + no-duplicates pins still pass. **Per ADR 0022 this is a committed test, and it must be confirmed failing-first**: the Implementer verifies the length/source-order pins go red against the un-bumped 12-entry array before going green on 18 (the regression-detector posture v1 established).
- `tests/e2e/fixtures/auth.ts`'s `LoginAsOptions.username` JSDoc references `DEV_USER_POOL` rather than re-listing names.
- `infra/authelia/README.md` reflects "Eighteen dev users" + the six new names + the cross-link.
- `tests/e2e/participant-graph-render.spec.ts`'s top-of-describe comment says "twelve" (not "four"), notes the 18-user pool with three spare pairs for blocks 13+, and cross-links this refinement. **The `test.describe(...)` at L135 stays non-`.serial`; no block, pair, or `loginAs` call changes.**
- `pnpm run check` clean.
- `pnpm run test:smoke` green; the Vitest baseline is unchanged in *count* (the two edited `it` cases are in-place edits, not additions) — the smoke suite simply re-asserts against 18. No prior case breaks.
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes `tests/e2e/participant-graph-render.spec.ts` and **all 12 blocks pass under `fullyParallel: true`** — confirming the existing twelve users still complete their OIDC dances after the `users.yml` edit (i.e. the file still parses and the existing entries are untouched) and that no `.serial` regression was introduced. There is no wall-clock-recovery assertion this time (the spec was already parallel); the gate is simply "stays green, stays parallel."
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this) after the Closer adds `complete 100`.
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_e2e_user_pool_expansion_v2`, with M10 propagation in `tasks/99-milestones.tji` if this leaf is the last M10 dependency (the Closer's ritual).

### Why no new Playwright spec (UI-stream e2e policy)

Per ORCHESTRATOR.md's UI-stream e2e policy, the default is "e2e is in scope." This leaf is the rare case the policy's "not a UI feature" framing covers: it **adds no component, no route, and no event surface** — there is no user-visible behaviour to exercise. It is test-infrastructure plumbing, a `participant_ui.*` leaf only by WBS placement (identical to v1, which the policy-conformant reviewers accepted on the same grounds). The new users are dormant headroom: validated by Authelia's startup YAML parse and pinned by the `dev-user-pool.test.ts` Vitest case, but **not** logged into via an OIDC dance until a future feature leaf consumes block 13 — at which point *that* leaf's refinement scopes the Playwright block that drives the new pair (just as v1's `ivan`/`julia`/`kate`/`leo` stayed dormant until later participant leaves consumed them). Adding a Playwright block now whose only job is to log in as `nora`/`oscar` with no feature behind it would be a throwaway verification, which ADR 0022 forbids. The committed Playwright surface for this leaf is therefore the **existing** 12-block spec re-running green under `fullyParallel` (proving the existing pool is intact), not a new block.

## Decisions

### §1 — Add THREE new pairs (12 → 18 users), not 2

The task note says "2+ more dev-user pairs." Alternatives:

- **(a) Add 2 pairs (16 users → 4 new block-slots).** Minimum to give the next two feature leaves their own blocks. Smallest diff. But with the role-swap doubling already exhausting the pool once, 4 slots is thin headroom and risks a v3 within a milestone or two.
- **(b) Add 3 pairs (18 users → 6 new block-slots: blocks 13-18).** **Chosen.** Mirrors v1's "three pairs / two spare pairs of headroom" calibration, scaled for the role-swap doubling (3 pairs → 6 slots). Marginal cost is ~30 YAML lines + 6 array entries + the smoke-pin list. Zero functional risk; the three pairs sit dormant until consumed. Gives real runway to the next wave of participant + audience blocks without inflating past the YAGNI line.
- **(c) Add 4+ pairs (20+ users).** Anticipates blocks with no current consumer; the principled round-robin helper is the right answer once the static pool's bookkeeping cost dominates (≈ this third expansion would be that signal). Rejected as YAGNI; if a fourth expansion is ever contemplated, build the helper instead (parking-lot note).

### §2 — Username naming: continue alphabetically `n`/`o`/`p`/`q`/`r`/`s` with readable ASCII Western first names

v1 stopped at `g`–`l` (`grace`, `henry`, `ivan`, `julia`, `kate`, `leo`). The 12 current initials are `a, b, d, e, f, g, h, i, j, k, l, m`. Continuing the next free letters gives **`nora`, `oscar`, `peter`, `quinn`, `rosa`, `sam`** (`n, o, p, q, r, s`) — each a recognizable, unambiguous, short, ASCII-only first name with a distinct initial and no collision with the existing roster. Alternatives (numeric `user13…`, or re-theming the whole pool) rejected for the same readability reasons v1 §2 gave: `nora claims debater-A` reads better than `user13 claims debater-A` in failure output. Pair grouping for the four-blocks-per-spec convention: `nora+oscar`, `peter+quinn`, `rosa+sam`.

### §3 — Trim the `LoginAsOptions.username` JSDoc to reference `DEV_USER_POOL`; don't carry a third hard-coded roster

The roster is currently hard-coded in three places: `users.yml` (the source of truth), `DEV_USER_POOL` (the TS mirror + smoke pin), and the `LoginAsOptions.username` JSDoc enumeration ([auth.ts:116-121](../../../tests/e2e/fixtures/auth.ts#L116)). The JSDoc already names `DEV_USER_POOL` as canonical one line later. Alternatives:

- **(a) Trim the JSDoc to "one of the seeded dev users; the canonical roster lives in {@link DEV_USER_POOL}", dropping the inline name list.** **Chosen.** Removes a copy that would otherwise churn on every expansion, with no loss — `{@link DEV_USER_POOL}` is the live reference and the names are one hop away. Reduces v3's edit surface by one file.
- **(b) Update the JSDoc enumeration to all 18 names (v1's choice).** Rejected: re-lists the roster a third time, guaranteeing the same drift-prone hand-sync grows with the pool. v1 kept it because the `{@link}` wasn't there yet; it is now.

### §4 — Shared argon2id hash, `'<Capitalized> Example'` displaynames, `groups: [dev]` — all inherited from v1 verbatim

v1 Decisions §4/§5/§6 settled these; nothing about this expansion changes the rationale. The Implementer copies the hash from any existing entry (e.g. [users.yml:30](../../../infra/authelia/users.yml#L30)) into each new entry; displaynames are `'Nora Example'` … `'Sam Example'`; every new user carries `groups: [dev]`. Reused rather than re-litigated.

### §5 — Refresh the stale top-of-describe comment, but make NO behavioural change to the spec

The pair-assignment comment ([participant-graph-render.spec.ts:109-134](../../../tests/e2e/participant-graph-render.spec.ts#L109)) opens "The four `test()` blocks below" though the spec has twelve, and it documents the pool as 12. Alternatives:

- **(a) Fix the count, append a headroom line for the three new pairs, cross-link this refinement; change no code.** **Chosen.** The comment is the natural place a future block-13 author reads the pair-assignment scheme and the available headroom, so keeping it truthful is cheap, high-value hygiene. Bounding the edit to the comment keeps the spec's 12 green blocks untouched — the re-run is a pure "existing pool still works" check.
- **(b) Leave the spec entirely untouched.** Rejected: re-running the spec to confirm the pool still works while knowingly leaving an actively-wrong comment ("four blocks", pool=12) is worse for the next reader than a one-comment edit. The staleness predates v2 but this leaf is the right occasion to correct it.
- **(c) Also consume a new pair in a fresh block.** Rejected — throwaway test, see §Acceptance "Why no new Playwright spec".

### §6 — No `users.yml` ↔ `DEV_USER_POOL` drift cross-check test in this leaf

The smoke pin asserts the TS array's shape but never reads `users.yml`, so a user added to one file but not the other isn't caught until a login fails. A test that parses `users.yml` and asserts its keys equal `DEV_USER_POOL` would close that gap. Alternatives:

- **(a) Skip it; keep the hard-coded source-order pin (v1's approach).** **Chosen.** Adding YAML parsing — and probably a parser dependency — into a smoke test is real scope beyond a 0.5d config rotation, and a dependency addition is itself an ADR-adjacent decision not worth triggering here. The drift risk is bounded (the two rosters are edited together in this same small leaf) and the failure mode is loud (a future login throws).
- **(b) Add the cross-check test now.** Rejected for the scope/dependency reasons above — but the drift risk **grows** with every expansion, so it is surfaced to the parking lot as a candidate hardening, not buried.

### §7 — No new ADR; config rotation within ADR 0017's carve-out

Identical to v1 §"No new ADR". More shared-password users of the same shape, same OIDC client, same dev-only file — ADR 0017 §"Consequences" bullet 2 names this as "config rotation [that] does not require a new ADR." No architectural commitment is made.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- `infra/authelia/users.yml` — six new entries (`nora`, `oscar`, `peter`, `quinn`, `rosa`, `sam`) appended below `leo`; header updated to "Eighteen dev accounts" with v2 cross-link.
- `infra/authelia/README.md` — count updated to "eighteen", six new names listed, v2 cross-link added.
- `tests/e2e/fixtures/dev-users.ts` — `DEV_USER_POOL` extended to 18 names in `users.yml` source order; header/JSDoc cross-link added.
- `tests/e2e/fixtures/auth.ts` — `LoginAsOptions.username` JSDoc trimmed to reference `DEV_USER_POOL` (no more hard-coded 12-name list).
- `tests/smoke/dev-user-pool.test.ts` — length pin updated 12→18, 18-name source-order list, title/header updated.
- `tests/e2e/participant-graph-render.spec.ts` — top-of-describe comment only: "four" → "twelve", 18-user pool headroom note for blocks 13+, v2 cross-link; no block/pair/`loginAs` change, `test.describe` stays non-`.serial`.
- All four verification suites green (driver-run): `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, `make test:e2e:compose`.
