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
  getWeeklyChartFromS3,
  getWeeklyRawChartFromS3,
  getYearlyChartFromS3,
  type RawPlayedDataLike,
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

type RawPlayedItem = RawPlayedDataLike["items"][number] & {
  trackName?: string;
  albumId?: string;
  albumName?: string;
  albumImageUrl?: string;
  artistIds?: unknown;
  artistNames?: unknown;
  durationMs?: unknown;
  playedAt?: unknown;
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
      playCount: number;
      totalDurationMs: number;
      lastPlayedAt: number;
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
      playCount: 1,
      totalDurationMs: Number.isFinite(duration) ? duration : 0,
      lastPlayedAt: playedAt,
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
    .slice(0, 100)
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

const applyRawWeeklyHistory = (
  chart: ChartResponse,
  previousWeekChart: ChartResponse | null,
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
      items: chart.items.map((item) => ({
        ...item,
        lastRank: null,
        peakRank: item.rank,
        weeksOnChart: 1,
      })),
    };
  }

  return {
    ...chart,
    items: chart.items.map((item) => {
      const previous = previousByTrack.get(item.trackId);
      if (!previous) {
        return {
          ...item,
          lastRank: null,
          peakRank: item.rank,
          weeksOnChart: 1,
        };
      }

      const previousPeak = previous.peakRank ?? item.rank;
      const previousWeeks = previous.weeksOnChart ?? 0;

      return {
        ...item,
        lastRank: previous.rank,
        peakRank: Math.min(previousPeak, item.rank),
        weeksOnChart: previousWeeks + 1,
      };
    }),
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
    if (rawChart && rawChart.items.length > 0) {
      const previousWeekChart = await getPreviousWeekChartForRaw(
        period,
        "latest",
      );
      const latestRawChart = applyRawWeeklyHistory(
        toChartFromRawWeekly(rawChart, period),
        previousWeekChart,
      );
      return {
        kind: "found",
        chart: latestRawChart,
        cachePolicy: getCachePolicy("latest"),
      } satisfies ChartFoundResult;
    }

    const chart = await getWeeklyChartFromS3(period.isoYear, period.isoWeek, "latest");
    if (!chart) {
      return buildLatestNotReady({
        status: "not_ready",
        type: "weekly",
        period,
        message: "이번 주 처리본이 아직 생성되지 않았습니다.",
        detail: "Lambda가 집계를 완료하면 즉시 조회됩니다.",
      });
    }

    return {
      kind: "found",
      chart,
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
      const rawChart = await getWeeklyRawChartFromS3(
        isoYear,
        isoWeek,
        lookupScope,
      );
      if (rawChart && rawChart.items.length > 0) {
        return {
          kind: "found",
          chart: toChartFromRawWeekly(rawChart, period),
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

    return {
      kind: "found",
      chart,
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
