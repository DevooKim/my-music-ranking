import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export const s3 = new S3Client({ region: process.env.S3_REGION || "ap-northeast-2" });
export const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

export const s3Paths = {
  // Raw 데이터 (주간 단위 누적)
  raw: (isoYear: number, isoWeek: number) =>
    `raw/${isoYear}/raw-week-${String(isoWeek).padStart(2, "0")}.json`,

  // 메타데이터
  nextMetadata: () => `metadata/recently-played/next.json`,

  trackStats: () => `metadata/track-stats.json`,
  trackStatsParquet: () => `metadata/track-stats.parquet`,

  // 처리된 데이터
  weeklyProcessed: (isoYear: number, isoWeek: number) =>
    `processed/weekly/${isoYear}/weekly-week-${String(isoWeek).padStart(2, "0")}.json`,

  monthlyProcessed: (year: number, month: number) =>
    `processed/monthly/${year}/monthly-month-${String(month).padStart(2, "0")}.json`,

  yearlyProcessed: (year: number) =>
    `processed/yearly/yearly-${year}.json`,
};

export async function getS3ObjectText(key: string): Promise<{ text: string; bytes: number } | null> {
  try {
    console.log(`[S3] GET s3://${BUCKET}/${key}`);
    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));

    const body = await result.Body?.transformToString();
    if (!body) return null;
    return { text: body, bytes: result.ContentLength ?? Buffer.from(body).length };
  } catch (error: any) {
    if (error.name === "NoSuchKey") return null;
    throw error;
  }
}

export async function getS3ObjectBytes(key: string): Promise<{ bytes: Uint8Array } | null> {
  try {
    console.log(`[S3] GET s3://${BUCKET}/${key}`);
    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));

    const rawBytes = await result.Body?.transformToByteArray();
    return rawBytes ? { bytes: new Uint8Array(rawBytes) } : null;
  } catch (error: any) {
    if (error.name === "NoSuchKey") return null;
    throw error;
  }
}

export interface S3PutObjectParams {
  ContentType?: string;
  ContentEncoding?: string;
}

export async function putS3Object(
  key: string,
  body: string | Uint8Array,
  params: S3PutObjectParams = {}
): Promise<number> {
  const payload = typeof body === "string" ? body : Buffer.from(body);
  const result = await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: payload,
    ContentType: params.ContentType ?? "application/octet-stream",
    ContentEncoding: params.ContentEncoding,
  }));
  return result.$metadata.httpStatusCode === 200 ? payload.length : 0;
}

export async function getS3Json<T>(key: string): Promise<T | null> {
  try {
    const result = await getS3ObjectText(key);
    if (!result) return null;
    return JSON.parse(result.text) as T;
  } catch (error: any) {
    if (error.name === "NoSuchKey") return null;
    throw error;
  }
}

export async function putS3Json(key: string, data: unknown): Promise<void> {
  await putS3Object(key, JSON.stringify(data, null, 2), {
    ContentType: "application/json",
  });
}

export async function listS3Keys(prefix: string): Promise<string[]> {
  console.log(`[S3] LIST s3://${BUCKET}/${prefix}`);
  const result = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));

  return (result.Contents || [])
    .filter((obj): obj is { Key: string } => typeof obj.Key === "string")
    .map((obj) => obj.Key);
}
