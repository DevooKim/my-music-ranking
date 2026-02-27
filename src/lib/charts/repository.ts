import { unstable_cache } from "next/cache";
import { getCachePolicy } from "@/lib/charts/cache-policy";
import { chartS3Keys, getJsonFromS3 } from "@/lib/charts/s3";
import type { CachePolicyScope, ChartResponse } from "@/lib/charts/types";

type CacheScopeLookup = Record<
  CachePolicyScope,
  (key: string) => Promise<unknown | null>
>;

interface RawPlayedItem {
  trackId?: string;
  trackName?: string;
  albumId?: string;
  albumName?: string;
  albumImageUrl?: string;
  artistIds?: unknown;
  artistNames?: unknown;
  artistImageUrls?: unknown;
  durationMs?: unknown;
}

interface RawWeeklyData {
  isoYear?: unknown;
  isoWeek?: unknown;
  items?: unknown;
}

export type RawPlayedDataLike = {
  isoYear?: unknown;
  isoWeek?: unknown;
  items: RawPlayedItem[];
};

const isRawWeeklyData = (value: unknown): value is RawWeeklyData => {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as RawWeeklyData).items)
  );
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isRawPlayedItem = (value: unknown): value is RawPlayedItem => {
  if (!value || typeof value !== "object") return false;

  const item = value as RawPlayedItem;

  return isNonEmptyString(item.trackId) && isNonEmptyString(item.trackName);
};

const isChartResponse = (value: unknown): value is ChartResponse => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    type?: unknown;
    period?: unknown;
    generatedAt?: unknown;
    items?: unknown;
  };

  return (
    (candidate.type === "weekly" ||
      candidate.type === "monthly" ||
      candidate.type === "yearly") &&
    !!candidate.period &&
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.items)
  );
};

const createCachedJsonLookup = <T>(
  scope: CachePolicyScope,
  category: string,
): ((key: string) => Promise<T | null>) => {
  const policy = getCachePolicy(scope);

  return unstable_cache(
    async (key: string): Promise<T | null> => {
      return getJsonFromS3<T>(key);
    },
    [category, scope],
    {
      revalidate: policy.maxAgeSeconds,
    },
  );
};

const cachedWeeklyCharts: CacheScopeLookup = {
  found: createCachedJsonLookup("found", "chart:weekly"),
  not_found: createCachedJsonLookup("not_found", "chart:weekly"),
  latest: createCachedJsonLookup("latest", "chart:weekly"),
  latest_not_found: createCachedJsonLookup("latest_not_found", "chart:weekly"),
};

const cachedRawWeeklies: CacheScopeLookup = {
  found: createCachedJsonLookup("found", "chart:raw-weekly"),
  not_found: createCachedJsonLookup("not_found", "chart:raw-weekly"),
  latest: createCachedJsonLookup("latest", "chart:raw-weekly"),
  latest_not_found: createCachedJsonLookup(
    "latest_not_found",
    "chart:raw-weekly",
  ),
};

const cachedMonthlyCharts: CacheScopeLookup = {
  found: createCachedJsonLookup("found", "chart:monthly"),
  not_found: createCachedJsonLookup("not_found", "chart:monthly"),
  latest: createCachedJsonLookup("latest", "chart:monthly"),
  latest_not_found: createCachedJsonLookup("latest_not_found", "chart:monthly"),
};

const cachedYearlyCharts: CacheScopeLookup = {
  found: createCachedJsonLookup("found", "chart:yearly"),
  not_found: createCachedJsonLookup("not_found", "chart:yearly"),
  latest: createCachedJsonLookup("latest", "chart:yearly"),
  latest_not_found: createCachedJsonLookup("latest_not_found", "chart:yearly"),
};

const resolveScope = (scope: CachePolicyScope | undefined): CachePolicyScope =>
  scope ?? "found";

export const getWeeklyChartFromS3 = async (
  isoYear: number,
  isoWeek: number,
  scope: CachePolicyScope = "found",
): Promise<ChartResponse | null> => {
  const cacheScope = resolveScope(scope);
  const raw = await cachedWeeklyCharts[cacheScope](
    chartS3Keys.weekly(isoYear, isoWeek),
  );

  if (!raw || !isChartResponse(raw)) return null;
  return raw as ChartResponse;
};

export const getWeeklyRawChartFromS3 = async (
  isoYear: number,
  isoWeek: number,
  scope: CachePolicyScope = "found",
): Promise<RawPlayedDataLike | null> => {
  const cacheScope = resolveScope(scope);
  const raw = await cachedRawWeeklies[cacheScope](
    chartS3Keys.rawWeek(isoYear, isoWeek),
  );
  if (!raw || !isRawWeeklyData(raw) || !Array.isArray(raw.items)) return null;

  const parsed = raw.items.filter(isRawPlayedItem).map((item) => ({ ...item }));

  return {
    ...(isNonEmptyString(raw.isoYear?.toString())
      ? { isoYear: raw.isoYear }
      : {}),
    ...(isNonEmptyString(raw.isoWeek?.toString())
      ? { isoWeek: raw.isoWeek }
      : {}),
    items: parsed,
  };
};

export const getMonthlyChartFromS3 = async (
  year: number,
  month: number,
  scope: CachePolicyScope = "found",
): Promise<ChartResponse | null> => {
  const cacheScope = resolveScope(scope);
  const raw = await cachedMonthlyCharts[cacheScope](
    chartS3Keys.monthly(year, month),
  );
  if (!raw || !isChartResponse(raw)) return null;
  return raw as ChartResponse;
};

export const getYearlyChartFromS3 = async (
  year: number,
  scope: CachePolicyScope = "found",
): Promise<ChartResponse | null> => {
  const cacheScope = resolveScope(scope);
  const raw = await cachedYearlyCharts[cacheScope](chartS3Keys.yearly(year));
  if (!raw || !isChartResponse(raw)) return null;
  return raw as ChartResponse;
};
