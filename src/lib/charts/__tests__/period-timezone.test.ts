import { expect, test } from "bun:test";

// `bun test` 는 결정성을 위해 TZ 를 UTC 로 강제한다. 그래서 이 파일 안에서는
// 로컬 TZ 의존 회귀(예: date-fns 로컬 함수 재도입)를 잡을 수 없다.
// TZ 를 바꾼 자식 프로세스로 기간 계산을 실행해 결과가 동일한지 확인한다.
const PROBE = `
import { getWeekPeriod, getMonthPeriod, getYearPeriod, moveWeekPeriod } from "${import.meta.dir}/../period";
console.log(JSON.stringify({
  week: getWeekPeriod(2026, 34),
  weekYearBoundary: getWeekPeriod(2026, 1),
  weekBack: moveWeekPeriod(getWeekPeriod(2026, 1), -1),
  month: getMonthPeriod(2026, 8),
  monthJan: getMonthPeriod(2026, 1),
  year: getYearPeriod(2026),
}));
`;

const runIn = (timeZone: string) => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "-"],
    stdin: Buffer.from(PROBE),
    env: { ...process.env, TZ: timeZone },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) {
    throw new Error(`TZ=${timeZone} 실행 실패: ${result.stderr.toString()}`);
  }
  return JSON.parse(result.stdout.toString().trim());
};

const EXPECTED = {
  week: { isoYear: 2026, isoWeek: 34, start: "2026-08-17", end: "2026-08-23" },
  weekYearBoundary: {
    isoYear: 2026,
    isoWeek: 1,
    start: "2025-12-29",
    end: "2026-01-04",
  },
  weekBack: {
    isoYear: 2025,
    isoWeek: 52,
    start: "2025-12-22",
    end: "2025-12-28",
  },
  month: { year: 2026, month: 8, start: "2026-08-01", end: "2026-08-31" },
  monthJan: { year: 2026, month: 1, start: "2026-01-01", end: "2026-01-31" },
  year: { year: 2026, start: "2026-01-01", end: "2026-12-31" },
};

// UTC 보다 앞선 TZ(Asia/Seoul, Kiritimati)가 회귀를 드러내는 쪽이다.
test.each([
  "UTC",
  "Asia/Seoul",
  "Pacific/Kiritimati",
  "America/New_York",
  "Pacific/Midway",
])("TZ=%s 에서 기간 경계가 동일하다", (timeZone) => {
  expect(runIn(timeZone)).toEqual(EXPECTED);
});
