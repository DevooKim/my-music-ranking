import type { ChartResponse } from "@/lib/charts/types";
import { chartS3Keys, getJsonFromS3 } from "@/lib/charts/s3";

interface RawPlayedItem {
  trackId?: string;
  trackName?: string;
  albumId?: string;
  albumName?: string;
  albumImageUrl?: string;
  artistIds?: unknown;
  artistNames?: unknown;
  durationMs?: unknown;
}

interface RawWeeklyData {
  isoYear?: unknown;
  isoWeek?: unknown;
  items?: unknown;
}

const isRawWeeklyData = (value: unknown): value is RawWeeklyData => {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as RawWeeklyData).items)
  );
};

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isRawPlayedItem = (value: unknown): value is RawPlayedItem => {
  if (!value || typeof value !== "object") return false;

  const item = value as RawPlayedItem;

  return isNonEmptyString(item.trackId) && isNonEmptyString(item.trackName);
};

const isChartResponse = (value: unknown): value is ChartResponse => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    type?: unknown;
    period?: unknown;
    generatedAt?: unknown;
    items?: unknown;
  };

  return (
    (candidate.type === "weekly" || candidate.type === "monthly" || candidate.type === "yearly") &&
    !!candidate.period &&
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.items)
  );
};

export const getWeeklyChartFromS3 = async (
  isoYear: number,
  isoWeek: number,
): Promise<ChartResponse | null> => {
  const raw = await getJsonFromS3<unknown>(chartS3Keys.weekly(isoYear, isoWeek));
  if (!raw || !isChartResponse(raw)) return null;
  return raw;
};

export const getWeeklyRawChartFromS3 = async (
  isoYear: number,
  isoWeek: number,
): Promise<RawPlayedDataLike | null> => {
  const raw = await getJsonFromS3<unknown>(chartS3Keys.rawWeek(isoYear, isoWeek));
  if (!raw || !isRawWeeklyData(raw) || !Array.isArray(raw.items)) return null;

  const parsed = raw.items
    .filter(isRawPlayedItem)
    .map((item) => ({ ...item }));

  return {
    ...(isNonEmptyString(raw.isoYear?.toString()) ? { isoYear: raw.isoYear } : {}),
    ...(isNonEmptyString(raw.isoWeek?.toString()) ? { isoWeek: raw.isoWeek } : {}),
    items: parsed,
  };
};

export type RawPlayedDataLike = {
  isoYear?: unknown;
  isoWeek?: unknown;
  items: RawPlayedItem[];
};

export const getMonthlyChartFromS3 = async (
  year: number,
  month: number,
): Promise<ChartResponse | null> => {
  const raw = await getJsonFromS3<unknown>(chartS3Keys.monthly(year, month));
  if (!raw || !isChartResponse(raw)) return null;
  return raw;
};

export const getYearlyChartFromS3 = async (year: number): Promise<ChartResponse | null> => {
  const raw = await getJsonFromS3<unknown>(chartS3Keys.yearly(year));
  if (!raw || !isChartResponse(raw)) return null;
  return raw;
};
