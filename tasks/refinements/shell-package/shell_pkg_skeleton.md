# packages/shell workspace skeleton

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.shell_pkg_skeleton`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `foundation.repo_skeleton` (settled — pnpm workspaces under `apps/` and `packages/` per [ADR 0010](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md); per-workspace `tsconfig.json` extending `tsconfig.base.json` per [ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
- `foundation.stack_decisions.frontend_framework_decision` (settled — React per [ADR 0003](../../../docs/adr/0003-frontend-framework-react.md)).

## What this task is

Land the empty `@a-conversa/shell` workspace under `packages/shell/`: a pnpm workspace member with `package.json`, `tsconfig.json`, a Vite library-mode build config, a single-file `src/index.ts` that exports a placeholder version constant, and one Vitest unit case that pins the constant. No mount-contract types, no auth context, no i18n bootstrap, no WS client — every one of those is its own downstream leaf under the same `shell_package` group in [`tasks/27-shell-package.tji`](../../27-shell-package.tji). This task lands the **structural seam** the rest of those leaves drop into.

The workspace is wired into the existing `pnpm-workspace.yaml` glob (`packages/*` — already present, no edit needed), added to the root [`tsconfig.json`](../../../tsconfig.json) `references` list so the solution-style `tsc -b` walks it, and gets its `build` / `typecheck` / `test` scripts exposed via `pnpm -F @a-conversa/shell run <script>` for downstream leaves and CI.

## Why it needs to be done

The micro-frontend pivot in [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) declares `packages/shell/` as the shared substrate consumed by both the new root app (`apps/root/`) and every UI surface (`apps/moderator/`, `apps/participant/`, `apps/audience/`, `apps/replay-test/`). The eight downstream leaves in `shell_package` (`shell_mount_contract`, `shell_auth_context`, `shell_screen_name_form`, `shell_login_logout_components`, `shell_i18n_bootstrap`, `shell_ws_client`, `shell_error_mapper`, `shell_tests`) each `depends !shell_pkg_skeleton` in the WBS — none of them can land before the workspace itself exists. The root-app group and the moderator-refactor task (`moderator_ui.mod_extract_to_mountable_library`) further down the WBS also block on the shell package being a real, buildable workspace.

Roughly ~12d of subsequent work (the rest of `shell_package`, plus `root_app`, plus the moderator refactor) unblocks once this 0.5d seam is in place. Per the orchestrator's one-task-one-commit rule, the seam ships alone — no opportunistic landing of the mount-contract types here.

## Inputs / context

- [`docs/adr/0026-micro-frontend-root-app.md`](../../../docs/adr/0026-micro-frontend-root-app.md) — the architectural pivot; declares `packages/shell/` and its eventual contents (mount-contract types lines 41–55; "What lives where" lines 60–78; library-mode surface build lines 37–57). This task lands only the empty skeleton.
- [`docs/adr/0010-directory-layout-pnpm-workspaces.md`](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md) — pnpm workspaces, `apps/` + `packages/`; 2026-05-16 Amendment line 64 explicitly records the addition of `packages/shell/`.
- [`docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md`](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — per-workspace `tsconfig.json` extending `tsconfig.base.json`; project references on the root tsconfig.
- [`docs/adr/0011-linter-eslint-with-typescript-eslint.md`](../../../docs/adr/0011-linter-eslint-with-typescript-eslint.md) — flat ESLint config at the root applies to `packages/**/*.{ts,tsx}` (see [`eslint.config.js`](../../../eslint.config.js) line 47); no per-workspace ESLint config needed.
- [`docs/adr/0012-formatter-prettier.md`](../../../docs/adr/0012-formatter-prettier.md) — Prettier at root, no per-workspace config.
- [`docs/adr/0006-unit-test-framework-vitest.md`](../../../docs/adr/0006-unit-test-framework-vitest.md) — Vitest is the unit runner; the root `vitest.config.ts` (lines 13–15) sets `resolve.conditions: ['source']` so workspace packages resolve to TS source without a build.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical verification ships as a committed test in the appropriate layer. Pure-logic check → Vitest under `packages/<ws>/src/*.test.ts` (line 32).
- **Reference workspace shape** — [`packages/i18n-catalogs/package.json`](../../../packages/i18n-catalogs/package.json), [`packages/i18n-catalogs/tsconfig.json`](../../../packages/i18n-catalogs/tsconfig.json), [`packages/shared-types/package.json`](../../../packages/shared-types/package.json), [`packages/shared-types/tsconfig.json`](../../../packages/shared-types/tsconfig.json). Both use the `source` / `default` dual-export pattern from the [ADR 0010 2026-05-11 Amendment](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md) (line 63); the shell package follows the same pattern.
- **Reference Vite config** — [`apps/moderator/vite.config.ts`](../../../apps/moderator/vite.config.ts) is an *app* Vite config (dev server + SPA build); ADR 0026 lines 37–57 describes the **library-mode** shape every surface bundle plus the shell will eventually use. No library-mode example exists in the repo yet — this task is the first.
- [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml) — already globs `packages/*` (line 3); the new workspace is picked up by `pnpm install` automatically, no edit required.
- [`tsconfig.json`](../../../tsconfig.json) (root, solution-style) — must add `{ "path": "packages/shell" }` to the `references` array so `pnpm typecheck` (which runs `tsc -b`) walks the new workspace.
- [`package.json`](../../../package.json) (root) — `packageManager: pnpm@9.15.4`; root scripts `build` (`pnpm -r build`), `typecheck` (`tsc -b`), `lint`, `check`, `test:smoke` (`vitest run tests/smoke packages apps`). The new workspace inherits all of these for free once it ships a `build` script and is on the root tsconfig references list. The smoke test glob (`packages`) auto-picks up new `.test.ts` files under `packages/shell/src/`.

## Constraints / requirements

- **Workspace name**: `@a-conversa/shell` (matches the existing `@a-conversa/i18n-catalogs`, `@a-conversa/shared-types`, `@a-conversa/test-fixtures`, `@a-conversa/moderator` pattern). The task brief used `@aconversa/shell`; the in-repo convention is hyphenated `@a-conversa/`.
- **Workspace path**: `packages/shell/`.
- **pnpm workspace member** — picked up by the existing `packages/*` glob in [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml); no edit to that file required.
- **TypeScript strict** — per [ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md). `tsconfig.json` extends `../../tsconfig.base.json` (which sets `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, `composite`, `declaration`).
- **ESLint** — the root [`eslint.config.js`](../../../eslint.config.js) flat-config file pattern `packages/**/*.{ts,tsx}` (line 47) automatically picks up `packages/shell/src/**`. No per-workspace ESLint config.
- **Prettier** — root config applies; no per-workspace config.
- **`source` / `default` dual-export** — `package.json#exports` declares `"source": "./src/index.ts"` (TS source for Vitest under `resolve.conditions: ['source']`) and `"default": "./dist/index.js"` (built JS for Node runtime). Matches the [ADR 0010 2026-05-11 Amendment](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md).
- **Vite library mode for the build** — per [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md). The surfaces all build in library mode; the shell adopts the same tooling now so the surface refactor finds a uniform pipeline already in place. The build emits a single ESM bundle plus its `.d.ts` (TS declarations come from `tsc --emitDeclarationOnly` running alongside Vite — Vite doesn't emit declarations in library mode by default).
  - `vite.config.ts` with `build.lib`: `entry: 'src/index.ts'`, `formats: ['es']`, `fileName: 'index'`.
  - `build.rollupOptions.external` lists React (`react`, `react-dom`, `react/jsx-runtime`) so the bundle doesn't double-bundle the consumer's React. No actual `react` import lands in this task, but the `external` entry is set up so future leaves don't have to revisit the config.
  - `build` script in `package.json` runs `tsc --emitDeclarationOnly -p tsconfig.json && vite build` (or splits the two; either is fine). The `tsc` half is the source of `.d.ts`; `vite build` is the source of `dist/index.js`.
- **Source layout** — `src/index.ts` is the public-surface barrel; each downstream subsystem (`shell_mount_contract`, `shell_auth_context`, `shell_screen_name_form`, `shell_login_logout_components`, `shell_i18n_bootstrap`, `shell_ws_client`, `shell_error_mapper`) lands its own `src/<subsystem>/` subdirectory in its own commit. For THIS task, `src/index.ts` exports a single placeholder constant:

  ```ts
  export const SHELL_PACKAGE_VERSION = '0.1.0' as const;
  ```

  The constant is a real export (not a comment); the vitest case asserts its value; together they pin "the package exists, links, builds, and exports something."
- **`peerDependencies`** — declares `react` and `react-dom` as peers without pinning versions (the eventual auth context, screen-name form, and login-logout components will export React components and need to share the consumer's React instance). The root and surface workspaces supply the actual React. No `dependencies` entries are added in this task — the package is dependency-free except for build/typing tools in `devDependencies` (`vite`, `typescript` are already in the root pnpm store).
- **No actual dependencies on `i18next` / `react-i18next` / `@a-conversa/i18n-catalogs` / `@a-conversa/shared-types`** until the leaves that need them land. The skeleton stays minimal so the diff for each downstream leaf is its own subsystem only.
- **Add `packages/shell` to the root [`tsconfig.json`](../../../tsconfig.json) `references` list** so `pnpm typecheck` (`tsc -b`) walks the new workspace. This is the only edit outside `packages/shell/` itself, and is the same edit `packages/i18n-catalogs` made when it landed (see the [`i18n_catalog_workflow.md` Status block](../frontend-i18n/i18n_catalog_workflow.md#status)).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script the CI already runs — no throwaway probes.

- `pnpm install` recognizes the new workspace: `pnpm -r ls` lists `@a-conversa/shell` under `packages/shell` (no extra edit to `pnpm-workspace.yaml` needed; the existing `packages/*` glob picks it up).
- `pnpm -F @a-conversa/shell build` exits zero and produces a `dist/` tree containing at minimum `dist/index.js` (Vite library-mode output) and `dist/index.d.ts` (tsc declarations).
- `pnpm -F @a-conversa/shell typecheck` (or `tsc -b` from the workspace root) exits zero.
- `pnpm run check` (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The root `tsconfig.json` `references` array now includes `{ "path": "packages/shell" }`; the ESLint flat config's `packages/**/*.{ts,tsx}` pattern picks the new source files up automatically.
- `pnpm run test:smoke` count grows by exactly **one** new Vitest case (the version-constant check below) and stays green. No existing test count drops.
- A Vitest case at `packages/shell/src/index.test.ts` asserts `SHELL_PACKAGE_VERSION === '0.1.0'`. Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) this is the package's regression-pinned existence proof: if the export name, value, or barrel re-export shape changes, this test fails. It is intentionally minimal — it pins observable behavior (the exported constant) rather than internal implementation (build artifacts).
- `pnpm -r build` (root: builds every workspace) walks the new workspace without error.

### UI-stream e2e policy

`shell_package` is **not** a UI-stream task — it ships frontend substrate, not a user-facing surface. **No Playwright spec is in scope for this task or for any other leaf under `shell_package`.** Per [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) "Stack-validation tests" (lines 113–117), the shell's downstream consumers (`apps/root/` and the surface refactor) exercise the shell end-to-end in their own Playwright suites; the shell itself is covered by Vitest at the unit layer only.

## Decisions

- **Vite library mode for the build (not `tsc -b` alone, not no-build).** Alternatives:
  - *`tsc -b` only* (what `packages/i18n-catalogs/` and `packages/shared-types/` use today) — rejected because the shell ships browser-side React components (auth context, login button, screen-name form) downstream, and surfaces consume those via dynamic `import()` per the ADR 0026 mount contract; bundler-friendly ESM output with tree-shakable exports starts to matter as soon as the first React component lands, and adding it later means rewriting the build for every consumer at once.
  - *No build* (publish raw TS) — rejected because production Node resolves to the `default` export per ADR 0010's 2026-05-11 Amendment (line 63), and the runtime image only ships built artifacts; the `dist/` half of the dual-export is required.
  - *Chosen:* Vite library mode now. The surfaces (per ADR 0026) all build in library mode too; uniform tooling across `packages/shell/` + `apps/<surface>/` is the goal. The skeleton lands the config so the next leaf doesn't have to.
- **Package name `@a-conversa/shell` (alternatives: `@a-conversa/app-shell`, `@a-conversa/frontend-shell`, `@aconversa/shell`).** Rejected: the verbose forms add no information (the package's path is `packages/shell/`; the scope `@a-conversa` already disambiguates). The unhyphenated `@aconversa/shell` from the task brief contradicts the in-repo convention (`@a-conversa/i18n-catalogs`, `@a-conversa/shared-types`, `@a-conversa/test-fixtures`, `@a-conversa/moderator`, `@a-conversa/server`, etc.) — chose to align.
- **Skeleton-only (no mount-contract types, no auth context, no anything else).** Alternative: land the mount-contract types now since they're small and unblock the most consumers. Rejected: a separate leaf `shell_mount_contract` exists in [`tasks/27-shell-package.tji`](../../27-shell-package.tji) for exactly that, and the orchestrator's one-task-one-commit discipline means each leaf's diff stays small and its commit isolatable. Conflating commits hurts revertability and review.
- **Placeholder export: `SHELL_PACKAGE_VERSION = '0.1.0' as const`.** Alternative names considered: `SHELL_VERSION`, `PACKAGE_VERSION`. Chose the namespaced form because future packages may want their own `*_PACKAGE_VERSION` constants and the prefix prevents barrel-import name collisions. `as const` gives the type a literal type (`'0.1.0'`), which makes the vitest assertion `expect(SHELL_PACKAGE_VERSION).toBe('0.1.0')` typecheck without a widening cast.
- **Vitest case pins the version constant (alternative: no test in the skeleton; alternative: test that `dist/index.js` exists).** Rejected:
  - *No test* — violates [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md); the package's existence + barrel export shape is a real behavior that wants regression-pinning.
  - *Test the build output exists* — rejected as a build-tooling test (checks that the build ran, not that the code behaves); ADR 0022's bar is "pin observable behavior," and the observable behavior of an empty-skeleton package is "the public export is what I declared it to be."
  - *Chosen:* one-line vitest case asserting the exported constant. Minimal cost; pins the export.
- **`peerDependencies` declares React (versions left to the consumer); no `dependencies` entries land in this task.** Alternative: pin React 18 here too. Rejected because the root and surface workspaces already pin `react@18.3.1` / `react-dom@18.3.1`; pinning here would create a four-place version-bump tax with no upside. Peer dependencies are the standard pattern for a library that ships React components alongside multiple React-consuming apps in the same monorepo.
- **Edit the root [`tsconfig.json`](../../../tsconfig.json) `references` array to add `{ "path": "packages/shell" }`.** Alternative: leave it out and rely on the workspace being discovered by `pnpm`. Rejected: `pnpm typecheck` runs `tsc -b` on the **root** tsconfig (per the [ADR 0013 status](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)), which only walks workspaces listed in the root's `references`. Without the edit, `pnpm typecheck` silently skips `packages/shell/`. The edit is required; it is the same edit `packages/i18n-catalogs` made when it landed.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Workspace skeleton landed at [`packages/shell/`](../../../packages/shell/) — [`package.json`](../../../packages/shell/package.json) (name `@a-conversa/shell`, `source`/`default` dual-export, React as `peerDependencies`, no runtime `dependencies`), [`tsconfig.json`](../../../packages/shell/tsconfig.json) extending `../../tsconfig.base.json`, and [`vite.config.ts`](../../../packages/shell/vite.config.ts) in library mode (ESM, `external` lists `react`, `react-dom`, `react/jsx-runtime`).
- Build pipeline is `vite build && tsc --emitDeclarationOnly` — **vite first** because Vite library mode empties `outDir` at build start; running `tsc --emitDeclarationOnly` afterwards lays `dist/index.d.ts` next to the bundle without being clobbered. Future leaves that add subsystems under `src/<subsystem>/` inherit this ordering.
- Test seam landed at [`packages/shell/src/index.test.ts`](../../../packages/shell/src/index.test.ts) — one Vitest case pins `SHELL_PACKAGE_VERSION === '0.1.0'` from [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts). `pnpm run test:smoke` went 3395 → 3396 (+1 case, +1 file), no existing test count drops. Per ADR 0022 this is the package's behavior-anchored existence proof.
- Root [`tsconfig.json`](../../../tsconfig.json) gained `{ "path": "packages/shell" }` in `references` so `tsc -b` walks the new workspace (the same edit `packages/i18n-catalogs` made when it landed).
- Two test-infrastructure carve-outs landed in the same commit because shell is the **first** `packages/*` workspace to ship its own `vite.config.ts`: [`tsconfig.tools.json`](../../../tsconfig.tools.json) now includes `packages/*/vite.config.ts`, and [`eslint.config.js`](../../../eslint.config.js) extends its existing `apps/*/vite.config.ts` ignore + carve-out to also cover `packages/*/vite.config.ts`. Both are **general enablement** for any future `packages/*/vite.config.ts` — not tech debt; they would have been required by whichever package shipped a vite config first.
- e2e: `not-run-not-required` (substrate; ADR 0026 lines 113–117 explicitly defer end-to-end coverage to the shell's downstream consumers, i.e. `apps/root/` + the surface refactor).
- Next leaf in the group is [`shell_mount_contract`](shell_mount_contract.md) — the first one to add real exports (`MountProps`, `UnmountFn`, `SurfaceModule`) on top of this seam.
