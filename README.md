# rfd-fyi

This repository provides a simple, less-distracting overlay for hot deals posted on https://forums.redflagdeals.com.

The frontend is made with Vue 3 and the backend is written in Go. The backend exists for caching purposes; to prevent excessive requests to RedFlagDeals itself.

## Docker

To run the latest:

```sh
docker run -d --name rfd-fyi -p 8080:8080 ghcr.io/davegallant/rfd-fyi
```

To build container from source:

```sh
make dev
```

## Local Development

To get up and running locally: in one shell, run:

```sh
make backend
```

In another shell, run:

```sh
make frontend
```
