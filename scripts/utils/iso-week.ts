import { addDays, endOfISOWeek, getISOWeeksInYear, startOfISOWeek } from "date-fns";

export interface IsoWeekTuple {
  isoYear: number;
  isoWeek: number;
}

export function getIsoWeekStartDate(isoYear: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekStart = startOfISOWeek(jan4);
  return addDays(firstWeekStart, (isoWeek - 1) * 7);
}

export function getIsoWeekEndDate(isoYear: number, isoWeek: number): Date {
  const start = getIsoWeekStartDate(isoYear, isoWeek);
  return endOfISOWeek(start);
}

export function getPreviousIsoWeek(isoYear: number, isoWeek: number): IsoWeekTuple | null {
  if (isoWeek > 1) {
    return { isoYear, isoWeek: isoWeek - 1 };
  }

  const previousYear = isoYear - 1;
  if (previousYear < 2000) return null;
  const weeksInPrevYear = getISOWeeksInYear(new Date(Date.UTC(previousYear, 0, 4)));
  return { isoYear: previousYear, isoWeek: weeksInPrevYear };
}
