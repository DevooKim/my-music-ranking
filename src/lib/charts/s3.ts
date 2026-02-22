import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const bucketName = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || "my-music-ranking";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";

const s3 = new S3Client({ region });

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const chartS3Keys = {
  weekly: (isoYear: number, isoWeek: number) =>
    `processed/weekly/${isoYear}/weekly-week-${pad2(isoWeek)}.json`,
  monthly: (year: number, month: number) =>
    `processed/monthly/${year}/monthly-month-${pad2(month)}.json`,
  yearly: (year: number) => `processed/yearly/yearly-${year}.json`,
};

const isNotFoundError = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
};

export const getJsonFromS3 = async <T>(key: string): Promise<T | null> => {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    if (!result.Body) return null;

    const rawText = await result.Body.transformToString();
    if (!rawText) return null;

    return JSON.parse(rawText) as T;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
};
