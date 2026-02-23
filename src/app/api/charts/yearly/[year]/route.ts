import { toApiResponse } from "@/lib/charts/http";
import { getYearlyChart } from "@/lib/charts/service";
import { getCurrentYearPeriod, isYearPeriodAfter } from "@/lib/charts/period";

export const dynamic = "force-dynamic";

const parseIntParam = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error("invalid");
  return parsed;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string }> },
) {
  try {
    const { year } = await params;
    const parsedYear = parseIntParam(year);

    if (parsedYear < 2000 || parsedYear > 2500) {
      return new Response(
        JSON.stringify({ error: "유효하지 않은 연도입니다." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const current = getCurrentYearPeriod();
    if (isYearPeriodAfter(parsedYear, current.year)) {
      return new Response(
        JSON.stringify({ error: "요청한 연도는 아직 집계되지 않았습니다." }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const result = await getYearlyChart(parsedYear);
    return toApiResponse(result);
  } catch {
    return new Response(
      JSON.stringify({ error: "유효하지 않은 연도입니다." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
