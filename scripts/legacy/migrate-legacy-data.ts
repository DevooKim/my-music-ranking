import { parseISO, isValid, getISOWeek, getISOWeekYear } from "date-fns";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { deduplicatePlayedItems } from "../../lambda/shared/mapper";
import type { PlayedItem, RawPlayedData } from "../../lambda/shared/types";
import { formatIsoWeekLabel, parseLegacyKey, buildRawObjectKey } from "../utils/legacy";
import { decodeLegacyJson } from "../utils/encoding";
import { BUCKET, DEFAULT_CONCURRENCY, LEGACY_PREFIX } from "../utils/config";
import { getObjectBuffer, listAllKeys, s3Client } from "../utils/s3";
import { fetchTrackMetadataByIsrc } from "../utils/spotify";

interface LegacySpotifyItem {
  track: {
    id: string;
    name: string;
    album: {
      id: string;
      name: string;
      images?: { url: string }[];
      total_tracks?: number;
      external_urls?: { spotify?: string };
    };
    artists: { id: string; name: string; external_urls?: { spotify?: string } }[];
    duration_ms: number;
    disc_number?: number;
    track_number?: number;
    external_ids?: {
      isrc?: string;
    };
    external_urls?: { spotify?: string };
  };
  played_at: string;
}

interface LegacySpotifyData {
  items: LegacySpotifyItem[];
}

interface TransformResult {
  newData: RawPlayedData;
  destinationKey: string;
  originalCount: number;
  dedupedCount: number;
}

interface CliOptions {
  dryRun: boolean;
  migrate: boolean;
  limit?: number;
  concurrency: number;
  prefix: string;
}

const toExternalUrls = (url?: string | null) => ({
  spotify: url ?? null,
});

const toExternalIds = (isrc?: string | null) => ({
  isrc: isrc ?? null,
});

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const dryRun = args.includes("--dry-run");
  const migrate = args.includes("--migrate");
  const limitValue = getValue("--limit");
  const limit = limitValue ? Number(limitValue) : undefined;
  const concurrencyValue = getValue("--concurrency");
  const concurrency = concurrencyValue ? Number(concurrencyValue) : DEFAULT_CONCURRENCY;
  const prefix = getValue("--prefix") ?? LEGACY_PREFIX;

  return {
    dryRun,
    migrate,
    limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY,
    prefix,
  };
}

async function mapLegacyItem(item: LegacySpotifyItem): Promise<PlayedItem> {
  const albumExternalUrl = item.track.album.external_urls?.spotify ?? null;
  const artistExternalUrls = item.track.artists.map((artist) => toExternalUrls(artist.external_urls?.spotify));

  const base: PlayedItem = {
    trackId: item.track.id,
    trackName: item.track.name,
    albumId: item.track.album.id,
    albumName: item.track.album.name,
    albumImageUrl: item.track.album.images?.[0]?.url ?? "",
    albumTotalTracks: item.track.album.total_tracks ?? 0,
    albumExternalUrls: toExternalUrls(albumExternalUrl),
    artistIds: item.track.artists.map((artist) => artist.id),
    artistNames: item.track.artists.map((artist) => artist.name),
    artistExternalUrls,
    trackExternalUrls: toExternalUrls(item.track.external_urls?.spotify),
    trackExternalIds: toExternalIds(item.track.external_ids?.isrc ?? null),
    discNumber: item.track.disc_number ?? 0,
    trackNumber: item.track.track_number ?? 0,
    playedAt: item.played_at,
    durationMs: item.track.duration_ms,
  };

  const isrc = item.track.external_ids?.isrc;
  if (!isrc) {
    return base;
  }

  const enriched = await fetchTrackMetadataByIsrc(isrc);
  if (!enriched) {
    return base;
  }

  return {
    ...base,
    trackName: enriched.trackName || base.trackName,
    albumName: enriched.albumName || base.albumName,
    albumId: enriched.albumId || base.albumId,
    albumImageUrl: enriched.albumImageUrl || base.albumImageUrl,
    albumTotalTracks: enriched.albumTotalTracks ?? base.albumTotalTracks,
    albumExternalUrls: enriched.albumExternalUrl
      ? toExternalUrls(enriched.albumExternalUrl)
      : base.albumExternalUrls,
    artistIds: enriched.artistIds.length > 0 ? enriched.artistIds : base.artistIds,
    artistNames: enriched.artistNames.length > 0 ? enriched.artistNames : base.artistNames,
    artistExternalUrls:
      enriched.artistExternalUrls && enriched.artistExternalUrls.length > 0
        ? enriched.artistExternalUrls.map((url) => toExternalUrls(url))
        : base.artistExternalUrls,
    trackExternalUrls: enriched.trackExternalUrl
      ? toExternalUrls(enriched.trackExternalUrl)
      : base.trackExternalUrls,
    trackExternalIds: enriched.trackExternalIds
      ? toExternalIds(enriched.trackExternalIds)
      : base.trackExternalIds,
    discNumber: enriched.discNumber ?? base.discNumber,
    trackNumber: enriched.trackNumber ?? base.trackNumber,
  };
}

async function buildItems(legacyItems: LegacySpotifyItem[]): Promise<PlayedItem[]> {
  const result: PlayedItem[] = [];
  for (const legacyItem of legacyItems) {
    result.push(await mapLegacyItem(legacyItem));
  }
  return result;
}

async function transformLegacyFile(key: string): Promise<TransformResult | null> {
  const info = parseLegacyKey(key);
  if (!info) {
    console.warn(`Skipping unmatched file name: ${key}`);
    return null;
  }

  const buffer = await getObjectBuffer(key);
  if (!buffer) {
    console.warn(`Empty file: ${key}`);
    return null;
  }

  const body = decodeLegacyJson(buffer);
  const legacyData: LegacySpotifyData = JSON.parse(body);
  if (!Array.isArray(legacyData.items)) {
    console.warn(`Invalid payload: ${key}`);
    return null;
  }

  const items = await buildItems(legacyData.items);
  const dedupedItems = deduplicatePlayedItems(items);

  const reference = legacyData.items[0]?.played_at
    ? parseISO(legacyData.items[0].played_at)
    : new Date(info.timestamp);

  const referenceDate = isValid(reference) ? reference : new Date(info.timestamp);
  const isoYear = getISOWeekYear(referenceDate);
  const isoWeek = getISOWeek(referenceDate);

  const destinationKey = buildRawObjectKey(isoYear, isoWeek, info.timestamp);

  const newData: RawPlayedData = {
    collectedAt: info.timestamp,
    isoYear,
    isoWeek,
    items: dedupedItems,
  };

  return {
    newData,
    destinationKey,
    originalCount: items.length,
    dedupedCount: dedupedItems.length,
  };
}

async function runDryRun(keys: string[]): Promise<void> {
  if (keys.length === 0) {
    console.log("No files to preview.");
    return;
  }

  const firstKey = keys[0];
  console.log(`\n=== Dry Run: ${firstKey} ===`);
  const result = await transformLegacyFile(firstKey);
  if (!result) return;
  console.log(`Target week: ${formatIsoWeekLabel(result.newData.isoYear, result.newData.isoWeek)}`);
  console.log(`Destination: ${result.destinationKey}`);
  console.log(`Items: ${result.originalCount} -> ${result.dedupedCount}`);
  console.log(JSON.stringify(result.newData.items[0], null, 2));
}

async function migrateKeys(keys: string[], concurrency: number): Promise<void> {
  if (keys.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  console.log(`Starting migration for ${keys.length} files (concurrency=${concurrency})`);

  let processed = 0;
  let success = 0;
  let skipped = 0;

  const upload = async (key: string): Promise<void> => {
    try {
      const result = await transformLegacyFile(key);
      if (!result) {
        skipped += 1;
        return;
      }

      await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: result.destinationKey,
        Body: JSON.stringify(result.newData, null, 2),
        ContentType: "application/json",
      }));

      success += 1;
      console.log(`✓ ${key} -> ${result.destinationKey} (${result.originalCount} → ${result.dedupedCount})`);
    } catch (error) {
      skipped += 1;
      console.error(`✗ Failed to migrate ${key}:`, error);
    } finally {
      processed += 1;
    }
  };

  for (let i = 0; i < keys.length; i += concurrency) {
    const chunk = keys.slice(i, i + concurrency);
    await Promise.all(chunk.map((key) => upload(key)));
    console.log(`Progress: ${processed}/${keys.length}`);
  }

  console.log(`\nMigration finished. Success: ${success}, Skipped: ${skipped}`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options.dryRun && !options.migrate) {
    console.log("Usage: bun run scripts/migrate-legacy-data.ts [--dry-run] [--migrate] [--limit N] [--concurrency N] [--prefix path]");
    return;
  }

  const keys = await listAllKeys(options.prefix);
  keys.sort((a, b) => a.localeCompare(b));

  const targetKeys = options.limit ? keys.slice(0, options.limit) : keys;
  console.log(`Discovered ${keys.length} files. Processing ${targetKeys.length}.`);

  if (options.dryRun) {
    await runDryRun(targetKeys);
  }

  if (options.migrate) {
    await migrateKeys(targetKeys, options.concurrency);
  }
}

main().catch((error) => {
  console.error("Migration script failed:", error);
//   process.exit(1);
});
