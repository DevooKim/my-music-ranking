import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { s3Paths, getS3ObjectBytes, getS3ObjectText, putS3Object } from "./s3";
import type { TrackStats } from "./types";

type StorageFormats = "json" | "parquet" | "both";
type ReadPreference = "json" | "parquet";

export interface TrackStatsReadOptions {
  storageFormats?: StorageFormats;
  readPreference?: ReadPreference;
}

export interface TrackStatsReadResult {
  data: TrackStats;
  used: "json" | "parquet" | "both" | "unknown";
  bytesReadByFormat: {
    json: number;
    parquet: number;
  };
  fallbackUsed: boolean;
  fallbackFrom?: "json" | "parquet";
  sourceError?: string;
  durationMs: number;
  bytesRead: number;
  attemptedFormats: ("json" | "parquet")[];
}

export interface TrackStatsWriteResult {
  wroteJson: boolean;
  wroteParquet: boolean;
  bytes: {
    json: number;
    parquet: number;
  };
  success: boolean;
  partialFailure: boolean;
  warnings: string[];
}

const DEFAULT_STORAGE_FORMATS: StorageFormats = "both";
const DEFAULT_READ_PREFERENCE: ReadPreference = "parquet";
const DEFAULT_PEAK_RANK = Number.MAX_SAFE_INTEGER;
const PARQUET_CONTENT_TYPE = "application/octet-stream";

type ParquetModule = {
  ParquetSchema: new (...args: unknown[]) => unknown;
  ParquetReader: { openFile: (path: string) => Promise<{ close: () => Promise<void>; getCursor: () => Promise<{ next: () => Promise<Record<string, unknown> | null> }>; }>; };
  ParquetWriter: { openFile: (schema: unknown, path: string) => Promise<{ appendRow: (row: Record<string, unknown>) => Promise<void>; close: () => Promise<void>; }> };
};

type TrackStatsRow = {
  trackId: string;
  weeklyPeakRank: number;
  weeklyPeakPeriod: string;
  totalWeeksOnChart: number;
  monthlyPeakRank: number;
  monthlyPeakPeriod: string;
  totalMonthsOnChart: number;
  yearlyPeakRank: number;
  yearlyPeakPeriod: number;
  totalYearsOnChart: number;
  totalPlayedCount: number;
  trackName: string;
  artistNames: string[];
  albumId: string;
  albumName: string;
};

let parquetModule: Promise<ParquetModule> | null = null;

function parseStorageFormats(value: string | undefined): StorageFormats {
  const raw = (value ?? process.env.TRACK_STATS_STORAGE_FORMATS ?? DEFAULT_STORAGE_FORMATS).toLowerCase();
  if (raw === "json" || raw === "parquet" || raw === "both") {
    return raw;
  }
  return DEFAULT_STORAGE_FORMATS;
}

function parseReadPreference(value: string | undefined): ReadPreference {
  const raw = (value ?? process.env.TRACK_STATS_READ_PREFERENCE ?? DEFAULT_READ_PREFERENCE).toLowerCase();
  if (raw === "json" || raw === "parquet") {
    return raw;
  }
  return DEFAULT_READ_PREFERENCE;
}

function toSafeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toSafeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toSafeArtistNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      names.push(item);
    }
  }
  return names;
}

function normalizeTrackStatsEntry(trackId: string, raw: unknown): TrackStatsRow | null {
  if (typeof trackId !== "string" || trackId.trim().length === 0) {
    return null;
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;
  return {
    trackId,
    weeklyPeakRank: toSafeNumber(data.weeklyPeakRank, DEFAULT_PEAK_RANK),
    weeklyPeakPeriod: toSafeString(data.weeklyPeakPeriod),
    totalWeeksOnChart: toSafeNumber(data.totalWeeksOnChart, 0),
    monthlyPeakRank: toSafeNumber(data.monthlyPeakRank, DEFAULT_PEAK_RANK),
    monthlyPeakPeriod: toSafeString(data.monthlyPeakPeriod),
    totalMonthsOnChart: toSafeNumber(data.totalMonthsOnChart, 0),
    yearlyPeakRank: toSafeNumber(data.yearlyPeakRank, DEFAULT_PEAK_RANK),
    yearlyPeakPeriod: toSafeNumber(data.yearlyPeakPeriod, 0),
    totalYearsOnChart: toSafeNumber(data.totalYearsOnChart, 0),
    totalPlayedCount: toSafeNumber(data.totalPlayedCount, 0),
    trackName: toSafeString(data.trackName),
    artistNames: toSafeArtistNames(data.artistNames),
    albumId: toSafeString(data.albumId),
    albumName: toSafeString(data.albumName),
  };
}

function normalizeTrackStats(stats: unknown): TrackStats {
  const source = (stats ?? {}) as Record<string, unknown>;
  const normalized: TrackStats = {};

  if (typeof source !== "object") {
    return normalized;
  }

  for (const [trackId, value] of Object.entries(source)) {
    const normalizedValue = normalizeTrackStatsEntry(trackId, value);
    if (!normalizedValue) continue;
    normalized[trackId] = normalizedValue;
  }

  return normalized;
}

function toTrackStatsRows(stats: TrackStats): TrackStatsRow[] {
  return Object.entries(stats).reduce<TrackStatsRow[]>((rows, [trackId, value]) => {
    const normalized = normalizeTrackStatsEntry(trackId, value);
    if (!normalized) return rows;
    rows.push(normalized);
    return rows;
  }, []);
}

function rowsToTrackStats(rows: unknown): TrackStats {
  if (!Array.isArray(rows)) {
    return {};
  }

  const normalized: TrackStats = {};

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const normalizedValue = normalizeTrackStatsEntry(toSafeString(value.trackId), value);
    if (!normalizedValue) continue;
    normalized[normalizedValue.trackId] = normalizedValue;
  }

  return normalized;
}

function buildTrackStatsParquetSchema(module: ParquetModule): unknown {
  return new module.ParquetSchema({
    trackId: { type: "UTF8" },
    weeklyPeakRank: { type: "INT64" },
    weeklyPeakPeriod: { type: "UTF8" },
    totalWeeksOnChart: { type: "INT64" },
    monthlyPeakRank: { type: "INT64" },
    monthlyPeakPeriod: { type: "UTF8" },
    totalMonthsOnChart: { type: "INT64" },
    yearlyPeakRank: { type: "INT64" },
    yearlyPeakPeriod: { type: "INT64" },
    totalYearsOnChart: { type: "INT64" },
    totalPlayedCount: { type: "INT64" },
    trackName: { type: "UTF8" },
    artistNames: { type: "UTF8", repeated: true },
    albumId: { type: "UTF8" },
    albumName: { type: "UTF8" },
  });
}

async function getParquetModule(): Promise<ParquetModule> {
  if (!parquetModule) {
    parquetModule = import("parquetjs").then((mod) => mod as unknown as ParquetModule);
  }
  return parquetModule;
}

function makeParquetTempPath(): string {
  const unique = randomBytes(8).toString("hex");
  return join(tmpdir(), `track-stats-${Date.now()}-${unique}.parquet`);
}

async function readTrackStatsJson(): Promise<{ data: TrackStats; bytes: number; found: boolean }> {
  const result = await getS3ObjectText(s3Paths.trackStats());
  if (!result) {
    return { data: {}, bytes: 0, found: false };
  }
  const parsed = JSON.parse(result.text) as unknown;
  return { data: normalizeTrackStats(parsed), bytes: result.bytes, found: true };
}

async function readTrackStatsParquet(): Promise<{ data: TrackStats; bytes: number; found: boolean }> {
  const result = await getS3ObjectBytes(s3Paths.trackStatsParquet());
  if (!result) {
    return { data: {}, bytes: 0, found: false };
  }

  const tempPath = makeParquetTempPath();
  await writeFile(tempPath, Buffer.from(result.bytes));
  try {
    const parquet = await getParquetModule();
    const reader = await parquet.ParquetReader.openFile(tempPath);
    const rows: unknown[] = [];
    try {
      const cursor = await reader.getCursor();
      while (true) {
        const row = await cursor.next();
        if (!row) break;
        rows.push(row);
      }
    } finally {
      await reader.close();
    }

    return { data: rowsToTrackStats(rows), bytes: result.bytes.byteLength, found: true };
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function writeTrackStatsJson(stats: TrackStats): Promise<number> {
  const normalized = normalizeTrackStats(stats);
  const json = JSON.stringify(normalized, null, 2);
  const bytes = Buffer.byteLength(json, "utf8");
  await putS3Object(s3Paths.trackStats(), json, {
    ContentType: "application/json",
  });
  return bytes;
}

async function writeTrackStatsParquet(stats: TrackStats): Promise<number> {
  const normalized = normalizeTrackStats(stats);
  const rows = toTrackStatsRows(normalized);
  const tempPath = makeParquetTempPath();
  const parquet = await getParquetModule();
  const schema = buildTrackStatsParquetSchema(parquet);

  try {
    const writer = await parquet.ParquetWriter.openFile(schema, tempPath);
    try {
      for (const row of rows) {
        await writer.appendRow(row as Record<string, unknown>);
      }
    } finally {
      await writer.close();
    }

  const file = await readFile(tempPath);
  const bytes = file.length;
    await putS3Object(s3Paths.trackStatsParquet(), file, {
      ContentType: PARQUET_CONTENT_TYPE,
    });
    return bytes;
  } finally {
    await rm(tempPath, { force: true });
  }
}

function withStoragePreference(formats: StorageFormats, readPreference: ReadPreference): ("json" | "parquet")[] {
  const readFirst = readPreference === "json" ? "json" : "parquet";
  const readSecond: "json" | "parquet" = readFirst === "json" ? "parquet" : "json";
  if (formats === "both") {
    return [readFirst, readSecond];
  }
  return [formats];
}

export async function getTrackStats(options: TrackStatsReadOptions = {}): Promise<TrackStatsReadResult> {
  const start = Date.now();
  const storageFormats = parseStorageFormats(options.storageFormats);
  const readPreference = parseReadPreference(options.readPreference);
  const order = withStoragePreference(storageFormats, readPreference);
  const result: TrackStatsReadResult = {
    data: {},
    used: "unknown",
    bytesReadByFormat: {
      json: 0,
      parquet: 0,
    },
    fallbackUsed: false,
    attemptedFormats: [],
    durationMs: 0,
    bytesRead: 0,
  };
  let found = false;

  for (let index = 0; index < order.length; index += 1) {
    const format = order[index];
    result.attemptedFormats.push(format);
    try {
      if (format === "json") {
        const json = await readTrackStatsJson();
        result.bytesRead += json.bytes;
        result.bytesReadByFormat.json += json.bytes;
        if (json.found) {
          result.data = json.data;
          result.used = result.fallbackUsed ? "both" : "json";
          found = true;
          break;
        }
      } else {
        const parquet = await readTrackStatsParquet();
        result.bytesRead += parquet.bytes;
        result.bytesReadByFormat.parquet += parquet.bytes;
        if (parquet.found) {
          result.data = parquet.data;
          result.used = result.fallbackUsed ? "both" : "parquet";
          found = true;
          break;
        }
      }

      if (index < order.length - 1) {
        result.fallbackUsed = true;
        if (!result.fallbackFrom) {
          result.fallbackFrom = format;
        }
        if (!result.sourceError) {
          result.sourceError = `${format}_missing`;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!result.fallbackFrom) {
        result.fallbackFrom = format;
      }
      if (order.length === 1 || index === order.length - 1) {
        throw new Error(`track-stats ${format} read failed: ${message}`);
      }
      result.fallbackUsed = true;
      result.sourceError = message;
    }
  }

  if (!found) {
    result.used = "unknown";
    if (!result.sourceError) {
      result.sourceError = "TRACK_STATS_FILE_NOT_FOUND";
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

export async function putTrackStats(stats: TrackStats, options: TrackStatsReadOptions = {}): Promise<TrackStatsWriteResult> {
  const storageFormats = parseStorageFormats(options.storageFormats);
  const writeJson = storageFormats === "json" || storageFormats === "both";
  const writeParquet = storageFormats === "parquet" || storageFormats === "both";
  const result: TrackStatsWriteResult = {
    wroteJson: false,
    wroteParquet: false,
    bytes: { json: 0, parquet: 0 },
    success: false,
    partialFailure: false,
    warnings: [],
  };

  if (writeJson) {
    try {
      result.bytes.json = await writeTrackStatsJson(stats);
      result.wroteJson = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`JSON write failed: ${message}`);
    }
  }

  if (writeParquet) {
    try {
      result.bytes.parquet = await writeTrackStatsParquet(stats);
      result.wroteParquet = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`Parquet write failed: ${message}`);
    }
  }

  result.success = result.wroteJson || result.wroteParquet;
  result.partialFailure = (writeJson && !result.wroteJson) || (writeParquet && !result.wroteParquet);
  if (!result.success) {
    throw new Error(`track-stats write failed: ${result.warnings.join(", ") || "unknown error"}`);
  }

  return result;
}
