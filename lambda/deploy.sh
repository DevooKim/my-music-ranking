#!/bin/bash

# SAM Deploy Script with .env support
# Usage: ./deploy.sh [--guided]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables from .env.lambda
if [ ! -f ".env.lambda" ]; then
    echo "Error: .env.lambda file not found!"
    echo "Please create .env.lambda based on .env.lambda.example"
    exit 1
fi

# Load environment variables without exposing them through command arguments.
set -a
. ./.env.lambda
set +a

# Validate required parameters
if [ -z "$SPOTIFY_CLIENT_ID" ] || [ -z "$SPOTIFY_CLIENT_SECRET" ] || [ -z "$SPOTIFY_REFRESH_TOKEN" ]; then
    echo "Error: Required Spotify credentials are missing in .env.lambda"
    exit 1
fi
if [ -n "$REVALIDATE_ENDPOINT_URL" ] && [ -z "$REVALIDATE_SECRET" ]; then
    echo "Error: REVALIDATE_SECRET is required when REVALIDATE_ENDPOINT_URL is set"
    exit 1
fi

echo "🚀 Starting SAM deployment..."
echo "📍 Region: ${AWS_REGION:-ap-northeast-2}"
echo "📦 S3 Bucket: ${S3_ARTIFACTS_BUCKET}"

# SAM's esbuild builder requires the project-local binary on PATH.
export PATH="$PROJECT_DIR/node_modules/.bin:$PATH"
if ! command -v esbuild >/dev/null 2>&1; then
    echo "Error: esbuild not found. Run 'bun install' in the project root first."
    exit 1
fi

echo "🔨 Building Lambda bundles..."
sam build

# Deploy only the built artifacts.
if [ "$1" == "--guided" ]; then
    sam deploy --guided --template-file .aws-sam/build/template.yaml \
        --s3-bucket "$S3_ARTIFACTS_BUCKET" \
        --parameter-overrides \
        "SpotifyClientId=$SPOTIFY_CLIENT_ID" \
        "SpotifyClientSecret=$SPOTIFY_CLIENT_SECRET" \
        "SpotifyRefreshToken=$SPOTIFY_REFRESH_TOKEN" \
        "RevalidateEndpointUrl=${REVALIDATE_ENDPOINT_URL:-}" \
        "RevalidateSecret=${REVALIDATE_SECRET:-}"
else
    sam deploy --template-file .aws-sam/build/template.yaml \
        --s3-bucket "$S3_ARTIFACTS_BUCKET" \
        --parameter-overrides \
        "SpotifyClientId=$SPOTIFY_CLIENT_ID" \
        "SpotifyClientSecret=$SPOTIFY_CLIENT_SECRET" \
        "SpotifyRefreshToken=$SPOTIFY_REFRESH_TOKEN" \
        "RevalidateEndpointUrl=${REVALIDATE_ENDPOINT_URL:-}" \
        "RevalidateSecret=${REVALIDATE_SECRET:-}"
fi

echo "✅ Deployment completed!"
