import { getYearlyChart } from "@/lib/charts/service";
import { toApiResponse } from "@/lib/charts/http";

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
      return new Response(JSON.stringify({ error: "유효하지 않은 연도입니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await getYearlyChart(parsedYear);
    return toApiResponse(result);
  } catch {
    return new Response(JSON.stringify({ error: "유효하지 않은 연도입니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
