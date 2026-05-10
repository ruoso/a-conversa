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
