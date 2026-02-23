import { getMonthPeriod, moveMonthPeriod } from "@/lib/charts/period";
import { getCurrentPeriods, getMonthlyChart } from "@/lib/charts/service";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";
import { notFound } from "next/navigation";

const parseIntParam = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error("invalid");
  return parsed;
};

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
  const previous = moveMonthPeriod(period, -1);
  const next = moveMonthPeriod(period, 1);
  const current = getCurrentPeriods();

  const result = await getMonthlyChart(parsedYear, parsedMonth);

  return (
    <ChartPageContent
      title={`월간 랭킹 ${period.year}-${String(period.month).padStart(2, "0")}`}
      description={`기간: ${period.start} ~ ${period.end}`}
      result={result}
      periods={current}
      activeScope="monthly"
      previousHref={`/monthly/${previous.year}/${String(previous.month).padStart(2, "0")}`}
      nextHref={`/monthly/${next.year}/${String(next.month).padStart(2, "0")}`}
    />
  );
}
