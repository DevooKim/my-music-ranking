import Link from "next/link";
import { getCurrentPeriods, getYearlyChart } from "@/lib/charts/service";

const FIRST_YEAR = 2000;

const formatYearRange = (latestYear: number): number[] => {
  const size = latestYear - FIRST_YEAR + 1;
  return Array.from({ length: size }, (_, index) => latestYear - index);
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function YearlyPage() {
  const current = getCurrentPeriods();
  const latestResult = await getYearlyChart(current.yearly.year);
  if (latestResult.kind === "error") throw new Error(latestResult.message);
  const years = formatYearRange(current.yearly.year);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold tracking-[0.2em] text-[#78f0b8]">
          MUSIC RANKING
        </p>
        <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
          연간 데이터
        </h1>
        <p className="max-w-2xl text-sm text-[#b6c2d1]">
          년도별로 연간 집계 랭킹을 조회하고 원하는 구간으로 바로 이동할 수
          있습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/"
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            주간으로 이동
          </Link>
          <Link
            href={`/monthly/${current.monthly.year}/${String(current.monthly.month).padStart(2, "0")}`}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            월간으로 이동
          </Link>
          <Link
            href={`/yearly/${current.yearly.year}`}
            className="rounded-full bg-[#1ed760] px-4 py-2 text-sm font-semibold text-[#04100a]"
          >
            이번 연도로 이동
          </Link>
        </div>
      </header>

      {latestResult.kind === "found" ? (
        <section className="rounded-2xl border border-white/10 bg-[#111827]/65 p-4 text-sm text-[#d1dce9] sm:p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-[#6dd3af]">
            최신 연간 집계
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {current.yearly.year} · 총{" "}
            {latestResult.chart.items.length.toLocaleString("ko-KR")}곡
          </p>
          <p className="mt-1 text-sm text-[#8ea2b5]">
            기간: {latestResult.chart.period.start} ~{" "}
            {latestResult.chart.period.end}
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-2xl font-semibold text-white sm:text-3xl">
          연도 목록
        </h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {years.map((year) => (
            <Link
              key={year}
              href={`/yearly/${year}`}
              className="group rounded-xl border border-white/10 bg-[#111827]/60 p-4 transition hover:border-[#1ed760]/70 hover:bg-[#111827]"
            >
              <p className="text-sm text-[#7f8da0]">연간 랭킹</p>
              <p className="mt-1 text-xl font-bold text-white">{year}</p>
              {year === current.yearly.year ? (
                <p className="mt-2 text-xs text-[#1ed760]">이번 연도</p>
              ) : (
                <p className="mt-2 text-xs text-[#9ca3af]">
                  {year}년 랭킹 보기
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
