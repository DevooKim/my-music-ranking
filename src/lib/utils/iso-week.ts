import {
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from "date-fns";

export interface ISOWeekInfo {
  isoYear: number;
  isoWeek: number;
  startDate: Date;
  endDate: Date;
}

// 현재 ISO 주차 정보
export function getCurrentISOWeek(date: Date = new Date()): ISOWeekInfo {
  return {
    isoYear: getISOWeekYear(date),
    isoWeek: getISOWeek(date),
    startDate: startOfISOWeek(date),
    endDate: endOfISOWeek(date),
  };
}

// 이전 ISO 주차 정보 (병합 시 사용)
export function getPreviousISOWeek(date: Date = new Date()): ISOWeekInfo {
  const lastWeek = subWeeks(date, 1);
  return getCurrentISOWeek(lastWeek);
}

// ISO 주차로부터 날짜 범위 계산
export function getISOWeekRange(
  isoYear: number,
  isoWeek: number,
): { start: Date; end: Date } {
  // ISO 주차의 첫 번째 날 (월요일) 찾기
  const jan4 = new Date(isoYear, 0, 4);
  const startOfYear = startOfISOWeek(jan4);
  const start = new Date(startOfYear);
  start.setDate(start.getDate() + (isoWeek - 1) * 7);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

// 타임스탬프 포맷 (S3 파일명용)
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
