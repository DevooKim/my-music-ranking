import Link from "next/link";
import { getCurrentPeriods, getLatestWeeklyChart } from "@/lib/charts/service";
import { moveMonthPeriod, moveWeekPeriod } from "@/lib/charts/period";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";

export default async function HomePage() {
  const result = await getLatestWeeklyChart();
  const current = getCurrentPeriods();

  const previousWeek = moveWeekPeriod(current.weekly, -1);
  const previousMonth = moveMonthPeriod(current.monthly, -1);

  return (
    <>
      <div className="border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <h1 className="text-lg font-bold text-zinc-900">Spotify 재생 랭킹</h1>
          <nav className="flex gap-2 text-sm">
            <Link href="/" className="rounded-full bg-zinc-900 px-3 py-1 text-white">주간</Link>
            <Link
              href={`/monthly/${current.monthly.year}/${String(current.monthly.month).padStart(2, "0")}`}
              className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
            >
              월간
            </Link>
            <Link
              href={`/yearly/${current.yearly.year}`}
              className="rounded-full border border-zinc-300 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
            >
              연간
            </Link>
          </nav>
        </div>
      </div>

      <ChartPageContent
        title={`이번 주차 랭킹 (${current.weekly.isoYear}-W${String(current.weekly.isoWeek).padStart(2, "0")})`}
        description={`기간: ${current.weekly.start} ~ ${current.weekly.end}`}
        result={result}
        previousHref={`/weekly/${previousWeek.isoYear}/${String(previousWeek.isoWeek).padStart(2, "0")}`}
      />

      <div className="mx-auto mt-6 w-full max-w-4xl px-4 pb-10">
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">빠른 이동</h2>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Link
              href={`/monthly/${previousMonth.year}/${String(previousMonth.month).padStart(2, "0")}`}
              className="rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
            >
              이전 월간 {previousMonth.year}-{String(previousMonth.month).padStart(2, "0")}
            </Link>
            <Link
              href={`/yearly/${current.yearly.year - 1}`}
              className="rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
            >
              지난 연도 랭킹 ({current.yearly.year - 1})
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
