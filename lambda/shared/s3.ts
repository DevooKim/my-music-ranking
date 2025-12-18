import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.S3_REGION || "ap-northeast-2" });
const BUCKET = process.env.S3_BUCKET || "my-music-ranking";
const BASE_PATH = "played";

export const s3Paths = {
  raw: (isoYear: number, isoWeek: number, filename: string) =>
    `${BASE_PATH}/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/${filename}.json`,
  
  weekly: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,
  
  chartWeekly: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/charts/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,
  
  chartMonthly: (year: number, month: number) =>
    `${BASE_PATH}/charts/monthly/${year}/month-${String(month).padStart(2, "0")}.json`,
  
  chartYearly: (year: number) =>
    `${BASE_PATH}/charts/yearly/${year}.json`,
  
  trackStats: () =>
    `${BASE_PATH}/stats/track-stats.json`,
};

export async function getS3Json<T>(key: string): Promise<T | null> {
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));
    
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (error: any) {
    if (error.name === "NoSuchKey") return null;
    throw error;
  }
}

export async function putS3Json(key: string, data: unknown): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  }));
}
