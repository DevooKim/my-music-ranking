import {
  addDays,
  addMonths,
  addYears,
  endOfISOWeek,
  endOfMonth,
  endOfYear,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  startOfMonth,
  startOfYear,
} from "date-fns";

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
const toDateKey = (value: Date): string => value.toISOString().slice(0, 10);

const isoWeekStart = (isoYear: number, isoWeek: number): Date => {
  const jan4 = new Date(isoYear, 0, 4);
  const firstWeekStart = startOfISOWeek(jan4);
  return addDays(firstWeekStart, (isoWeek - 1) * 7);
};

export const getCurrentWeekPeriod = (date: Date = new Date()): WeekPeriod => {
  return {
    isoYear: getISOWeekYear(date),
    isoWeek: getISOWeek(date),
    start: toDateKey(startOfISOWeek(date)),
    end: toDateKey(endOfISOWeek(date)),
  };
};

export const getWeekPeriod = (isoYear: number, isoWeek: number): WeekPeriod => {
  const start = isoWeekStart(isoYear, isoWeek);
  return {
    isoYear,
    isoWeek,
    start: toDateKey(start),
    end: toDateKey(endOfISOWeek(start)),
  };
};

export const moveWeekPeriod = (period: WeekPeriod, offset: number): WeekPeriod => {
  const moved = addDays(isoWeekStart(period.isoYear, period.isoWeek), offset * 7);
  return getWeekPeriod(getISOWeekYear(moved), getISOWeek(moved));
};

export const formatWeekLabel = (period: WeekPeriod): string =>
  `${period.isoYear}-W${pad2(period.isoWeek)}`;

export const getCurrentMonthPeriod = (date: Date = new Date()): MonthPeriod => {
  const start = startOfMonth(date);
  return {
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    start: toDateKey(start),
    end: toDateKey(endOfMonth(start)),
  };
};

export const getMonthPeriod = (year: number, month: number): MonthPeriod => {
  const normalized = new Date(year, month - 1, 1);
  const start = startOfMonth(normalized);
  return {
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    start: toDateKey(start),
    end: toDateKey(endOfMonth(start)),
  };
};

export const moveMonthPeriod = (period: MonthPeriod, offset: number): MonthPeriod => {
  const moved = addMonths(new Date(period.year, period.month - 1, 1), offset);
  return getMonthPeriod(moved.getFullYear(), moved.getMonth() + 1);
};

export const formatMonthLabel = (period: MonthPeriod): string =>
  `${period.year}-${pad2(period.month)}`;

export const getCurrentYearPeriod = (date: Date = new Date()): YearPeriod => {
  const start = startOfYear(date);
  return {
    year: start.getFullYear(),
    start: toDateKey(start),
    end: toDateKey(endOfYear(start)),
  };
};

export const getYearPeriod = (year: number): YearPeriod => {
  const start = startOfYear(new Date(year, 0, 1));
  return {
    year: start.getFullYear(),
    start: toDateKey(start),
    end: toDateKey(endOfYear(start)),
  };
};

export const moveYearPeriod = (period: YearPeriod, offset: number): YearPeriod => {
  const moved = addYears(new Date(period.year, 0, 1), offset);
  return getYearPeriod(moved.getFullYear());
};

export const formatYearLabel = (period: YearPeriod): string => `${period.year}`;

export const isValidMonth = (year: number, month: number): boolean => {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 2000 && month >= 1 && month <= 12;
};

export const isValidYear = (year: number): boolean => Number.isInteger(year) && year >= 2000 && year <= 2500;
