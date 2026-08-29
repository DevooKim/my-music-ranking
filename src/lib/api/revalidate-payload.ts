import {
  buildChartTags,
  buildTrackStatsTags,
  buildWeeklyArtistTags,
} from "@/lib/charts/chart-tags";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: string[],
): boolean => {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, i) => key === expected[i])
  );
};

const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

export const buildRevalidationTags = (payload: unknown): string[] | null => {
  if (!isRecord(payload) || typeof payload.kind !== "string") return null;

  if (payload.kind === "track-stats") {
    return hasOnlyKeys(payload, ["kind"]) ? buildTrackStatsTags() : null;
  }

  if (payload.kind === "weekly-artist") {
    if (
      !hasOnlyKeys(payload, ["kind", "isoYear", "isoWeek"]) ||
      !integer(payload.isoYear, 2000, 2500) ||
      !integer(payload.isoWeek, 1, 53)
    )
      return null;
    return buildWeeklyArtistTags(payload.isoYear, payload.isoWeek);
  }

  if (payload.kind !== "chart" || typeof payload.chartType !== "string")
    return null;

  if (payload.chartType === "weekly") {
    if (
      !hasOnlyKeys(payload, ["kind", "chartType", "isoYear", "isoWeek"]) ||
      !integer(payload.isoYear, 2000, 2500) ||
      !integer(payload.isoWeek, 1, 53)
    )
      return null;
    return buildChartTags("weekly", {
      isoYear: payload.isoYear,
      isoWeek: payload.isoWeek,
    });
  }
  if (payload.chartType === "monthly") {
    if (
      !hasOnlyKeys(payload, ["kind", "chartType", "year", "month"]) ||
      !integer(payload.year, 2000, 2500) ||
      !integer(payload.month, 1, 12)
    )
      return null;
    return buildChartTags("monthly", {
      year: payload.year,
      month: payload.month,
    });
  }
  if (payload.chartType === "yearly") {
    if (
      !hasOnlyKeys(payload, ["kind", "chartType", "year"]) ||
      !integer(payload.year, 2000, 2500)
    )
      return null;
    return buildChartTags("yearly", { year: payload.year });
  }
  return null;
};
