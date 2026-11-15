import { unstable_cache } from "next/cache";
import { buildArtistChartItems } from "@/lib/charts/artist-ranking";
import { getCachePolicy } from "@/lib/charts/cache-policy";
import {
  getCurrentMonthPeriod,
  getCurrentWeekPeriod,
  moveMonthPeriod,
  moveWeekPeriod,
} from "@/lib/charts/period";
import { getMonthlyChart, getWeeklyChart } from "@/lib/charts/service";
import {
  type RankTrends,
  TREND_TOP_N,
  type TrendPeriod,
  type TrendPoint,
  type TrendSeries,
  type TrendUnit,
} from "@/lib/charts/trend-types";
import type { ChartQueryResult } from "@/lib/charts/types";

type SeriesSeed = Omit<TrendSeries, "points">;

type PeriodEntry = SeriesSeed & TrendPoint;

const collectSeries = (
  periodEntries: (PeriodEntry[] | null)[],
): TrendSeries[] => {
  // 기간 중 한 번이라도 탑 N에 든 항목만 시리즈로 만든다.
  const seeds = new Map<string, SeriesSeed>();
  for (const entries of periodEntries) {
    for (const entry of entries ?? []) {
      if (entry.rank > TREND_TOP_N) continue;
      const previous = seeds.get(entry.id);
      // 최신 구간의 메타데이터(이름·이미지)를 우선한다.
      seeds.set(entry.id, {
        id: entry.id,
        name: entry.name,
        subtitle: entry.subtitle,
        imageUrl: entry.imageUrl ?? previous?.imageUrl ?? null,
        url: entry.url ?? previous?.url ?? null,
      });
    }
  }

  const indexed = periodEntries.map(
    (entries) => new Map((entries ?? []).map((entry) => [entry.id, entry])),
  );

  return Array.from(seeds.values()).map((seed) => ({
    ...seed,
    points: indexed.map((byId) => {
      const entry = byId.get(seed.id);
      return entry ? { rank: entry.rank, playCount: entry.playCount } : null;
    }),
  }));
};

type PeriodSlot = Pick<
  TrendPeriod,
  "key" | "start" | "end" | "label" | "detailLabel"
> & {
  load: () => Promise<ChartQueryResult>;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatShortDate = (dateKey: string): string => {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
};

const buildWeeklySlots = (count: number): PeriodSlot[] => {
  const current = getCurrentWeekPeriod();
  return Array.from({ length: count }, (_, index) => {
    const period = moveWeekPeriod(current, index - (count - 1));
    return {
      key: `${period.isoYear}-W${pad2(period.isoWeek)}`,
      start: period.start,
      end: period.end,
      label: formatShortDate(period.start),
      detailLabel: `${formatShortDate(period.start)} ~ ${formatShortDate(period.end)} (W${pad2(period.isoWeek)})`,
      load: () => getWeeklyChart(period.isoYear, period.isoWeek),
    };
  });
};

const buildMonthlySlots = (count: number): PeriodSlot[] => {
  const current = getCurrentMonthPeriod();
  return Array.from({ length: count }, (_, index) => {
    const period = moveMonthPeriod(current, index - (count - 1));
    return {
      key: `${period.year}-${pad2(period.month)}`,
      start: period.start,
      end: period.end,
      label: `${period.month}월`,
      detailLabel: `${period.year}년 ${period.month}월`,
      load: () => getMonthlyChart(period.year, period.month),
    };
  });
};

const computeRankTrends = async (
  unit: TrendUnit,
  range: number,
): Promise<{ trends: RankTrends; degraded: boolean }> => {
  const slots =
    unit === "weekly" ? buildWeeklySlots(range) : buildMonthlySlots(range);
  const results = await Promise.all(slots.map((slot) => slot.load()));

  const trackEntries: (PeriodEntry[] | null)[] = [];
  const artistEntries: (PeriodEntry[] | null)[] = [];

  for (const result of results) {
    if (result.kind !== "found" || result.chart.items.length === 0) {
      trackEntries.push(null);
      artistEntries.push(null);
      continue;
    }

    trackEntries.push(
      result.chart.items.map((item) => ({
        id: item.trackId,
        name: item.trackName,
        subtitle: item.artistNames.join(", ") || null,
        imageUrl: item.albumImageUrl || null,
        url: item.url ?? `https://open.spotify.com/track/${item.trackId}`,
        rank: item.rank,
        playCount: item.playCount,
      })),
    );

    // 월간 처리본에는 아티스트 차트가 없어 트랙 차트에서 집계한다.
    const artistItems =
      result.artistItems ?? buildArtistChartItems(result.chart.items);
    artistEntries.push(
      artistItems.map((item) => ({
        id: item.artistId,
        name: item.artistName,
        subtitle: null,
        imageUrl: item.artistImageUrl,
        url: `https://open.spotify.com/artist/${item.artistId}`,
        rank: item.rank,
        playCount: item.playCount,
      })),
    );
  }

  // 뒤쪽(최신)의 비어 있는 구간은 잘라내 마지막 열이 항상 실제 차트가 되게 한다.
  let length = slots.length;
  while (length > 0 && trackEntries[length - 1] === null) length -= 1;
  // 앞쪽(과거)의 비어 있는 구간도 잘라낸다. 수집 시작 이전 구간이다.
  let offset = 0;
  while (offset < length && trackEntries[offset] === null) offset += 1;

  const trends: RankTrends = {
    unit,
    periods: slots.slice(offset, length).map((slot, index) => ({
      key: slot.key,
      start: slot.start,
      end: slot.end,
      label: slot.label,
      detailLabel: slot.detailLabel,
      available: trackEntries[offset + index] !== null,
      // 주간은 마지막 칸이 진행 중인 이번 주다. 월간은 완료된 달만 처리본이 있다.
      inProgress: unit === "weekly" && offset + index === slots.length - 1,
    })),
    tracks: collectSeries(trackEntries.slice(offset, length)),
    artists: collectSeries(artistEntries.slice(offset, length)),
  };

  return {
    trends,
    degraded: results.some((result) => result.kind === "error"),
  };
};

/** 조회 오류가 섞인 결과를 캐시에 남기지 않기 위한 신호 */
class DegradedTrendsError extends Error {
  constructor(readonly trends: RankTrends) {
    super("rank trends computed with lookup errors");
  }
}

/**
 * 그래프 한 장을 그리려면 구간 수만큼 차트를 읽어야 하므로, 합쳐진 결과를
 * 통째로 캐시한다. 이번 주 차트가 갱신되는 주기(latest 정책)만큼만 유지하고,
 * 구간이 넘어가면 키가 바뀌어 새로 계산한다.
 */
export const getRankTrends = async (
  unit: TrendUnit,
  range: number,
): Promise<RankTrends> => {
  const currentKey =
    unit === "weekly"
      ? getCurrentWeekPeriod().start
      : getCurrentMonthPeriod().start;

  try {
    return await unstable_cache(
      async () => {
        const { trends, degraded } = await computeRankTrends(unit, range);
        if (degraded) throw new DegradedTrendsError(trends);
        return trends;
      },
      ["chart:trends", unit, String(range), currentKey],
      { revalidate: getCachePolicy("latest").maxAgeSeconds },
    )();
  } catch (error) {
    if (error instanceof DegradedTrendsError) return error.trends;
    throw error;
  }
};
