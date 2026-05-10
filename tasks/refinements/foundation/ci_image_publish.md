# Publish container image on tagged release

**TaskJuggler entry**: `foundation.ci.ci_image_publish` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort**: 1d

## What and why

CI workflow that publishes the application Docker image to a registry on tagged releases (semver tags like `v1.0.0`).

## Decisions

- Workflow: `.github/workflows/release.yml`, triggered on `tags: 'v*'`.
- Registry: GitHub Container Registry (ghcr.io) — free for public repos, integrated with GitHub auth.
- Image tags: `vMAJOR.MINOR.PATCH`, plus `:latest` on the highest non-pre-release tag.
- Build runs the same Docker buildx multi-stage build as `ci_build`.
- Pre-release tags (`v1.0.0-beta.1`) get the version tag but **not** `:latest`.

## Acceptance criteria

- `release.yml` workflow exists.
- Pushing a `v0.1.0` tag triggers a successful publish.
- The image is pullable from `ghcr.io/<org>/a-conversa:v0.1.0`.

## Status

**Done 2026-05-10.** Implemented in [.github/workflows/release.yml](../../../.github/workflows/release.yml):

- Single `publish` job, triggered on `push: tags: ['v*']`, with
  `permissions: contents: read, packages: write`.
- Mirrors `ci.yml`'s setup pattern (checkout, Node 20, Corepack/pnpm,
  pnpm store cache, `pnpm install --frozen-lockfile` with `HUSKY=0`,
  `pnpm run build`).
- Builds and pushes via `docker/setup-buildx-action@v3`,
  `docker/login-action@v3` (ghcr.io, `${{ github.actor }}` +
  `${{ secrets.GITHUB_TOKEN }}`), `docker/metadata-action@v5`, and
  `docker/build-push-action@v6` with `cache-from`/`cache-to: type=gha`.
- Registry image name: `ghcr.io/<repo-owner>/aconversa-app` (lowercased
  via `${{ github.repository_owner }}`). Note: this is `aconversa-app`,
  not `a-conversa` — chosen to match the in-repo image name from ADR 0015
  / `ci_build` and keep the registry path a single token.
- Tag mapping: `type=semver,pattern={{version}}` strips the leading `v`
  (so `v1.2.3` → `:1.2.3`); `type=raw,value=latest` is gated on
  `!contains(github.ref, '-')` so pre-release tags (`v1.0.0-beta.1`)
  publish only the version tag and never move `:latest`.

**ADR-0015 stub-entry caveat**: the application image's entry point is
still the placeholder banner-and-exit-0 from ADR 0015. v0.x foundation
tags will publish anyway because what we're exercising right now is the
*pipeline* shape (auth, semver tag mapping, buildx + GHA cache, no
`:latest` on pre-releases). `backend.api_skeleton` lands the meaningful
image body without changing this workflow.
