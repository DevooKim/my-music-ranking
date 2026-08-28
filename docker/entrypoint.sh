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

AWS_ACCESS_KEY_ID_VALUE="$(secret_value aws_access_key_id)" || exit 1
AWS_SECRET_ACCESS_KEY_VALUE="$(secret_value aws_secret_access_key)" || exit 1
SPOTIFY_CLIENT_ID_VALUE="$(secret_value spotify_client_id)" || exit 1
SPOTIFY_CLIENT_SECRET_VALUE="$(secret_value spotify_client_secret)" || exit 1
SPOTIFY_REFRESH_TOKEN_VALUE="$(secret_value spotify_refresh_token)" || exit 1
REVALIDATE_SECRET_VALUE="$(secret_value revalidate_secret)" || exit 1

export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID_VALUE"
export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY_VALUE"
export SPOTIFY_CLIENT_ID="$SPOTIFY_CLIENT_ID_VALUE"
export SPOTIFY_CLIENT_SECRET="$SPOTIFY_CLIENT_SECRET_VALUE"
export SPOTIFY_REFRESH_TOKEN="$SPOTIFY_REFRESH_TOKEN_VALUE"
export REVALIDATE_SECRET="$REVALIDATE_SECRET_VALUE"

exec gosu nextjs "$@"
