export interface WeekPeriod {
  isoYear: number;
  isoWeek: number;
  start: string;
  end: string;
}

export interface MonthPeriod {
  year: number;
  month: number;
  start: string;
  end: string;
}

export interface YearPeriod {
  year: number;
  start: string;
  end: string;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");
// 이 모듈의 모든 기간 경계는 UTC 기준으로 계산하고 UTC 기준으로 직렬화한다.
// 프로세스 로컬 TZ에 의존하는 Date 생성자나 date-fns 로컬 함수를 섞으면
// TZ가 UTC보다 앞선 환경에서 경계가 하루 밀린다.
const toDateKey = (value: Date): string => value.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const CHART_TIME_ZONE =
  process.env.CHART_TIME_ZONE || process.env.APP_TIME_ZONE || "Asia/Seoul";

const getDatePartsInZone = (
  date: Date = new Date(),
): { year: number; month: number; day: number } => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: CHART_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );

    return {
      year: Number.parseInt(parts.year ?? "", 10),
      month: Number.parseInt(parts.month ?? "", 10),
      day: Number.parseInt(parts.day ?? "", 10),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
};

const getDateInChartZone = (date?: Date): Date => {
  const parts = getDatePartsInZone(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
};

const getIsoWeekInfo = (date: Date): { isoYear: number; isoWeek: number } => {
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Monday = 0
  const shiftedToThursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  shiftedToThursday.setUTCDate(
    shiftedToThursday.getUTCDate() + (3 - dayOfWeek),
  );

  const isoYear = shiftedToThursday.getUTCFullYear();
  const weekOneThursday = new Date(Date.UTC(isoYear, 0, 4));
  const weekOneDayOfWeek = (weekOneThursday.getUTCDay() + 6) % 7;
  const weekOneStart = weekOneThursday.getTime() - weekOneDayOfWeek * DAY_MS;
  const isoWeek =
    Math.floor((shiftedToThursday.getTime() - weekOneStart) / WEEK_MS) + 1;

  return {
    isoYear,
    isoWeek,
  };
};

const isoWeekStart = (isoYear: number, isoWeek: number): Date => {
  // ISO 8601: 1주차는 1월 4일을 포함하는 주.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayOfWeek = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  const firstWeekStart = jan4.getTime() - jan4DayOfWeek * DAY_MS;
  return new Date(firstWeekStart + (isoWeek - 1) * WEEK_MS);
};

export const getCurrentWeekPeriod = (date: Date = new Date()): WeekPeriod => {
  const zonedDate = getDateInChartZone(date);
  const week = getIsoWeekInfo(zonedDate);
  const start = new Date(
    zonedDate.getTime() - ((zonedDate.getUTCDay() + 6) % 7) * DAY_MS,
  );

  return {
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
    start: toDateKey(start),
    end: toDateKey(new Date(start.getTime() + 6 * DAY_MS)),
  };
};

export const getWeekPeriod = (isoYear: number, isoWeek: number): WeekPeriod => {
  const start = isoWeekStart(isoYear, isoWeek);
  return {
    isoYear,
    isoWeek,
    start: toDateKey(start),
    end: toDateKey(new Date(start.getTime() + 6 * DAY_MS)),
  };
};

export const moveWeekPeriod = (
  period: WeekPeriod,
  offset: number,
): WeekPeriod => {
  const moved = new Date(
    isoWeekStart(period.isoYear, period.isoWeek).getTime() + offset * WEEK_MS,
  );
  const week = getIsoWeekInfo(moved);
  return getWeekPeriod(week.isoYear, week.isoWeek);
};

export const formatWeekLabel = (period: WeekPeriod): string =>
  `${period.isoYear}-W${pad2(period.isoWeek)}`;

export const getCurrentMonthPeriod = (date: Date = new Date()): MonthPeriod => {
  const zonedDate = getDateInChartZone(date);
  const monthStart = new Date(
    Date.UTC(zonedDate.getUTCFullYear(), zonedDate.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(zonedDate.getUTCFullYear(), zonedDate.getUTCMonth() + 1, 0),
  );
  return {
    year: monthStart.getUTCFullYear(),
    month: monthStart.getUTCMonth() + 1,
    start: toDateKey(monthStart),
    end: toDateKey(monthEnd),
  };
};

export const getMonthPeriod = (year: number, month: number): MonthPeriod => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  // day=0 은 이전 달의 마지막 날 → 해당 월의 말일.
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  );
  return {
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    start: toDateKey(start),
    end: toDateKey(end),
  };
};

export const isWeekPeriodAfter = (
  lhs: { isoYear: number; isoWeek: number },
  rhs: { isoYear: number; isoWeek: number },
): boolean => {
  if (lhs.isoYear !== rhs.isoYear) return lhs.isoYear > rhs.isoYear;
  return lhs.isoWeek > rhs.isoWeek;
};

export const isWeekPeriodEqual = (
  lhs: { isoYear: number; isoWeek: number },
  rhs: { isoYear: number; isoWeek: number },
): boolean => lhs.isoYear === rhs.isoYear && lhs.isoWeek === rhs.isoWeek;

export const isMonthPeriodAfter = (
  lhs: { year: number; month: number },
  rhs: { year: number; month: number },
): boolean => {
  if (lhs.year !== rhs.year) return lhs.year > rhs.year;
  return lhs.month > rhs.month;
};

export const isYearPeriodAfter = (lhs: number, rhs: number): boolean =>
  lhs > rhs;

export const moveMonthPeriod = (
  period: MonthPeriod,
  offset: number,
): MonthPeriod => {
  const moved = new Date(Date.UTC(period.year, period.month - 1 + offset, 1));
  return getMonthPeriod(moved.getUTCFullYear(), moved.getUTCMonth() + 1);
};

export const formatMonthLabel = (period: MonthPeriod): string =>
  `${period.year}-${pad2(period.month)}`;

export const getCurrentYearPeriod = (date: Date = new Date()): YearPeriod => {
  const zonedDate = getDateInChartZone(date);
  const yearStart = new Date(Date.UTC(zonedDate.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(zonedDate.getUTCFullYear(), 12, 0));
  return {
    year: yearStart.getUTCFullYear(),
    start: toDateKey(yearStart),
    end: toDateKey(yearEnd),
  };
};

export const getYearPeriod = (year: number): YearPeriod => {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  return {
    year: start.getUTCFullYear(),
    start: toDateKey(start),
    end: toDateKey(end),
  };
};

export const moveYearPeriod = (
  period: YearPeriod,
  offset: number,
): YearPeriod => {
  return getYearPeriod(period.year + offset);
};

export const formatYearLabel = (period: YearPeriod): string => `${period.year}`;

export const isValidMonth = (year: number, month: number): boolean => {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= 2000 &&
    month >= 1 &&
    month <= 12
  );
};

export const isValidYear = (year: number): boolean =>
  Number.isInteger(year) && year >= 2000 && year <= 2500;
