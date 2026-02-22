import Link from "next/link";
import type { ChartQueryResult } from "@/lib/charts/types";
import { ChartList, DetailActionButton } from "@/lib/ui/charts/ChartList";

type ChartPageContentProps = {
  title: string;
  description: string;
  result: ChartQueryResult;
  previousHref?: string;
  nextHref?: string;
};

export const ChartPageContent = ({
  title,
  description,
  result,
  previousHref,
  nextHref,
}: ChartPageContentProps) => {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Personal Spotify Chart</p>
        <h1 className="text-3xl font-bold text-zinc-900">{title}</h1>
        <p className="text-zinc-600">{description}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {previousHref ? <DetailActionButton href={previousHref} label="이전 구간" /> : null}
        {nextHref ? <DetailActionButton href={nextHref} label="다음 구간" /> : null}
        <Link
          href="/"
          className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          이번 주차로 이동
        </Link>
      </div>

      {result.kind === "found" ? (
        <ChartList items={result.chart.items} />
      ) : result.kind === "not_found" ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <p className="text-lg font-semibold">현재 구간은 아직 집계되지 않았습니다.</p>
          <p className="mt-2 text-sm">{result.response.message}</p>
          <p className="mt-1 text-sm text-amber-700">{result.response.detail}</p>
          <p className="mt-4 text-xs text-amber-600">캐시 정책: {result.cachePolicy.scope}</p>
        </section>
      ) : (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
          <p className="text-lg font-semibold">오류가 발생했습니다.</p>
          <p className="mt-2 text-sm">{result.message}</p>
        </section>
      )}
    </main>
  );
};
