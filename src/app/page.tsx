import { moveWeekPeriod } from "@/lib/charts/period";
import { getCurrentPeriods, getLatestWeeklyChart } from "@/lib/charts/service";
import { ChartPageContent } from "@/lib/ui/charts/ChartPageContent";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const weeklyViewMode = toWeeklyViewMode(resolvedSearchParams.view);

  const result = await getLatestWeeklyChart();
  if (result.kind === "error") throw new Error(result.message);

  const current = getCurrentPeriods();

  const previousWeek = moveWeekPeriod(current.weekly, -1);

  return (
    <ChartPageContent
      title={`이번 주차 랭킹 (${current.weekly.isoYear}-W${String(current.weekly.isoWeek).padStart(2, "0")})`}
      description={`기간: ${current.weekly.start} ~ ${current.weekly.end}`}
      result={result}
      periods={current}
      activeScope="weekly"
      previousHref={`/weekly/${previousWeek.isoYear}/${String(previousWeek.isoWeek).padStart(2, "0")}`}
      weeklyViewMode={weeklyViewMode}
    />
  );
}

const toWeeklyViewMode = (value?: string): "track" | "artist" =>
  value === "artist" ? "artist" : "track";
