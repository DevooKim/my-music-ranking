import type { ChartItem, ChartResponse } from "../types";

// 지난 차트와 비교하여 lastRank 계산
export function compareWithLastChart(
  currentItems: Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[],
  lastChart: ChartResponse | null
): Omit<ChartItem, "peakRank" | "weeksOnChart">[] {
  const lastRankMap = new Map<string, number>();
  
  if (lastChart) {
    for (const item of lastChart.items) {
      lastRankMap.set(item.trackId, item.rank);
    }
  }
  
  return currentItems.map((item) => ({
    ...item,
    lastRank: lastRankMap.get(item.trackId) ?? null,
  }));
}

// 순위 변동 계산 헬퍼
export function getRankChange(current: number, last: number | null): string {
  if (last === null) return "NEW";
  if (current < last) return `${last - current}`;
  if (current > last) return `${current - last}`;
  return "-";
}
