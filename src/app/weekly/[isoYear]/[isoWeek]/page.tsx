import { notFound } from "next/navigation";
import {
  getWeekPeriod,
  isWeekPeriodAfter,
  moveWeekPeriod,
} from "@/lib/charts/period";
import { getCurrentPeriods, getWeeklyChart } from "@/lib/charts/service";
import { parseBoundedDecimal } from "@/lib/routing/decimal";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";

const parseYear = (value: string): number => {
  const parsed = parseBoundedDecimal(value, 2000, 2500);
  if (parsed === null) notFound();
  return parsed;
};

const parseWeek = (value: string): number => {
  const parsed = parseBoundedDecimal(value, 1, 53);
  if (parsed === null) notFound();
  return parsed;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function WeeklyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ isoYear: string; isoWeek: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const [{ isoYear, isoWeek }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({ view: undefined as string | undefined }),
  ]);
  const weeklyViewMode = toWeeklyViewMode(resolvedSearchParams.view);

  const year = parseYear(isoYear);
  const week = parseWeek(isoWeek);

  const period = getWeekPeriod(year, week);
  const current = getCurrentPeriods();

  const previous = moveWeekPeriod(period, -1);
  const next = moveWeekPeriod(period, 1);
  const isNextAfterCurrent = isWeekPeriodAfter(next, current.weekly);
  const isNextCurrent =
    next.isoYear === current.weekly.isoYear &&
    next.isoWeek === current.weekly.isoWeek;
  const nextHref = isNextAfterCurrent
    ? undefined
    : isNextCurrent
      ? "/"
      : `/weekly/${next.isoYear}/${String(next.isoWeek).padStart(2, "0")}`;

  const result = await getWeeklyChart(year, week);
  if (result.kind === "error") throw new Error(result.message);

  return (
    <ChartPageContent
      title={`주간 랭킹 ${period.isoYear}-W${String(period.isoWeek).padStart(2, "0")}`}
      description={`기간: ${period.start} ~ ${period.end}`}
      result={result}
      periods={current}
      activeScope="weekly"
      previousHref={`/weekly/${previous.isoYear}/${String(previous.isoWeek).padStart(2, "0")}`}
      nextHref={nextHref}
      weeklyViewMode={weeklyViewMode}
    />
  );
}

const toWeeklyViewMode = (value?: string): "track" | "artist" =>
  value === "artist" ? "artist" : "track";
