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
    total_tracks?: number;
    external_urls?: { spotify?: string };
  };
  artists: { id: string; name: string; external_urls?: { spotify?: string } }[];
  external_urls?: { spotify?: string };
  external_ids?: { isrc?: string };
  disc_number: number;
  track_number: number;
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
    albumTotalTracks: track.album.total_tracks ?? 0,
    albumExternalUrls: {
      spotify: track.album.external_urls?.spotify ?? null,
    },
    artistIds: track.artists.map((a) => a.id),
    artistNames: track.artists.map((a) => a.name),
    artistExternalUrls: track.artists.map((a) => ({
      spotify: a.external_urls?.spotify ?? null,
    })),
    trackExternalUrls: {
      spotify: track.external_urls?.spotify ?? null,
    },
    trackExternalIds: {
      isrc: track.external_ids?.isrc ?? null,
    },
    discNumber: track.disc_number,
    trackNumber: track.track_number,
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
