import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.S3_REGION || "ap-northeast-2" });
const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

export const s3Paths = {
  // Raw 데이터 (주간 단위 누적)
  raw: (isoYear: number, isoWeek: number) =>
    `raw/${isoYear}/raw-week-${String(isoWeek).padStart(2, "0")}.json`,

  // 메타데이터
  nextMetadata: () => `metadata/recently-played/next.json`,

  trackStats: () => `metadata/track-stats.json`,

  // 처리된 데이터
  weeklyProcessed: (isoYear: number, isoWeek: number) =>
    `processed/weekly/${isoYear}/weekly-week-${String(isoWeek).padStart(2, "0")}.json`,

  monthlyProcessed: (year: number, month: number) =>
    `processed/monthly/${year}/monthly-month-${String(month).padStart(2, "0")}.json`,

  yearlyProcessed: (year: number) =>
    `processed/yearly/yearly-${year}.json`,
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

export async function listS3Keys(prefix: string): Promise<string[]> {
  const result = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));

  return (result.Contents || [])
    .filter((obj): obj is { Key: string } => typeof obj.Key === "string")
    .map((obj) => obj.Key);
}
