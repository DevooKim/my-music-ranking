export interface PlayedItem {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playedAt: string;
  durationMs: number;
}

export interface RawPlayedData {
  collectedAt: string;
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
}

export interface WeeklyPlayedData {
  isoYear: number;
  isoWeek: number;
  startDate: string;
  endDate: string;
  totalCount: number;
  items: PlayedItem[];
}

export interface ChartItem {
  rank: number;
  lastRank: number | null;
  peakRank: number;
  weeksOnChart: number;
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
    trackName: string;
    artistNames: string[];
  };
}
