import { getISOWeek, getISOWeekYear } from "date-fns";
import type { LegacyKeyInfo } from "./utils/legacy";
import { formatIsoWeekLabel, parseLegacyKey } from "./utils/legacy";
import { BUCKET, DEFAULT_SAMPLE_SIZE, LEGACY_PREFIX } from "./utils/config";
import { getObjectBody, listAllKeys } from "./utils/s3";

interface LegacySpotifyData {
  items?: Array<{ played_at?: string }>;
}

interface SummarySampleEntry {
  key: string;
  itemCount: number;
  firstPlayedAt?: string;
  lastPlayedAt?: string;
}

function logHeader(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function infoFromKey(key: string): LegacyKeyInfo | null {
  const info = parseLegacyKey(key);
  if (!info) {
    console.warn(`Skipped key with unexpected format: ${key}`);
    return null;
  }
  return info;
}

async function loadSampleData(keys: string[], sampleSize: number): Promise<SummarySampleEntry[]> {
  const sample: SummarySampleEntry[] = [];

  for (const key of keys.slice(0, sampleSize)) {
    const body = await getObjectBody(key);
    if (!body) continue;

    const data: LegacySpotifyData = JSON.parse(body);
    const played = data.items ?? [];
    sample.push({
      key,
      itemCount: played.length,
      firstPlayedAt: played[0]?.played_at,
      lastPlayedAt: played[played.length - 1]?.played_at,
    });
  }

  return sample;
}

async function countTracks(keys: string[]): Promise<number> {
  let total = 0;
  for (const key of keys) {
    const body = await getObjectBody(key);
    if (!body) continue;
    const data: LegacySpotifyData = JSON.parse(body);
    total += data.items?.length ?? 0;
  }
  return total;
}

function parseArgs(): { sampleSize: number; includeTrackCount: boolean } {
  const args = process.argv.slice(2);
  const sampleFlagIndex = args.findIndex((arg) => arg === "--sample");
  const sampleSize = sampleFlagIndex >= 0 ? Number(args[sampleFlagIndex + 1]) : DEFAULT_SAMPLE_SIZE;
  const includeTrackCount = args.includes("--count-tracks");

  return {
    sampleSize: Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : DEFAULT_SAMPLE_SIZE,
    includeTrackCount,
  };
}

async function analyzeLegacyData(): Promise<void> {
  const { sampleSize, includeTrackCount } = parseArgs();

  logHeader("Legacy Data Analysis");
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Prefix: ${LEGACY_PREFIX}`);

  const keys = await listAllKeys(LEGACY_PREFIX);
  if (keys.length === 0) {
    console.log("No legacy files found.");
    return;
  }

  keys.sort((a, b) => a.localeCompare(b));

  let earliest: Date | null = null;
  let latest: Date | null = null;
  const weekCoverage = new Map<string, number>();

  for (const key of keys) {
    const info = infoFromKey(key);
    if (!info) continue;

    const date = new Date(Date.UTC(info.year, info.month - 1, info.day, info.hour));

    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;

    const isoYear = getISOWeekYear(date);
    const isoWeek = getISOWeek(date);
    const label = formatIsoWeekLabel(isoYear, isoWeek);

    weekCoverage.set(label, (weekCoverage.get(label) ?? 0) + 1);
  }

  console.log(`\nFound ${keys.length} files.`);
  console.log(`Date range: ${earliest?.toISOString() ?? "N/A"} -> ${latest?.toISOString() ?? "N/A"}`);
  console.log(`Week coverage: ${weekCoverage.size} unique weeks.`);

  const sortedCoverage = Array.from(weekCoverage.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [label, count] of sortedCoverage) {
    console.log(`  ${label}: ${count} files`);
  }

  const sampleData = await loadSampleData(keys, sampleSize);
  logHeader(`Sample (${sampleData.length})`);
  sampleData.forEach((sample) => {
    console.log(`- ${sample.key}: ${sample.itemCount} items (${sample.firstPlayedAt} .. ${sample.lastPlayedAt})`);
  });

  if (includeTrackCount) {
    logHeader("Counting tracks (this may take a while)");
    const totalTracks = await countTracks(keys);
    console.log(`Total tracks across all files: ${totalTracks}`);
  }
}

analyzeLegacyData().catch((error) => {
  console.error("Failed to analyze legacy data:", error);
  process.exit(1);
});
