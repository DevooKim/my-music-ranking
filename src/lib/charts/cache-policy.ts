import type { CachePolicyInfo, CachePolicyScope } from "@/lib/charts/types";

const parseSeconds = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const deriveLatestCacheDefaults = (rawIntervalSeconds: number) => {
  const interval =
    Number.isFinite(rawIntervalSeconds) && rawIntervalSeconds > 0
      ? rawIntervalSeconds
      : 1_800;
  return {
    foundMaxAge: Math.min(Math.max(Math.floor(interval / 2), 60), 300),
    foundSWR: Math.min(Math.max(Math.floor(interval / 2), 60), 300),
    notFoundMaxAge: Math.min(Math.max(Math.floor(interval / 12), 60), 120),
    notFoundSWR: 0,
  };
};

const latestDefaults = deriveLatestCacheDefaults(
  parseSeconds(process.env.SPOTIFY_RAW_COLLECTION_INTERVAL_SECONDS, 1_800),
);
const boundedLatestSeconds = (
  value: string | undefined,
  fallback: number,
): number => Math.min(parseSeconds(value, fallback), 300);
const boundedLatestNotFoundSeconds = (
  value: string | undefined,
  fallback: number,
): number => Math.min(parseSeconds(value, fallback), 120);

const buildCacheControl = (maxAge: number, swr: number): string =>
  ["public", "max-age=0", `s-maxage=${maxAge}`]
    .concat(swr > 0 ? [`stale-while-revalidate=${swr}`] : [])
    .join(", ");

export const chartCachePolicies: Record<CachePolicyScope, CachePolicyInfo> = {
  found: {
    scope: "found",
    maxAgeSeconds: parseSeconds(
      process.env.CHART_FOUND_CACHE_MAX_AGE_SECONDS,
      30 * 24 * 60 * 60,
    ),
    staleWhileRevalidateSeconds: parseSeconds(
      process.env.CHART_FOUND_CACHE_SWR_SECONDS,
      30 * 24 * 60 * 60,
    ),
    cacheControl: "",
  },
  not_found: {
    scope: "not_found",
    maxAgeSeconds: parseSeconds(
      process.env.CHART_NOT_FOUND_CACHE_MAX_AGE_SECONDS,
      120,
    ),
    staleWhileRevalidateSeconds: 0,
    cacheControl: "",
  },
  latest: {
    scope: "latest",
    maxAgeSeconds: boundedLatestSeconds(
      process.env.CHART_LATEST_CACHE_MAX_AGE_SECONDS,
      latestDefaults.foundMaxAge,
    ),
    staleWhileRevalidateSeconds: boundedLatestSeconds(
      process.env.CHART_LATEST_CACHE_SWR_SECONDS,
      latestDefaults.foundSWR,
    ),
    cacheControl: "",
  },
  latest_not_found: {
    scope: "latest_not_found",
    maxAgeSeconds: boundedLatestNotFoundSeconds(
      process.env.CHART_LATEST_NOT_FOUND_CACHE_MAX_AGE_SECONDS,
      latestDefaults.notFoundMaxAge,
    ),
    staleWhileRevalidateSeconds: 0,
    cacheControl: "",
  },
};

for (const policy of Object.values(chartCachePolicies)) {
  policy.cacheControl = buildCacheControl(
    policy.maxAgeSeconds,
    policy.staleWhileRevalidateSeconds,
  );
}

export const noStoreCachePolicy: CachePolicyInfo = {
  scope: "error",
  maxAgeSeconds: 0,
  staleWhileRevalidateSeconds: 0,
  cacheControl: "no-store",
};

export const getCachePolicy = (scope: CachePolicyScope): CachePolicyInfo =>
  chartCachePolicies[scope];

export { buildCacheControl };
