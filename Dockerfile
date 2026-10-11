FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY internal/ ./internal/
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /arvlet .

FROM build AS test
RUN apk add --no-cache gcc musl-dev
RUN go vet ./... && go test -race -cover ./...

FROM alpine:3.23
RUN addgroup -g 10001 arvlet && adduser -D -u 10001 -G arvlet arvlet \
    && mkdir /data && chown arvlet:arvlet /data
COPY --from=build /arvlet /usr/local/bin/arvlet
USER arvlet
ENV ARVLET_DB=/data/arvlet.db
EXPOSE 8090
ENTRYPOINT ["arvlet"]
