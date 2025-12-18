#!/bin/bash

# SAM Deploy Script with .env support
# Usage: ./deploy.sh [--guided]

set -e

# Load environment variables from .env.lambda
if [ ! -f ".env.lambda" ]; then
    echo "Error: .env.lambda file not found!"
    echo "Please create .env.lambda based on .env.lambda.example"
    exit 1
fi

# Load environment variables
export $(cat .env.lambda | grep -v '^#' | xargs)

# Validate required parameters
if [ -z "$SPOTIFY_CLIENT_ID" ] || [ -z "$SPOTIFY_CLIENT_SECRET" ] || [ -z "$SPOTIFY_REFRESH_TOKEN" ]; then
    echo "Error: Required Spotify credentials are missing in .env.lambda"
    exit 1
fi

echo "🚀 Starting SAM deployment..."
echo "📍 Region: ${AWS_REGION:-ap-northeast-2}"
echo "📦 S3 Bucket: ${S3_ARTIFACTS_BUCKET}"

# Run SAM deploy
if [ "$1" == "--guided" ]; then
    sam deploy --guided --s3-bucket "$S3_ARTIFACTS_BUCKET" \
        --parameter-overrides \
        "SpotifyClientId=$SPOTIFY_CLIENT_ID" \
        "SpotifyClientSecret=$SPOTIFY_CLIENT_SECRET" \
        "SpotifyRefreshToken=$SPOTIFY_REFRESH_TOKEN"
else
    sam deploy --s3-bucket "$S3_ARTIFACTS_BUCKET" \
        --parameter-overrides \
        "SpotifyClientId=$SPOTIFY_CLIENT_ID" \
        "SpotifyClientSecret=$SPOTIFY_CLIENT_SECRET" \
        "SpotifyRefreshToken=$SPOTIFY_REFRESH_TOKEN"
fi

echo "✅ Deployment completed!"
