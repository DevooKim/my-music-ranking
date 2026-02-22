import type { ChartResponse } from "@/lib/charts/types";
import { chartS3Keys, getJsonFromS3 } from "@/lib/charts/s3";

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
