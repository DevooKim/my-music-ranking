import type { Metadata } from "next";
import { getCurrentPeriods } from "@/lib/charts/service";
import {
  TREND_TOP_N,
  TREND_UNIT_TEXT,
  toTrendRange,
  toTrendUnit,
} from "@/lib/charts/trend-types";
import { getRankTrends } from "@/lib/charts/trends";
import { RankTrendSection } from "@/lib/ui/charts/RankTrendSection";
import { SiteHeader } from "@/lib/ui/charts/SiteHeader";

export const metadata: Metadata = {
  title: "랭킹 그래프 | my-music-ranking",
  description: "주간·월간 탑 10 트랙·아티스트의 순위 변화 그래프",
};

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; unit?: string; range?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const unit = toTrendUnit(resolvedSearchParams.unit);
  const range = toTrendRange(unit, resolvedSearchParams.range);
  const viewMode = resolvedSearchParams.view === "artist" ? "artist" : "track";
  const unitText = TREND_UNIT_TEXT[unit];

  const trends = await getRankTrends(unit, range);
  const first = trends.periods[0];
  const last = trends.periods[trends.periods.length - 1];
  const summary = `${unitText.name} 탑 ${TREND_TOP_N} 순위 변화`;

  return (
    <>
      <SiteHeader activeScope="trends" periods={getCurrentPeriods()} />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
            랭킹 그래프
          </h1>
          <p className="text-sm text-[#b6c2d1]">
            {first && last
              ? `${summary} · 기간: ${first.start} ~ ${last.end}${last.inProgress ? " (이번 주는 집계 진행 중)" : ""}`
              : summary}
          </p>
        </header>

        {trends.periods.length > 0 ? (
          <RankTrendSection
            key={`${unit}-${range}`}
            unit={unit}
            periods={trends.periods}
            tracks={trends.tracks}
            artists={trends.artists}
            range={range}
            initialViewMode={viewMode}
          />
        ) : (
          <section className="rounded-2xl border border-[#ffdb99]/60 bg-[#1f1f1f] p-6 text-[#ffd59a]">
            <p className="text-lg font-semibold">
              표시할 {unitText.name} 차트가 아직 없습니다.
            </p>
            <p className="mt-2 text-sm">
              최근 {range}
              {unitText.span} 동안 집계된 {unitText.name} 차트를 찾지
              못했습니다.
            </p>
          </section>
        )}
      </main>
    </>
  );
}
