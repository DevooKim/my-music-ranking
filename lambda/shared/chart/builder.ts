import type { ChartItem, ChartResponse, TrackStats, PlayedItem } from "../types";
import { aggregatePlays, assignRanks } from "./calculator";
import { compareWithLastChart } from "./comparator";
import { updateTrackStats, getStatsForChart } from "./stats-manager";

type ChartType = "weekly" | "monthly" | "yearly";

interface BuildChartInput {
  items: PlayedItem[];
  chartType: ChartType;
  period: {
    start: string;
    end: string;
    label: string;
    isoYear?: number;
    isoWeek?: number;
    year?: number;
    month?: number;
  };
  lastChart: ChartResponse | null;
  trackStats: TrackStats;
  recentlySeenTrackIds?: Set<string>;
  limit?: number;
}

interface BuildChartResult {
  chart: ChartResponse;
  updatedStats: TrackStats;
}

const getPreviousPeriodCount = (
  trackStats: TrackStats,
  trackId: string,
  chartType: ChartType,
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

export function buildChart(input: BuildChartInput): BuildChartResult {
  const { items, chartType, period, lastChart, trackStats, limit } = input;
  const previousChartStreaks = getPreviousChartStreaks(lastChart, chartType);
  
  // 1. 집계
  const aggregated = aggregatePlays(items);
  
  // 2. 순위 부여
  const ranked = assignRanks(aggregated, limit);
  
  // 3. 지난 차트와 비교
  const withLastRank = compareWithLastChart(ranked, lastChart);
  
  // 4. 통계 업데이트
  const { stats: updatedStats } = updateTrackStats(
    trackStats, 
    withLastRank, 
    period.label, 
    chartType
  );
  
  // 5. peak/weeks 정보 추가
  const finalItems: ChartItem[] = withLastRank.map((item) => {
    const { peakRank } = getStatsForChart(
      updatedStats,
      item.trackId,
      chartType
    );
    const previousPeriods = getPreviousPeriodCount(trackStats, item.trackId, chartType);
    const hasRecentWindowData = Boolean(input.recentlySeenTrackIds);
    const hasSeenBefore =
      previousPeriods > 0;
    const wasSeenInWindow =
      hasRecentWindowData && input.recentlySeenTrackIds?.has(item.trackId) ? true : false;
    const shouldMarkReentry =
      hasRecentWindowData && hasSeenBefore && !wasSeenInWindow;
    const entryStatus = item.lastRank === null
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
      : null;
    
    const periodStreak =
      item.lastRank === null
        ? 1
        : (previousChartStreaks.get(item.trackId) ?? 0) + 1;

    return {
      ...item,
      peakRank: Math.min(peakRank, item.rank),
      weeksOnChart: periodStreak,
      entryStatus,
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
