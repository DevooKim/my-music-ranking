import type { ChartItem } from "@/lib/charts/types";

export type ArtistChartItem = {
  rank: number;
  artistId: string;
  artistName: string;
  playCount: number;
  totalDurationMs: number;
  trackCount: number;
  artistImageUrl: string | null;
};

export const buildArtistChartItems = (items: ChartItem[]): ArtistChartItem[] => {
  const byArtist = new Map<
    string,
    {
      artistName: string;
      playCount: number;
      totalDurationMs: number;
      trackIds: Set<string>;
      artistImageUrl: string | null;
    }
  >();

  for (const item of items) {
    const artistsLength = Math.max(item.artistIds.length, item.artistNames.length);

    for (let index = 0; index < artistsLength; index += 1) {
      const artistId = item.artistIds[index];
      const artistName = item.artistNames[index];
      const artistImageUrl = item.artistImageUrls[index] || null;

      if (!artistId || !artistName) continue;

      const current = byArtist.get(artistId);

      if (current) {
        current.playCount += item.playCount;
        current.totalDurationMs += item.totalDurationMs;
        current.trackIds.add(item.trackId);
        if (!current.artistImageUrl && artistImageUrl) {
          current.artistImageUrl = artistImageUrl;
        }
        continue;
      }

      byArtist.set(artistId, {
        artistName,
        playCount: item.playCount,
        totalDurationMs: item.totalDurationMs,
        trackIds: new Set([item.trackId]),
        artistImageUrl,
      });
    }
  }

  return Array.from(byArtist.entries())
    .sort((a, b) => {
      if (b[1].playCount !== a[1].playCount) {
        return b[1].playCount - a[1].playCount;
      }

      if (b[1].totalDurationMs !== a[1].totalDurationMs) {
        return b[1].totalDurationMs - a[1].totalDurationMs;
      }

      return a[1].artistName.localeCompare(b[1].artistName, "ko");
    })
    .map(([artistId, value], index) => ({
      rank: index + 1,
      artistId,
      artistName: value.artistName,
      playCount: value.playCount,
      totalDurationMs: value.totalDurationMs,
      trackCount: value.trackIds.size,
      artistImageUrl: value.artistImageUrl,
    }));
};
