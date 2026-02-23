import { toApiResponse } from "@/lib/charts/http";
import { getMonthlyChart } from "@/lib/charts/service";
import {
  getCurrentMonthPeriod,
  getMonthPeriod,
  isMonthPeriodAfter,
} from "@/lib/charts/period";

export const dynamic = "force-dynamic";

const parseIntParam = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error("invalid");
  return parsed;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string; month: string }> },
) {
  try {
    const { year, month } = await params;
    const parsedYear = parseIntParam(year);
    const parsedMonth = parseIntParam(month);

    if (parsedYear < 2000 || parsedMonth < 1 || parsedMonth > 12) {
      return new Response(
        JSON.stringify({ error: "유효하지 않은 파라미터입니다." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const current = getCurrentMonthPeriod();
    const requestPeriod = getMonthPeriod(parsedYear, parsedMonth);
    if (isMonthPeriodAfter(requestPeriod, current)) {
      return new Response(
        JSON.stringify({ error: "요청한 월은 아직 집계되지 않았습니다." }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const result = await getMonthlyChart(parsedYear, parsedMonth);
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
