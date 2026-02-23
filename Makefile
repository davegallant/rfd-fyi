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
	@cd backend && CGO_ENABLED=0 HTTP_PORT=8080 go run .
.PHONY: backend

## frontend: Build and run the frontend from source
frontend:
	@npm run serve
.PHONY: frontend

## dev: Build and run in Docker
dev:
	docker build -t rfd-fyi:dev .
	docker run -d --name rfd-fyi-dev -p 8080:8080 rfd-fyi:dev
.PHONY: dev

## prod: Run the latest image in Docker
prod:
	@git pull
	@docker pull ghcr.io/davegallant/rfd-fyi
	@docker run -d --name rfd-fyi-prod -p 8080:8080 ghcr.io/davegallant/rfd-fyi
.PHONY: prod

## teardown: Teardown Docker
teardown:
	docker stop rfd-fyi-dev rfd-fyi-prod || true
	docker rm rfd-fyi-dev rfd-fyi-prod || true
.PHONY: teardown
