export type ChartType = "weekly" | "monthly" | "yearly";

export type CachePolicyScope =
  | "found"
  | "not_found"
  | "latest"
  | "latest_not_found";

export interface CachePolicyInfo {
  scope: CachePolicyScope;
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
  cacheControl: string;
}

export type ChartEntryStatus = "new" | "reentry";

export interface ChartPeriod {
  start: string;
  end: string;
  isoYear?: number;
  isoWeek?: number;
  year?: number;
  month?: number;
}

export interface ChartItem {
  rank: number;
  trackId: string;
  trackName: string;
  url?: string | null;
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
  entryStatus: ChartEntryStatus | null;
}

export interface ChartResponse {
  type: ChartType;
  period: ChartPeriod;
  generatedAt: string;
  items: ChartItem[];
}

export interface NotReadyChartResponse {
  status: "not_ready";
  type: ChartType;
  period: ChartPeriod;
  generatedAt: string;
  message: string;
  nextExpectedAt?: string;
  detail?: string;
}

export interface ChartFoundResult {
  kind: "found";
  chart: ChartResponse;
  cachePolicy: CachePolicyInfo;
}

export interface ChartNotFoundResult {
  kind: "not_found";
  response: NotReadyChartResponse;
  cachePolicy: CachePolicyInfo;
}

export interface ChartErrorResult {
  kind: "error";
  type: ChartType;
  statusCode: number;
  message: string;
  cachePolicy: CachePolicyInfo;
}

export type ChartQueryResult =
  | ChartFoundResult
  | ChartNotFoundResult
  | ChartErrorResult;
