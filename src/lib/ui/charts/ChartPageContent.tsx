import Link from "next/link";
import type { ChartQueryResult } from "@/lib/charts/types";
import { ChartList, DetailActionButton } from "@/lib/ui/charts/ChartList";

type ChartScope = "weekly" | "monthly" | "yearly";

type CurrentPeriods = {
  weekly: { isoYear: number; isoWeek: number };
  monthly: { year: number; month: number };
  yearly: { year: number };
};

type ChartPageContentProps = {
  title: string;
  description: string;
  result: ChartQueryResult;
  previousHref?: string;
  nextHref?: string;
  periods: CurrentPeriods;
  activeScope: ChartScope;
};

export const ChartPageContent = ({
  title,
  description,
  result,
  previousHref,
  nextHref,
  periods,
  activeScope,
}: ChartPageContentProps) => {
  const latestHref =
    activeScope === "weekly"
      ? "/"
      : activeScope === "monthly"
        ? `/monthly/${periods.monthly.year}/${String(periods.monthly.month).padStart(2, "0")}`
        : `/yearly/${periods.yearly.year}`;

  const quickLabel =
    activeScope === "weekly"
      ? "이번 주차로 이동"
      : activeScope === "monthly"
        ? "이번 달로 이동"
        : "이번 연도로 이동";

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0b1020]/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link
            href="/"
            className="text-sm font-medium uppercase tracking-[0.28em] text-[#b7ffe0]"
          >
            Your music flow
          </Link>
          <nav className="flex gap-2 text-sm">
            <Link
              href="/"
              className={`rounded-full px-4 py-1.5 ${activeScope === "weekly" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"}`}
            >
              주간
            </Link>
            <Link
              href={`/monthly/${periods.monthly.year}/${String(periods.monthly.month).padStart(2, "0")}`}
              className={`rounded-full px-4 py-1.5 ${activeScope === "monthly" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"}`}
            >
              월간
            </Link>
            <Link
              href={`/yearly/${periods.yearly.year}`}
              className={`rounded-full px-4 py-1.5 ${activeScope === "yearly" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"}`}
            >
              연간
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[#7af0a6]">
            Personal Spotify Chart
          </p>
          <h1 className="text-4xl font-bold leading-tight text-white">
            {title}
          </h1>
          {result.kind === "found" ? (
            <p className="text-sm text-[#b6c2d1]">
              {description} · 총{" "}
              {result.chart.items.length.toLocaleString("ko-KR")}곡
            </p>
          ) : (
            <p className="text-sm text-[#b6c2d1]">{description}</p>
          )}
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
          <ChartList items={result.chart.items} />
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
