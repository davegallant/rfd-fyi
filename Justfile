set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List available recipes
default:
    @just --list

# Run the Cloudflare Pages app locally, including Pages Functions
dev:
    npm run pages:dev

# Seed local Pages KV by refreshing topics through the local admin endpoint
seed-local-kv:
    curl -X POST -H "Authorization: Bearer dev" http://localhost:8788/admin/refresh

# Run the scheduled refresh Worker locally
dev-worker:
    npm run worker:dev

# Run frontend-only Vite dev server
dev-vite:
    npm run serve

# Deploy the Cloudflare Pages app and Pages Functions
deploy-pages:
    npm run pages:deploy

# Deploy the scheduled Cloudflare Worker
deploy-worker:
    npm run worker:deploy

# Deploy both Pages and the scheduled Worker
deploy: deploy-pages deploy-worker
