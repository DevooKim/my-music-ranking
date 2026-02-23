import {
  getCurrentMonthPeriod,
  getCurrentWeekPeriod,
  getCurrentYearPeriod,
  getMonthPeriod,
  type WeekPeriod,
  moveWeekPeriod,
  getWeekPeriod,
  getYearPeriod,
} from "@/lib/charts/period";
import type {
  ChartResponse,
  ChartErrorResult,
  ChartFoundResult,
  ChartNotFoundResult,
  ChartQueryResult,
  NotReadyChartResponse,
} from "@/lib/charts/types";
import { getCachePolicy } from "@/lib/charts/cache-policy";
import {
  getMonthlyChartFromS3,
  getWeeklyRawChartFromS3,
  getWeeklyChartFromS3,
  getYearlyChartFromS3,
  type RawPlayedDataLike,
} from "@/lib/charts/repository";

type RawPlayedItem = RawPlayedDataLike["items"][number] & {
  trackName?: string;
  albumId?: string;
  albumName?: string;
  albumImageUrl?: string;
  artistIds?: unknown;
  artistNames?: unknown;
  durationMs?: unknown;
};

const toChartFromRawWeekly = (raw: RawPlayedDataLike, period: WeekPeriod): ChartResponse => {
  const aggregated = new Map<string, {
    trackId: string;
    trackName: string;
    albumId: string;
    albumName: string;
    albumImageUrl: string;
    artistIds: string[];
    artistNames: string[];
    playCount: number;
    totalDurationMs: number;
  }>();

  (raw.items as RawPlayedItem[]).forEach((item) => {
    if (!item.trackId || !item.trackName || !item.albumId || !item.albumName || !item.albumImageUrl) {
      return;
    }

    const duration = Number(item.durationMs ?? 0);

    const previous = aggregated.get(item.trackId);
    if (previous) {
      previous.playCount += 1;
      previous.totalDurationMs += Number.isFinite(duration) ? duration : 0;
      return;
    }

    aggregated.set(item.trackId, {
      trackId: item.trackId,
      trackName: item.trackName,
      albumId: item.albumId,
      albumName: item.albumName,
      albumImageUrl: item.albumImageUrl,
      artistIds: Array.isArray(item.artistIds) ? item.artistIds.filter((x): x is string => typeof x === "string") : [],
      artistNames: Array.isArray(item.artistNames)
        ? item.artistNames.filter((x): x is string => typeof x === "string")
        : [],
      playCount: 1,
      totalDurationMs: Number.isFinite(duration) ? duration : 0,
    });
  });

  const rankedItems = Array.from(aggregated.values())
    .sort((a, b) => {
      if (b.playCount !== a.playCount) {
        return b.playCount - a.playCount;
      }

      if (b.totalDurationMs !== a.totalDurationMs) {
        return b.totalDurationMs - a.totalDurationMs;
      }

      return a.trackName.localeCompare(b.trackName, "en");
    })
    .slice(0, 100)
    .map<ChartResponse["items"][number]>((entry, index) => ({
      ...entry,
      rank: index + 1,
      lastRank: null,
      peakRank: null,
      weeksOnChart: null,
    }));

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

const applyRawWeeklyHistory = (
  chart: ChartResponse,
  previousWeekChart: ChartResponse | null,
): ChartResponse => {
  const previousByTrack = previousWeekChart
    ? new Map(previousWeekChart.items.map((item) => [item.trackId, { rank: item.rank, peakRank: item.peakRank, weeksOnChart: item.weeksOnChart }]))
    : new Map<string, { rank: number; peakRank: number | null; weeksOnChart: number | null }>();

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
): Promise<ChartResponse | null> => {
  const previous = moveWeekPeriod(period, -1);

  const previousProcessed = await getWeeklyChartFromS3(previous.isoYear, previous.isoWeek);
  if (previousProcessed) return previousProcessed;

  const previousRaw = await getWeeklyRawChartFromS3(previous.isoYear, previous.isoWeek);
  if (!previousRaw || previousRaw.items.length === 0) return null;

  return toChartFromRawWeekly(previousRaw, previous);
};

const buildError = (type: "weekly" | "monthly" | "yearly", message: string): ChartErrorResult => ({
  kind: "error",
  type,
  statusCode: 500,
  message,
  cachePolicy: getCachePolicy("not_found"),
});

const buildNotReady = (payload: Omit<NotReadyChartResponse, "generatedAt">): ChartNotFoundResult => ({
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
    const chart = await getWeeklyChartFromS3(period.isoYear, period.isoWeek);
    if (!chart) {
      const rawChart = await getWeeklyRawChartFromS3(period.isoYear, period.isoWeek);
      if (rawChart && rawChart.items.length > 0) {
        const previousWeekChart = await getPreviousWeekChartForRaw(period);
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
  try {
    const chart = await getWeeklyChartFromS3(isoYear, isoWeek);
    if (!chart) {
      const rawChart = await getWeeklyRawChartFromS3(isoYear, isoWeek);
      if (rawChart && rawChart.items.length > 0) {
        return {
          kind: "found",
          chart: toChartFromRawWeekly(rawChart, period),
          cachePolicy: getCachePolicy("found"),
        } satisfies ChartFoundResult;
      }

      return buildNotReady({
        status: "not_ready",
        type: "weekly",
        period,
        message: "요청한 주차 처리본이 아직 존재하지 않습니다.",
        detail: "미래 주차이거나 Lambda가 아직 집계하지 않은 구간일 수 있습니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("found"),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("weekly", "주간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getMonthlyChart = async (year: number, month: number): Promise<ChartQueryResult> => {
  const period = getMonthPeriod(year, month);
  try {
    const chart = await getMonthlyChartFromS3(year, month);
    if (!chart) {
      return buildNotReady({
        status: "not_ready",
        type: "monthly",
        period,
        message: "요청한 월 처리본이 아직 존재하지 않습니다.",
        detail: "월간 집계 스케줄이 완료되지 않은 구간일 수 있습니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("found"),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("monthly", "월간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getYearlyChart = async (year: number): Promise<ChartQueryResult> => {
  const period = getYearPeriod(year);
  try {
    const chart = await getYearlyChartFromS3(year);
    if (!chart) {
      return buildNotReady({
        status: "not_ready",
        type: "yearly",
        period,
        message: "요청한 연도 처리본이 아직 존재하지 않습니다.",
        detail: "연간 집계가 완료되지 않은 구간일 수 있습니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("found"),
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
