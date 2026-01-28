import type { PlayedItem, ChartItem } from "../types";

// playedAt 타임스탬프 + trackId 조합으로 중복 제거
function removeDuplicatePlayedItems(items: PlayedItem[]): PlayedItem[] {
  const seen = new Map<string, PlayedItem>();
  
  for (const item of items) {
    const timestamp = new Date(item.playedAt).getTime();
    const compositeKey = `${timestamp}-${item.trackId}`;
    
    if (!seen.has(compositeKey)) {
      seen.set(compositeKey, item);
    }
  }
  
  return Array.from(seen.values());
}

export interface AggregatedTrack {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playCount: number;
  totalDurationMs: number;
}

export function aggregatePlays(items: PlayedItem[]): AggregatedTrack[] {
  // 1단계: 중복 재생 기록 제거
  const dedupedItems = removeDuplicatePlayedItems(items);
  
  // 2단계: trackId별로 집계
  const map = new Map<string, AggregatedTrack>();

  for (const item of dedupedItems) {
    const existing = map.get(item.trackId);
    if (existing) {
      existing.playCount++;
      existing.totalDurationMs += item.durationMs;
    } else {
      map.set(item.trackId, {
        trackId: item.trackId,
        trackName: item.trackName,
        albumId: item.albumId,
        albumName: item.albumName,
        albumImageUrl: item.albumImageUrl,
        artistIds: item.artistIds,
        artistNames: item.artistNames,
        playCount: 1,
        totalDurationMs: item.durationMs,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.playCount - a.playCount);
}

export function assignRanks(aggregated: AggregatedTrack[], limit?: number): Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[] {
  const limitedData = limit ? aggregated.slice(0, limit) : aggregated;
  return limitedData.map((item, index) => ({
    rank: index + 1,
    trackId: item.trackId,
    trackName: item.trackName,
    albumId: item.albumId,
    albumName: item.albumName,
    albumImageUrl: item.albumImageUrl,
    artistIds: item.artistIds,
    artistNames: item.artistNames,
    playCount: item.playCount,
    totalDurationMs: item.totalDurationMs,
    lastRank: null, // Will be filled later
    peakRank: 0,    // Will be filled later
    weeksOnChart: 0 // Will be filled later
  }));
}
