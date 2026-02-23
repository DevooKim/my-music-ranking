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
      <ChartPageContent
        title={`이번 주차 랭킹 (${current.weekly.isoYear}-W${String(current.weekly.isoWeek).padStart(2, "0")})`}
        description={`기간: ${current.weekly.start} ~ ${current.weekly.end}`}
        result={result}
        periods={current}
        activeScope="weekly"
        previousHref={`/weekly/${previousWeek.isoYear}/${String(previousWeek.isoWeek).padStart(2, "0")}`}
      />

      <div className="mx-auto mt-6 w-full max-w-5xl px-4 pb-10">
        <section className="rounded-2xl border border-white/10 bg-[#111827]/75 p-4">
          <h2 className="mb-3 text-sm font-semibold text-[#7af0a6]">빠른 이동</h2>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Link
              href={`/monthly/${previousMonth.year}/${String(previousMonth.month).padStart(2, "0")}`}
              className="rounded-lg border border-white/15 px-3 py-2 text-white/90 hover:bg-white/10"
            >
              이전 월간 {previousMonth.year}-{String(previousMonth.month).padStart(2, "0")}
            </Link>
            <Link
              href={`/yearly/${current.yearly.year - 1}`}
              className="rounded-lg border border-white/15 px-3 py-2 text-white/90 hover:bg-white/10"
            >
              지난 연도 랭킹 ({current.yearly.year - 1})
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
