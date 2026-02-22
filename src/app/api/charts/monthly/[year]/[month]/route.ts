import { getMonthlyChart } from "@/lib/charts/service";
import { toApiResponse } from "@/lib/charts/http";

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
      return new Response(JSON.stringify({ error: "유효하지 않은 파라미터입니다." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await getMonthlyChart(parsedYear, parsedMonth);
    return toApiResponse(result);
  } catch {
    return new Response(JSON.stringify({ error: "유효하지 않은 파라미터입니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
