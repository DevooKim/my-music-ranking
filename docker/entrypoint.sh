#!/bin/sh
set -eu

secret_value() {
  file="/run/secrets/$1"
  if [ ! -r "$file" ]; then
    echo "Missing Docker secret: $1" >&2
    exit 1
  fi
  value=$(cat "$file")
  case "$value" in
    ""|your-*|your_*|replace-*|replace_*|example-*|example_*)
      echo "Docker secret is empty or still a placeholder: $1" >&2
      exit 1
      ;;
  esac
  printf '%s' "$value"
}

export AWS_ACCESS_KEY_ID="$(secret_value aws_access_key_id)"
export AWS_SECRET_ACCESS_KEY="$(secret_value aws_secret_access_key)"
export SPOTIFY_CLIENT_ID="$(secret_value spotify_client_id)"
export SPOTIFY_CLIENT_SECRET="$(secret_value spotify_client_secret)"
export SPOTIFY_REFRESH_TOKEN="$(secret_value spotify_refresh_token)"
export REVALIDATE_SECRET="$(secret_value revalidate_secret)"

exec "$@"
