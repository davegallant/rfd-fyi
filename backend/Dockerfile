# syntax=docker/dockerfile:1.21
FROM cgr.dev/chainguard/go:latest AS build

WORKDIR /src

COPY . /src

RUN CGO_ENABLED=0 go build -o backend .

FROM cgr.dev/chainguard/static:latest

COPY --from=build /src/backend /backend

EXPOSE 8080

CMD [ "/backend" ]
