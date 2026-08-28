#!/bin/sh
set -eu

# Requires a previously built image. Uses synthetic values only and never prints
# secret contents. The source files deliberately use operator-style mode 0400.
IMAGE=${WEB_IMAGE:-my-music-ranking:reviewed}
PROJECT="home-server-integration-$$"
TMP_DIR=$(mktemp -d)
cleanup() {
  docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

for name in aws_access_key_id aws_secret_access_key spotify_client_id spotify_client_secret spotify_refresh_token revalidate_secret; do
  printf 'integration-test-value\n' > "$TMP_DIR/$name"
  chmod 0400 "$TMP_DIR/$name"
done

export WEB_IMAGE="$IMAGE"
export AWS_ACCESS_KEY_ID_FILE="$TMP_DIR/aws_access_key_id"
export AWS_SECRET_ACCESS_KEY_FILE="$TMP_DIR/aws_secret_access_key"
export SPOTIFY_CLIENT_ID_FILE="$TMP_DIR/spotify_client_id"
export SPOTIFY_CLIENT_SECRET_FILE="$TMP_DIR/spotify_client_secret"
export SPOTIFY_REFRESH_TOKEN_FILE="$TMP_DIR/spotify_refresh_token"
export REVALIDATE_SECRET_FILE="$TMP_DIR/revalidate_secret"

docker compose -p "$PROJECT" up -d --no-build web nginx >/dev/null
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:8080/healthz >/dev/null
uid=$(docker compose -p "$PROJECT" exec -T web sh -c 'grep "^Uid:" /proc/1/status | awk "{print \$2}"')
test "$uid" = 1001

cache_status() {
  curl -sS -D - -o /dev/null "$@" | awk 'tolower($0) ~ /^x-cache-status:/ { gsub("\r", ""); sub(/^.*: /, ""); print; exit }'
}
clear_cache() {
  docker compose -p "$PROJECT" stop nginx >/dev/null
  docker compose -p "$PROJECT" run --rm --no-deps --entrypoint /bin/sh nginx \
    -c 'rm -rf /var/cache/nginx/chart/* /var/cache/nginx/assets/*' >/dev/null
  docker compose -p "$PROJECT" up -d nginx >/dev/null
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then return; fi
    sleep 1
  done
  exit 1
}

# Normal HTML is shared-cacheable despite Next dynamic rendering.
test "$(cache_status http://127.0.0.1:8080/yearly)" = MISS
test "$(cache_status http://127.0.0.1:8080/yearly)" = HIT

clear_cache
test "$(cache_status -H 'RSC: 1' -H 'Accept: text/x-component' http://127.0.0.1:8080/yearly)" = BYPASS
test "$(cache_status http://127.0.0.1:8080/yearly)" = MISS
test "$(cache_status http://127.0.0.1:8080/yearly)" = HIT

clear_cache
test "$(cache_status -H 'Cookie: session=integration' http://127.0.0.1:8080/yearly)" = BYPASS
test "$(cache_status http://127.0.0.1:8080/yearly)" = MISS
test "$(cache_status http://127.0.0.1:8080/yearly)" = HIT

echo "home-server standalone/Nginx cache matrix passed"
