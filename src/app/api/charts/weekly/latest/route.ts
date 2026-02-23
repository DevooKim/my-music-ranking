import { toApiResponse } from "@/lib/charts/http";
import { getLatestWeeklyChart } from "@/lib/charts/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getLatestWeeklyChart();
  return toApiResponse(result);
}
