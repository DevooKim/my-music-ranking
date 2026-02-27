import Link from "next/link";
import type { ChartQueryResult } from "@/lib/charts/types";
import type { MonthPeriod, YearPeriod, WeekPeriod } from "@/lib/charts/period";
import { moveMonthPeriod, moveYearPeriod } from "@/lib/charts/period";
import { ChartList, DetailActionButton } from "@/lib/ui/charts/ChartList";
import { WeeklyChartSection } from "@/lib/ui/charts/WeeklyChartSection";

type ChartScope = "weekly" | "monthly" | "yearly";

type CurrentPeriods = {
  weekly: WeekPeriod;
  monthly: MonthPeriod;
  yearly: YearPeriod;
};

type ChartPageContentProps = {
  title: string;
  description: string;
  result: ChartQueryResult;
  previousHref?: string;
  nextHref?: string;
  periods: CurrentPeriods;
  activeScope: ChartScope;
  serverRenderedAt?: string;
};

export const ChartPageContent = ({
  title,
  description,
  result,
  previousHref,
  nextHref,
  periods,
  activeScope,
  serverRenderedAt,
}: ChartPageContentProps) => {
  const formatDuration = (milliseconds: number) => {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
    return `${totalMinutes.toLocaleString("ko-KR")}분`;
  };

  const getSummary = () => {
    if (result.kind !== "found") return null;
    const totalDurationMs = result.chart.items.reduce(
      (sum, item) => sum + item.totalDurationMs,
      0,
    );
    return {
      totalCount: result.chart.items.length.toLocaleString("ko-KR"),
      totalDuration: formatDuration(totalDurationMs),
    };
  };

  const lastMonth = moveMonthPeriod(periods.monthly, -1);
  const lastYear = moveYearPeriod(periods.yearly, -1);

  const latestHref =
    activeScope === "weekly"
      ? "/"
      : activeScope === "monthly"
        ? `/monthly/${lastMonth.year}/${String(lastMonth.month).padStart(2, "0")}`
        : `/yearly/${lastYear.year}`;

  const quickLabel =
    activeScope === "weekly"
      ? "이번 주차로 이동"
      : activeScope === "monthly"
        ? "지난 달로 이동"
        : "작년으로 이동";

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0b1020]/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <img
              src="/logo.svg"
              alt="My Music Ranking logo"
              className="h-9 w-auto flex-none sm:h-10"
            />
            <span className="text-sm font-semibold tracking-[0.12em] text-[#b7ffe0] sm:text-base">
              My Music Ranking
            </span>
          </Link>
          <nav className="grid w-full grid-cols-3 gap-2 text-xs sm:flex sm:w-auto sm:gap-2 sm:text-sm">
            <Link
              href="/"
              className={`rounded-full px-2.5 py-1.5 text-center ${activeScope === "weekly" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"} sm:px-4`}
            >
              주간
            </Link>
            <Link
              href={`/monthly/${activeScope === "monthly" ? String(periods.monthly.year) : String(lastMonth.year)}/${activeScope === "monthly" ? String(periods.monthly.month).padStart(2, "0") : String(lastMonth.month).padStart(2, "0")}`}
              className={`rounded-full px-2.5 py-1.5 text-center ${activeScope === "monthly" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"} sm:px-4`}
            >
              월간
            </Link>
            <Link
              href={activeScope === "yearly" ? `/yearly/${periods.yearly.year}` : `/yearly/${lastYear.year}`}
              className={`rounded-full px-2.5 py-1.5 text-center ${activeScope === "yearly" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"} sm:px-4`}
            >
              연간
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
            {title}
          </h1>
          {result.kind === "found" ? (
            <p className="text-sm text-[#b6c2d1]">
              {description} · 총 {getSummary()?.totalCount}곡 · 총 재생시간{" "}
              {getSummary()?.totalDuration}
            </p>
          ) : (
            <p className="text-sm text-[#b6c2d1]">{description}</p>
          )}
          {serverRenderedAt ? (
            <p className="text-xs text-[#7c8694]">서버 렌더링 시각: {serverRenderedAt}</p>
          ) : null}
        </header>

        <div className="flex flex-wrap gap-2">
          {previousHref ? (
            <DetailActionButton href={previousHref} label="이전 구간" />
          ) : null}
          {nextHref ? (
            <DetailActionButton href={nextHref} label="다음 구간" />
          ) : null}
          <Link
            href={latestHref}
            className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-[#121212] hover:bg-white"
          >
            {quickLabel}
          </Link>
        </div>

        {result.kind === "found" ? (
          activeScope === "weekly" ? (
            <WeeklyChartSection items={result.chart.items} />
          ) : (
            <ChartList items={result.chart.items} chartType={activeScope} />
          )
        ) : result.kind === "not_found" ? (
          <section className="rounded-2xl border border-[#ffdb99]/60 bg-[#1f1f1f] p-6 text-[#ffd59a]">
            <p className="text-lg font-semibold">
              현재 구간은 아직 집계되지 않았습니다.
            </p>
            <p className="mt-2 text-sm">{result.response.message}</p>
            <p className="mt-1 text-sm text-[#ffd59a]/90">
              {result.response.detail}
            </p>
            <p className="mt-4 text-xs text-[#9ca3af]">
              캐시 정책: {result.cachePolicy.scope}
            </p>
          </section>
        ) : (
          <section className="rounded-2xl border border-[#ff8e8e]/60 bg-[#2b1616] p-6 text-[#ffc7c7]">
            <p className="text-lg font-semibold">오류가 발생했습니다.</p>
            <p className="mt-2 text-sm">{result.message}</p>
          </section>
        )}
      </main>
    </>
  );
};
