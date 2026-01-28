import { deduplicatePlayedItems } from "../../lambda/shared/mapper";
import type { WeeklyPlayedData } from "../../lambda/shared/types";
import { putS3Json, s3Paths } from "../../lambda/shared/s3";
import { formatIsoWeekLabel } from "../utils/legacy";
import { fetchRawWeekData } from "../utils/raw-data";
import { getIsoWeekEndDate, getIsoWeekStartDate } from "../utils/iso-week";

interface CliOptions {
  isoYear: number;
  isoWeek: number;
  writeWeekly: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const isoYear = Number(getValue("--year"));
  const isoWeek = Number(getValue("--week"));
  const writeWeekly = args.includes("--write-weekly");

  if (!Number.isFinite(isoYear) || isoYear < 2000) {
    throw new Error("Missing or invalid --year");
  }

  if (!Number.isFinite(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    throw new Error("Missing or invalid --week");
  }

  return { isoYear, isoWeek, writeWeekly };
}

async function main(): Promise<void> {
  const { isoYear, isoWeek, writeWeekly } = parseArgs();
  const { keys, items } = await fetchRawWeekData(isoYear, isoWeek);

  if (keys.length === 0) {
    console.log(`No raw files found for ${formatIsoWeekLabel(isoYear, isoWeek)}`);
    return;
  }

  console.log(`Found ${keys.length} files for ${formatIsoWeekLabel(isoYear, isoWeek)}`);

  const deduped = deduplicatePlayedItems(items);
  const removed = items.length - deduped.length;

  console.log(`Total items: ${items.length}`);
  console.log(`Unique items: ${deduped.length}`);
  console.log(`Removed duplicates: ${removed}`);

  if (!writeWeekly) return;

  const start = getIsoWeekStartDate(isoYear, isoWeek);
  const end = getIsoWeekEndDate(isoYear, isoWeek);

  const weeklyData: WeeklyPlayedData = {
    isoYear,
    isoWeek,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    totalCount: deduped.length,
    items: deduped,
  };

  const weeklyKey = s3Paths.weekly(isoYear, isoWeek);
  await putS3Json(weeklyKey, weeklyData);
  console.log(`Saved weekly snapshot to ${weeklyKey}`);
}

main().catch((error) => {
  console.error("Week deduplication failed:", error);
  process.exit(1);
});
