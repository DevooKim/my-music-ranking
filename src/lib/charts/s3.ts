import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { revalidateTag, unstable_cache } from "next/cache";

export const bucketName =
  process.env.S3_BUCKET_NAME ||
  process.env.AWS_BUCKET_NAME ||
  process.env.S3_BUCKET ||
  "my-music-ranking";
const region = process.env.S3_REGION || "ap-northeast-2";
const parseIntOrDefault = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const PRIVATE_ARTIST_S3_CACHE_TTL_SECONDS = parseIntOrDefault(
  process.env.ARTIST_THUMBNAIL_S3_CACHE_TTL_SECONDS,
  14 * 24 * 60 * 60,
);
const PRIVATE_S3_CACHE_TAG = "artist-thumbnail-private-s3";

export const s3Client = new S3Client({ region });

export const buildPublicS3Url = (key: string): string =>
  `https://s3.${region}.amazonaws.com/${bucketName}/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const chartS3Keys = {
  rawWeek: (isoYear: number, isoWeek: number) =>
    `raw/${isoYear}/raw-week-${pad2(isoWeek)}.json`,
  weekly: (isoYear: number, isoWeek: number) =>
    `processed/weekly/${isoYear}/weekly-week-${pad2(isoWeek)}.json`,
  monthly: (year: number, month: number) =>
    `processed/monthly/${year}/monthly-month-${pad2(month)}.json`,
  yearly: (year: number) => `processed/yearly/yearly-${year}.json`,
  trackStats: () => "metadata/track-stats.json",
  trackStatsParquet: () => "metadata/track-stats.parquet",
};

const isNotFoundError = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.$metadata?.httpStatusCode === 404
  );
};

export const getJsonFromS3 = async <T>(key: string): Promise<T | null> => {
  try {
    const response = await fetch(buildPublicS3Url(key), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    if (response.status === 404) {
      return null;
    }
    if (response.status === 403) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        `S3 fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    const rawText = await response.text();
    if (!rawText) return null;

    return JSON.parse(rawText) as T;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
};

const getJsonFromPrivateS3Raw = async <T>(key: string): Promise<T | null> => {
  try {
    const result = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );

    const rawText = await result.Body?.transformToString();
    if (!rawText) return null;

    return JSON.parse(rawText) as T;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
};

const getJsonFromPrivateS3Cached = (key: string) =>
  unstable_cache(
    async () => getJsonFromPrivateS3Raw<unknown>(key),
    ["private-s3-json", key],
    {
      revalidate: PRIVATE_ARTIST_S3_CACHE_TTL_SECONDS,
      tags: [PRIVATE_S3_CACHE_TAG],
    },
  );

export const getJsonFromPrivateS3 = async <T>(
  key: string,
): Promise<T | null> => {
  const raw = await getJsonFromPrivateS3Cached(key)();
  return raw as T | null;
};

export const putJsonToS3 = async (
  key: string,
  data: unknown,
): Promise<void> => {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: "application/json",
    }),
  );
  revalidateTag(PRIVATE_S3_CACHE_TAG, { expire: 0 });
};
