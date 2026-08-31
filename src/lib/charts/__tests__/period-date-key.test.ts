import { describe, expect, test } from "bun:test";
import {
  getCurrentMonthPeriod,
  getCurrentWeekPeriod,
  getCurrentYearPeriod,
  getMonthPeriod,
  getWeekPeriod,
  getYearPeriod,
  moveMonthPeriod,
  moveWeekPeriod,
  moveYearPeriod,
} from "../period";

const DAY_MS = 24 * 60 * 60 * 1000;
const spanInDays = (start: string, end: string): number =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS +
  1;

describe("getWeekPeriod", () => {
  test.each([
    [2026, 34, "2026-08-17", "2026-08-23"],
    [2026, 36, "2026-08-31", "2026-09-06"],
    [2026, 1, "2025-12-29", "2026-01-04"],
    [2020, 53, "2020-12-28", "2021-01-03"],
  ])("%i-W%i => %s ~ %s", (isoYear, isoWeek, start, end) => {
    expect(getWeekPeriod(isoYear, isoWeek)).toEqual({
      isoYear,
      isoWeek,
      start,
      end,
    });
  });

  test("모든 주차가 7일 구간이다", () => {
    for (const year of [2020, 2024, 2026]) {
      for (let week = 1; week <= 52; week += 1) {
        const period = getWeekPeriod(year, week);
        expect(spanInDays(period.start, period.end)).toBe(7);
      }
    }
  });

  test("start는 월요일, end는 일요일이다", () => {
    const period = getWeekPeriod(2026, 34);
    expect(new Date(`${period.start}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${period.end}T00:00:00Z`).getUTCDay()).toBe(0);
  });
});

describe("getMonthPeriod", () => {
  test.each([
    [2026, 8, "2026-08-01", "2026-08-31"],
    [2026, 1, "2026-01-01", "2026-01-31"],
    [2026, 12, "2026-12-01", "2026-12-31"],
    [2026, 2, "2026-02-01", "2026-02-28"],
    [2024, 2, "2024-02-01", "2024-02-29"],
  ])("%i-%i => %s ~ %s", (year, month, start, end) => {
    expect(getMonthPeriod(year, month)).toEqual({ year, month, start, end });
  });
});

describe("getYearPeriod", () => {
  test.each([
    [2026, "2026-01-01", "2026-12-31"],
    [2020, "2020-01-01", "2020-12-31"],
  ])("%i => %s ~ %s", (year, start, end) => {
    expect(getYearPeriod(year)).toEqual({ year, start, end });
  });
});

describe("move* 는 경계를 넘어도 구간을 유지한다", () => {
  test("주차: 연도 경계", () => {
    expect(moveWeekPeriod(getWeekPeriod(2026, 1), -1)).toEqual({
      isoYear: 2025,
      isoWeek: 52,
      start: "2025-12-22",
      end: "2025-12-28",
    });
  });

  test("주차: 53주차가 있는 해로 이동", () => {
    expect(moveWeekPeriod(getWeekPeriod(2021, 1), -1)).toEqual({
      isoYear: 2020,
      isoWeek: 53,
      start: "2020-12-28",
      end: "2021-01-03",
    });
  });

  test("월간: 연도 경계", () => {
    expect(moveMonthPeriod(getMonthPeriod(2026, 1), -1)).toEqual({
      year: 2025,
      month: 12,
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(moveMonthPeriod(getMonthPeriod(2026, 12), 1)).toEqual({
      year: 2027,
      month: 1,
      start: "2027-01-01",
      end: "2027-01-31",
    });
  });

  test("연간", () => {
    expect(moveYearPeriod(getYearPeriod(2026), -1)).toEqual({
      year: 2025,
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });
});

describe("current* 계열", () => {
  test("현재 주차는 7일 구간이다", () => {
    const period = getCurrentWeekPeriod();
    expect(spanInDays(period.start, period.end)).toBe(7);
  });

  test("현재 주차를 지정 조회하면 구간이 일치한다", () => {
    const current = getCurrentWeekPeriod();
    const explicit = getWeekPeriod(current.isoYear, current.isoWeek);
    expect(explicit.start).toBe(current.start);
    expect(explicit.end).toBe(current.end);
  });

  test("현재 월/연을 지정 조회하면 구간이 일치한다", () => {
    const month = getCurrentMonthPeriod();
    expect(getMonthPeriod(month.year, month.month)).toEqual(month);
    const year = getCurrentYearPeriod();
    expect(getYearPeriod(year.year)).toEqual(year);
  });
});
