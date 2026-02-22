import { getLatestWeeklyChart } from "@/lib/charts/service";
import { toApiResponse } from "@/lib/charts/http";

export async function GET() {
  const result = await getLatestWeeklyChart();
  return toApiResponse(result);
}
