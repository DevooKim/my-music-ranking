import type { PlayedItem } from "./types";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { TZDate } from "@date-fns/tz";

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

// 중복 제거 키 생성 (playedAt을 timestamp로 변환)
export function getDeduplicationKey(item: PlayedItem): string {
  const timestamp = new Date(item.playedAt).getTime();
  return `${timestamp}_${item.trackId}`;
}

// 중복 제거 (같은 트랙 + 같은 시간)
export function deduplicatePlayedItems(items: PlayedItem[]): PlayedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getDeduplicationKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// KST 시간대로 변환하여 ISO Week 정보 계산
function getKSTISOWeekInfo(playedAt: string): { isoYear: number; isoWeek: number } {
  // TZDate를 사용하여 KST 시간대로 변환
  const kstDate = new TZDate(playedAt, "Asia/Seoul");
  
  const isoYear = getISOWeekYear(kstDate);
  const isoWeek = getISOWeek(kstDate);
  
  return { isoYear, isoWeek };
}

// 주차별 그룹핑 (KST 기준)
export interface WeekGroup {
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
}

export function groupByWeek(items: PlayedItem[]): WeekGroup[] {
  const grouped = new Map<string, WeekGroup>();
  
  for (const item of items) {
    const { isoYear, isoWeek } = getKSTISOWeekInfo(item.playedAt);
    const weekKey = `${isoYear}-${String(isoWeek).padStart(2, "0")}`;
    
    if (!grouped.has(weekKey)) {
      grouped.set(weekKey, { isoYear, isoWeek, items: [] });
    }
    grouped.get(weekKey)?.items.push(item);
  }
  
  return Array.from(grouped.values());
}
