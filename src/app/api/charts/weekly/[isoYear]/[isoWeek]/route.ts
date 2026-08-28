import { getCachePolicy } from "@/lib/charts/cache-policy";
import { toApiResponse } from "@/lib/charts/http";
import {
  getCurrentWeekPeriod,
  getWeekPeriod,
  isWeekPeriodAfter,
} from "@/lib/charts/period";
import { getWeeklyChart } from "@/lib/charts/service";
import { parseBoundedDecimal } from "@/lib/routing/decimal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const invalidParameterResponse = () =>
  new Response(JSON.stringify({ error: "유효하지 않은 파라미터입니다." }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ isoYear: string; isoWeek: string }> },
) {
  try {
    const { isoYear, isoWeek } = await params;
    const year = parseBoundedDecimal(isoYear, 2000, 2500);
    const week = parseBoundedDecimal(isoWeek, 1, 53);

    if (year === null || week === null) {
      return invalidParameterResponse();
    }

    const current = getCurrentWeekPeriod();
    const requestPeriod = getWeekPeriod(year, week);
    if (isWeekPeriodAfter(requestPeriod, current)) {
      return new Response(
        JSON.stringify({ error: "요청한 주차는 아직 집계되지 않았습니다." }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": getCachePolicy("not_found").cacheControl,
          },
        },
      );
    }

    const result = await getWeeklyChart(year, week);
    return toApiResponse(result);
  } catch {
    return new Response(
      JSON.stringify({ error: "차트 조회 중 오류가 발생했습니다." }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
