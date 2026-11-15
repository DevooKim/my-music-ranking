import { unstable_cache } from "next/cache";

import { getCachePolicy } from "@/lib/charts/cache-policy";
import { buildPublicS3Url, chartS3Keys, getJsonFromS3 } from "@/lib/charts/s3";
import type {
  CachePolicyScope,
  ChartResponse,
} from "@/lib/charts/types";

type RawPlayedItem = {
  trackId?: string;
  trackName?: string;
  albumId?: string;
  albumImageUrl?: string;
  artistIds?: unknown;
  artistNames?: unknown;
  artistImageUrls?: unknown;
  durationMs?: unknown;
};

type RawWeeklyData = {
  isoYear?: unknown;
  isoWeek?: unknown;
  items?: unknown;
};

export type RawPlayedDataLike = {
  isoYear?: unknown;
  isoWeek?: unknown;
  items: RawPlayedItem[];
};

type TrackStatsFormat = "json" | "parquet";

type TrackStatsRow = {
  trackId?: unknown;
  weeklyPeakRank?: unknown;
  totalWeeksOnChart?: unknown;
};

export interface WeeklyTrackStatsRecord {
  weeklyPeakRank: number;
  totalWeeksOnChart: number;
}

export type WeeklyTrackStats = Record<string, WeeklyTrackStatsRecord>;

interface CacheScopeLookup {
  found: (key: string) => Promise<unknown | null>;
  not_found: (key: string) => Promise<unknown | null>;
  latest: (key: string) => Promise<unknown | null>;
  latest_not_found: (key: string) => Promise<unknown | null>;
}

interface TrackStatsScopeLookup {
  found: () => Promise<WeeklyTrackStats | null>;
  not_found: () => Promise<WeeklyTrackStats | null>;
  latest: () => Promise<WeeklyTrackStats | null>;
  latest_not_found: () => Promise<WeeklyTrackStats | null>;
}

const isRawPlayedItem = (value: unknown): value is RawPlayedItem => {
  if (!value || typeof value !== "object") return false;

  const item = value as RawPlayedItem;
  return (
    typeof item.trackId === "string" &&
    item.trackId.length > 0 &&
    typeof item.trackName === "string" &&
    item.trackName.length > 0
  );
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

const isRawWeeklyData = (value: unknown): value is RawWeeklyData => {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as RawWeeklyData).items)
  );
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const toSafeString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toSafeNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const isServer = typeof window === "undefined";
const logServerError = (message: string, error?: unknown): void => {
  if (!isServer) return;
  console.error(message, error);
};

const parseTrackStatsPreference = (): TrackStatsFormat => {
  const raw = (process.env.TRACK_STATS_READ_PREFERENCE || "parquet").toLowerCase();
  return raw === "json" ? "json" : "parquet";
};

const parseTrackStatsLookupOrder = (
  preference: TrackStatsFormat,
): TrackStatsFormat[] => {
  const fallback: TrackStatsFormat = preference === "json" ? "parquet" : "json";
  return [preference, fallback];
};

const normalizeTrackStatsRow = (
  trackId: string,
  value: unknown,
): WeeklyTrackStatsRecord | null => {
  if (!trackId) return null;
  if (!value || typeof value !== "object") return null;

  const source = value as {
    weeklyPeakRank?: unknown;
    totalWeeksOnChart?: unknown;
  };

  return {
    weeklyPeakRank: toSafeNumber(source.weeklyPeakRank, Number.MAX_SAFE_INTEGER),
    totalWeeksOnChart: toSafeNumber(source.totalWeeksOnChart, 0),
  };
};

const normalizeTrackStats = (source: unknown): WeeklyTrackStats => {
  if (!source || typeof source !== "object") return {};
  const raw = source as Record<string, unknown>;
  const normalized: WeeklyTrackStats = {};

  for (const [trackId, value] of Object.entries(raw)) {
    const stats = normalizeTrackStatsRow(trackId, value);
    if (!stats) continue;
    normalized[trackId] = stats;
  }

  return normalized;
};

const normalizeTrackStatsFromParquetRow = (
  row: TrackStatsRow,
): WeeklyTrackStatsRecord | null => {
  const trackId = toSafeString(row.trackId);
  if (!trackId) return null;
  return {
    weeklyPeakRank: toSafeNumber(row.weeklyPeakRank, Number.MAX_SAFE_INTEGER),
    totalWeeksOnChart: toSafeNumber(row.totalWeeksOnChart, 0),
  };
};

const readTrackStatsFromJson = async (): Promise<WeeklyTrackStats | null> => {
  const raw = await getJsonFromS3<Record<string, unknown> | null>(
    chartS3Keys.trackStats(),
  );
  if (!raw) return null;
  return normalizeTrackStats(raw);
};

const readTrackStatsFromParquet = async (): Promise<WeeklyTrackStats | null> => {
  let duckdbClient: typeof import("@/lib/duckdb/client");
  try {
    duckdbClient = await import("@/lib/duckdb/client");
  } catch (error) {
    logServerError("DuckDB is not available. Fallback to track-stats json.", error);
    return null;
  }

  let rows: TrackStatsRow[];
  try {
    const connection = await duckdbClient.getDuckDB();
    const parquetUrl = buildPublicS3Url(chartS3Keys.trackStatsParquet());
    const sql = `SELECT trackId, weeklyPeakRank, totalWeeksOnChart FROM read_parquet('${parquetUrl}')`;
    rows = await duckdbClient.queryAll<TrackStatsRow>(connection, sql);
  } catch (error) {
    logServerError("Failed to initialize DuckDB for track-stats parquet query.", error);
    return null;
  }
  if (!rows.length) return null;

  const normalized: WeeklyTrackStats = {};
  for (const row of rows) {
    const stats = normalizeTrackStatsFromParquetRow(row);
    if (!stats) continue;
    const trackId = toSafeString(row.trackId);
    if (!trackId) continue;
    normalized[trackId] = stats;
  }

  return normalized;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

const normalizeChartResponse = (value: ChartResponse): ChartResponse => ({
  ...value,
  items: value.items.map((item) => ({
    ...item,
    artistIds: toStringArray(item.artistIds),
    artistNames: toStringArray(item.artistNames),
    artistImageUrls: toStringArray(item.artistImageUrls),
  })),
});

/**
 * "없음" 결과를 Next 데이터 캐시에 남기지 않기 위한 신호.
 * unstable_cache는 결과에 따라 TTL을 바꿀 수 없어서, 처리본이 아직 없는 구간을
 * 조회하면 null이 found 정책(기본 30일)으로 굳어 버린다. 콜백에서 던지면 캐시에
 * 기록되지 않는다.
 */
class S3ObjectMissingError extends Error {}

type MemoEntry = { expiresAt: number; value: Promise<unknown> };

const MEMO_MAX_ENTRIES = 200;
const MEMO_MAX_TTL_MS = 5 * 60 * 1000;
const memo = new Map<string, MemoEntry>();

/**
 * 인스턴스 메모리 캐시. 같은 키의 동시 요청을 하나로 합치고(in-flight dedupe),
 * 짧은 시간 안의 반복 조회는 데이터 캐시 왕복 없이 돌려준다.
 */
const memoize = <T>(
  key: string,
  ttlMs: (value: T) => number,
  load: () => Promise<T>,
): Promise<T> => {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  const value = load();
  // 진행 중에는 만료 없이 공유하고, 끝나면 결과에 맞는 TTL로 고친다.
  const entry: MemoEntry = { expiresAt: Number.POSITIVE_INFINITY, value };
  memo.delete(key);
  memo.set(key, entry);
  value.then(
    (resolved) => {
      if (memo.get(key) === entry) {
        entry.expiresAt = Date.now() + ttlMs(resolved);
      }
    },
    () => {
      if (memo.get(key) === entry) memo.delete(key);
    },
  );

  if (memo.size > MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }

  return value;
};

const memoTtlMs = (scope: CachePolicyScope, value: unknown): number => {
  // 없음은 처리본이 곧 생길 수 있으므로 not_found 정책만큼만 기억한다.
  const policy = getCachePolicy(value === null ? "not_found" : scope);
  return Math.min(policy.maxAgeSeconds * 1000, MEMO_MAX_TTL_MS);
};

/** null을 데이터 캐시에 남기지 않는 unstable_cache 래퍼 */
const cacheUnlessMissing = async <T>(
  load: () => Promise<T | null>,
  keyParts: string[],
  revalidate: number,
): Promise<T | null> => {
  try {
    return await unstable_cache(
      async () => {
        const value = await load();
        if (value === null) throw new S3ObjectMissingError();
        return value;
      },
      keyParts,
      { revalidate },
    )();
  } catch (error) {
    if (error instanceof S3ObjectMissingError) return null;
    throw error;
  }
};

const createCachedJsonLookup = <T>(
  scope: CachePolicyScope,
  category: string,
): ((key: string) => Promise<T | null>) => {
  const policy = getCachePolicy(scope);

  return (key: string): Promise<T | null> =>
    memoize(
      `${category}|${scope}|${key}`,
      (value) => memoTtlMs(scope, value),
      () =>
        cacheUnlessMissing(
          () => getJsonFromS3<T>(key),
          [category, scope, key],
          policy.maxAgeSeconds,
        ),
    );
};

const createCachedTrackStatsLookup = (
  scope: CachePolicyScope,
  format: TrackStatsFormat,
): (() => Promise<WeeklyTrackStats | null>) => {
  const policy = getCachePolicy(scope);
  const cacheKey = `chart:track-stats:${format}`;

  return unstable_cache(
    async () => {
      if (format === "json") {
        return readTrackStatsFromJson();
      }
      return readTrackStatsFromParquet();
    },
    [cacheKey, scope],
    {
      revalidate: policy.maxAgeSeconds,
    },
  );
};

const cachedTrackStats: Record<TrackStatsFormat, Record<CachePolicyScope, () => Promise<WeeklyTrackStats | null>>> = {
  json: {
    found: createCachedTrackStatsLookup("found", "json"),
    not_found: createCachedTrackStatsLookup("not_found", "json"),
    latest: createCachedTrackStatsLookup("latest", "json"),
    latest_not_found: createCachedTrackStatsLookup("latest_not_found", "json"),
  },
  parquet: {
    found: createCachedTrackStatsLookup("found", "parquet"),
    not_found: createCachedTrackStatsLookup("not_found", "parquet"),
    latest: createCachedTrackStatsLookup("latest", "parquet"),
    latest_not_found: createCachedTrackStatsLookup("latest_not_found", "parquet"),
  },
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
  latest_not_found: createCachedJsonLookup("latest_not_found", "chart:raw-weekly"),
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
  return normalizeChartResponse(raw);
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
  return normalizeChartResponse(raw);
};

export const getYearlyChartFromS3 = async (
  year: number,
  scope: CachePolicyScope = "found",
): Promise<ChartResponse | null> => {
  const cacheScope = resolveScope(scope);
  const raw = await cachedYearlyCharts[cacheScope](chartS3Keys.yearly(year));
  if (!raw || !isChartResponse(raw)) return null;
  return normalizeChartResponse(raw);
};

export const getTrackStatsForWeekly = async (
  scope: CachePolicyScope = "found",
  options: { readPreference?: TrackStatsFormat } = {},
): Promise<WeeklyTrackStats> => {
  const cacheScope = resolveScope(scope);
  const preference = options.readPreference ?? parseTrackStatsPreference();
  const order = parseTrackStatsLookupOrder(preference);

  for (const format of order) {
    const raw = await cachedTrackStats[format][cacheScope]();
    if (raw !== null) {
      return raw;
    }
  }

  return {};
};
