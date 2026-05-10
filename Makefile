# a-conversa — top-level task runner.
#
# Thin wrappers around pnpm and docker compose. The compose targets here
# are the underlying wiring; richer wrappers (env-var checks, friendly
# output) land with foundation.dev_env.one_command_script. Per-workspace
# tasks land with their owning subtree refinements.

.PHONY: help install test up down down-v logs ps clean

help:
	@echo "a-conversa — make targets"
	@echo "  make install   pnpm install across all workspaces"
	@echo "  make test      run smoke tests (vitest, cucumber, playwright)"
	@echo "  make up        bring up the dev stack (docker compose up -d)"
	@echo "  make down      stop the dev stack (volumes preserved)"
	@echo "  make down-v    stop the dev stack and drop named volumes"
	@echo "  make logs      tail logs from the dev stack"
	@echo "  make ps        show dev-stack service status"
	@echo "  make clean     remove build artifacts and caches"

install:
	@pnpm install -r

test:
	@pnpm run test:smoke
	@pnpm run test:behavior:smoke
	@pnpm run test:e2e:smoke

up:
	@docker compose up -d

down:
	@docker compose down

down-v:
	@docker compose down -v

logs:
	@docker compose logs -f

ps:
	@docker compose ps

clean:
	@rm -rf node_modules apps/*/node_modules packages/*/node_modules
	@rm -rf dist build coverage playwright-report test-results
