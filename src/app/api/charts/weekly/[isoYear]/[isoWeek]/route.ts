import { toApiResponse } from "@/lib/charts/http";
import { getWeeklyChart } from "@/lib/charts/service";
import {
  getCurrentWeekPeriod,
  getWeekPeriod,
  isWeekPeriodAfter,
} from "@/lib/charts/period";

export const dynamic = "force-dynamic";

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
      return new Response(
        JSON.stringify({ error: "유효하지 않은 파라미터입니다." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const current = getCurrentWeekPeriod();
    const requestPeriod = getWeekPeriod(year, week);
    if (isWeekPeriodAfter(requestPeriod, current)) {
      return new Response(
        JSON.stringify({ error: "요청한 주차는 아직 집계되지 않았습니다." }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const result = await getWeeklyChart(year, week);
    return toApiResponse(result);
  } catch {
    return new Response(
      JSON.stringify({ error: "유효하지 않은 파라미터입니다." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
