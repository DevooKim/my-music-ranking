import type { ChartItem, TrackStats } from "@/lib/types/played";

interface UpdateResult {
  stats: TrackStats;
  updated: string[];  // 업데이트된 trackId 목록
}

// 차트 결과로 트랙 통계 업데이트 (주간 차트만 지원)
export function updateTrackStats(
  currentStats: TrackStats,
  chartItems: Omit<ChartItem, "peakRank" | "weeksOnChart">[],
  period: string  // "2025-W01"
): UpdateResult {
  const stats = { ...currentStats };
  const updated: string[] = [];
  
  for (const item of chartItems) {
    const existing = stats[item.trackId];
    
    if (!existing) {
      // 새 트랙
      stats[item.trackId] = {
        peakRank: item.rank,
        peakPeriod: period,
        totalWeeksOnChart: 1,
        trackName: item.trackName,
        artistNames: item.artistNames,
      };
      updated.push(item.trackId);
    } else {
      // 기존 트랙 업데이트
      existing.totalWeeksOnChart += 1;
      if (item.rank < existing.peakRank) {
        existing.peakRank = item.rank;
        existing.peakPeriod = period;
        updated.push(item.trackId);
      }
      
      // 트랙 메타 업데이트
      existing.trackName = item.trackName;
      existing.artistNames = item.artistNames;
    }
  }
  
  return { stats, updated };
}

// 통계에서 peak/weeks 정보 가져오기
export function getStatsForChart(
  stats: TrackStats,
  trackId: string
): { peakRank: number; periodsOnChart: number } {
  const trackStats = stats[trackId];
  
  if (!trackStats) {
    return { peakRank: Infinity, periodsOnChart: 0 };
  }
  
  return {
    peakRank: trackStats.peakRank,
    periodsOnChart: trackStats.totalWeeksOnChart,
  };
}
