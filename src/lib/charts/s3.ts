const bucketName =
  process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || "my-music-ranking";
const region =
  process.env.S3_REGION || "ap-northeast-2";

const buildPublicS3Url = (key: string): string =>
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

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`S3 fetch failed: ${response.status} ${response.statusText}`);
    }

    const rawText = await response.text();
    if (!rawText) return null;

    return JSON.parse(rawText) as T;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
};
