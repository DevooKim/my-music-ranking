import { addMonths, addWeeks, addYears, eachWeekOfInterval, endOfISOWeek, endOfMonth, endOfYear, getISOWeek, getISOWeekYear, startOfISOWeek, startOfMonth, startOfYear, subMonths } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { buildChart } from "../shared/chart";
import { listS3Keys, getS3Json, putS3Json, s3Paths } from "../shared/s3";
import { getTrackStats, putTrackStats } from "../shared/track-stats-storage";
import type { ChartResponse, PlayedItem, RawPlayedData, TrackStats } from "../shared/types";

const KOREA_TIMEZONE = "Asia/Seoul";
const DEFAULT_START_WEEK = { isoYear: 2025, isoWeek: 38 };
const RAW_WEEK_KEY_RE = /^raw\/(\d{4})\/raw-week-(\d{2})\.json$/;

interface WeekPoint {
  isoYear: number;
  isoWeek: number;
}

type Scope = "weekly" | "monthly" | "yearly" | "all";

interface RebuildOptions {
  start: WeekPoint;
  end?: WeekPoint;
  scope: Scope;
  dryRun: boolean;
  resetTrackStats: boolean;
  listRawOnly: boolean;
  trackStatsFormat: "json" | "parquet" | "both";
}

function printHelp(): void {
  console.log(`
Usage:
  bun run lambda/tools/rebuild-processed.ts [options]

Options:
  --from <YYYY-Www>       시작 주차 지정 (기본: ${formatWeek(DEFAULT_START_WEEK)})
  --to <YYYY-Www>         종료 주차 지정 (기본: S3 raw에서 감지한 마지막 주차)
  --scope <weekly|monthly|yearly|all>  처리 범위 (기본: all)
  --track-stats-format <json|parquet|both>  track-stats 저장 포맷 (기본: both)
  --dry-run               실제 S3 쓰기 없이 동작만 확인
  --no-reset-track-stats  기존 track-stats.json을 유지하면서 재계산
  --list-raw-weeks        처리 가능한 raw 주차 목록만 출력 후 종료
`);
}

function parseWeekInput(input: string): WeekPoint {
  const match = input.trim().match(/^(\d{4})-W?(\d{1,2})$/i);

  if (!match) {
    throw new Error(`Invalid week format: ${input}`);
  }

  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);

  if (!Number.isInteger(isoYear) || !Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    throw new Error(`Invalid week value: ${input}`);
  }

  return { isoYear, isoWeek };
}

function parseArgs(argv: string[]): RebuildOptions {
  const options: RebuildOptions = {
    start: DEFAULT_START_WEEK,
    scope: "all",
    dryRun: false,
    resetTrackStats: true,
    listRawOnly: false,
    trackStatsFormat: "both",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      case "--from": {
        const value = argv[index + 1];
        if (!value) throw new Error("--from requires a value");
        options.start = parseWeekInput(value);
        index += 1;
        break;
      }
      case "--to": {
        const value = argv[index + 1];
        if (!value) throw new Error("--to requires a value");
        options.end = parseWeekInput(value);
        index += 1;
        break;
      }
      case "--scope": {
        const value = argv[index + 1];
        if (!value || (value !== "weekly" && value !== "monthly" && value !== "yearly" && value !== "all")) {
          throw new Error("--scope must be weekly | monthly | yearly | all");
        }
        options.scope = value as Scope;
        index += 1;
        break;
      }
      case "--track-stats-format": {
        const value = argv[index + 1];
        if (!value || (value !== "json" && value !== "parquet" && value !== "both")) {
          throw new Error("--track-stats-format must be json | parquet | both");
        }
        options.trackStatsFormat = value;
        index += 1;
        break;
      }
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--no-reset-track-stats":
        options.resetTrackStats = false;
        break;
      case "--list-raw-weeks":
        options.listRawOnly = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function compareWeek(a: WeekPoint, b: WeekPoint): number {
  if (a.isoYear !== b.isoYear) return a.isoYear - b.isoYear;
  return a.isoWeek - b.isoWeek;
}

function formatWeek(point: WeekPoint): string {
  return `${point.isoYear}-W${String(point.isoWeek).padStart(2, "0")}`;
}

function getWeekRange(isoYear: number, isoWeek: number): { start: Date; end: Date } {
  const jan4 = new Date(isoYear, 0, 4);
  const startOfYear = startOfISOWeek(jan4);
  const start = new Date(startOfYear);
  start.setDate(start.getDate() + (isoWeek - 1) * 7);

  const end = endOfISOWeek(start);
  return { start, end };
}

function getWeekKeyFromDate(date: Date): WeekPoint {
  return { isoYear: getISOWeekYear(date), isoWeek: getISOWeek(date) };
}

async function listRawWeeks(): Promise<WeekPoint[]> {
  const keys = await listS3Keys("raw/");
  const weeks = new Map<string, WeekPoint>();

  for (const key of keys) {
    const match = key.match(RAW_WEEK_KEY_RE);
    if (!match) continue;

    const isoYear = Number(match[1]);
    const isoWeek = Number(match[2]);
    const point = { isoYear, isoWeek };

    weeks.set(formatWeek(point), point);
  }

  return [...weeks.values()].sort(compareWeek);
}

function toKstDate(value: string): Date {
  return new TZDate(value, KOREA_TIMEZONE);
}

function isCurrentWeek(target: WeekPoint, current: WeekPoint): boolean {
  return target.isoYear === current.isoYear && target.isoWeek === current.isoWeek;
}

function isCurrentMonth(target: Date, current: Date): boolean {
  return target.getFullYear() === current.getFullYear() && target.getMonth() === current.getMonth();
}

function isCurrentYear(targetYear: number, current: Date): boolean {
  return targetYear === current.getFullYear();
}

const REENTRY_LOOKBACK_WEEKS = 4;

async function getRecentTrackIdsFromPreviousWeeks(
  current: WeekPoint,
  previousCache: Map<string, ChartResponse | null>,
): Promise<Set<string>> {
  const recentTrackIds = new Set<string>();
  let cursor = getPreviousWeek(current);

  for (let step = 0; step < REENTRY_LOOKBACK_WEEKS; step += 1) {
    const previousKey = formatWeek(cursor);
    const cached = previousCache.get(previousKey);
    const previous = cached === undefined
      ? await getS3Json<ChartResponse>(
          s3Paths.weeklyProcessed(cursor.isoYear, cursor.isoWeek),
        )
      : cached;

    if (cached === undefined) {
      previousCache.set(previousKey, previous);
    }

    if (previous?.items?.length) {
      for (const item of previous.items) {
        recentTrackIds.add(item.trackId);
      }
    }

    cursor = getPreviousWeek(cursor);
  }

  return recentTrackIds;
}

async function rebuildWeeklyRange(
  start: WeekPoint,
  end: WeekPoint,
  trackStats: TrackStats,
  currentDate: Date,
  dryRun: boolean,
): Promise<TrackStats> {
  let cursor = getWeekRange(start.isoYear, start.isoWeek).start;
  const endDate = getWeekRange(end.isoYear, end.isoWeek).start;
  const currentWeek = getWeekKeyFromDate(currentDate);

  const previousCache = new Map<string, ChartResponse | null>();
  let currentStats = { ...trackStats };
  let processed = 0;

  while (cursor.getTime() <= endDate.getTime()) {
    const current = getWeekKeyFromDate(cursor);
    const keyLabel = formatWeek(current);
    if (isCurrentWeek(current, currentWeek)) {
      console.log(`[SKIP] weekly ${keyLabel}: current week excluded`);
      cursor = addWeeks(cursor, 1);
      continue;
    }

    const rawKey = s3Paths.raw(current.isoYear, current.isoWeek);
    const raw = await getS3Json<RawPlayedData>(rawKey);

    if (!raw || !raw.items || raw.items.length === 0) {
      console.log(`[SKIP] weekly ${keyLabel}: raw missing or empty`);
      cursor = addWeeks(cursor, 1);
      continue;
    }

    const weekRange = getWeekRange(current.isoYear, current.isoWeek);

    const previous = getPreviousWeek(current);
    const previousKey = formatWeek(previous);
    const lastChart = previousCache.has(previousKey)
      ? previousCache.get(previousKey) ?? null
      : await getS3Json<ChartResponse>(
          s3Paths.weeklyProcessed(previous.isoYear, previous.isoWeek),
        );
    const recentlySeenTrackIds = await getRecentTrackIdsFromPreviousWeeks(
      current,
      previousCache,
    );

    const { chart, updatedStats } = buildChart({
      items: raw.items as PlayedItem[],
      chartType: "weekly",
      period: {
        start: weekRange.start.toISOString(),
        end: weekRange.end.toISOString(),
        label: keyLabel,
        isoYear: current.isoYear,
        isoWeek: current.isoWeek,
      },
      lastChart,
      recentlySeenTrackIds,
      trackStats: currentStats,
    });

    if (!dryRun) {
      await putS3Json(s3Paths.weeklyProcessed(current.isoYear, current.isoWeek), chart);
    }

    previousCache.set(keyLabel, chart);
    currentStats = updatedStats;
    processed += 1;

    console.log(`[OK] weekly ${keyLabel}: ${chart.items.length} items`);
    cursor = addWeeks(cursor, 1);
  }

  console.log(`[DONE] weekly range processed: ${processed}`);
  return currentStats;
}

function getPreviousWeek(current: WeekPoint): WeekPoint {
  const previousDate = addWeeks(getWeekRange(current.isoYear, current.isoWeek).start, -1);
  return getWeekKeyFromDate(previousDate);
}

async function rebuildMonthlyRange(
  start: WeekPoint,
  end: WeekPoint,
  trackStats: TrackStats,
  currentDate: Date,
  dryRun: boolean,
): Promise<TrackStats> {
  const startDate = startOfMonth(getWeekRange(start.isoYear, start.isoWeek).start);
  const endDate = startOfMonth(getWeekRange(end.isoYear, end.isoWeek).start);

  let current = startDate;
  const previousCache = new Map<string, ChartResponse | null>();
  let currentStats = { ...trackStats };
  let processed = 0;

  while (current.getTime() <= endDate.getTime()) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
    if (isCurrentMonth(current, currentDate)) {
      console.log(`[SKIP] monthly ${monthLabel}: current month excluded`);
      current = addMonths(current, 1);
      continue;
    }

    const startAt = startOfMonth(current);
    const endAt = endOfMonth(current);
    const weeks = eachWeekOfInterval({ start: startAt, end: endAt }, { weekStartsOn: 1 });

    const allItems: PlayedItem[] = [];

    for (const weekStart of weeks) {
      const weekPoint = getWeekKeyFromDate(weekStart);
      const raw = await getS3Json<RawPlayedData>(s3Paths.raw(weekPoint.isoYear, weekPoint.isoWeek));
      if (!raw?.items?.length) {
        continue;
      }

      for (const item of raw.items) {
        const playedAt = toKstDate(item.playedAt);
        if (playedAt >= startAt && playedAt <= endAt) {
          allItems.push(item);
        }
      }
    }

    if (allItems.length === 0) {
      console.log(`[SKIP] monthly ${monthLabel}: no raw records`);
      current = addMonths(current, 1);
      continue;
    }

    const previousMonth = subMonths(current, 1);
    const previousLabel = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
    const lastChart = previousCache.get(previousLabel)
      ?? (await getS3Json<ChartResponse>(s3Paths.monthlyProcessed(previousMonth.getFullYear(), previousMonth.getMonth() + 1)));

    const { chart, updatedStats } = buildChart({
      items: allItems,
      chartType: "monthly",
      period: {
        start: startAt.toISOString(),
        end: endAt.toISOString(),
        label: monthLabel,
        year,
        month,
      },
      lastChart,
      trackStats: currentStats,
    });

    if (!dryRun) {
      await putS3Json(s3Paths.monthlyProcessed(year, month), chart);
    }

    previousCache.set(monthLabel, chart);
    currentStats = updatedStats;
    processed += 1;

    console.log(`[OK] monthly ${monthLabel}: ${chart.items.length} items`);
    current = addMonths(current, 1);
  }

  console.log(`[DONE] monthly range processed: ${processed}`);
  return currentStats;
}

async function rebuildYearlyRange(
  start: WeekPoint,
  end: WeekPoint,
  trackStats: TrackStats,
  currentDate: Date,
  dryRun: boolean,
): Promise<TrackStats> {
  let current = startOfYear(getWeekRange(start.isoYear, start.isoWeek).start);
  const endDate = startOfYear(getWeekRange(end.isoYear, end.isoWeek).start);

  const previousCache = new Map<number, ChartResponse | null>();
  let currentStats = { ...trackStats };
  let processed = 0;

  while (current.getTime() <= endDate.getTime()) {
    const year = current.getFullYear();
    const yearLabel = `${year}`;

    if (isCurrentYear(year, currentDate)) {
      console.log(`[SKIP] yearly ${yearLabel}: current year excluded`);
      current = addYears(current, 1);
      continue;
    }

    const startAt = startOfYear(current);
    const endAt = endOfYear(current);
    const weeks = eachWeekOfInterval({ start: startAt, end: endAt }, { weekStartsOn: 1 });
    const allItems: PlayedItem[] = [];

    for (const weekStart of weeks) {
      const weekPoint = getWeekKeyFromDate(weekStart);
      const raw = await getS3Json<RawPlayedData>(s3Paths.raw(weekPoint.isoYear, weekPoint.isoWeek));
      if (!raw?.items?.length) {
        continue;
      }

      for (const item of raw.items) {
        const playedAt = toKstDate(item.playedAt);
        if (playedAt >= startAt && playedAt <= endAt) {
          allItems.push(item);
        }
      }
    }

    if (allItems.length === 0) {
      console.log(`[SKIP] yearly ${yearLabel}: no raw records`);
      current = addYears(current, 1);
      continue;
    }

    const previousYear = year - 1;
    const cached = previousCache.get(previousYear);
    const lastChart = cached === undefined
      ? await getS3Json<ChartResponse>(s3Paths.yearlyProcessed(previousYear))
      : cached;
    if (cached === undefined) {
      previousCache.set(previousYear, lastChart);
    }

    const { chart, updatedStats } = buildChart({
      items: allItems,
      chartType: "yearly",
      period: {
        start: startAt.toISOString(),
        end: endAt.toISOString(),
        label: yearLabel,
        year,
      },
      lastChart,
      trackStats: currentStats,
    });

    const chartWithoutEntryStatus: typeof chart = {
      ...chart,
      items: chart.items.map((item) => ({ ...item, entryStatus: null })),
    };

    if (!dryRun) {
      await putS3Json(s3Paths.yearlyProcessed(year), chartWithoutEntryStatus);
    }

    previousCache.set(year, chart);
    currentStats = updatedStats;
    processed += 1;

    console.log(`[OK] yearly ${yearLabel}: ${chart.items.length} items`);
    current = addYears(current, 1);
  }

  console.log(`[DONE] yearly range processed: ${processed}`);
  return currentStats;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const availableRawWeeks = await listRawWeeks();

  if (options.listRawOnly) {
    console.log("[INFO] raw weeks:");
    for (const week of availableRawWeeks) {
      console.log(`- ${formatWeek(week)}`);
    }
    return;
  }

  if (availableRawWeeks.length === 0) {
    console.log("[WARN] raw data not found under raw/ prefix");
    return;
  }

  const defaultEnd = availableRawWeeks[availableRawWeeks.length - 1];
  const start = options.start;
  const end = options.end ?? defaultEnd;

  if (compareWeek(start, end) > 0) {
    throw new Error(`Invalid range: start(${formatWeek(start)}) > end(${formatWeek(end)})`);
  }

  if (compareWeek(start, defaultEnd) > 0) {
    console.log(`[INFO] requested start=${formatWeek(start)} is newer than last raw=${formatWeek(defaultEnd)}.`);
    return;
  }

  const lastTrackStatsResult = await getTrackStats({
    storageFormats: options.trackStatsFormat,
    readPreference: options.trackStatsFormat === "json" ? "json" : "parquet",
  });
  const lastTrackStats = lastTrackStatsResult.data;
  let trackStats: TrackStats = options.resetTrackStats ? {} : { ...lastTrackStats };

  if (options.resetTrackStats && !options.dryRun) {
    const backupKey = `metadata/track-stats.rebuild-backup-${new Date().toISOString()}.json`;
    await putS3Json(backupKey, lastTrackStats);
    console.log(`[INFO] track-stats backup: ${backupKey}`);
  }

  const currentDate = toKstDate(new Date().toISOString());

  console.log("[INFO] rebuild options:");
  console.log(`- scope: ${options.scope}`);
  console.log(`- start: ${formatWeek(start)}`);
  console.log(`- end: ${formatWeek(end)}`);
  console.log(`- dryRun: ${options.dryRun ? "true" : "false"}`);
  console.log(`- resetTrackStats: ${options.resetTrackStats ? "true" : "false"}`);
  console.log(`- trackStatsFormat: ${options.trackStatsFormat}`);

  if (options.scope === "weekly" || options.scope === "all") {
    trackStats = await rebuildWeeklyRange(start, end, trackStats, currentDate, options.dryRun);
  }

  if (options.scope === "monthly" || options.scope === "all") {
    trackStats = await rebuildMonthlyRange(start, end, trackStats, currentDate, options.dryRun);
  }

  if (options.scope === "yearly" || options.scope === "all") {
    trackStats = await rebuildYearlyRange(start, end, trackStats, currentDate, options.dryRun);
  }

  if (!options.dryRun) {
    const writeResult = await putTrackStats(trackStats, {
      storageFormats: options.trackStatsFormat,
      readPreference: options.trackStatsFormat === "json" ? "json" : "parquet",
    });
    console.log(`[INFO] updated track-stats (${writeResult.wroteJson ? "json" : ""}${writeResult.wroteParquet ? `${writeResult.wroteJson ? "/" : ""}parquet` : ""})`);
    if (writeResult.partialFailure) {
      console.log(`[WARN] partial track-stats write: ${writeResult.warnings.join("; ")}`);
    }
  } else {
    console.log("[INFO] dry-run mode: track-stats.json write skipped");
  }

  console.log("[DONE] rebuild finished");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[ERROR] rebuild failed:", message);
  process.exit(1);
});
