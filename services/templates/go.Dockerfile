# Go (detected via go.mod)
FROM golang:1.23 AS build

WORKDIR /app

COPY . .

RUN go mod download
RUN CGO_ENABLED=0 go build -o /app/server .

# debian-slim (not distroless) so `docker exec ... sh` still works for debugging.
FROM debian:bookworm-slim

WORKDIR /app

COPY --from=build /app/server .

EXPOSE 8080

CMD ["./server"]
