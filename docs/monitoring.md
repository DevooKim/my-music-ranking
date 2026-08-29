# Monitoring

Uptime Kuma is included in Compose but is deliberately bound to
`127.0.0.1:3001`; it is not a public service and is not sent through Funnel.
Create monitors manually after deployment:

- the approved public Funnel URL (`/`),
- the public Funnel URL plus `/api/health/live`, and
- optionally `http://web:3000/api/health/live` from an internal monitoring
  network.

The live endpoint checks only that Next can process a request. It intentionally
does not expose AWS, Spotify, filesystem, or credential state. Configure alerts
and SMTP/notification credentials in Uptime Kuma's local data store, not in Git.

Tailscale login, tailnet ACL changes, Funnel publication, and real monitor
creation are operator actions and are not automated here.
