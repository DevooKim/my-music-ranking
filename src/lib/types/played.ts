// 개별 재생 기록
export interface PlayedItem {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
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
}

// 차트 응답
export interface ChartResponse {
  type: "realtime" | "weekly" | "monthly" | "yearly";
  period: {
    start: string;
    end: string;
  };
  generatedAt: string;
  items: ChartItem[];
}
