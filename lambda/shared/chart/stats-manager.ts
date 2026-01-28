import type { ChartItem, TrackStats } from "../types";

interface UpdateResult {
  stats: TrackStats;
  updated: string[];  // 업데이트된 trackId 목록
}

// 차트 결과로 트랙 통계 업데이트
export function updateTrackStats(
  currentStats: TrackStats,
  chartItems: Omit<ChartItem, "peakRank" | "weeksOnChart">[],
  period: string | number,  // "2025-W01" or "2025-01" or 2025
  chartType: "weekly" | "monthly" | "yearly"
): UpdateResult {
  const stats = { ...currentStats };
  const updated: string[] = [];
  
  for (const item of chartItems) {
    const existing = stats[item.trackId];
    
    if (!existing) {
      // 새 트랙
      stats[item.trackId] = {
        weeklyPeakRank: chartType === "weekly" ? item.rank : Infinity,
        weeklyPeakPeriod: chartType === "weekly" ? String(period) : "",
        totalWeeksOnChart: chartType === "weekly" ? 1 : 0,
        
        monthlyPeakRank: chartType === "monthly" ? item.rank : Infinity,
        monthlyPeakPeriod: chartType === "monthly" ? String(period) : "",
        totalMonthsOnChart: chartType === "monthly" ? 1 : 0,
        
        yearlyPeakRank: chartType === "yearly" ? item.rank : Infinity,
        yearlyPeakPeriod: chartType === "yearly" ? Number(period) : 0,
        totalYearsOnChart: chartType === "yearly" ? 1 : 0,

        totalPlayedCount: item.playCount,
        trackName: item.trackName,
        artistNames: item.artistNames,
      };
      updated.push(item.trackId);
    } else {
      // 기존 트랙 업데이트
      if (chartType === "weekly") {
        existing.totalWeeksOnChart += 1;
        if (item.rank < existing.weeklyPeakRank) {
          existing.weeklyPeakRank = item.rank;
          existing.weeklyPeakPeriod = String(period);
          updated.push(item.trackId);
        }
      } else if (chartType === "monthly") {
        existing.totalMonthsOnChart += 1;
        if (item.rank < existing.monthlyPeakRank) {
          existing.monthlyPeakRank = item.rank;
          existing.monthlyPeakPeriod = String(period);
          updated.push(item.trackId);
        }
      } else if (chartType === "yearly") {
        existing.totalYearsOnChart += 1;
        if (item.rank < existing.yearlyPeakRank) {
          existing.yearlyPeakRank = item.rank;
          existing.yearlyPeakPeriod = Number(period);
          updated.push(item.trackId);
        }
      }
      
      // 트랙 메타 업데이트
      existing.trackName = item.trackName;
      existing.artistNames = item.artistNames;
      existing.totalPlayedCount += item.playCount;
    }
  }
  
  return { stats, updated };
}

// 통계에서 peak/weeks 정보 가져오기
export function getStatsForChart(
  stats: TrackStats,
  trackId: string,
  chartType: "weekly" | "monthly" | "yearly"
): { peakRank: number; periodsOnChart: number } {
  const trackStats = stats[trackId];
  
  if (!trackStats) {
    return { peakRank: Infinity, periodsOnChart: 0 };
  }
  
  if (chartType === "weekly") {
    return {
      peakRank: trackStats.weeklyPeakRank,
      periodsOnChart: trackStats.totalWeeksOnChart,
    };
  } else if (chartType === "monthly") {
    return {
      peakRank: trackStats.monthlyPeakRank,
      periodsOnChart: trackStats.totalMonthsOnChart,
    };
  } else {
    return {
      peakRank: trackStats.yearlyPeakRank,
      periodsOnChart: trackStats.totalYearsOnChart,
    };
  }
}
