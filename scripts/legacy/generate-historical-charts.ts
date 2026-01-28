import { deduplicatePlayedItems } from "../../lambda/shared/mapper";
import type { ChartResponse, TrackStats, WeeklyPlayedData } from "../../lambda/shared/types";
import { buildChart } from "../../lambda/shared/chart/builder";
import { getS3Json, putS3Json, s3Paths } from "../../lambda/shared/s3";
import { formatIsoWeekLabel } from "../utils/legacy";
import { fetchRawWeekData, listRawWeeks } from "../utils/raw-data";
import type { IsoWeekTuple } from "../utils/iso-week";
import { getIsoWeekEndDate, getIsoWeekStartDate, getPreviousIsoWeek } from "../utils/iso-week";

interface ParsedArgs {
  weekTokens?: string;
  year?: number;
  processAll: boolean;
  saveWeekly: boolean;
  limit?: number;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const weekTokens = getValue("--weeks");
  const yearValue = getValue("--year");
  const limitValue = getValue("--limit");

  return {
    weekTokens,
    year: yearValue ? Number(yearValue) : undefined,
    processAll: args.includes("--all"),
    saveWeekly: args.includes("--write-weekly"),
    limit: limitValue ? Number(limitValue) : undefined,
  };
}

function parseWeekList(token: string): IsoWeekTuple[] {
  const candidates = token.split(",").map((part) => part.trim()).filter(Boolean);
  const parsed: IsoWeekTuple[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const match = candidate.match(/^(\d{4})[-_/Ww]?(\d{1,2})$/);
    if (!match) {
      console.warn(`Ignoring invalid week token: ${candidate}`);
      continue;
    }

    const isoYear = Number(match[1]);
    const isoWeek = Number(match[2]);
    if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek) || isoWeek < 1 || isoWeek > 53) {
      console.warn(`Ignoring out-of-range week token: ${candidate}`);
      continue;
    }

    const key = `${isoYear}-${isoWeek}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ isoYear, isoWeek });
  }

  return parsed.sort((a, b) => (a.isoYear === b.isoYear ? a.isoWeek - b.isoWeek : a.isoYear - b.isoYear));
}

async function resolveWeeks(args: ParsedArgs): Promise<IsoWeekTuple[]> {
  if (args.weekTokens) {
    return parseWeekList(args.weekTokens);
  }

  if (args.year) {
    return listRawWeeks(args.year);
  }

  if (args.processAll) {
    return listRawWeeks();
  }

  throw new Error("Specify --weeks, --year, or --all to select target weeks");
}

async function loadLastChart(
  week: IsoWeekTuple,
  cache: Map<string, ChartResponse>,
): Promise<ChartResponse | null> {
  const previous = getPreviousIsoWeek(week.isoYear, week.isoWeek);
  if (!previous) return null;

  const label = formatIsoWeekLabel(previous.isoYear, previous.isoWeek);
  if (cache.has(label)) {
    return cache.get(label) ?? null;
  }

  const existing = await getS3Json<ChartResponse>(s3Paths.chartWeekly(previous.isoYear, previous.isoWeek));
  if (existing) {
    cache.set(label, existing);
    return existing;
  }

  return null;
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  const weeks = await resolveWeeks(parsed);

  if (weeks.length === 0) {
    console.log("No weeks to process.");
    return;
  }

  const limitedWeeks = parsed.limit && parsed.limit > 0 ? weeks.slice(0, parsed.limit) : weeks;
  console.log(`Processing weeks: ${limitedWeeks.map((week) => formatIsoWeekLabel(week.isoYear, week.isoWeek)).join(", ")}`);

  let trackStats = (await getS3Json<TrackStats>(s3Paths.trackStats())) ?? {};
  const chartCache = new Map<string, ChartResponse>();

  for (const week of limitedWeeks) {
    const { keys, items } = await fetchRawWeekData(week.isoYear, week.isoWeek);
    const label = formatIsoWeekLabel(week.isoYear, week.isoWeek);

    if (keys.length === 0) {
      console.log(`Skipping ${label}: no raw files found.`);
      continue;
    }

    const deduped = deduplicatePlayedItems(items);
    if (deduped.length === 0) {
      console.log(`Skipping ${label}: no plays after deduplication.`);
      continue;
    }

    const start = getIsoWeekStartDate(week.isoYear, week.isoWeek);
    const end = getIsoWeekEndDate(week.isoYear, week.isoWeek);

    const lastChart = await loadLastChart(week, chartCache);

    const { chart, updatedStats } = buildChart({
      items: deduped,
      chartType: "weekly",
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        label,
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
      },
      lastChart,
      trackStats,
    });

    trackStats = updatedStats;
    chartCache.set(label, chart);

    await putS3Json(s3Paths.chartWeekly(week.isoYear, week.isoWeek), chart);
    console.log(`✓ Saved weekly chart for ${label} (${deduped.length} plays)`);

    if (parsed.saveWeekly) {
      const weeklyPayload: WeeklyPlayedData = {
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalCount: deduped.length,
        items: deduped,
      };
      await putS3Json(s3Paths.weekly(week.isoYear, week.isoWeek), weeklyPayload);
      console.log(`  ↳ Saved weekly snapshot to ${s3Paths.weekly(week.isoYear, week.isoWeek)}`);
    }
  }

  await putS3Json(s3Paths.trackStats(), trackStats);
  console.log("Updated track stats store.");
}

main().catch((error) => {
  console.error("Failed to generate historical charts:", error);
  process.exit(1);
});
