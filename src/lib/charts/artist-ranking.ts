import type { ArtistChartItem, ChartItem } from "@/lib/charts/types";

export const buildArtistChartItems = (items: ChartItem[]): ArtistChartItem[] => {
  const defaultFirstPlayedAt = Number.MAX_SAFE_INTEGER;

  const parseFirstPlayedAt = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.length > 0) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : defaultFirstPlayedAt;
    }

    return defaultFirstPlayedAt;
  };

  const byArtist = new Map<
    string,
    {
      artistName: string;
      playCount: number;
      totalDurationMs: number;
      trackIds: Set<string>;
      artistImageUrl: string | null;
      firstPlayedAt: number;
    }
  >();

  for (const item of items) {
    const artistIds = Array.isArray(item.artistIds) ? item.artistIds : [];
    const artistNames = Array.isArray(item.artistNames) ? item.artistNames : [];
    const artistImageUrls = Array.isArray(item.artistImageUrls)
      ? item.artistImageUrls
      : [];
    const firstPlayedAt = parseFirstPlayedAt(
      (item as ChartItem & { firstPlayedAt?: unknown }).firstPlayedAt,
    );

    const artistsLength = Math.max(artistIds.length, artistNames.length);

    for (let index = 0; index < artistsLength; index += 1) {
      const artistId = artistIds[index];
      const artistName = artistNames[index];
      const artistImageUrl = artistImageUrls[index] || null;

      if (!artistId || !artistName) continue;

      const current = byArtist.get(artistId);

      if (current) {
        current.playCount += item.playCount;
        current.totalDurationMs += item.totalDurationMs;
        current.trackIds.add(item.trackId);
        if (firstPlayedAt < current.firstPlayedAt) {
          current.firstPlayedAt = firstPlayedAt;
        }
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
        firstPlayedAt,
        artistImageUrl,
      });
    }
  }

  return Array.from(byArtist.entries())
    .sort((a, b) => {
      if (b[1].playCount !== a[1].playCount) {
        return b[1].playCount - a[1].playCount;
      }

      const trackCountDiff = a[1].trackIds.size - b[1].trackIds.size;
      if (trackCountDiff !== 0) {
        return trackCountDiff;
      }

      if (a[1].totalDurationMs !== b[1].totalDurationMs) {
        return a[1].totalDurationMs - b[1].totalDurationMs;
      }

      return a[1].firstPlayedAt - b[1].firstPlayedAt;
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
