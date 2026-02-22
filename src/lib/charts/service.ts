import {
  getCurrentMonthPeriod,
  getCurrentWeekPeriod,
  getCurrentYearPeriod,
  getMonthPeriod,
  getWeekPeriod,
  getYearPeriod,
} from "@/lib/charts/period";
import type {
  ChartErrorResult,
  ChartFoundResult,
  ChartNotFoundResult,
  ChartQueryResult,
  NotReadyChartResponse,
} from "@/lib/charts/types";
import { getCachePolicy } from "@/lib/charts/cache-policy";
import {
  getMonthlyChartFromS3,
  getWeeklyChartFromS3,
  getYearlyChartFromS3,
} from "@/lib/charts/repository";

const buildError = (type: "weekly" | "monthly" | "yearly", message: string): ChartErrorResult => ({
  kind: "error",
  type,
  statusCode: 500,
  message,
  cachePolicy: getCachePolicy("not_found"),
});

const buildNotReady = (payload: Omit<NotReadyChartResponse, "generatedAt">): ChartNotFoundResult => ({
  kind: "not_found",
  response: {
    ...payload,
    generatedAt: new Date().toISOString(),
  },
  cachePolicy: getCachePolicy("not_found"),
});

const buildLatestNotReady = (
  payload: Omit<NotReadyChartResponse, "generatedAt">,
): ChartNotFoundResult => ({
  kind: "not_found",
  response: {
    ...payload,
    generatedAt: new Date().toISOString(),
  },
  cachePolicy: getCachePolicy("latest_not_found"),
});

export const getLatestWeeklyChart = async (): Promise<ChartQueryResult> => {
  const period = getCurrentWeekPeriod();
  try {
    const chart = await getWeeklyChartFromS3(period.isoYear, period.isoWeek);

    if (!chart) {
      return buildLatestNotReady({
        status: "not_ready",
        type: "weekly",
        period,
        message: "이번 주 처리본이 아직 생성되지 않았습니다.",
        detail: "Lambda가 집계를 완료하면 즉시 조회됩니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("latest"),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("weekly", "주간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getWeeklyChart = async (
  isoYear: number,
  isoWeek: number,
): Promise<ChartQueryResult> => {
  const period = getWeekPeriod(isoYear, isoWeek);
  try {
    const chart = await getWeeklyChartFromS3(isoYear, isoWeek);
    if (!chart) {
      return buildNotReady({
        status: "not_ready",
        type: "weekly",
        period,
        message: "요청한 주차 처리본이 아직 존재하지 않습니다.",
        detail: "미래 주차이거나 Lambda가 아직 집계하지 않은 구간일 수 있습니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("found"),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("weekly", "주간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getMonthlyChart = async (year: number, month: number): Promise<ChartQueryResult> => {
  const period = getMonthPeriod(year, month);
  try {
    const chart = await getMonthlyChartFromS3(year, month);
    if (!chart) {
      return buildNotReady({
        status: "not_ready",
        type: "monthly",
        period,
        message: "요청한 월 처리본이 아직 존재하지 않습니다.",
        detail: "월간 집계 스케줄이 완료되지 않은 구간일 수 있습니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("found"),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("monthly", "월간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getYearlyChart = async (year: number): Promise<ChartQueryResult> => {
  const period = getYearPeriod(year);
  try {
    const chart = await getYearlyChartFromS3(year);
    if (!chart) {
      return buildNotReady({
        status: "not_ready",
        type: "yearly",
        period,
        message: "요청한 연도 처리본이 아직 존재하지 않습니다.",
        detail: "연간 집계가 완료되지 않은 구간일 수 있습니다.",
      });
    }

    return {
      kind: "found",
      chart,
      cachePolicy: getCachePolicy("found"),
    } satisfies ChartFoundResult;
  } catch {
    return buildError("yearly", "연간 차트 조회 중 오류가 발생했습니다.");
  }
};

export const getCurrentPeriods = () => ({
  weekly: getCurrentWeekPeriod(),
  monthly: getCurrentMonthPeriod(),
  yearly: getCurrentYearPeriod(),
});
