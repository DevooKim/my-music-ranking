#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 ops/deploy-VERSION.record" >&2
  exit 2
fi

record=$1
case "$record" in
  /*) ;;
  *) record="$(pwd)/$record" ;;
esac
[ -r "$record" ] || { echo "deployment record is not readable: $record" >&2; exit 1; }

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

record_value() {
  awk -F= -v key="$1" '$1 == key { print substr($0, length(key) + 2); exit }' "$record"
}

image_ref=$(record_value WEB_IMAGE)
recorded_id=$(record_value IMAGE_ID)
[ -n "$image_ref" ] || { echo "record missing WEB_IMAGE" >&2; exit 1; }
[ -n "$recorded_id" ] || { echo "record missing IMAGE_ID" >&2; exit 1; }

current_id=$(docker image inspect "$image_ref" --format '{{.Id}}' 2>/dev/null) || {
  echo "recorded image is not available locally: $image_ref" >&2
  exit 1
}
if [ "$current_id" != "$recorded_id" ]; then
  echo "IMAGE_ID mismatch for $image_ref" >&2
  echo "recorded: $recorded_id" >&2
  echo "current:  $current_id" >&2
  exit 1
fi

case "$image_ref" in
  *@sha256:*)
    repo_digests=$(docker image inspect "$image_ref" \
      --format '{{range .RepoDigests}}{{println .}}{{end}}')
    printf '%s\n' "$repo_digests" | grep -Fqx "$image_ref" || {
      echo "recorded registry digest is not present locally: $image_ref" >&2
      exit 1
    }
    ;;
esac

# Re-export the verified reference so every Compose invocation uses it.
export WEB_IMAGE="$image_ref"
docker compose up -d --no-build --force-recreate web nginx
curl -fsS http://127.0.0.1:8080/healthz >/dev/null
docker compose ps
./ops/clear-nginx-cache.sh
printf '%s\n' "rollback verified and applied: $image_ref"
