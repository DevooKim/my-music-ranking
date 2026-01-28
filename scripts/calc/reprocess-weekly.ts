import { deduplicatePlayedItems } from "../../lambda/shared/mapper";
import type { ChartResponse, TrackStats } from "../../lambda/shared/types";
import { buildChart } from "../../lambda/shared/chart/builder";
import { getS3Json, putS3Json, s3Paths } from "../../lambda/shared/s3";
import { formatIsoWeekLabel } from "../utils/legacy";
import { fetchRawWeekData, listRawWeeks } from "../utils/raw-data";
import type { IsoWeekTuple } from "../utils/iso-week";
import { getIsoWeekEndDate, getIsoWeekStartDate, getPreviousIsoWeek } from "../utils/iso-week";

interface ParsedArgs {
  weeks?: string[];
  year?: number;
  all: boolean;
  limit?: number;
  dryRun: boolean;
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
    weeks: weekTokens?.split(",").map(w => w.trim()),
    year: yearValue ? Number(yearValue) : undefined,
    all: args.includes("--all"),
    limit: limitValue ? Number(limitValue) : undefined,
    dryRun: args.includes("--dry-run"),
  };
}

function parseWeekList(tokens: string[]): IsoWeekTuple[] {
  const parsed: IsoWeekTuple[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const match = token.match(/^(\d{4})[-_/Ww]?(\d{1,2})$/);
    if (!match) {
      console.warn(`Invalid week token: ${token}`);
      continue;
    }

    const isoYear = Number(match[1]);
    const isoWeek = Number(match[2]);
    
    if (isoWeek < 1 || isoWeek > 53) {
      console.warn(`Out of range week: ${token}`);
      continue;
    }

    const key = `${isoYear}-${isoWeek}`;
    if (!seen.has(key)) {
      seen.add(key);
      parsed.push({ isoYear, isoWeek });
    }
  }

  return parsed.sort((a, b) => 
    a.isoYear === b.isoYear ? a.isoWeek - b.isoWeek : a.isoYear - b.isoYear
  );
}

async function resolveWeeks(args: ParsedArgs): Promise<IsoWeekTuple[]> {
  if (args.weeks) {
    return parseWeekList(args.weeks);
  }

  if (args.year) {
    return listRawWeeks(args.year);
  }

  if (args.all) {
    return listRawWeeks();
  }

  throw new Error("Specify --weeks, --year, or --all");
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

  const existing = await getS3Json<ChartResponse>(
    s3Paths.chartWeekly(previous.isoYear, previous.isoWeek)
  );
  
  if (existing) {
    cache.set(label, existing);
  }

  return existing;
}

async function main(): Promise<void> {
  console.log("=== Weekly Chart Reprocessing ===\n");
  
  const args = parseArgs();
  const weeks = await resolveWeeks(args);

  if (weeks.length === 0) {
    console.log("No weeks to process.");
    return;
  }

  // dry-run일 때는 자동으로 limit 3 적용
  const targetWeeks = args.dryRun 
    ? weeks.slice(0, 3)
    : args.limit && args.limit > 0 
      ? weeks.slice(0, args.limit) 
      : weeks;

  if (args.dryRun) {
    console.log("🔍 DRY RUN MODE - No data will be saved\n");
  }

  console.log(`Target weeks: ${targetWeeks.length}`);
  console.log(`Weeks: ${targetWeeks.map(w => formatIsoWeekLabel(w.isoYear, w.isoWeek)).join(", ")}\n`);

  let trackStats = await getS3Json<TrackStats>(s3Paths.trackStats()) ?? {};
  const chartCache = new Map<string, ChartResponse>();

  let processed = 0;
  let skipped = 0;

  for (const week of targetWeeks) {
    const label = formatIsoWeekLabel(week.isoYear, week.isoWeek);
    const { keys, items } = await fetchRawWeekData(week.isoYear, week.isoWeek);

    if (keys.length === 0) {
      console.log(`[SKIP] ${label}: No raw files`);
      skipped++;
      continue;
    }

    // 중복 제거 (타임스탬프 + trackId)
    const deduped = deduplicatePlayedItems(items);
    
    if (deduped.length === 0) {
      console.log(`[SKIP] ${label}: No plays after dedup`);
      skipped++;
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

    if (!args.dryRun) {
      await putS3Json(s3Paths.chartWeekly(week.isoYear, week.isoWeek), chart);
    }
    
    console.log(`[OK] ${label}: ${chart.items.length} tracks, ${deduped.length} plays (${items.length} raw)`);
    
    // dry-run일 때 상위 5개 트랙 출력
    if (args.dryRun) {
      console.log(`     Top 5 tracks:`);
      chart.items.slice(0, 5).forEach((item, idx) => {
        console.log(`       ${idx + 1}. ${item.trackName} - ${item.artistNames.join(", ")} (${item.playCount} plays)`);
      });
      console.log();
    }
    
    processed++;
  }

  if (!args.dryRun) {
    await putS3Json(s3Paths.trackStats(), trackStats);
  }

  console.log(`\n✅ Weekly reprocessing ${args.dryRun ? '(DRY RUN) ' : ''}complete`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${targetWeeks.length}`);
  
  if (args.dryRun) {
    console.log(`\n💡 Run without --dry-run to save changes to S3`);
  }
}

main().catch((error) => {
  console.error("❌ Failed:", error);
  process.exit(1);
});
