set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# List available recipes
default:
    @just --list

# Deploy the Cloudflare Pages app and Pages Functions
deploy-pages:
    npm run pages:deploy

# Deploy the scheduled Cloudflare Worker
deploy-worker:
    npm run worker:deploy

# Deploy both Pages and the scheduled Worker
deploy: deploy-pages deploy-worker
