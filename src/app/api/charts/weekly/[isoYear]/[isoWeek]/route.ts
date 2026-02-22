import { getWeeklyChart } from "@/lib/charts/service";
import { toApiResponse } from "@/lib/charts/http";

const parseIntParam = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error("invalid");
  return parsed;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ isoYear: string; isoWeek: string }> },
) {
  try {
    const { isoYear, isoWeek } = await params;
    const year = parseIntParam(isoYear);
    const week = parseIntParam(isoWeek);

    if (year < 2000 || week < 1 || week > 53) {
      return new Response(JSON.stringify({ error: "유효하지 않은 파라미터입니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await getWeeklyChart(year, week);
    return toApiResponse(result);
  } catch {
    return new Response(JSON.stringify({ error: "유효하지 않은 파라미터입니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
