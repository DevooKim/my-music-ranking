# Nginx cache and revalidation operations

## Cache policy

- `/` and `/api/charts/weekly/latest`: 5-minute shared-cache freshness.
- Historical chart API 200 responses use the configured 30-day cache validity.
  Dynamic chart HTML namespaces include the current period, so Nginx keeps them
  at a safe 5-minute TTL; missing chart responses are 404 with a 2-minute
  negative-cache policy and no stale-while-revalidate directive.
- `/_next/static/*`: 365 days and immutable.
- `/sw.js`, health, revalidation, RSC/prefetch, cookies/auth, unsafe methods,
  and artist-thumbnail requests bypass and are not stored.
- `X-Cache-Status` and the Nginx cache access log are diagnostic only.

The latest policy is also used by Next's `unstable_cache` lookups. Lambda writes
invalidate matching Next tags and retries the HTTP notification at most three
times with bounded timeout/backoff. A failed notification is logged as a
structured warning; it does not claim that invalidation succeeded, and the
5-minute latest TTL remains the fallback.

OSS Nginx has no general per-entry maximum stale-age switch. `proxy_cache_use_stale`
is intentionally bounded operationally by the cache volume's `inactive=30d` and
by the documented cache-clear procedure, but this is not a cryptographic or
hard wall-clock guarantee while an entry is actively requested. Do not describe
it as “stale for exactly 30 days.” Negative 404 responses have no SWR policy and
are configured separately at 2 minutes; an upstream error during stale serving
is still subject to OSS Nginx stale semantics, so clear the cache when a strict
404 guarantee is required.

## Verification

From a host with the service running:

```sh
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/                 # should become HIT after warm-up
curl -i -X POST http://127.0.0.1:8080/api/revalidate
curl -i -H 'RSC: 1' http://127.0.0.1:8080/
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
