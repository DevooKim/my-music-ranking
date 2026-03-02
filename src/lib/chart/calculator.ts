import type { ChartItem } from "@/lib/types/played";

const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

interface AggregatedRow {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string;   // JSON 배열 문자열
  artistNames: string; // JSON 배열 문자열
  playCount: number;
  totalDurationMs: number;
  firstPlayedAt: unknown;
}

export interface AggregatedTrack {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playCount: number;
  totalDurationMs: number;
  firstPlayedAt: number;
}

const normalizeFirstPlayedAt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  return Number.MAX_SAFE_INTEGER;
};

/**
 * S3의 raw JSON 파일들을 DuckDB로 집계
 * @param s3Pattern S3 glob 패턴 (예: "played/raw/2025/01/*.json")
 * @param limit 결과 제한
 */
export async function aggregatePlaysFromS3(
  s3Pattern: string,
  limit = 100
): Promise<AggregatedTrack[]> {
  const duckdbClient = await import("@/lib/duckdb/client");
  const conn = await duckdbClient.getDuckDB();
  const s3Path = `s3://${BUCKET}/${s3Pattern}`;
  
  const sql = `
    WITH flattened AS (
      SELECT 
        unnest(items) as item
      FROM read_json_auto('${s3Path}', union_by_name=true)
    )
    SELECT 
      item.trackId as trackId,
      item.trackName as trackName,
      item.albumId as albumId,
      item.albumName as albumName,
      item.albumImageUrl as albumImageUrl,
      json(item.artistIds) as artistIds,
      json(item.artistNames) as artistNames,
      COUNT(*) as playCount,
      SUM(item.durationMs) as totalDurationMs,
      MIN(CAST(item.playedAt AS TIMESTAMP)) as firstPlayedAt
    FROM flattened
    GROUP BY 
      item.trackId, item.trackName, item.albumId, 
      item.albumName, item.albumImageUrl, 
      item.artistIds, item.artistNames
    ORDER BY playCount DESC, firstPlayedAt ASC
    LIMIT ${limit}
  `;
  
  const rows = await duckdbClient.queryAll<AggregatedRow>(conn, sql);
  
  return rows.map((row) => ({
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: JSON.parse(row.artistIds),
    artistNames: JSON.parse(row.artistNames),
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
    firstPlayedAt: normalizeFirstPlayedAt(row.firstPlayedAt),
  }));
}

/**
 * 주간 차트용 S3 패턴 생성
 */
export function getWeeklyS3Pattern(isoYear: number, isoWeek: number): string {
  return `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/*.json`;
}

/**
 * 월간 차트용 S3 패턴 생성 (해당 월의 모든 주)
 * 현재는 연도별 전체 파일을 조회하며, DuckDB 쿼리에서 날짜 필터링 필요
 */
export function getMonthlyS3Pattern(year: number, _month: number): string {
  // 월간은 해당 월에 속하는 모든 raw 파일 조회
  // 월별 폴더 구조가 아닌 경우 glob 패턴 조정 필요
  // TODO: WHERE 절에서 날짜 필터링하거나 폴더 구조 변경 고려
  return `played/raw/${year}/*/*.json`;
}

/**
 * 연간 차트용 S3 패턴 생성
 */
export function getYearlyS3Pattern(year: number): string {
  return `played/raw/${year}/**/*.json`;
}

/**
 * 집계된 트랙에 순위 부여
 */
export function assignRanks(
  tracks: AggregatedTrack[],
  limit = 100
): Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[] {
  return tracks.slice(0, limit).map((track, index) => ({
    rank: index + 1,
    entryStatus: null,
    ...track,
  }));
}
