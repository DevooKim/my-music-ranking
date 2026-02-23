import type { CachePolicyInfo, CachePolicyScope } from "@/lib/charts/types";

const parseSeconds = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const rawCollectionIntervalSeconds = parseSeconds(
  process.env.SPOTIFY_RAW_COLLECTION_INTERVAL_SECONDS,
  2 * 60 * 60,
);

const latestFoundMaxAgeDefault = clamp(
  Math.floor(rawCollectionIntervalSeconds / 2),
  600,
  3600,
);
const latestFoundSWRDefault = latestFoundMaxAgeDefault;
const latestNotFoundMaxAgeDefault = clamp(
  Math.floor(rawCollectionIntervalSeconds / 12),
  60,
  600,
);
const latestNotFoundSWRDefault = clamp(
  Math.floor(rawCollectionIntervalSeconds / 60),
  30,
  120,
);

const foundMaxAge = parseSeconds(
  process.env.CHART_FOUND_CACHE_MAX_AGE_SECONDS,
  30 * 24 * 60 * 60,
);
const foundSWR = parseSeconds(
  process.env.CHART_FOUND_CACHE_SWR_SECONDS,
  foundMaxAge,
);
const notFoundMaxAge = parseSeconds(
  process.env.CHART_NOT_FOUND_CACHE_MAX_AGE_SECONDS,
  120,
);
const notFoundSWR = parseSeconds(
  process.env.CHART_NOT_FOUND_CACHE_SWR_SECONDS,
  600,
);
const latestMaxAge = parseSeconds(
  process.env.CHART_LATEST_CACHE_MAX_AGE_SECONDS,
  latestFoundMaxAgeDefault,
);
const latestSWR = parseSeconds(
  process.env.CHART_LATEST_CACHE_SWR_SECONDS,
  latestFoundSWRDefault,
);
const latestNotFoundMaxAge = parseSeconds(
  process.env.CHART_LATEST_NOT_FOUND_CACHE_MAX_AGE_SECONDS,
  latestNotFoundMaxAgeDefault,
);
const latestNotFoundSWR = parseSeconds(
  process.env.CHART_LATEST_NOT_FOUND_CACHE_SWR_SECONDS,
  latestNotFoundSWRDefault,
);

const buildCacheControl = (maxAge: number, swr: number) =>
  `public, max-age=${maxAge}, stale-while-revalidate=${swr}`;

export const chartCachePolicies: Record<CachePolicyScope, CachePolicyInfo> = {
  found: {
    scope: "found",
    maxAgeSeconds: foundMaxAge,
    staleWhileRevalidateSeconds: foundSWR,
    cacheControl: buildCacheControl(foundMaxAge, foundSWR),
  },
  not_found: {
    scope: "not_found",
    maxAgeSeconds: notFoundMaxAge,
    staleWhileRevalidateSeconds: notFoundSWR,
    cacheControl: buildCacheControl(notFoundMaxAge, notFoundSWR),
  },
  latest: {
    scope: "latest",
    maxAgeSeconds: latestMaxAge,
    staleWhileRevalidateSeconds: latestSWR,
    cacheControl: buildCacheControl(latestMaxAge, latestSWR),
  },
  latest_not_found: {
    scope: "latest_not_found",
    maxAgeSeconds: latestNotFoundMaxAge,
    staleWhileRevalidateSeconds: latestNotFoundSWR,
    cacheControl: buildCacheControl(latestNotFoundMaxAge, latestNotFoundSWR),
  },
};

export const getCachePolicy = (scope: CachePolicyScope): CachePolicyInfo => {
  return chartCachePolicies[scope];
};
