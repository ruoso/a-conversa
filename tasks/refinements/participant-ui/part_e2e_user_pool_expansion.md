# Expand Authelia dev user pool so participant e2e specs can drop `describe.serial`

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_e2e_user_pool_expansion`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_annotation_render` (settled, commit landing 2026-05-17 — the immediate predecessor and the source of this debt. Shipped the fourth `test()` block in [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) (lines 741-979 — alice + ben again), the `test.describe.serial(...)` modifier at line 116, and the in-file rationale comment at lines 103-115 that explicitly names this expansion task as the cheap fix. The 6-user pool exhaustion was first hit there; the wall-clock recovery target this task asserts against is the prior `~14s/block under fullyParallel` baseline documented in that refinement's Status block.
- Prose-only context (NOT a `.tji` edge): `foundation.dev_env.dockerfile_mock_oauth` (settled 2026-05-10 — [`tasks/refinements/foundation/dockerfile_mock_oauth.md`](../foundation/dockerfile_mock_oauth.md)) is the origin of the 6-user pool (`alice` / `ben` / `maria` / `dave` / `erin` / `frank`). Its "Additional decisions" §"Six dev users" rationale ("three from the canonical walkthrough plus three more so two parallel Playwright sessions can run side by side") is what this leaf extends — three parallel sessions (the current 3 participant-graph-render blocks) already saturate the pool; the fourth block tipped it over. The same refinement's Status §"users.yml" documents the argon2id password convention + the shared `aconversa-dev` plaintext this leaf reuses verbatim.
- Prose-only context (NOT a `.tji` edge): ADR 0017 [`docs/adr/0017-mock-oauth-authelia-users-file.md`](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) §"Decision" bullet 2 ("Six dev users with one shared password") is the architectural seam this expansion extends. The ADR's "Consequences" bullet 2 explicitly carves out the amendment posture: "The shared-password decision is a dev-quality-of-life trade and is the natural amendment point if Playwright tests later need per-user credential isolation (per the ADR amendment carve-out — config rotation does not require a new ADR)." This leaf is exactly that carve-out: dev-config rotation (more users, same password, same shape) within the established ADR — no new ADR needed.

## What this task is

Expand the local-dev Authelia user database — currently the 6-user pool `alice` / `ben` / `maria` / `dave` / `erin` / `frank` — by adding **three more user pairs** (6 new users, taking the pool to 12), then revert the `tests/e2e/participant-graph-render.spec.ts` describe from `test.describe.serial(...)` back to `test.describe(...)` so its 4 blocks run in parallel again. The work is e2e-test-infrastructure plumbing, NOT a UI rendering feature: a `participant_ui.*` leaf only by WBS placement (the wall was first hit in the participant-UI stream's graph-render spec; the consumer of the expanded pool is cross-cutting across every UI surface's Playwright suite).

Concretely the deliverable is:

- An extension to [`infra/authelia/users.yml`](../../../infra/authelia/users.yml) that adds six new dev-user entries — `grace`, `henry`, `ivan`, `julia`, `kate`, `leo` — each with the same YAML shape as the existing six (`displayname`, `password`, `email`, `groups`), each sharing the same argon2id hash of `aconversa-dev` that the existing entries use (the hash is constant across all dev users; the password is documented in [`infra/authelia/README.md`](../../../infra/authelia/README.md) and ADR 0017). The file header comment updates the user count from "Six dev accounts" to "Twelve dev accounts" and cross-links this refinement so a future reader sees why the pool grew. No change to `infra/authelia/configuration.yml` (the OIDC client at `aconversa-app-dev` does NOT whitelist user IDs — verified via grep — so any user in `users.yml` is authorizable).
- An extension to [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) that updates the JSDoc `LoginAsOptions.username` enumeration at line 112-115 from the current 6 names to the new 12. The JSDoc is the only place in `auth.ts` that names the dev users explicitly — the `loginAs` function itself accepts an arbitrary `username: string` and forwards it to Authelia, so no runtime code change is needed. Optionally export a `DEV_USER_POOL: readonly string[]` constant carrying the 12 names so future suites can iterate / pick from a single source of truth (Decision §7 — chosen for future-proofing without coupling to current callers).
- A small Vitest case in (or alongside) the existing auth-fixture coverage that asserts `DEV_USER_POOL.length === 12` and that each entry matches the username regex `^[a-z]+$` — pins the pool's existence and the naming convention so a future refactor that drops or renames a user surfaces as a red test, per ADR 0022.
- A revert of [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) line 116 from `test.describe.serial('Participant operate route — read-mostly graph render', () => {` back to `test.describe('Participant operate route — read-mostly graph render', () => {`. Block 4's `loginAs(page, { username: 'alice' })` / `loginAs(page, { username: 'ben' })` calls at lines 769 and 778 are swapped to `'grace'` and `'henry'` (the first new pair from this leaf). The in-file rationale comment at lines 103-115 is rewritten to point at the now-resolved pool exhaustion and link to this refinement's Status block; the per-block comments at lines 370-374 and 574-580 (which justify the distinct-pair-per-block posture) stay unchanged — they remain accurate.
- A re-run of the full `tests/e2e/participant-graph-render.spec.ts` under the default `fullyParallel: true` posture (the `chromium-participant-skeleton` project's default per [`playwright.config.ts`](../../../playwright.config.ts)) confirming the wall-clock recovers from `~33.5s under one worker` (the `.serial` baseline documented in `part_annotation_render`'s Status) to `~14s/block under fullyParallel` (the prior 3-block-parallel baseline). The recovery IS the e2e verification — no new Playwright spec is needed.

Out of scope (deferred to existing or future leaves):

- **Principled round-robin auth helper that allocates users dynamically from a larger pool.** The originating note explicitly carves this out: "The principled fix — a dedicated round-robin auth helper that allocates from a larger pool dynamically — is explicitly out of scope; revisit only if the cheap path proves insufficient." A future task (no current WBS leaf) would author a `fixtures/userPool.ts` that hands out `{ creator, debater }` pairs from a freelist, blocks on contention, and releases on teardown. That's a bigger refactor than the 0.5d budget allows; the cheap fix (more users in the static pool) gets the participant stream unblocked today.
- **Per-user credential isolation (distinct passwords).** ADR 0017 calls out per-user-passwords as a future amendment point if Playwright tests need credential isolation; this leaf does NOT trigger that amendment (the shared `aconversa-dev` password keeps the dev-quality-of-life trade intact and matches the 6 existing entries verbatim).
- **Production user-pool changes.** `users.yml` is `# DEV ONLY`; production Authelia uses a database-backed user store and federated upstream providers per ADR 0002. This expansion touches the dev-only file and has no production reachability.
- **Group / role taxonomy redesign.** The existing six users all carry `groups: [dev]`; the new six do the same. No new group, no new role, no per-user role customization. The methodology layer's role assignment (moderator / participant / audience) is driven by the application's own session-membership records (see [`apps/server/src/`](../../../apps/server/src) auth + session layers), NOT by Authelia groups; Authelia groups are dev-bookkeeping only.
- **Compose stack rebuild.** Confirmed by reading [`compose.yaml:151`](../../../compose.yaml#L151): `infra/authelia/users.yml` is bind-mounted read-only at `/config/users.yml` from the host. Authelia's `authentication_backend.file.refresh_interval: '5 minutes'` (per [`infra/authelia/configuration.yml:48`](../../../infra/authelia/configuration.yml#L48)) means a running container picks up the new users within 5 minutes; a `make down && make up` cycle is a one-second restart that picks them up immediately. No image rebuild, no Compose config change.
- **OIDC client whitelist expansion.** Verified by grep on [`infra/authelia/configuration.yml`](../../../infra/authelia/configuration.yml): the only `users:` reference is `authentication_backend.file` (the user store itself); the OIDC client at `aconversa-app-dev` carries `authorization_policy: one_factor` (line 203) with NO per-user allowlist. Any user in `users.yml` is authorizable for the client.
- **Updates to spec files OTHER than `participant-graph-render.spec.ts`.** No other spec currently uses more than 2 users per run, so none are at the exhaustion edge. Future spec authors pick from the expanded pool the same way today's authors do — no helper retrofit needed.
- **Display-name capitalization normalization** at the application layer. The existing `expect(alice.screenName.toLowerCase()).toBe('alice')` pattern in [`participant-graph-render.spec.ts:133`](../../../tests/e2e/participant-graph-render.spec.ts#L133) already absorbs the capitalization variance (the displayname is `'Alice Example'` per [`users.yml:20`](../../../infra/authelia/users.yml#L20), but the application's `screenName` post-callback is either the lowercased username or the user-entered screen-name from the new-user form — the test asserts case-insensitively per the comment at lines 126-131). The new users follow the same convention: `displayname: 'Grace Example'`, `screenName.toLowerCase() === 'grace'` at the assertion site. No source-side change.

## Why it needs to be done

The participant-UI stream's `part_graph_view` has four more sibling leaves landing after `part_annotation_render` that will each likely need a Playwright e2e block on the same `participant-graph-render.spec.ts` file or a sibling: `part_diagnostic_highlights`, `part_pan_zoom_tap`, `part_own_vote_indicators`, `part_other_vote_indicators`, `part_entity_detail_panel`. Each block currently needs a fresh `{ creator, debater }` user pair to avoid in-file `users` upsert races (the rationale documented in three prior block comments — [`participant-graph-render.spec.ts:370-374`](../../../tests/e2e/participant-graph-render.spec.ts#L370), [`tests/e2e/participant-graph-render.spec.ts:574-580`](../../../tests/e2e/participant-graph-render.spec.ts#L574), and the now-obsolete top-of-describe comment at lines 103-115). At 6 users (3 pairs) the pool was saturated by blocks 1-3; `part_annotation_render`'s block-4 tipped over and forced the `.serial` modifier (wall-clock `~14s/block` parallel → `~33.5s` sequential per its Status block).

The cheap fix unblocks the next 1-3 leaves (each adding 1-2 more blocks) without revisiting the test-infrastructure decision. The principled fix (a round-robin helper) is documented as a future option in the originating note and stays out of scope per the same.

Downstream concretely:

- **`participant_ui.part_graph_view.part_diagnostic_highlights`** (next likely block to land) consumes one fresh pair — `ivan` + `julia` available.
- **`participant_ui.part_graph_view.part_own_vote_indicators`** consumes one fresh pair — `kate` + `leo` available.
- **`participant_ui.part_graph_view.part_other_vote_indicators`** could reuse one of the freshly-introduced pairs OR motivate a second expansion if more siblings stack up. 12 users (6 pairs) leaves 2 spare pairs beyond the immediate next 2 blocks, which is the "1-2 leaves of headroom" buffer Decision §1 trades against the marginal cost of a 4th pair.
- **`tests/e2e/participant-graph-render.spec.ts`'s wall-clock** recovers from `~33.5s` (one-worker serial) to `~14s/block under fullyParallel` (4 parallel workers if available) — the documented baseline before `part_annotation_render`. Aggregate Playwright run-time across the chromium-participant-skeleton project drops by `~19.5s`.
- **Future moderator-UI specs** that also exhaust the 6-user pool (none today, but the same pattern applies once `mod_*` Playwright blocks stack up) inherit the expanded pool for free — the pool is shared across all spec files.

## Inputs / context

### ADRs

- [ADR 0017 — Mock OAuth in dev: Authelia in users-file mode](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) — the architectural seam this expansion sits inside. The ADR's §"Decision" bullet 2 commits to "Six dev users with one shared password"; bullet 5 commits to sqlite + filesystem notifier dev storage; bullet 6 commits to `aconversa-dev` as the shared password. The §"Consequences" bullet 2 carves out the explicit amendment posture: "config rotation does not require a new ADR." This leaf is config rotation within that carve-out — more users, same password, same shape, same OIDC client — and does NOT require an ADR.
- [ADR 0002 — Self-hosted OIDC via Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — the broader architectural choice. Production Authelia uses a database-backed user store; the dev `users.yml` is a faithful-OIDC stand-in only. Expansion of the dev pool has zero production reachability.
- [ADR 0008 — Playwright as the e2e framework](../../../docs/adr/0008-e2e-framework-playwright.md) — the framework whose `fullyParallel: true` posture the spec file restores. The `.serial` modifier is a Playwright primitive and the revert is a one-line edit.
- [ADR 0017 — Mock OAuth dev users-file](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) §"Verification" — the smoke-test invocation that confirmed the original config parses cleanly. The expanded `users.yml` parses cleanly through the same path (Authelia's YAML loader rejects duplicate keys + malformed entries at startup; the per-user shape is uniform).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest case asserting `DEV_USER_POOL.length === 12` AND the revert of the `.serial` modifier (re-run of the parallel-mode spec going green) are the committed verifications.

No new ADR. This is dev-config rotation within ADR 0017's explicit amendment carve-out.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_annotation_render.md`](part_annotation_render.md) — the immediate predecessor and the source of the debt. Its Decision §6 walks through the three options that were considered before settling on `.serial` (fourth block in same file with `alice`+`ben` reuse + `.serial` modifier; new spec file; reuse without `.serial`) and its Status block documents the `~33.5s` wall-clock baseline this leaf's revert will measure against. The revert this leaf performs is exactly the unwind of that Decision §6 once the pool is no longer the binding constraint.
- [`tasks/refinements/participant-ui/part_axiom_mark_decoration.md`](part_axiom_mark_decoration.md) — Decision §6 (the second-to-last instance of "pick a fresh user pair per block") set the precedent for distinct-pair-per-block. Block 3 used `frank` + `erin` (the last of the original 6); the comment at [`participant-graph-render.spec.ts:574-580`](../../../tests/e2e/participant-graph-render.spec.ts#L574) is that decision's in-code documentation. The expansion this leaf delivers keeps that precedent valid for blocks 4-N.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) and [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — the earlier participant-UI Playwright blocks that established the `loginAs(page, { username })` pattern + the per-block `freshContext` + `logoutAndClearAllCookies` chain. No change to those patterns; the new pair just slots into the existing scaffold.

### Sibling refinements on the foundation (where the original pool was set)

- [`tasks/refinements/foundation/dockerfile_mock_oauth.md`](../foundation/dockerfile_mock_oauth.md) — the origin of the 6-user pool. Its "Additional decisions" §"Six dev users" gives the rationale ("three from the canonical walkthrough plus three more so two parallel Playwright sessions can run side by side"); the Status block documents the password convention (`argon2id`, shared `aconversa-dev`) and the file header that this leaf updates. The expansion this leaf delivers is a faithful continuation: same hash algorithm, same plaintext password, same group membership, same shape — just six more entries.

### Live code the leaf plugs into

- [`infra/authelia/users.yml:1-55`](../../../infra/authelia/users.yml#L1) — the entire dev-user database. This leaf appends 6 new entries (`grace` / `henry` / `ivan` / `julia` / `kate` / `leo`) below `frank`, each with the same shape: `displayname: '<Name> Example'`, `password: '<the-shared-argon2id-hash>'`, `email: <name>@aconversa.local`, `groups: [dev]`. The file header comment at lines 1-16 updates "Six dev accounts" → "Twelve dev accounts" and adds a cross-link to this refinement. No new password hash needs generating; the existing hash is reused verbatim (the docstring at lines 12-14 documents the generator command for future rotation).
- [`infra/authelia/configuration.yml:46-58`](../../../infra/authelia/configuration.yml#L46) — `authentication_backend.file` block. `path: /config/users.yml` is unchanged; `refresh_interval: '5 minutes'` means a running container picks up the new entries automatically (a `make down && make up` cycle is the deterministic restart). The argon2id parameters at lines 51-58 are what generated the existing hash; the same parameters validate the same hash for the new users — no parameter change.
- [`infra/authelia/configuration.yml:203`](../../../infra/authelia/configuration.yml#L203) — `authorization_policy: one_factor` on the OIDC client. Grep-confirmed there is NO `users:` whitelist on the OIDC client; any user in the backend can complete the OIDC dance for `aconversa-app-dev`. No change to this file.
- [`compose.yaml:138-160`](../../../compose.yaml#L138) — the `authelia` Compose service. Lines 150-152 bind-mount `infra/authelia/users.yml` read-only at `/config/users.yml`. No change to compose wiring; the bind mount picks up host-side edits on container restart.
- [`tests/e2e/fixtures/auth.ts:97-135`](../../../tests/e2e/fixtures/auth.ts#L97) — `AUTHELIA_DEV_PASSWORD` constant + `LoginAsOptions` interface. The JSDoc at lines 112-115 enumerates the 6 existing users — this leaf updates the enumeration to 12 and (per Decision §7) adds a `DEV_USER_POOL: readonly string[]` named export below `AUTHELIA_DEV_PASSWORD`. The `loginAs` function body at lines 202-335 is unchanged (it accepts an arbitrary `username: string`).
- [`tests/e2e/participant-graph-render.spec.ts:103-115`](../../../tests/e2e/participant-graph-render.spec.ts#L103) — the top-of-describe rationale comment justifying `.serial`. This leaf rewrites the comment to document the pool expansion + link to this refinement, and removes the "Do NOT flip back to plain `test.describe`" directive (no longer applicable).
- [`tests/e2e/participant-graph-render.spec.ts:116`](../../../tests/e2e/participant-graph-render.spec.ts#L116) — the `test.describe.serial(...)` call. This leaf reverts to `test.describe(...)`.
- [`tests/e2e/participant-graph-render.spec.ts:769`](../../../tests/e2e/participant-graph-render.spec.ts#L769) — `loginAs(page, { username: 'alice' })` in block 4. This leaf changes to `'grace'`.
- [`tests/e2e/participant-graph-render.spec.ts:778`](../../../tests/e2e/participant-graph-render.spec.ts#L778) — `loginAs(page, { username: 'ben' })` in block 4. This leaf changes to `'henry'`.
- [`tests/e2e/participant-graph-render.spec.ts:741`](../../../tests/e2e/participant-graph-render.spec.ts#L741) — block-4's `test()` title. This leaf updates the leading `alice creates a session, ben claims debater-A` to `grace creates a session, henry claims debater-A`.
- [`tests/e2e/participant-graph-render.spec.ts:757-762`](../../../tests/e2e/participant-graph-render.spec.ts#L757) — block-4's "Reuses alice + ben (the block-1 pair) per Decision §6" comment. This leaf rewrites to "Uses grace + henry (a fresh pair from the part_e2e_user_pool_expansion expansion); the describe is no longer .serial — see this refinement's Status block."
- [`playwright.config.ts`](../../../playwright.config.ts) — unchanged. `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`; the default `fullyParallel: true` is what the revert restores.

### Existing fixtures the spec composes with

- [`tests/e2e/fixtures/auth.ts:202-335`](../../../tests/e2e/fixtures/auth.ts#L202) — `loginAs(page, opts)`. Already accepts an arbitrary `username: string`; the new users work without any signature change.
- [`tests/e2e/global-auth.setup.ts`](../../../tests/e2e/global-auth.setup.ts) (referenced by `auth.ts:215`) — the storage-state seeder. Today it seeds a single user's session; the multi-user storage-state strategy is outside this leaf's scope (the per-test `freshContext` + `loginAs` chain is what the four blocks use, NOT a shared storage state across users).

### What the surface MUST NOT do

- **No new password hash generation.** The shared argon2id hash for `aconversa-dev` is reused verbatim across all 6 new entries. Running the `authelia crypto hash generate argon2` command (documented at [`users.yml:12-14`](../../../infra/authelia/users.yml#L12)) would yield a different hash (random salt) that validates the same plaintext — but using a different hash per user would needlessly complicate diff review with no functional gain. The shared hash matches the existing convention.
- **No per-user password.** Every new user uses the same `aconversa-dev` plaintext per ADR 0017's explicit decision. The amendment-point carve-out (per-user passwords for credential isolation) is NOT triggered by this leaf.
- **No new groups.** All 6 new users carry `groups: [dev]` to match the existing 6. Authelia groups are dev-bookkeeping only — the application's role / membership model is independent.
- **No OIDC client config changes.** `aconversa-app-dev` has no per-user allowlist; any user in `users.yml` is authorizable.
- **No compose.yaml or Dockerfile changes.** The users file is bind-mounted; the container picks up edits on restart.
- **No `loginAs` signature change.** The function already takes an arbitrary `username`; the JSDoc update is documentation-only.
- **No round-robin helper.** Out of scope per the originating note.
- **No reshape of the existing 6 entries.** Their displaynames, emails, passwords, and groups are byte-for-byte unchanged.
- **No change to spec files other than `participant-graph-render.spec.ts`.** No other spec currently exhausts the pool; future spec authors pick from the expanded pool as a side benefit.
- **No change to `tests/e2e/global-auth.setup.ts`** or the storage-state strategy. The four `participant-graph-render` blocks use `freshContext` + `loginAs` per-test, NOT the shared storage state; the storage-state seeder's single-user posture is unaffected.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `infra/authelia/users.yml` — modified. Six new top-level entries appended below `frank` (in alphabetical-extension order): `grace`, `henry`, `ivan`, `julia`, `kate`, `leo`. Each entry has the same four-field shape (`displayname`, `password`, `email`, `groups`) as the existing six, with `displayname: '<Capitalized> Example'`, `password` set to the verbatim shared argon2id hash already in the file, `email: <lowercase>@aconversa.local`, `groups: [dev]`. The file header comment at lines 1-16 updates "Six dev accounts" → "Twelve dev accounts" and adds a cross-link: `# Refinement: tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`.
- `infra/authelia/README.md` — modified IF it enumerates the 6 users by name (the Implementer reads it; if the count or roster is mentioned, update both; if only `aconversa-dev` is documented, no change needed). Implementer: grep for `alice\|ben\|maria\|six dev` before editing.
- `tests/e2e/fixtures/auth.ts` — modified. (1) JSDoc on `LoginAsOptions.username` at lines 112-115 updated to enumerate all 12 users (or, more compactly, "one of the seeded dev users in `infra/authelia/users.yml` — `alice`, `ben`, `maria`, `dave`, `erin`, `frank`, `grace`, `henry`, `ivan`, `julia`, `kate`, `leo` (per ADR 0017 + this refinement)"). (2) Add a new named export `DEV_USER_POOL: readonly string[]` below `AUTHELIA_DEV_PASSWORD` (~line 106) carrying the 12 usernames in source order matching `users.yml`. Header JSDoc on `DEV_USER_POOL` cites this refinement + ADR 0017 + names the single source of truth (`infra/authelia/users.yml`). (3) No change to `loginAs` body, `LoginAsOptions` shape (other than the JSDoc), or any other helper.
- `tests/e2e/fixtures/auth.test.ts` — NEW (or `tests/e2e/fixtures/auth.fixtures.test.ts` if a sibling test file already exists; Implementer checks). Single Vitest case (or two) asserting (a) `DEV_USER_POOL.length === 12`; (b) every entry matches `/^[a-z]+$/` (ASCII lowercase only — pins the "no diacritics" convention so a future PR adding e.g. `josé` surfaces as red); (c) the array has no duplicates (`new Set(DEV_USER_POOL).size === DEV_USER_POOL.length`). The test lives under `tests/e2e/fixtures/` because Vitest's repo-wide config picks up `*.test.ts` anywhere; the file lives next to `auth.ts` so the cross-reference is local.
- `tests/e2e/participant-graph-render.spec.ts` — modified. (1) Line 103-115: top-of-describe rationale comment rewritten — see the rewritten text in the §Component-shape sketch below. (2) Line 116: `test.describe.serial(...)` → `test.describe(...)`. (3) Line 741: `test()` title updated to lead with `grace creates a session, henry claims debater-A`. (4) Line 757-762: block-4's "Reuses alice + ben" comment rewritten — see the §Component-shape sketch below. (5) Line 769: `loginAs(page, { username: 'alice' })` → `loginAs(page, { username: 'grace' })`. (6) Line 770: `expect(alice.screenName.toLowerCase()).toBe('alice')` → `expect(grace.screenName.toLowerCase()).toBe('grace')` (variable rename + assertion update). (7) Line 778: `loginAs(page, { username: 'ben' })` → `loginAs(page, { username: 'henry' })`. (8) Line 779: `expect(ben.screenName.toLowerCase()).toBe('ben')` → `expect(henry.screenName.toLowerCase()).toBe('henry')`. (9) Any subsequent in-block usages of `alice` / `ben` variable names get renamed to `grace` / `henry` accordingly. NO other behavioural change.

### Files this task does NOT touch

- `infra/authelia/configuration.yml` — unchanged. OIDC client config doesn't whitelist users; argon2id parameters validate the reused hash.
- `compose.yaml` — unchanged. Bind mount picks up users.yml edits on container restart.
- `infra/authelia/tls/`, `infra/authelia/data/` — unchanged. No TLS or storage changes.
- `tests/e2e/global-auth.setup.ts` — unchanged. The storage-state seeder's single-user posture is irrelevant to the per-test `freshContext` + `loginAs` chain used by participant-graph-render.
- `tests/e2e/participant-graph-render.spec.ts` blocks 1, 2, 3 — unchanged. They keep their `alice`+`ben`, `maria`+`dave`, `frank`+`erin` pairings. The distinct-pair-per-block precedent stays valid.
- All other `tests/e2e/*.spec.ts` files — unchanged. No other spec is at the pool exhaustion edge today.
- `playwright.config.ts` — unchanged. `fullyParallel: true` was already the default; the spec's `.serial` modifier was the in-file override the revert removes.
- `apps/server/`, `apps/root/`, `apps/moderator/`, `apps/participant/`, `apps/audience/`, `packages/*` — unchanged. No application code involved.
- `docs/adr/` — no new ADR. Config rotation within ADR 0017's amendment carve-out.
- `.tji` files — `complete 100` on `part_e2e_user_pool_expansion` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (sketches the Implementer ports verbatim)

**`infra/authelia/users.yml` — appended entries (sketch)**

```yaml
  grace:
    displayname: 'Grace Example'
    password: '$argon2id$v=19$m=65536,t=3,p=4$JpiWZ31afMmtrS72rVRXrA$jy30rqZRty9UwAL/7WVCmC1nK7N9FlgW/J3fQ021BPs'
    email: grace@aconversa.local
    groups:
      - dev
  henry:
    displayname: 'Henry Example'
    # ... same hash ...
  ivan:
    displayname: 'Ivan Example'
    # ... same hash ...
  julia:
    displayname: 'Julia Example'
    # ... same hash ...
  kate:
    displayname: 'Kate Example'
    # ... same hash ...
  leo:
    displayname: 'Leo Example'
    # ... same hash ...
```

**`tests/e2e/fixtures/auth.ts` — new named export (sketch)**

```ts
/**
 * The 12 dev-only Authelia users seeded in `infra/authelia/users.yml`,
 * in source order. Maintained as a single source of truth so spec
 * authors can iterate or pick from a freelist without hard-coding the
 * roster. The 6-user → 12-user expansion is documented in
 * `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`;
 * the underlying ADR is `docs/adr/0017-mock-oauth-authelia-users-file.md`.
 *
 * Every entry is a valid `LoginAsOptions.username` and authenticates
 * with {@link AUTHELIA_DEV_PASSWORD}.
 */
export const DEV_USER_POOL: readonly string[] = [
  'alice', 'ben', 'maria', 'dave', 'erin', 'frank',
  'grace', 'henry', 'ivan', 'julia', 'kate', 'leo',
] as const;
```

**`tests/e2e/participant-graph-render.spec.ts` — rewritten top-of-describe comment (sketch)**

```ts
// The four `test()` blocks below run in parallel under Playwright's
// default `fullyParallel: true` posture. Each block claims a distinct
// `{ creator, debater }` pair from the 12-user Authelia dev pool
// (`infra/authelia/users.yml`) to avoid the in-file per-session
// `users` upsert race that surfaces when two blocks within the same
// worker claim the same user-id concurrently.
//
// Pair assignment (source: tests/e2e/fixtures/auth.ts DEV_USER_POOL):
//   block 1: alice + ben
//   block 2: maria + dave
//   block 3: frank + erin
//   block 4: grace + henry
//
// History: blocks 1-3 saturated the original 6-user pool; block 4
// (added by `part_annotation_render`) initially reused alice+ben and
// flipped the describe to `.serial` (wall-clock ~33.5s under one
// worker). The pool was expanded to 12 by
// `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`,
// freeing block 4 to use a fresh pair and the describe to revert to
// parallel execution (wall-clock recovered to ~14s/block).
```

**`tests/e2e/participant-graph-render.spec.ts` — rewritten block-4 comment (sketch, replacing the prior "Reuses alice + ben" comment at lines 757-762)**

```ts
    // Uses `grace` + `henry` — a fresh pair from the 12-user dev pool
    // expansion (`infra/authelia/users.yml`; see
    // `tasks/refinements/participant-ui/part_e2e_user_pool_expansion.md`).
    // Distinct from blocks 1-3 so the four blocks run in parallel under
    // `fullyParallel: true` without racing on the shared user-creation
    // path.
```

## Acceptance criteria

The check that says "done":

- `infra/authelia/users.yml` contains 12 top-level entries (`alice`, `ben`, `maria`, `dave`, `erin`, `frank`, `grace`, `henry`, `ivan`, `julia`, `kate`, `leo`), each with `displayname`, `password`, `email`, `groups` matching the existing convention. The file header comment reflects the new count and cross-links this refinement. `make up` (or `docker compose up -d authelia`) brings the Authelia container up cleanly with the new users; the Implementer verifies by tailing the container logs for `Startup complete` and confirming no YAML-parse error.
- A new `DEV_USER_POOL: readonly string[]` is exported from `tests/e2e/fixtures/auth.ts` carrying the 12 usernames in source order.
- `tests/e2e/fixtures/auth.test.ts` (or an equivalent location chosen by the Implementer) contains a Vitest case asserting `DEV_USER_POOL.length === 12`, the no-duplicates property, and the `/^[a-z]+$/` regex per entry. Per ADR 0022, this is a committed test.
- `tests/e2e/participant-graph-render.spec.ts` line 116 reads `test.describe('Participant operate route — read-mostly graph render', () => {` (no `.serial`). Block 4 uses `grace` + `henry`. The top-of-describe comment + block-4 comment are rewritten per the sketches above.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new fixture test (1-3 cases depending on how the Implementer chooses to split). No prior cases break.
- `pnpm -F @a-conversa/participant build` succeeds (unchanged from baseline — no application code touched).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes `tests/e2e/participant-graph-render.spec.ts` and all 4 blocks pass. **Wall-clock recovery assertion**: the run-time for `chromium-participant-skeleton` on this spec file is at or near the prior `~14s/block under fullyParallel` baseline (i.e., ~14-20s for the slowest of the 4 blocks under parallel execution; aggregate spec-file wall-clock with 4 parallel workers should land in the same 14-20s range, NOT the 33.5s `.serial` baseline). The Implementer records the measured wall-clock in the Closer's Status block.
- **Per ORCHESTRATOR.md UI-stream e2e policy**: this leaf does NOT add a new Playwright spec; the verification IS the revert of the existing spec to parallel + the green re-run. The "UI-stream tasks need a Playwright pin" policy is satisfied by the existing 4-block spec file going green under the new posture.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_e2e_user_pool_expansion` in the same commit (the Closer's ritual).

## Decisions

### §1 — Add THREE new pairs (6 users → 12-user pool), not 2

The originating note suggests "2 more dev user pairs" (taking the pool to 10). Three alternatives:

- **(a) Add 2 pairs (10 users total).** Minimum to unblock the current participant-graph-render block-4 + leave 1 spare pair for the next sibling. Smallest diff, smallest header-comment update.
- **(b) Add 3 pairs (12 users total).** Chosen. The next 1-2 participant-UI sibling leaves (`part_diagnostic_highlights`, `part_own_vote_indicators`, `part_other_vote_indicators`, `part_entity_detail_panel`) are likely each to add a Playwright block needing a fresh pair; 12 users (6 pairs) gives 2 spare pairs of headroom beyond block-4. Marginal cost of the third pair: 8 more YAML lines + 2 more username entries in `DEV_USER_POOL` + 2 more entries in the JSDoc. Zero functional risk; the third pair sits dormant until consumed.
- **(c) Add 4+ pairs (14+ users total).** Anticipates further blocks but inflates the static pool without a current consumer. The principled fix (round-robin helper) is the right answer once the static pool's cost exceeds 12-16; below that threshold the static pool stays simpler. Rejected as YAGNI.

Chosen: (b). Three pairs gets the participant-UI stream unblocked for the next 1-2 leaves of work without inflating the pool past the YAGNI threshold. If a fourth pair is needed later, a second expansion is a 5-minute job within the same seam.

### §2 — Username naming: continue alphabetical from `g`/`h`/`i`/`j`/`k`/`l` with readable Western first names; ASCII-only

The existing pool `alice` / `ben` / `maria` / `dave` / `erin` / `frank` is NOT strictly alphabetical (it skips `c` and `g`-`l`) but is a recognizable set of readable Western first names. Two alternatives:

- **(a) Continue alphabetically: `grace`, `henry`, `ivan`, `julia`, `kate`, `leo`.** Chosen. Each name starts with a distinct letter (`g`, `h`, `i`, `j`, `k`, `l`), is unambiguous in spelling, is ASCII-only (no diacritics — see §3 below), and is short enough to type quickly in test code. No collision with the existing 6 (which use `a`, `b`, `m`, `d`, `e`, `f`).
- **(b) Continue the existing pattern: more names that fit "canonical walkthrough" feel.** Subjective; the existing 6 names don't follow a single thematic pattern (mix of US/UK/Spanish-origin names), so there's no strong "extension of theme" signal. Rejected as no improvement over (a).
- **(c) Use non-name identifiers: `user7`, `user8`, …, `user12`.** Rejected: the existing pool's readable-name posture is helpful in test-failure output ("alice claims debater-A" reads better than "user1 claims debater-A"); switching to numeric identifiers mid-pool breaks readability without a compensating benefit.

Chosen: (a). Names: `grace`, `henry`, `ivan`, `julia`, `kate`, `leo`. Pair-grouping for the four-blocks-per-spec convention: `grace`+`henry`, `ivan`+`julia`, `kate`+`leo` (the natural alphabetical pairing). Block-4's revert (per the Constraints sketch) uses the first new pair (`grace`+`henry`).

### §3 — ASCII-only usernames; no diacritics

The displayname pattern `Alice Example` / `Ben Example` is ASCII-only across all 6 existing entries. Two alternatives:

- **(a) ASCII-only for both username AND displayname.** Chosen. Keeps the regex assertion `/^[a-z]+$/` tractable; avoids the Authelia capitalization flake-class the predecessor refinement (`part_annotation_render`'s spec at line 127-131) explicitly absorbed (`expect(alice.screenName.toLowerCase()).toBe('alice')` — case-insensitive because the displayname casing can shift); avoids any encoding variance between the YAML loader, Authelia's user-store, and the OIDC id_token claim serializer.
- **(b) Add diacritic-bearing names (e.g. `josé`, `renée`) for i18n coverage.** Rejected: i18n coverage of usernames is NOT what this leaf is verifying; the i18n test surface is the locale catalogs (`packages/i18n-catalogs/`). Mixing diacritic-bearing usernames into the dev pool invites encoding flakes that have nothing to do with the test under verification, exactly the failure mode the originating note warned about.

Chosen: (a). The `auth.test.ts` regex `/^[a-z]+$/` pins this.

### §4 — Reuse the existing shared argon2id hash byte-for-byte; do NOT regenerate per-user

The existing 6 entries all use the same argon2id hash of `aconversa-dev` (the hash is documented at [`users.yml:12-14`](../../../infra/authelia/users.yml#L12) as "All six users share the same hash because the dev password is shared"). Two alternatives:

- **(a) Reuse the exact hash byte-for-byte for all 6 new entries.** Chosen. Authelia validates the hash against the plaintext `aconversa-dev` regardless of whether the salt is unique; reusing the hash means the diff for `users.yml` is mechanical (6 new entries, each with one obviously-copy-pasted hash line), reviewer-friendly, and matches the existing file's convention verbatim. No new hash needs generating.
- **(b) Generate a fresh hash per new user.** Each call to `authelia crypto hash generate argon2 --password 'aconversa-dev'` yields a distinct salt and therefore a distinct hash that all validate the same plaintext. Mechanically works, but produces 6 distinct hash strings in the diff with no functional benefit — and obscures the "all dev users share the same plaintext" convention that the existing 6 entries make obvious. Rejected as it makes the file less, not more, readable.

Chosen: (a). The Implementer copies the hash from one of the existing entries (e.g., line 21 — `alice`'s hash) into each of the 6 new entries.

### §5 — Displayname convention: `'<Capitalized> Example'`, matching the existing entries

The 6 existing entries all carry `displayname: '<Capitalized> Example'` (e.g., `'Alice Example'`, `'Ben Example'`). Two alternatives:

- **(a) Match the existing convention: `'Grace Example'`, `'Henry Example'`, ….** Chosen. Uniform with the existing 6; the test-side `screenName.toLowerCase()` comparison at [`participant-graph-render.spec.ts:133`](../../../tests/e2e/participant-graph-render.spec.ts#L133) absorbs the capitalization variance the same way for the new users as for the existing ones.
- **(b) Use a different displayname pattern (e.g., `'Grace Dev'`, `'Grace'`).** Rejected: no reason to diverge from the established convention; uniformity makes the file easier to scan.

Chosen: (a). The capitalization concern flagged by the prior implementer (`expect(... .toLowerCase()).toBe('alice')`) is handled by the existing assertion pattern, which works identically for the new users because they follow the same displayname convention.

### §6 — All new users carry `groups: [dev]`; no new group or role

Two alternatives:

- **(a) All new users carry `groups: [dev]`.** Chosen. The existing 6 carry the same; Authelia groups are dev-bookkeeping only (the application's role / membership model is independent and lives in the per-session DB tables).
- **(b) Assign role-suggestive groups (e.g., `[dev, moderator]`, `[dev, participant]`).** Rejected: the application doesn't read Authelia groups for role assignment, so the group label would be inert and misleading. The application's role model is session-membership-driven; Authelia groups are not the seam.

Chosen: (a). Per §"Group/role assignment" of the originating context.

### §7 — Export a `DEV_USER_POOL: readonly string[]` constant from `auth.ts`; document but don't refactor existing callers

The existing `loginAs` callers hard-code the username string per call (e.g., `loginAs(page, { username: 'alice' })`). Two alternatives:

- **(a) Add a `DEV_USER_POOL` named export; document it; do NOT refactor existing callers.** Chosen. The constant is the single source of truth for "what dev users exist"; future spec authors who want to pick a pair from a freelist (or future round-robin helper) import from one place. Existing callers stay hard-coded — refactoring them to `DEV_USER_POOL[0]` etc. would obscure WHICH user each block is using and is exactly the kind of cleverness that hurts test readability.
- **(b) Don't add the constant; only update the JSDoc.** Rejected: a Vitest case asserting "the pool has 12 entries" needs SOMETHING in `auth.ts` to import; the constant is the minimal seam that supports the test and also future spec authors. The marginal cost is one 12-element string array.
- **(c) Refactor existing callers to use `DEV_USER_POOL[N]` indexing.** Rejected: makes the spec less readable (the variable name in-context tells the reader who the user is; indexing into a constant requires the reader to count). The constant is purely additive.

Chosen: (a). Adds the export + JSDoc + Vitest pin; leaves all existing `loginAs(page, { username: '<name>' })` calls untouched.

### §8 — Compose stack picks up the new users via the existing bind-mount + Authelia's 5-minute refresh interval; no rebuild

Verified by reading [`compose.yaml:151-152`](../../../compose.yaml#L151) and [`infra/authelia/configuration.yml:48`](../../../infra/authelia/configuration.yml#L48). Two alternatives the originating context raised:

- **(a) Bind mount picks up edits on container restart; `make down && make up` is the deterministic pickup; running container auto-refreshes within 5 minutes.** Chosen — this is what the existing config already does. No change.
- **(b) Image rebuild required.** Rejected — Authelia's image is upstream (`authelia/authelia:4.39` per ADR 0017); the users file is mounted, not baked. No rebuild needed.

The Implementer's verification step is to run `make down && make up` (or `docker compose restart authelia`) and tail the Authelia logs for `Startup complete` to confirm the YAML parses cleanly. No image build, no Compose config edit.

### §9 — `.serial` revert is part of acceptance, not deferred to a follow-up

Two alternatives:

- **(a) Revert `.serial` → `fullyParallel` as part of THIS task; assert wall-clock recovery in the Status block.** Chosen. The revert is one line of code (`test.describe.serial(...)` → `test.describe(...)`) plus the block-4 user-rename; it's the natural completion of the pool expansion and the e2e verification IS that the revert goes green in parallel mode. Splitting the revert into a follow-up task would risk the expansion landing and the revert never happening (the `.serial` modifier would silently keep the wall-clock regression in place — exactly the tech-debt accretion ORCHESTRATOR.md's tech-debt registration policy is meant to prevent).
- **(b) Land the user-pool expansion in this task; the `.serial` revert lands in a separate follow-up.** Rejected: separation of concerns isn't worth the risk of the revert being forgotten. The expansion + revert are a single conceptual change (pool was too small → expand pool → consume the new headroom).

Chosen: (a). Both halves land in the same task and the same commit.

### §10 — Pair assignment for block 4: `grace` + `henry` (the first new pair); no preservation of `alice` + `ben` reuse

Three alternatives for which pair block 4 uses post-expansion:

- **(a) Use `grace` + `henry` (the first new pair).** Chosen. Each block now uses a distinct fresh pair; `alice` + `ben` are exclusively block 1's pair; the distinct-pair-per-block precedent (from prior leaves' Decision §6) is preserved without exception.
- **(b) Keep block 4 on `alice` + `ben` and use `grace` + `henry` for a future block.** Rejected: violates the distinct-pair-per-block precedent that motivated this entire expansion in the first place. The whole point of expanding the pool is to give block 4 its own pair.
- **(c) Reshuffle all 4 blocks to use the "new" pairs (block 1 = grace + henry, block 2 = ivan + julia, etc.).** Rejected: unnecessary churn; the existing blocks 1-3 work fine on `alice` / `ben` / `maria` / `dave` / `frank` / `erin` and reshuffling adds diff noise without benefit.

Chosen: (a). Block 4 swaps `alice`+`ben` → `grace`+`henry`.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- **Headline outcome — wall-clock recovery**: `tests/e2e/participant-graph-render.spec.ts` under `chromium-participant-skeleton` now runs 4 blocks (plus the auth setup) in **14.3s under 4 workers**, down from the 33.5s `.serial` baseline `part_annotation_render` shipped. The pre-`.serial` parallel posture is fully restored.
- **6→12 dev user pool expansion**: appended `grace` / `henry` / `ivan` / `julia` / `kate` / `leo` to [`infra/authelia/users.yml`](../../../infra/authelia/users.yml) using the verbatim shared argon2id hash of `aconversa-dev` and `groups: [dev]` per Decisions §4 / §5 / §6; file-header comment updated "Six dev accounts" → "Twelve dev accounts" with a cross-link to this refinement. [`infra/authelia/README.md`](../../../infra/authelia/README.md) updated in lockstep ("Six dev users" → "Twelve dev users" + the six new names + cross-link to this refinement).
- **`DEV_USER_POOL: readonly string[]` export**: new named export in [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) carrying the 12 usernames in `users.yml` source order per Decision §7; `LoginAsOptions.username` JSDoc enumeration updated from 6 to 12 names.
- **Failing-first verification per ADR 0022**: new pin file [`tests/smoke/dev-user-pool.test.ts`](../../../tests/smoke/dev-user-pool.test.ts) ships 4 Vitest cases asserting `DEV_USER_POOL.length === 12`, the `/^[a-z]+$/` ASCII-only regex per entry, the no-duplicates property, and source-order alignment. The pin was confirmed to go red when the array was temporarily shrunk to 6 entries before going green on the full 12 — the regression-detector posture Decision §7 + the Acceptance criteria called for.
- **`.serial` revert + block-4 user swap**: [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) flipped `test.describe.serial(...)` → `test.describe(...)` (Decision §9); block 4's `alice` + `ben` pair swapped to `grace` + `henry` (Decision §10) so the four blocks now each claim a distinct fresh pair from the expanded pool; the top-of-describe and block-4 rationale comments rewritten per the §Component-shape sketches to document the now-12-user pool + cite this refinement.
- **Vitest test-count delta**: 178 files / 3894 tests → 179 files / 3898 tests (+1 file, +4 cases). Cucumber unchanged. Playwright block-count unchanged (still 4 blocks in the spec).
- **No tech-debt registered**: this IS the debt-paydown task; the principled round-robin auth helper remains documented as explicitly out of scope per Decision §1 and is a future option only if a fourth pool expansion ever proves needed.
