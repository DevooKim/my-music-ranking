#!/bin/bash

# Load environment variables from .env file
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and fill in the values:"
    echo "  cp .env.example .env"
    exit 1
fi

# Read variables from .env (without exporting to avoid issues)
AUTH_TOKEN=$(grep '^AUTH_TOKEN=' .env | cut -d'=' -f2-)
S3_BUCKET_NAME=$(grep '^S3_BUCKET_NAME=' .env | cut -d'=' -f2-)
SPOTIFY_CLIENT_ID=$(grep '^SPOTIFY_CLIENT_ID=' .env | cut -d'=' -f2-)
SPOTIFY_CLIENT_SECRET=$(grep '^SPOTIFY_CLIENT_SECRET=' .env | cut -d'=' -f2-)
SPOTIFY_REFRESH_TOKEN=$(grep '^SPOTIFY_REFRESH_TOKEN=' .env | cut -d'=' -f2-)

# Build the SAM application
sam build

if [ $? -ne 0 ]; then
    echo "Build failed!"1
    exit 1
fi

sam deploy --parameter-overrides \
    "AuthToken=$AUTH_TOKEN" \
    "S3BucketName=$S3_BUCKET_NAME" \
    "SpotifyClientSecret=$SPOTIFY_CLIENT_SECRET" \
    "SpotifyClientId=$SPOTIFY_CLIENT_ID" \
    "SpotifyRefreshToken=$SPOTIFY_REFRESH_TOKEN"

