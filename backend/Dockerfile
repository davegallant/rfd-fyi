FROM dhi.io/golang:1.26-debian13-dev AS build

WORKDIR /src

COPY . /src

RUN CGO_ENABLED=0 go build -o backend .

FROM dhi.io/static:20251003-musl-alpine3.23

COPY --from=build /src/backend /backend

EXPOSE 8080

CMD [ "/backend" ]
