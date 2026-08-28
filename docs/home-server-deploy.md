# Home server deployment runbook

This repository contains templates only. Do not put AWS, Spotify, Tailscale, or
revalidation credentials in Git, images, chat, or logs.

## First setup

1. Install Docker Compose v2 and Docker on the Debian host. Run Docker as a
   dedicated operator account.
2. Copy `lambda/.env.lambda.example` to `lambda/.env.lambda` for Lambda-only
   configuration. Copy each `.secrets/*.example` to the corresponding filename
   without `.example`, replace every placeholder, and set mode `0400`:

   ```sh
   install -d -m 700 .secrets
   # create the six files from their examples using an approved secret manager
   chmod 400 .secrets/*
   ```

3. Set non-secret values in a private `.env` (bucket, region, and cache values).
   `docker compose config` should be reviewed before starting. Placeholder secret
   files intentionally make the container entrypoint fail fast; they are not
   usable credentials.
4. Build and start with `docker compose up -d --build`. Only Nginx binds a host
   port (`127.0.0.1:8080`); `web` is network-internal and Uptime Kuma binds
   `127.0.0.1:3001`.
5. Verify `curl -fsS http://127.0.0.1:8080/healthz`, then verify the public
   Funnel URL from an external network.

## Tailscale (operator action, not automated here)

Install and authenticate Tailscale on the host, then inspect the assigned
hostname. After confirming Nginx locally, an operator may publish only the
loopback listener using the approved Funnel command, for example:

```sh
tailscale status
tailscale funnel --bg http://127.0.0.1:8080
```

The exact command, ACL policy, hostname, and approval must be decided by the
administrator. Do not run login, Funnel, AWS, Lambda, or secret rotation from
this repository workflow. Uptime Kuma remains loopback-only; if it needs to be
operated remotely, use an authenticated tailnet path (SSH/tailnet access), not
Funnel/public exposure.

## Versioned deploy / rollback

Do not use `docker compose up --build` as a rollback mechanism. Build and record
an immutable version identifier before replacing the running service. A local
operator can use a commit-derived tag plus the image content ID; a registry
operator should additionally record the registry digest and pin `WEB_IMAGE` to
`name@sha256:...`.

```sh
VERSION="$(git rev-parse --short=12 HEAD)"
IMAGE="my-music-ranking:${VERSION}"
docker build -t "$IMAGE" .
IMAGE_ID="$(docker image inspect "$IMAGE" --format '{{.Id}}')"
printf 'WEB_IMAGE=%s\nIMAGE_ID=%s\n' "$IMAGE" "$IMAGE_ID" | tee "ops/deploy-${VERSION}.record"
WEB_IMAGE="$IMAGE" docker compose up -d --no-build --force-recreate web nginx
# verify health and logs without printing environment values
docker compose ps
docker compose logs --tail=100 web nginx
curl -fsS http://127.0.0.1:8080/healthz
./ops/clear-nginx-cache.sh
```

Keep the deployment record and the previous image locally or in the approved
registry. To roll back, set `WEB_IMAGE` to the recorded previous tag/digest,
then recreate and health-check the same services:

```sh
WEB_IMAGE="my-music-ranking:${PREVIOUS_VERSION}" \
  docker compose up -d --no-build --force-recreate web nginx
curl -fsS http://127.0.0.1:8080/healthz
docker compose ps
./ops/clear-nginx-cache.sh
```

The cache clear (or an independently reviewed generation rollover) is mandatory
after deploy and rollback so old HTML/API entries cannot survive an image
change. The script only removes Nginx cache files, never Uptime Kuma data or
secrets.

## Explicitly out of scope

This runbook does not log in to Tailscale, publish a Funnel, alter AWS/Lambda/S3,
create credentials, or terminate Vercel. Perform those changes manually only
after an independent operational review.
