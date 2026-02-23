# Build frontend
FROM dhi.io/node:25-debian13-dev AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Build backend (with embedded frontend)
FROM dhi.io/golang:1.26-debian13-dev AS backend-builder
WORKDIR /src
COPY backend /src
COPY --from=frontend-builder /app/dist /src/dist
RUN CGO_ENABLED=0 go build -o rfd-fyi .

FROM dhi.io/static:20251003-musl-alpine3.23 AS runtime
COPY --from=backend-builder /src/rfd-fyi /rfd-fyi

EXPOSE 8080
ENTRYPOINT ["/rfd-fyi"]
