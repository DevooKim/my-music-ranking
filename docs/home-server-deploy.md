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

## Deploy / rollback

```sh
docker compose build web
# review the image digest and then:
docker compose up -d --no-build
# verify health and logs without printing environment values
docker compose ps
docker compose logs --tail=100 web nginx
```

A deployment must either run `ops/clear-nginx-cache.sh` after the new image is
healthy or use a separately reviewed cache-generation rollover. This prevents
old HTML/API entries from surviving an image change. The script only removes
Nginx cache files, never Uptime Kuma data or secrets.

## Explicitly out of scope

This runbook does not log in to Tailscale, publish a Funnel, alter AWS/Lambda/S3,
create credentials, or terminate Vercel. Perform those changes manually only
after an independent operational review.
