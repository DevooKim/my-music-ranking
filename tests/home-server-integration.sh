#!/bin/sh
set -eu

# Requires a previously built image. Uses synthetic values only and never prints
# secret contents. The source files deliberately use operator-style mode 0400.
IMAGE=${WEB_IMAGE:-my-music-ranking:reviewed}
PROJECT="home-server-integration-$$"
TMP_DIR=$(mktemp -d)
MOCK_CONTAINER=
cleanup() {
  set +e
  if [ -n "$MOCK_CONTAINER" ]; then docker rm -f "$MOCK_CONTAINER" >/dev/null 2>&1; fi
  docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1
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
wait_for_nginx() {
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then return; fi
    sleep 1
  done
  exit 1
}
wait_for_nginx
uid=$(docker compose -p "$PROJECT" exec -T web sh -c 'grep "^Uid:" /proc/1/status | awk "{print \$2}"')
test "$uid" = 1001

assert_headers() {
  expected_status=$1
  expected_cache=$2
  expected_control=$3
  shift 3
  headers="$TMP_DIR/headers"
  curl -sS -D "$headers" -o /dev/null "$@"
  status=$(awk 'NR == 1 { print $2; exit }' "$headers")
  cache=$(awk 'tolower($0) ~ /^x-cache-status:/ { sub("\r$", ""); sub("^[^:]*: *", ""); print; exit }' "$headers")
  control=$(awk 'tolower($0) ~ /^cache-control:/ { sub("\r$", ""); sub("^[^:]*: *", ""); print; exit }' "$headers")
  test "$status" = "$expected_status"
  test "$cache" = "$expected_cache"
  test "$control" = "$expected_control"
}
clear_cache() {
  docker compose -p "$PROJECT" stop nginx >/dev/null
  docker compose -p "$PROJECT" run --rm --no-deps --entrypoint /bin/sh nginx \
    -c 'rm -rf /var/cache/nginx/chart/* /var/cache/nginx/assets/*' >/dev/null
  docker compose -p "$PROJECT" up -d nginx >/dev/null
  wait_for_nginx
}

# Normal HTML is shared-cacheable despite Next dynamic rendering.
assert_headers 200 MISS 'public, max-age=0, s-maxage=300' \
  http://127.0.0.1:8080/yearly
assert_headers 200 HIT 'public, max-age=0, s-maxage=300' \
  http://127.0.0.1:8080/yearly
assert_headers 404 MISS 'public, max-age=0, s-maxage=120' \
  http://127.0.0.1:8080/yearly/not-a-decimal
assert_headers 404 HIT 'public, max-age=0, s-maxage=120' \
  http://127.0.0.1:8080/yearly/not-a-decimal

clear_cache
assert_headers 200 BYPASS no-store \
  -H 'RSC: 1' -H 'Accept: text/x-component' \
  http://127.0.0.1:8080/yearly
assert_headers 200 MISS 'public, max-age=0, s-maxage=300' \
  http://127.0.0.1:8080/yearly
assert_headers 200 HIT 'public, max-age=0, s-maxage=300' \
  http://127.0.0.1:8080/yearly

clear_cache
assert_headers 200 BYPASS no-store \
  -H 'Cookie: session=integration' http://127.0.0.1:8080/yearly
assert_headers 200 BYPASS no-store \
  -H 'Authorization: Bearer integration' http://127.0.0.1:8080/yearly
assert_headers 200 BYPASS no-store \
  -X POST http://127.0.0.1:8080/yearly

# Replace the real upstream with a disposable mock only for upstream
# Set-Cookie/4xx/5xx cases that the application does not ordinarily emit.
cat > "$TMP_DIR/mock-nginx.conf" <<'EOF'
events {}
http {
  server {
    listen 3000;
    location = /yearly/cache-test-set-cookie {
      add_header Set-Cookie 'integration_probe=1; Path=/' always;
      return 200 'ok\n';
    }
    location = /yearly/cache-test-client-error { return 400 'bad\n'; }
    location = /yearly/cache-test-server-error { return 500 'bad\n'; }
  }
}
EOF
docker compose -p "$PROJECT" stop nginx web >/dev/null
docker compose -p "$PROJECT" rm -f web >/dev/null
MOCK_CONTAINER=$(docker run -d --name "${PROJECT}-mock-web" \
  --network "${PROJECT}_default" --network-alias web \
  -v "$TMP_DIR/mock-nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.27-alpine)
nginx_container=$(docker compose -p "$PROJECT" ps -aq nginx)
docker start "$nginx_container" >/dev/null
wait_for_nginx
assert_headers 200 BYPASS no-store \
  http://127.0.0.1:8080/yearly/cache-test-set-cookie
set_cookie_headers="$TMP_DIR/set-cookie-headers"
curl -sS -D "$set_cookie_headers" -o /dev/null \
  http://127.0.0.1:8080/yearly/cache-test-set-cookie
grep -qi '^Set-Cookie: integration_probe=1' "$set_cookie_headers"
assert_headers 400 BYPASS no-store \
  http://127.0.0.1:8080/yearly/cache-test-client-error
assert_headers 500 BYPASS no-store \
  http://127.0.0.1:8080/yearly/cache-test-server-error

echo "home-server standalone/Nginx cache matrix passed"
