# rfd-fyi

This repository provides a simple, less-distracting overlay for hot deals posted on https://forums.redflagdeals.com.

The frontend is made with Vue 3. Cloudflare Pages serves the frontend and Pages Functions serve `/topics.json` and `/html` from Cloudflare KV. A scheduled Cloudflare Worker refreshes the cached topics to avoid excessive requests to RedFlagDeals itself.

## Cloudflare deployment

Install dependencies and log in to Cloudflare:

```sh
npm install
npx wrangler login
```

Create a KV namespace and a preview namespace:

```sh
npx wrangler kv namespace create TOPICS_KV
npx wrangler kv namespace create TOPICS_KV --preview
```

Copy the returned namespace IDs into both:

- `wrangler.toml`
- `worker/wrangler.toml`

Deploy the Pages app:

```sh
npm run pages:deploy
```

Deploy the scheduled refresh Worker:

```sh
npm run worker:deploy
```

The Worker runs every 5 minutes and writes the latest topics to KV. Pages reads that cached JSON at `/topics.json` and renders a no-JavaScript view at `/html`.

Optional manual refresh endpoints:

```sh
# For the Pages /admin/refresh endpoint
npx wrangler pages secret put REFRESH_SECRET --project-name rfd-fyi
curl -X POST -H "Authorization: Bearer $REFRESH_SECRET" https://<your-pages-domain>/admin/refresh

# For the Worker /refresh endpoint
npx wrangler secret put REFRESH_SECRET --config worker/wrangler.toml
curl -H "Authorization: Bearer $REFRESH_SECRET" https://rfd-fyi-refresh.<your-subdomain>.workers.dev/refresh
```

## Local Development

To run the Vite frontend against the existing Go backend:

```sh
make backend
make frontend
```

To run the Cloudflare Pages build locally:

```sh
npm run pages:dev
```

To run the refresh Worker locally:

```sh
npm run worker:dev
```

## Docker legacy deployment

The previous Docker deployment is still present while the Cloudflare migration is in progress:

```sh
make dev
```
