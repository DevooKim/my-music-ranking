import type { ChartItem, TrackStats } from "../types";

const DEFAULT_PEAK_RANK = Number.MAX_SAFE_INTEGER;

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
        weeklyPeakRank: chartType === "weekly" ? item.rank : DEFAULT_PEAK_RANK,
        weeklyPeakPeriod: chartType === "weekly" ? String(period) : "",
        totalWeeksOnChart: chartType === "weekly" ? 1 : 0,
        
        monthlyPeakRank: chartType === "monthly" ? item.rank : DEFAULT_PEAK_RANK,
        monthlyPeakPeriod: chartType === "monthly" ? String(period) : "",
        totalMonthsOnChart: chartType === "monthly" ? 1 : 0,
        
        yearlyPeakRank: chartType === "yearly" ? item.rank : DEFAULT_PEAK_RANK,
        yearlyPeakPeriod: chartType === "yearly" ? Number(period) : 0,
        totalYearsOnChart: chartType === "yearly" ? 1 : 0,

        totalPlayedCount: item.playCount,
        trackName: item.trackName,
        artistNames: item.artistNames,
        albumId: item.albumId,
        albumName: item.albumName,
      };
      updated.push(item.trackId);
    } else {
      // 기존 트랙 업데이트
      if (chartType === "weekly") {
        existing.totalWeeksOnChart += 1;
        if (existing.weeklyPeakRank > item.rank) {
          existing.weeklyPeakRank = item.rank;
          existing.weeklyPeakPeriod = String(period);
          updated.push(item.trackId);
        }
      } else if (chartType === "monthly") {
        existing.totalMonthsOnChart += 1;
        if (existing.monthlyPeakRank > item.rank) {
          existing.monthlyPeakRank = item.rank;
          existing.monthlyPeakPeriod = String(period);
          updated.push(item.trackId);
        }
      } else if (chartType === "yearly") {
        existing.totalYearsOnChart += 1;
        if (existing.yearlyPeakRank > item.rank) {
          existing.yearlyPeakRank = item.rank;
          existing.yearlyPeakPeriod = Number(period);
          updated.push(item.trackId);
        }
      }
      
      // 트랙 메타 업데이트
      existing.trackName = item.trackName;
      existing.artistNames = item.artistNames;
      existing.albumId = item.albumId;
      existing.albumName = item.albumName;
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
      peakRank: Number.isFinite(trackStats.weeklyPeakRank) ? trackStats.weeklyPeakRank : DEFAULT_PEAK_RANK,
      periodsOnChart: trackStats.totalWeeksOnChart,
    };
  } else if (chartType === "monthly") {
    return {
      peakRank: Number.isFinite(trackStats.monthlyPeakRank) ? trackStats.monthlyPeakRank : DEFAULT_PEAK_RANK,
      periodsOnChart: trackStats.totalMonthsOnChart,
    };
  } else {
    return {
      peakRank: Number.isFinite(trackStats.yearlyPeakRank) ? trackStats.yearlyPeakRank : DEFAULT_PEAK_RANK,
      periodsOnChart: trackStats.totalYearsOnChart,
    };
  }
}
