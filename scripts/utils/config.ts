import "dotenv/config";

export const REGION = process.env.S3_REGION ?? "ap-northeast-2";
export const BUCKET = process.env.S3_BUCKET ?? "my-music-ranking";
export const LEGACY_PREFIX = process.env.LEGACY_PREFIX ?? "spotify-recently-played/";
export const RAW_BASE_PREFIX = process.env.RAW_BASE_PREFIX ?? "played/raw/";
export const DEFAULT_SAMPLE_SIZE = Number(process.env.LEGACY_SAMPLE_SIZE ?? 5);
export const DEFAULT_CONCURRENCY = Number(process.env.MIGRATION_CONCURRENCY ?? 10);
export const SPOTIFY_TOKEN = process.env.SPOTIFY_TOKEN ?? "";
export const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET ?? "KR";
export const SPOTIFY_LOCALE = process.env.SPOTIFY_LOCALE ?? "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7";
export const ENABLE_ISRC_ENRICHMENT = (process.env.ENABLE_ISRC_ENRICHMENT ?? "true") !== "false";

export function padWeek(isoWeek: number): string {
  return String(isoWeek).padStart(2, "0");
}
