FROM golang:1.27-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/pargar ./cmd/server

FROM alpine:3.22

RUN adduser -D -H -u 10001 app

WORKDIR /app

COPY --from=builder /out/pargar ./pargar
COPY --from=builder /src/media/sample.mp4 ./media/sample.mp4
RUN chown -R app:app /app

USER app

EXPOSE 8080

CMD ["./pargar"]
