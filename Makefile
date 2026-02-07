.DEFAULT_GOAL := help

.PHONY: help install dev-api dev-web db-migrate vector-reindex build test ci lint lint-fix format format-check typecheck

help:
	@echo "Available targets:"
	@echo "  make install         Install dependencies with bun"
	@echo "  make dev-api         Start API development command"
	@echo "  make dev-web         Start Web development command"
	@echo "  make db-migrate      Run D1 migration command"
	@echo "  make vector-reindex  Run vector index rebuild command"
	@echo "  make lint            Run lint commands"
	@echo "  make lint-fix        Run lint auto-fix commands"
	@echo "  make test            Run tests"
	@echo "  make typecheck       Run TypeScript type checks"
	@echo "  make build           Run build commands"
	@echo "  make ci              Run lint + test + typecheck + build"
	@echo "  make format          Run formatter"
	@echo "  make format-check    Check formatter"

install:
	bun install

dev-api:
	bun run dev:api

dev-web:
	bun run dev:web

db-migrate:
	bun run db:migrate

vector-reindex:
	bun run vector:reindex

lint:
	bun run lint

lint-fix:
	bun run lint:fix

test:
	bun run test

typecheck:
	bun run typecheck

build:
	bun run build

ci:
	bun run ci

format:
	bun run format

format-check:
	bun run format:check
