import type { ChartType } from "@/lib/charts/types";

const pad2 = (value: number): string => String(value).padStart(2, "0");

type ChartTagPeriod =
  | { isoYear: number; isoWeek: number }
  | { year: number; month: number }
  | { year: number };

export const buildChartTags = (
  chartType: ChartType,
  period: ChartTagPeriod,
): string[] => {
  if (chartType === "weekly" && "isoYear" in period) {
    return [
      "chart",
      "chart:weekly",
      `chart:weekly:${period.isoYear}:${pad2(period.isoWeek)}`,
    ];
  }
  if (chartType === "monthly" && "month" in period) {
    return [
      "chart",
      "chart:monthly",
      `chart:monthly:${period.year}:${pad2(period.month)}`,
    ];
  }
  if (chartType === "yearly" && "year" in period && !("month" in period)) {
    return ["chart", "chart:yearly", `chart:yearly:${period.year}`];
  }
  throw new Error("Invalid chart tag period");
};

export const buildTrackStatsTags = (): string[] => [
  "chart",
  "chart:track-stats",
];

export const buildWeeklyArtistTags = (
  isoYear: number,
  isoWeek: number,
): string[] => [
  "chart",
  "chart:artist-weekly",
  `chart:artist-weekly:${isoYear}:${pad2(isoWeek)}`,
];
