import type { PlayedItem } from "@/lib/types/played";

// Spotify API 응답 타입 (필요한 필드만)
interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  album: {
    id: string;
    name: string;
    images?: { url: string }[];
  };
  artists: { id: string; name: string }[];
}

interface SpotifyPlayedItem {
  track: SpotifyTrack;
  played_at: string;
}

// Spotify API 응답에서 필요한 필드만 추출
export function mapSpotifyToPlayedItem(
  spotifyItem: SpotifyPlayedItem,
): PlayedItem {
  const { track, played_at } = spotifyItem;

  return {
    trackId: track.id,
    trackName: track.name,
    albumId: track.album.id,
    albumName: track.album.name,
    albumImageUrl: track.album.images?.[0]?.url || "",
    artistIds: track.artists.map((a) => a.id),
    artistNames: track.artists.map((a) => a.name),
    playedAt: played_at,
    durationMs: track.duration_ms,
  };
}

// 중복 제거 (같은 트랙 + 같은 시간)
export function deduplicatePlayedItems(items: PlayedItem[]): PlayedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.trackId}-${item.playedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
