import type { PlayedItem, ChartItem } from "../types";

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
  const map = new Map<string, AggregatedTrack>();

  for (const item of items) {
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

export function assignRanks(aggregated: AggregatedTrack[], limit = 100): Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[] {
  return aggregated.slice(0, limit).map((item, index) => ({
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
