import { deduplicatePlayedItems } from "../../lambda/shared/mapper";
import type { ChartResponse, TrackStats, PlayedItem } from "../../lambda/shared/types";
import { buildChart } from "../../lambda/shared/chart/builder";
import { getS3Json, putS3Json, s3Paths } from "../../lambda/shared/s3";
import { fetchRawWeekData, listRawWeeks } from "../utils/raw-data";

interface MonthTuple {
  year: number;
  month: number;
}

interface ParsedArgs {
  months?: string[];
  year?: number;
  all: boolean;
  limit?: number;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const monthTokens = getValue("--months");
  const yearValue = getValue("--year");
  const limitValue = getValue("--limit");

  return {
    months: monthTokens?.split(",").map(m => m.trim()),
    year: yearValue ? Number(yearValue) : undefined,
    all: args.includes("--all"),
    limit: limitValue ? Number(limitValue) : undefined,
  };
}

function parseMonthList(tokens: string[]): MonthTuple[] {
  const parsed: MonthTuple[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const match = token.match(/^(\d{4})[-_/]?(\d{1,2})$/);
    if (!match) {
      console.warn(`Invalid month token: ${token}`);
      continue;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    
    if (month < 1 || month > 12) {
      console.warn(`Out of range month: ${token}`);
      continue;
    }

    const key = `${year}-${month}`;
    if (!seen.has(key)) {
      seen.add(key);
      parsed.push({ year, month });
    }
  }

  return parsed.sort((a, b) => 
    a.year === b.year ? a.month - b.month : a.year - b.year
  );
}

async function resolveMonths(args: ParsedArgs): Promise<MonthTuple[]> {
  if (args.months) {
    return parseMonthList(args.months);
  }

  const weeks = await listRawWeeks(args.year);
  const monthSet = new Set<string>();
  
  for (const week of weeks) {
    const date = new Date(week.isoYear, 0, 4 + (week.isoWeek - 1) * 7);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    monthSet.add(`${year}-${month}`);
  }

  return Array.from(monthSet)
    .map(key => {
      const [year, month] = key.split('-').map(Number);
      return { year, month };
    })
    .sort((a, b) => a.year === b.year ? a.month - b.month : a.year - b.year);
}

async function collectMonthData(year: number, month: number): Promise<PlayedItem[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  const weeks = await listRawWeeks(year);
  const allItems: PlayedItem[] = [];

  for (const week of weeks) {
    const { items } = await fetchRawWeekData(week.isoYear, week.isoWeek);
    
    // 해당 월의 데이터만 필터링
    const filtered = items.filter(item => {
      const playedDate = new Date(item.playedAt);
      return playedDate >= startDate && playedDate <= endDate;
    });

    allItems.push(...filtered);
  }

  return allItems;
}

async function loadLastChart(
  month: MonthTuple,
  cache: Map<string, ChartResponse>,
): Promise<ChartResponse | null> {
  let prevYear = month.year;
  let prevMonth = month.month - 1;
  
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear--;
  }

  const label = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  if (cache.has(label)) {
    return cache.get(label) ?? null;
  }

  const existing = await getS3Json<ChartResponse>(
    s3Paths.chartMonthly(prevYear, prevMonth)
  );
  
  if (existing) {
    cache.set(label, existing);
  }

  return existing;
}

async function main(): Promise<void> {
  console.log("=== Monthly Chart Reprocessing ===\n");
  
  const args = parseArgs();
  const months = await resolveMonths(args);

  if (months.length === 0) {
    console.log("No months to process.");
    return;
  }

  const targetMonths = args.limit && args.limit > 0 
    ? months.slice(0, args.limit) 
    : months;

  console.log(`Target months: ${targetMonths.length}`);
  console.log(`Months: ${targetMonths.map(m => `${m.year}-${String(m.month).padStart(2, '0')}`).join(", ")}\n`);

  let trackStats = await getS3Json<TrackStats>(s3Paths.trackStats()) ?? {};
  const chartCache = new Map<string, ChartResponse>();

  let processed = 0;
  let skipped = 0;

  for (const month of targetMonths) {
    const label = `${month.year}-${String(month.month).padStart(2, '0')}`;
    const items = await collectMonthData(month.year, month.month);

    if (items.length === 0) {
      console.log(`[SKIP] ${label}: No data`);
      skipped++;
      continue;
    }

    // 중복 제거
    const deduped = deduplicatePlayedItems(items);

    const startDate = new Date(month.year, month.month - 1, 1);
    const endDate = new Date(month.year, month.month, 0, 23, 59, 59, 999);
    const lastChart = await loadLastChart(month, chartCache);

    const { chart, updatedStats } = buildChart({
      items: deduped,
      chartType: "monthly",
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label,
        year: month.year,
        month: month.month,
      },
      lastChart,
      trackStats,
    });

    trackStats = updatedStats;
    chartCache.set(label, chart);

    await putS3Json(s3Paths.chartMonthly(month.year, month.month), chart);
    
    console.log(`[OK] ${label}: ${chart.items.length} tracks, ${deduped.length} plays (${items.length} raw)`);
    processed++;
  }

  await putS3Json(s3Paths.trackStats(), trackStats);

  console.log(`\n✅ Monthly reprocessing complete`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${targetMonths.length}`);
}

main().catch((error) => {
  console.error("❌ Failed:", error);
  process.exit(1);
});
