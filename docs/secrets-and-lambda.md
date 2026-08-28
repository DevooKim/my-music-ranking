# Secret and Lambda configuration template

The checked-in files are examples only:

- `.secrets/*.example` are Compose secret-file templates.
- `lambda/.env.lambda.example` is a local SAM deploy template.
- `.env.example` contains non-secret application settings and a placeholder
  `REVALIDATE_SECRET`.

Compose mounts secrets read-only at `/run/secrets/*`. The web entrypoint maps
them to the environment variables expected by the existing AWS and Spotify
code and exits before starting if a file is missing, empty, or still a
placeholder. Docker Compose secrets are file mounts, not encryption; protect the
host account and filesystem permissions.

Set `REVALIDATE_ENDPOINT_URL` and the matching secret in the Lambda deployment
configuration only after the Funnel URL is approved. The helper sends no secret
or token to logs, uses a 5-second maximum request timeout, retries retryable
failures at most three attempts with bounded exponential backoff, and emits a
failure observation when the endpoint remains unavailable. S3 writes remain
successful even when notification fails; the latest five-minute cache is the
fallback.

No credential creation, AWS deployment, real Lambda environment update, or
Tailscale authentication is performed by this repository change.
