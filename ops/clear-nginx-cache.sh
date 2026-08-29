#!/bin/sh
set -eu

# Run from the repository checkout. This is intentionally not an HTTP purge.
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

printf '%s\n' "Stopping Nginx before clearing only its cache volume..."
docker compose stop nginx
docker compose run --rm --no-deps --entrypoint /bin/sh nginx \
  -c 'rm -rf /var/cache/nginx/chart/* /var/cache/nginx/assets/*'
docker compose up -d nginx
printf '%s\n' "Nginx cache cleared; verify MISS then HIT using docs/cache-operations.md."
