const BUCKET = process.env.S3_BUCKET || "my-music-ranking";
const BASE_PATH = "played";

export const s3Paths = {
  bucket: BUCKET,

  // raw/{isoYear}/{isoWeek}/{timestamp}.json
  raw: (isoYear: number, isoWeek: number, timestamp: string) =>
    `${BASE_PATH}/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/${timestamp}.json`,

  // raw/{isoYear}/{isoWeek}/*.json (glob pattern)
  rawWeekGlob: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/*.json`,

  // weekly/{isoYear}/week-{isoWeek}.json
  weekly: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,

  // weekly/{isoYear}/*.json (glob pattern)
  weeklyYearGlob: (isoYear: number) => `${BASE_PATH}/weekly/${isoYear}/*.json`,

  // S3 URL
  toS3Url: (path: string) => `s3://${BUCKET}/${path}`,
};
