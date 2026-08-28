import { toApiResponse } from "@/lib/charts/http";
import { getLatestWeeklyChart } from "@/lib/charts/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await getLatestWeeklyChart();
  return toApiResponse(result);
}
