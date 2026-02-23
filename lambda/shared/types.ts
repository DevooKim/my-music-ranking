export interface ExternalUrls {
  spotify: string | null;
}

export interface ExternalIds {
  isrc: string | null;
}

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
  playedAt: string;
  durationMs: number;
}

export interface RawPlayedData {
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
}

export interface NextMetadata {
  next: string | null;
  updatedAt: string;
}

export interface WeeklyPlayedData {
  isoYear: number;
  isoWeek: number;
  startDate: string;
  endDate: string;
  totalCount: number;
  items: PlayedItem[];
}

export type ChartEntryStatus = "new" | "reentry";

export interface ChartItem {
  rank: number;
  lastRank: number | null;
  peakRank: number;
  weeksOnChart: number;
  entryStatus: ChartEntryStatus | null;
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

export interface ChartResponse {
  type: "weekly" | "monthly" | "yearly";
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

export interface TrackStats {
  [trackId: string]: {
    weeklyPeakRank: number;
    weeklyPeakPeriod: string;
    totalWeeksOnChart: number;
    monthlyPeakRank: number;
    monthlyPeakPeriod: string;
    totalMonthsOnChart: number;
    yearlyPeakRank: number;
    yearlyPeakPeriod: number;
    totalYearsOnChart: number;
    totalPlayedCount: number;
    trackName: string;
    artistNames: string[];
  };
}
