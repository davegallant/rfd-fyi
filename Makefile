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

## frontend: Run the Vite frontend from source
frontend:
	@npm run serve
.PHONY: frontend

## pages-dev: Build and run Cloudflare Pages locally
pages-dev:
	@npm run pages:dev
.PHONY: pages-dev

## pages-deploy: Build and deploy Cloudflare Pages
pages-deploy:
	@npm run pages:deploy
.PHONY: pages-deploy

## worker-dev: Run the scheduled refresh Worker locally
worker-dev:
	@npm run worker:dev
.PHONY: worker-dev

## worker-deploy: Deploy the scheduled refresh Worker
worker-deploy:
	@npm run worker:deploy
.PHONY: worker-deploy

