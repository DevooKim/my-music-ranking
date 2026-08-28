import { getCachePolicy } from "@/lib/charts/cache-policy";
import { toApiResponse } from "@/lib/charts/http";
import {
  getCurrentMonthPeriod,
  getMonthPeriod,
  isMonthPeriodAfter,
} from "@/lib/charts/period";
import { getMonthlyChart } from "@/lib/charts/service";
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
  { params }: { params: Promise<{ year: string; month: string }> },
) {
  try {
    const { year, month } = await params;
    const parsedYear = parseBoundedDecimal(year, 2000, 2500);
    const parsedMonth = parseBoundedDecimal(month, 1, 12);

    if (parsedYear === null || parsedMonth === null) {
      return invalidParameterResponse();
    }

    const current = getCurrentMonthPeriod();
    const requestPeriod = getMonthPeriod(parsedYear, parsedMonth);
    if (isMonthPeriodAfter(requestPeriod, current)) {
      return new Response(
        JSON.stringify({ error: "요청한 월은 아직 집계되지 않았습니다." }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": getCachePolicy("not_found").cacheControl,
          },
        },
      );
    }

    const result = await getMonthlyChart(parsedYear, parsedMonth);
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
