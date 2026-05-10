# a-conversa — top-level task runner.
#
# Thin wrappers around pnpm and (eventually) docker compose. Real wiring for
# `up` lands with foundation.dev_env.compose_file. Per-workspace tasks land
# with their owning subtree refinements.

.PHONY: help install test up clean

help:
	@echo "a-conversa — make targets"
	@echo "  make install   pnpm install across all workspaces"
	@echo "  make test      run smoke tests (vitest, cucumber, playwright)"
	@echo "  make up        bring up the dev stack (placeholder)"
	@echo "  make clean     remove build artifacts and caches"

install:
	@pnpm install -r

test:
	@pnpm run test:smoke
	@pnpm run test:behavior:smoke
	@pnpm run test:e2e:smoke

up:
	@echo "TODO: docker compose up (wired by foundation.dev_env.compose_file)"

clean:
	@rm -rf node_modules apps/*/node_modules packages/*/node_modules
	@rm -rf dist build coverage playwright-report test-results
