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
  limit?: number;
}

interface BuildChartResult {
  chart: ChartResponse;
  updatedStats: TrackStats;
}

export function buildChart(input: BuildChartInput): BuildChartResult {
  const { items, chartType, period, lastChart, trackStats, limit = 100 } = input;
  
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
    const { peakRank, periodsOnChart } = getStatsForChart(
      updatedStats,
      item.trackId,
      chartType
    );
    
    return {
      ...item,
      peakRank: Math.min(peakRank, item.rank),
      weeksOnChart: periodsOnChart,
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
