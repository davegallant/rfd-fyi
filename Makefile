SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

## help: Print this help message
help:
	@echo
	@echo "Usage:"
	@echo
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' |  sed -e 's/^/ /' | sort
	@echo
.PHONY: help

## backend: Build and run the backend from source
backend:
	@cd backend && CGO_ENABLED=0 go run .
.PHONY: backend

## frontend: Build and run the frontend from source
frontend:
	@npm run serve
.PHONY: frontend

## dev: Build and run in docker compose
dev:
	docker compose up --build -d
.PHONY: dev

## prod: Run the latest images in docker compose
prod:
	@git pull
	@docker pull ghcr.io/davegallant/rfd-fyi-backend
	@docker pull ghcr.io/davegallant/rfd-fyi-frontend
	@docker compose -f docker-compose.prod.yml up -d
.PHONY: prod

## teardown: Teardown docker
teardown:
	docker compose down
.PHONY: teardown
