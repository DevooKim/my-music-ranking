import { notFound } from "next/navigation";
import { getMonthPeriod, moveMonthPeriod } from "@/lib/charts/period";
import { getCurrentPeriods, getMonthlyChart } from "@/lib/charts/service";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";

const parseIntParam = (value: string): number => {
  if (!/^\\d+$/.test(value)) notFound();
  return Number(value);
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function MonthlyDetailPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const { year, month } = await params;

  const parsedYear = parseIntParam(year);
  const parsedMonth = parseIntParam(month);

  if (parsedYear < 2000 || parsedMonth < 1 || parsedMonth > 12) {
    notFound();
  }

  const period = getMonthPeriod(parsedYear, parsedMonth);
  const current = getCurrentPeriods();

  const previous = moveMonthPeriod(period, -1);
  const next = moveMonthPeriod(period, 1);
  const isNextAfterCurrent =
    next.year > current.monthly.year ||
    (next.year === current.monthly.year && next.month > current.monthly.month);
  const nextHref = isNextAfterCurrent
    ? undefined
    : `/monthly/${next.year}/${String(next.month).padStart(2, "0")}`;

  const result = await getMonthlyChart(parsedYear, parsedMonth);
  if (result.kind === "not_found") notFound();
  if (result.kind === "error") throw new Error(result.message);

  return (
    <ChartPageContent
      title={`월간 랭킹 ${period.year}-${String(period.month).padStart(2, "0")}`}
      description={`기간: ${period.start} ~ ${period.end}`}
      result={result}
      periods={current}
      activeScope="monthly"
      previousHref={`/monthly/${previous.year}/${String(previous.month).padStart(2, "0")}`}
      nextHref={nextHref}
    />
  );
}
