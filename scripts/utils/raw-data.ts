import type { PlayedItem, RawPlayedData } from "../../lambda/shared/types";
import { getObjectBody, listAllKeys } from "./s3";
import { normalizedRawPrefix, rawWeekPrefix } from "./legacy";
import type { IsoWeekTuple } from "./iso-week";

export interface RawWeekData {
  keys: string[];
  payloads: RawPlayedData[];
  items: PlayedItem[];
}

export async function fetchRawWeekData(isoYear: number, isoWeek: number): Promise<RawWeekData> {
  const prefix = rawWeekPrefix(isoYear, isoWeek);
  const keys = await listAllKeys(prefix);
  const payloads: RawPlayedData[] = [];
  const items: PlayedItem[] = [];

  for (const key of keys) {
    const body = await getObjectBody(key);
    if (!body) continue;

    const payload: RawPlayedData = JSON.parse(body);
    payloads.push(payload);
    items.push(...(payload.items ?? []));
  }

  return { keys, payloads, items };
}

export async function listRawWeeks(filterYear?: number): Promise<IsoWeekTuple[]> {
  const prefix = normalizedRawPrefix();
  const keys = await listAllKeys(prefix);
  const seen = new Set<string>();

  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length);
    const [yearStr, weekStr] = remainder.split("/");
    if (!yearStr || !weekStr) continue;

    const isoYear = Number(yearStr);
    const isoWeek = Number(weekStr);
    if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek)) continue;
    if (filterYear && isoYear !== filterYear) continue;

    const token = `${isoYear}-${weekStr}`;
    seen.add(token);
  }

  return Array.from(seen)
    .map((token) => {
      const [yearPart, weekPart] = token.split("-");
      return {
        isoYear: Number(yearPart),
        isoWeek: Number(weekPart),
      };
    })
    .filter((tuple) => Number.isFinite(tuple.isoYear) && Number.isFinite(tuple.isoWeek))
    .sort((a, b) => (a.isoYear === b.isoYear ? a.isoWeek - b.isoWeek : a.isoYear - b.isoYear));
}
