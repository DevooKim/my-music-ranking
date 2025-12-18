import { RAW_BASE_PREFIX, padWeek } from "./config";

const RAW_PREFIX_NORMALIZED = RAW_BASE_PREFIX.endsWith("/")
  ? RAW_BASE_PREFIX
  : `${RAW_BASE_PREFIX}/`;

export interface LegacyKeyInfo {
  timestamp: string;
  year: number;
  month: number;
  day: number;
  hour: number;
}

export function parseLegacyKey(key: string): LegacyKeyInfo | null {
  const match = key.match(/(\d{4})(\d{2})(\d{2})(\d{2})\.json$/);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);

  const timestamp = `${yearStr}-${monthStr}-${dayStr}T${hourStr}:00:00.000Z`;

  return { timestamp, year, month, day, hour };
}

export function buildRawObjectKey(isoYear: number, isoWeek: number, collectedAt: string): string {
  const week = padWeek(isoWeek);
  const sanitized = collectedAt.replace(/[:.]/g, "-");
  return `${RAW_PREFIX_NORMALIZED}${isoYear}/${week}/${sanitized}.json`;
}

export function formatIsoWeekLabel(isoYear: number, isoWeek: number): string {
  return `${isoYear}-W${padWeek(isoWeek)}`;
}

export function rawWeekPrefix(isoYear: number, isoWeek: number): string {
  return `${RAW_PREFIX_NORMALIZED}${isoYear}/${padWeek(isoWeek)}/`;
}

export function normalizedRawPrefix(): string {
  return RAW_PREFIX_NORMALIZED;
}
