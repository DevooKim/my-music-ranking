import type { ChartItem, ChartResponse, TrackStats } from "@/lib/types/played";
import { 
  aggregatePlaysFromS3, 
  assignRanks,
  getWeeklyS3Pattern,
  getMonthlyS3Pattern,
  getYearlyS3Pattern,
} from "./calculator";
import { compareWithLastChart } from "./comparator";
import { updateTrackStats, getStatsForChart } from "./stats-manager";

type ChartType = "weekly" | "monthly" | "yearly";

interface BuildChartInput {
  chartType: ChartType;
  recentlySeenTrackIds?: Set<string>;
  period: {
    start: string;
    end: string;
    label: string;  // "2025-W01", "2025-01", "2025"
    // 주간용
    isoYear?: number;
    isoWeek?: number;
    // 월간용
    year?: number;
    month?: number;
  };
  lastChart: ChartResponse | null;
  trackStats: TrackStats;
  limit?: number;
}

interface BuildChartResult {
  chart: ChartResponse;
  updatedStats: TrackStats;
}

const getPreviousPeriodCount = (
  chartType: ChartType,
  trackStats: TrackStats,
  trackId: string,
): number => {
  const stats = trackStats[trackId];
  if (!stats) return 0;

  if (chartType === "weekly") return stats.totalWeeksOnChart;
  if (chartType === "monthly") return stats.totalMonthsOnChart;
  return stats.totalYearsOnChart;
};

const getPreviousChartStreaks = (
  lastChart: ChartResponse | null,
  chartType: ChartType,
): Map<string, number> => {
  if (!lastChart || lastChart.type !== chartType) return new Map();

  return new Map(
    lastChart.items.map((item) => [item.trackId, item.weeksOnChart ?? 0]),
  );
};

/**
 * S3 패턴 결정
 */
function getS3Pattern(chartType: ChartType, period: BuildChartInput["period"]): string {
  if (chartType === "weekly" && period.isoYear && period.isoWeek) {
    return getWeeklyS3Pattern(period.isoYear, period.isoWeek);
  } else if (chartType === "monthly" && period.year && period.month) {
    return getMonthlyS3Pattern(period.year, period.month);
  } else if (chartType === "yearly" && period.year) {
    return getYearlyS3Pattern(period.year);
  }
  throw new Error(`Invalid period for chartType: ${chartType}`);
}

/**
 * DuckDB를 사용하여 S3에서 직접 차트 생성
 */
export async function buildChart(input: BuildChartInput): Promise<BuildChartResult> {
  const { chartType, period, lastChart, trackStats, limit = 100 } = input;
  const previousChartStreaks = getPreviousChartStreaks(lastChart, chartType);
  
  // 1. S3 패턴 결정 및 DuckDB로 집계
  const s3Pattern = getS3Pattern(chartType, period);
  const aggregated = await aggregatePlaysFromS3(s3Pattern, limit);
  
  // 2. 순위 부여
  const ranked = assignRanks(aggregated, limit);
  
  // 3. 지난 차트와 비교 (lastRank)
  const withLastRank = compareWithLastChart(ranked, lastChart);
  
  // 4. 통계 업데이트 (주간 차트만)
  let updatedStats = trackStats;
  if (chartType === "weekly") {
    const result = updateTrackStats(trackStats, withLastRank, period.label);
    updatedStats = result.stats;
  }
  
  // 5. peak/weeks 정보 추가
  const finalItems: ChartItem[] = withLastRank.map((item) => {
    const { peakRank } = getStatsForChart(
      updatedStats,
      item.trackId
    );
    const previousPeriods = getPreviousPeriodCount(
      chartType,
      trackStats,
      item.trackId,
    );
    const hasRecentWindowData = Boolean(input.recentlySeenTrackIds);
    const hasSeenBefore = previousPeriods > 0;
    const wasSeenInWindow =
      hasRecentWindowData && input.recentlySeenTrackIds?.has(item.trackId)
        ? true
        : false;
    const shouldMarkReentry =
      hasRecentWindowData && hasSeenBefore && !wasSeenInWindow;

    const periodStreak =
      item.lastRank === null
        ? 1
        : (previousChartStreaks.get(item.trackId) ?? 0) + 1;
    
    return {
      ...item,
      peakRank: Math.min(peakRank, item.rank),
      weeksOnChart: periodStreak,
      entryStatus: item.lastRank === null
        ? chartType === "weekly"
          ? hasRecentWindowData
            ? !hasSeenBefore
              ? "new"
              : shouldMarkReentry
                ? "reentry"
                : null
            : (hasSeenBefore ? "reentry" : "new")
          : previousPeriods > 0
            ? "reentry"
            : "new"
        : null,
    };
  });
  
  // 6. 차트 응답 생성
  const chart: ChartResponse = {
    type: chartType,
    period: {
      start: period.start,
      end: period.end,
      ...(chartType === "weekly" && {
        isoYear: period.isoYear,
        isoWeek: period.isoWeek,
      }),
      ...(chartType === "monthly" && {
        year: period.year,
        month: period.month,
      }),
      ...(chartType === "yearly" && {
        year: period.year,
      }),
    },
    generatedAt: new Date().toISOString(),
    items: finalItems,
  };
  
  return { chart, updatedStats };
}

/**
 * 실시간 차트 생성 (현재 주 기준)
 */
export async function buildRealtimeChart(
  isoYear: number,
  isoWeek: number,
  limit = 50
): Promise<ChartResponse> {
  const s3Pattern = getWeeklyS3Pattern(isoYear, isoWeek);
  const aggregated = await aggregatePlaysFromS3(s3Pattern, limit);
  const ranked = assignRanks(aggregated, limit);
  
  return {
    type: "realtime",
    period: {
      start: new Date().toISOString(),
      end: new Date().toISOString(),
      isoYear,
      isoWeek,
    },
    generatedAt: new Date().toISOString(),
    items: ranked.map((item) => ({
      ...item,
      lastRank: null,
      peakRank: null,
      weeksOnChart: null,
    })),
  };
}
