import { getCachePolicy } from "@/lib/charts/cache-policy";
import {
  getCurrentMonthPeriod,
  getCurrentWeekPeriod,
  getCurrentYearPeriod,
  getMonthPeriod,
  isWeekPeriodEqual,
  getWeekPeriod,
  getYearPeriod,
  moveWeekPeriod,
  type WeekPeriod,
} from "@/lib/charts/period";
import {
  getMonthlyChartFromS3,
  getWeeklyArtistChartFromS3,
  getTrackStatsForWeekly,
  getWeeklyChartFromS3,
  getWeeklyRawChartFromS3,
  getYearlyChartFromS3,
  type RawPlayedDataLike,
  type WeeklyTrackStats,
} from "@/lib/charts/repository";
import type {
  CachePolicyScope,
  ChartErrorResult,
  ChartFoundResult,
  ChartNotFoundResult,
  ChartQueryResult,
  ChartResponse,
  NotReadyChartResponse,
} from "@/lib/charts/types";
import { buildArtistChartItems } from "@/lib/charts/artist-ranking";

type RawPlayedItem = RawPlayedDataLike["items"][number] & {
  trackName?: string;
  albumId?: string;
  albumName?: string;
  albumImageUrl?: string;
  artistIds?: unknown;
  artistNames?: unknown;
  artistImageUrls?: unknown;
  durationMs?: unknown;
  playedAt?: unknown;
  url?: unknown;
  trackExternalUrls?: {
    spotify?: unknown;
  };
};

const toChartFromRawWeekly = (
  raw: RawPlayedDataLike,
  period: WeekPeriod,
): ChartResponse => {
  const normalizePlayedAt = (value: unknown): number => {
    if (typeof value !== "string" || value.length === 0) return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  };

  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];

  const aggregated = new Map<
    string,
    {
      trackId: string;
      trackName: string;
      albumId: string;
      albumName: string;
      albumImageUrl: string;
      artistIds: string[];
      artistNames: string[];
      artistImageUrls: string[];
      playCount: number;
      totalDurationMs: number;
      lastPlayedAt: number;
      firstPlayedAt: number;
      url: string | null;
    }
  >();

  (raw.items as RawPlayedItem[]).forEach((item) => {
    if (
      !item.trackId ||
      !item.trackName ||
      !item.albumId ||
      !item.albumName ||
      !item.albumImageUrl
    ) {
      return;
    }

    const duration = Number(item.durationMs ?? 0);
    const playedAt = normalizePlayedAt(item.playedAt);

    const previous = aggregated.get(item.trackId);
    if (previous) {
      previous.playCount += 1;
      previous.totalDurationMs += Number.isFinite(duration) ? duration : 0;
      if (playedAt > previous.lastPlayedAt) {
        previous.lastPlayedAt = playedAt;
      }
      if (playedAt < previous.firstPlayedAt) {
        previous.firstPlayedAt = playedAt;
      }
      if (!previous.url) {
        const candidateUrl =
          typeof item.url === "string"
            ? item.url
            : typeof item.trackExternalUrls?.spotify === "string"
              ? item.trackExternalUrls.spotify
              : null;
        previous.url = candidateUrl;
      }

      const candidateArtistImageUrls = toStringArray(item.artistImageUrls);
      for (let index = 0; index < candidateArtistImageUrls.length; index += 1) {
        if (!previous.artistImageUrls[index]) {
          previous.artistImageUrls[index] = candidateArtistImageUrls[index];
        }
      }

      return;
    }

    aggregated.set(item.trackId, {
      trackId: item.trackId,
      trackName: item.trackName,
      albumId: item.albumId,
      albumName: item.albumName,
      albumImageUrl: item.albumImageUrl,
      artistIds: Array.isArray(item.artistIds)
        ? item.artistIds.filter((x): x is string => typeof x === "string")
        : [],
      artistNames: Array.isArray(item.artistNames)
        ? item.artistNames.filter((x): x is string => typeof x === "string")
        : [],
      artistImageUrls: toStringArray(item.artistImageUrls),
      playCount: 1,
      totalDurationMs: Number.isFinite(duration) ? duration : 0,
      lastPlayedAt: playedAt,
      firstPlayedAt: playedAt,
      url:
        typeof item.url === "string"
          ? item.url
          : typeof item.trackExternalUrls?.spotify === "string"
            ? item.trackExternalUrls.spotify
            : null,
    });
  });

  const rankedItems = Array.from(aggregated.values())
    .sort((a, b) => {
      if (b.playCount !== a.playCount) {
        return b.playCount - a.playCount;
      }

      if (a.lastPlayedAt !== b.lastPlayedAt) {
        return a.lastPlayedAt - b.lastPlayedAt;
      }

      return a.trackName.localeCompare(b.trackName, "en");
    })
    .map<ChartResponse["items"][number]>((entry, index) => {
      const { lastPlayedAt: _lastPlayedAt, ...item } = entry;
      return {
        ...item,
        rank: index + 1,
        lastRank: null,
        peakRank: null,
        weeksOnChart: null,
        entryStatus: null,
      };
    });

  return {
    type: "weekly",
    period: {
      start: period.start,
      end: period.end,
      isoYear: period.isoYear,
      isoWeek: period.isoWeek,
    },
    generatedAt: new Date().toISOString(),
    items: rankedItems,
  };
};

const isFutureWeekPeriod = (period: WeekPeriod): boolean => {
  const current = getCurrentWeekPeriod();
  if (period.isoYear !== current.isoYear)
    return period.isoYear > current.isoYear;
  return period.isoWeek > current.isoWeek;
};

const isFutureMonthPeriod = (period: {
  year: number;
  month: number;
}): boolean => {
  const current = getCurrentMonthPeriod();
  if (period.year !== current.year) return period.year > current.year;
  return period.month > current.month;
};

const isFutureYearPeriod = (year: number): boolean => {
  const current = getCurrentYearPeriod();
  return year > current.year;
};

const resolveLookupScope = (isFuture: boolean): CachePolicyScope =>
  isFuture ? "not_found" : "found";

const REENTRY_LOOKBACK_WEEKS = 4;

const wasTrackSeenBefore = (
  trackStats: WeeklyTrackStats,
  trackId: string,
): boolean => (trackStats[trackId]?.totalWeeksOnChart ?? 0) > 0;

const getTrackPeakRankFromStats = (
  trackStats: WeeklyTrackStats,
  trackId: string,
): number => trackStats[trackId]?.weeklyPeakRank ?? Number.MAX_SAFE_INTEGER;

const applyRawWeeklyHistory = (
  chart: ChartResponse,
  previousWeekChart: ChartResponse | null,
  trackStats: WeeklyTrackStats,
  recentTrackIds?: Set<string>,
): ChartResponse => {
  const previousByTrack = previousWeekChart
    ? new Map(
        previousWeekChart.items.map((item) => [
          item.trackId,
          {
            rank: item.rank,
            peakRank: item.peakRank,
            weeksOnChart: item.weeksOnChart,
          },
        ]),
      )
    : new Map<
        string,
        { rank: number; peakRank: number | null; weeksOnChart: number | null }
      >();

  if (!previousWeekChart) {
    return {
      ...chart,
      items: chart.items.map((item) => {
        const hasEverAppeared = wasTrackSeenBefore(trackStats, item.trackId);
        const wasRecentlySeen = recentTrackIds?.has(item.trackId) ?? false;
        const peakFromTrackStats = getTrackPeakRankFromStats(trackStats, item.trackId);

        return {
          ...item,
          lastRank: null,
          peakRank: Math.min(peakFromTrackStats, item.rank),
          weeksOnChart: 1,
          entryStatus:
            hasEverAppeared && !wasRecentlySeen
              ? "reentry"
                : hasEverAppeared
                  ? null
                  : "new",
        };
      }),
    };
  }

  return {
    ...chart,
    items: chart.items.map((item) => {
      const previous = previousByTrack.get(item.trackId);
      if (!previous) {
        const hasEverAppeared = wasTrackSeenBefore(trackStats, item.trackId);
        const wasRecentlySeen = recentTrackIds?.has(item.trackId) ?? false;
        const peakFromTrackStats = getTrackPeakRankFromStats(trackStats, item.trackId);

        return {
          ...item,
          lastRank: null,
          peakRank: Math.min(peakFromTrackStats, item.rank),
          weeksOnChart: 1,
          entryStatus:
            hasEverAppeared && !wasRecentlySeen
              ? "reentry"
              : hasEverAppeared
                ? null
                : "new",
        };
      }

      const previousPeak = previous.peakRank ?? item.rank;
      const previousWeeks = previous.weeksOnChart ?? 0;
      const peakFromTrackStats = getTrackPeakRankFromStats(
        trackStats,
        item.trackId,
      );

      return {
        ...item,
        lastRank: previous.rank,
        peakRank: Math.min(previousPeak, peakFromTrackStats, item.rank),
        weeksOnChart: previousWeeks + 1,
        entryStatus: null,
      };
    }),
  };
};

const collectRecentWeeklyTrackIds = async (
  period: WeekPeriod,
  lookupScope: CachePolicyScope,
  lookbackWeeks = REENTRY_LOOKBACK_WEEKS,
): Promise<Set<string>> => {
  const trackIds = new Set<string>();
  let cursor = period;

  for (let step = 0; step < lookbackWeeks; step += 1) {
    const previous = await getPreviousWeekChartForRaw(cursor, lookupScope);
    if (previous?.items?.length) {
      for (const item of previous.items) {
        trackIds.add(item.trackId);
      }
    }
    cursor = moveWeekPeriod(cursor, -1);
  }

  return trackIds;
};

const getRecentAndEverSeenWeeklyTrackIds = async (
  period: WeekPeriod,
  lookupScope: CachePolicyScope,
): Promise<{
  recentTrackIds: Set<string>;
  trackStats: WeeklyTrackStats;
}> => {
  const [recentTrackIds, trackStats] = await Promise.all([
    collectRecentWeeklyTrackIds(period, lookupScope),
    getTrackStatsForWeekly(lookupScope),
  ]);

  return {
    recentTrackIds,
    trackStats,
  };
};

const getPreviousWeekChartForRaw = async (
  period: WeekPeriod,
  lookupScope: CachePolicyScope,
): Promise<ChartResponse | null> => {
  const previous = moveWeekPeriod(period, -1);

  const previousProcessed = await getWeeklyChartFromS3(
    previous.isoYear,
    previous.isoWeek,
    lookupScope,
  );
  if (previousProcessed) return previousProcessed;

  const previousRaw = await getWeeklyRawChartFromS3(
    previous.isoYear,
    previous.isoWeek,
    lookupScope,
  );
  if (!previousRaw || previousRaw.items.length === 0) return null;

  return toChartFromRawWeekly(previousRaw, previous);
};

const buildError = (
  type: "weekly" | "monthly" | "yearly",
  message: string,
): ChartErrorResult => ({
  kind: "error",
  type,
  statusCode: 500,
  message,
  cachePolicy: getCachePolicy("not_found"),
});

const buildNotReady = (
  payload: Omit<NotReadyChartResponse, "generatedAt">,
): ChartNotFoundResult => ({
  kind: "not_found",
  response: {
    ...payload,
    generatedAt: new Date().toISOString(),
  },
  cachePolicy: getCachePolicy("not_found"),
});

const buildLatestNotReady = (
  payload: Omit<NotReadyChartResponse, "generatedAt">,
): ChartNotFoundResult => ({
  kind: "not_found",
  response: {
    ...payload,
    generatedAt: new Date().toISOString(),
  },
  cachePolicy: getCachePolicy("latest_not_found"),
});

export const getLatestWeeklyChart = async (): Promise<ChartQueryResult> => {
  const period = getCurrentWeekPeriod();
  try {
    const rawChart = await getWeeklyRawChartFromS3(
      period.isoYear,
      period.isoWeek,
      "latest",
    );
    if (!rawChart || rawChart.items.length === 0) {
      return buildLatestNotReady({
        status: "not_ready",
        type: "weekly",
        period,
        message: "이번 주 raw 데이터가 아직 집계되지 않았습니다.",
        detail: "raw 수집 주기가 반영되면 즉시 조회됩니다.",
      });
    }

      const chart = toChartFromRawWeekly(rawChart, period);

      const artistItems = buildArtistChartItems(chart.items);

      return {
        kind: "found",
        chart,
        artistItems,
        cachePolicy: getCachePolicy("latest"),
      } satisfies ChartFoundResult;
  } catch {
    return buildError("weekly", "주간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getWeeklyChart = async (
  isoYear: number,
  isoWeek: number,
): Promise<ChartQueryResult> => {
  const period = getWeekPeriod(isoYear, isoWeek);
  if (isWeekPeriodEqual(period, getCurrentWeekPeriod())) {
    return getLatestWeeklyChart();
  }

  const isFuture = isFutureWeekPeriod(period);
  const lookupScope = resolveLookupScope(isFuture);

  if (isFuture) {
    return buildNotReady({
      status: "not_ready",
      type: "weekly",
      period,
      message: "요청한 주차는 아직 집계되지 않았습니다.",
      detail: "현재 시점 기준 이전 데이터만 조회할 수 있습니다.",
    });
  }

  try {
    const chart = await getWeeklyChartFromS3(isoYear, isoWeek, lookupScope);
    if (!chart) {
      const rawChart = await getWeeklyRawChartFromS3(isoYear, isoWeek, lookupScope);
      if (rawChart && rawChart.items.length > 0) {
        const { recentTrackIds, trackStats } =
          await getRecentAndEverSeenWeeklyTrackIds(period, lookupScope);
        const previousWeekChart = await getPreviousWeekChartForRaw(
          period,
          lookupScope,
        );
        const chart = applyRawWeeklyHistory(
          toChartFromRawWeekly(rawChart, period),
          previousWeekChart,
          trackStats,
          recentTrackIds,
        );

        const serverArtistItems = buildArtistChartItems(chart.items);

        return {
          kind: "found",
          chart,
          artistItems: serverArtistItems,
          cachePolicy: getCachePolicy(lookupScope),
        } satisfies ChartFoundResult;
      }

    const notReadyPolicy: CachePolicyScope = lookupScope;
      return {
        ...buildNotReady({
          status: "not_ready",
          type: "weekly",
          period,
          message: "요청한 주차 처리본이 아직 존재하지 않습니다.",
          detail:
            "미래 주차이거나 Lambda가 아직 집계하지 않은 구간일 수 있습니다.",
        }),
        cachePolicy: getCachePolicy(notReadyPolicy),
      };
    }

    const artistItems = await getWeeklyArtistChartFromS3(
      isoYear,
      isoWeek,
      lookupScope,
    );

    const hydratedArtistItems = artistItems;

    return {
      kind: "found",
      chart,
      artistItems: hydratedArtistItems ?? undefined,
      cachePolicy: getCachePolicy(lookupScope),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("weekly", "주간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getMonthlyChart = async (
  year: number,
  month: number,
): Promise<ChartQueryResult> => {
  const period = getMonthPeriod(year, month);
  const isFuture = isFutureMonthPeriod(period);
  const lookupScope = resolveLookupScope(isFuture);

  if (isFuture) {
    return buildNotReady({
      status: "not_ready",
      type: "monthly",
      period,
      message: "요청한 월은 아직 집계되지 않았습니다.",
      detail: "현재 시점 기준 이전 데이터만 조회할 수 있습니다.",
    });
  }

  try {
    const chart = await getMonthlyChartFromS3(year, month, lookupScope);
    if (!chart) {
      return {
        ...buildNotReady({
          status: "not_ready",
          type: "monthly",
          period,
          message: "요청한 월 처리본이 아직 존재하지 않습니다.",
          detail: "월간 집계 스케줄이 완료되지 않은 구간일 수 있습니다.",
        }),
        cachePolicy: getCachePolicy(lookupScope),
      };
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy(lookupScope),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("monthly", "월간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getYearlyChart = async (
  year: number,
): Promise<ChartQueryResult> => {
  const period = getYearPeriod(year);
  const isFuture = isFutureYearPeriod(year);
  const lookupScope = resolveLookupScope(isFuture);

  if (isFuture) {
    return buildNotReady({
      status: "not_ready",
      type: "yearly",
      period,
      message: "요청한 연도는 아직 집계되지 않았습니다.",
      detail: "현재 시점 기준 이전 데이터만 조회할 수 있습니다.",
    });
  }

  try {
    const chart = await getYearlyChartFromS3(year, lookupScope);
    if (!chart) {
      return {
        ...buildNotReady({
          status: "not_ready",
          type: "yearly",
          period,
          message: "요청한 연도 처리본이 아직 존재하지 않습니다.",
          detail: "연간 집계가 완료되지 않은 구간일 수 있습니다.",
        }),
        cachePolicy: getCachePolicy(lookupScope),
      };
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy(lookupScope),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("yearly", "연간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getCurrentPeriods = () => ({
  weekly: getCurrentWeekPeriod(),
  monthly: getCurrentMonthPeriod(),
  yearly: getCurrentYearPeriod(),
});
