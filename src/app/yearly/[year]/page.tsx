import { notFound } from "next/navigation";
import { getYearPeriod, moveYearPeriod } from "@/lib/charts/period";
import { getCurrentPeriods, getYearlyChart } from "@/lib/charts/service";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";

const parseIntParam = (value: string): number => {
  if (!/^\\d+$/.test(value)) notFound();
  return Number(value);
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function YearlyDetailPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  const parsedYear = parseIntParam(year);

  if (parsedYear < 2000 || parsedYear > 2500) {
    notFound();
  }

  const period = getYearPeriod(parsedYear);
  const current = getCurrentPeriods();

  const previous = moveYearPeriod(period, -1);
  const next = moveYearPeriod(period, 1);
  const isNextAfterCurrent = next.year > current.yearly.year;
  const nextHref = isNextAfterCurrent ? undefined : `/yearly/${next.year}`;

  const result = await getYearlyChart(parsedYear);
  if (result.kind === "not_found") notFound();
  if (result.kind === "error") throw new Error(result.message);

  return (
    <ChartPageContent
      title={`연간 랭킹 ${period.year}`}
      description={`기간: ${period.start} ~ ${period.end}`}
      result={result}
      periods={current}
      activeScope="yearly"
      previousHref={`/yearly/${previous.year}`}
      nextHref={nextHref}
    />
  );
}
