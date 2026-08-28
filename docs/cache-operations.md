# Nginx cache and revalidation operations

## Cache policy

- `/` and `/api/charts/weekly/latest`: 5-minute shared-cache freshness.
- Historical chart API 200 responses use the configured 30-day cache validity.
  Dynamic chart HTML namespaces include the current period, so Nginx keeps them
  at a safe 5-minute TTL; missing chart responses are 404 with a 2-minute
  negative-cache policy and no stale-while-revalidate directive.
- `/_next/static/*`: 365 days and immutable.
- Allowlisted HTML locations (`/` and chart detail paths) may replace Next's
  dynamic `private/no-store` metadata with a public 5-minute policy; this is
  scoped to those locations only. `/sw.js`, health, revalidation, RSC/prefetch,
  cookies/auth, unsafe methods, Set-Cookie responses, and artist-thumbnail
  requests bypass and are not stored. 4xx/5xx responses are not stored except
  the deliberate 404 negative-cache policy.
- `X-Cache-Status` and the Nginx cache access log are diagnostic only.

Latest raw-week lookup intentionally bypasses Next's `unstable_cache`; Nginx is
its only shared response cache, so an origin refresh cannot be extended by a
second stale-while-revalidate layer. Historical lookups use Next's tag cache.
Lambda writes invalidate matching Next tags immediately (`expire: 0`) and retry
the HTTP notification at most three times with bounded timeout/backoff. A failed
notification is logged as a structured warning; it does not claim that
invalidation succeeded, and the 5-minute latest TTL remains the fallback.

OSS Nginx has no general per-entry maximum stale-age switch. `proxy_cache_use_stale`
is intentionally bounded operationally by the cache volume's `inactive=30d` and
by the documented cache-clear procedure, but this is not a cryptographic or
hard wall-clock guarantee while an entry is actively requested. Do not describe
it as “stale for exactly 30 days.” Negative 404 responses have no SWR policy and
are configured separately at 2 minutes; an upstream error during stale serving
is still subject to OSS Nginx stale semantics, so clear the cache when a strict
404 guarantee is required.

## Verification

From a host with the service running (or run the synthetic standalone/Nginx
matrix after building `WEB_IMAGE`):

```sh
WEB_IMAGE=my-music-ranking:reviewed ./tests/home-server-integration.sh
```

The integration script creates temporary synthetic secret files with mode 0400,
starts Compose, checks the app process UID, and proves normal MISS→HIT after
RSC-first and cookie-first requests. It removes its containers, volume, and
synthetic files on exit. For manual checks:

```sh
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/                 # should become HIT after warm-up
curl -i -X POST http://127.0.0.1:8080/api/revalidate
curl -i -H 'RSC: 1' http://127.0.0.1:8080/
curl -i -H 'Cookie: session=test' http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/                 # normal request can MISS then HIT
curl -i http://127.0.0.1:8080/api/health/live
```

The revalidation request must be made only with the approved secret; never put
that header in shell history or logs.

## Safe full cache clear

Run after a historical re-aggregation or deployment rollover:

```sh
./ops/clear-nginx-cache.sh
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1:8080/
```

The first request should be `MISS` and the second `HIT`. The script stops Nginx
before deleting only `/var/cache/nginx` from the named volume, then starts it
again. It does not delete `.secrets`, `uptime_data`, or application data.
