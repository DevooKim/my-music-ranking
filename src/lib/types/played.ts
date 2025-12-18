export interface ExternalUrls {
  spotify: string | null;
}

export interface ExternalIds {
  isrc: string | null;
}

// 개별 재생 기록
export interface PlayedItem {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  albumTotalTracks: number;
  albumExternalUrls: ExternalUrls;
  artistIds: string[];
  artistNames: string[];
  artistExternalUrls: ExternalUrls[];
  trackExternalUrls: ExternalUrls;
  trackExternalIds: ExternalIds;
  discNumber: number;
  trackNumber: number;
  playedAt: string; // ISO 8601
  durationMs: number;
}

// Raw JSON (2시간마다 수집)
export interface RawPlayedData {
  collectedAt: string; // ISO 8601
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
}

// Weekly JSON (월요일 병합)
export interface WeeklyPlayedData {
  isoYear: number;
  isoWeek: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalCount: number;
  items: PlayedItem[];
}

// 차트 아이템 (집계 결과)
export interface ChartItem {
  rank: number;
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playCount: number;
  totalDurationMs: number;
  lastRank: number | null;
  peakRank: number | null;
  weeksOnChart: number | null;
}

// 차트 응답
export interface ChartResponse {
  type: "realtime" | "weekly" | "monthly" | "yearly";
  period: {
    start: string;
    end: string;
    isoYear?: number;
    isoWeek?: number;
    year?: number;
    month?: number;
  };
  generatedAt: string;
  items: ChartItem[];
}

// 트랙 통계 (누적)
export interface TrackStats {
  [trackId: string]: {
    peakRank: number;
    peakPeriod: string;
    totalWeeksOnChart: number;
    trackName: string;
    artistNames: string[];
  };
}
