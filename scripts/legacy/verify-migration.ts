import type { RawPlayedData } from "../../lambda/shared/types";
import { formatIsoWeekLabel, normalizedRawPrefix } from "../utils/legacy";
import { LEGACY_PREFIX, DEFAULT_SAMPLE_SIZE } from "../utils/config";
import { getObjectBody, listAllKeys } from "../utils/s3";

interface CliOptions {
  sampleSize: number;
  compareLegacy: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const sampleValue = getValue("--sample");
  const sampleSize = sampleValue ? Number(sampleValue) : DEFAULT_SAMPLE_SIZE;

  return {
    sampleSize: Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : DEFAULT_SAMPLE_SIZE,
    compareLegacy: args.includes("--compare-legacy"),
  };
}

function parseRawWeekKey(key: string, rawPrefix: string): string | null {
  if (!key.startsWith(rawPrefix)) return null;
  const remainder = key.slice(rawPrefix.length);
  const [yearStr, weekStr] = remainder.split("/");
  if (!yearStr || !weekStr) return null;
  const isoYear = Number(yearStr);
  const isoWeek = Number(weekStr);
  if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek)) return null;
  return formatIsoWeekLabel(isoYear, isoWeek);
}

async function loadSamples(keys: string[], sampleSize: number): Promise<RawPlayedData[]> {
  const samples: RawPlayedData[] = [];
  for (const key of keys.slice(0, sampleSize)) {
    const body = await getObjectBody(key);
    if (!body) continue;
    const payload: RawPlayedData = JSON.parse(body);
    samples.push(payload);
  }
  return samples;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const rawPrefix = normalizedRawPrefix();

  console.log("Verifying migrated raw data...");
  const rawKeys = await listAllKeys(rawPrefix);
  rawKeys.sort((a, b) => a.localeCompare(b));

  if (rawKeys.length === 0) {
    console.log("No migrated files found under played/raw.");
    return;
  }

  const weekCoverage = new Map<string, number>();
  for (const key of rawKeys) {
    const weekLabel = parseRawWeekKey(key, rawPrefix);
    if (!weekLabel) continue;
    weekCoverage.set(weekLabel, (weekCoverage.get(weekLabel) ?? 0) + 1);
  }

  console.log(`Total migrated files: ${rawKeys.length}`);
  console.log(`Covered weeks: ${weekCoverage.size}`);

  for (const [week, count] of Array.from(weekCoverage.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${week}: ${count} files`);
  }

  const samples = await loadSamples(rawKeys, options.sampleSize);
  if (samples.length > 0) {
    const timestamps = samples
      .map((sample) => sample.collectedAt)
      .filter(Boolean)
      .map((value) => new Date(value));
    const earliest = timestamps.reduce((min, date) => (min && min < date ? min : date), timestamps[0]);
    const latest = timestamps.reduce((max, date) => (max && max > date ? max : date), timestamps[0]);

    console.log(`\nSample (${samples.length} files):`);
    samples.forEach((sample) => {
      const weekLabel = formatIsoWeekLabel(sample.isoYear, sample.isoWeek);
      console.log(`- ${weekLabel} collectedAt=${sample.collectedAt} items=${sample.items?.length ?? 0}`);
    });

    if (earliest && latest) {
      console.log(`CollectedAt range: ${earliest.toISOString()} -> ${latest.toISOString()}`);
    }
  }

  if (options.compareLegacy) {
    console.log("\nComparing with legacy prefix...");
    const legacyKeys = await listAllKeys(LEGACY_PREFIX);
    console.log(`Legacy files: ${legacyKeys.length}`);
    const delta = rawKeys.length - legacyKeys.length;
    console.log(`Difference: ${delta >= 0 ? "+" : ""}${delta}`);
  }
}

main().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
