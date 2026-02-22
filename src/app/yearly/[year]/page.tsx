import { getYearPeriod, moveYearPeriod } from "@/lib/charts/period";
import { getYearlyChart } from "@/lib/charts/service";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";
import { notFound } from "next/navigation";

const parseIntParam = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error("invalid");
  return parsed;
};

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
  const previous = moveYearPeriod(period, -1);
  const next = moveYearPeriod(period, 1);

  const result = await getYearlyChart(parsedYear);

  return (
    <ChartPageContent
      title={`연간 랭킹 ${period.year}`}
      description={`기간: ${period.start} ~ ${period.end}`}
      result={result}
      previousHref={`/yearly/${previous.year}`}
      nextHref={`/yearly/${next.year}`}
    />
  );
}
