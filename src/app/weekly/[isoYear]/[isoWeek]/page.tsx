import { getWeekPeriod, moveWeekPeriod } from "@/lib/charts/period";
import { getCurrentPeriods, getWeeklyChart } from "@/lib/charts/service";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";
import { notFound } from "next/navigation";

const parseIntParam = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error("invalid");
  return parsed;
};

export default async function WeeklyDetailPage({
  params,
}: {
  params: Promise<{ isoYear: string; isoWeek: string }>;
}) {
  const { isoYear, isoWeek } = await params;

  const year = parseIntParam(isoYear);
  const week = parseIntParam(isoWeek);

  if (year < 2000 || week < 1 || week > 53) {
    notFound();
  }

  const period = getWeekPeriod(year, week);
  const previous = moveWeekPeriod(period, -1);
  const next = moveWeekPeriod(period, 1);
  const current = getCurrentPeriods();

  const result = await getWeeklyChart(year, week);

  return (
    <ChartPageContent
      title={`주간 랭킹 ${period.isoYear}-W${String(period.isoWeek).padStart(2, "0")}`}
      description={`기간: ${period.start} ~ ${period.end}`}
      result={result}
      periods={current}
      activeScope="weekly"
      previousHref={`/weekly/${previous.isoYear}/${String(previous.isoWeek).padStart(2, "0")}`}
      nextHref={`/weekly/${next.isoYear}/${String(next.isoWeek).padStart(2, "0")}`}
    />
  );
}
