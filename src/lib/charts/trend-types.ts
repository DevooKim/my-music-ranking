// 클라이언트 컴포넌트에서도 가져다 쓰는 타입·상수. 서버 전용 모듈을 import하지 않는다.
export const TREND_TOP_N = 10;

export type TrendUnit = "weekly" | "monthly";

/** 월간 처리본이 존재하는 가장 이른 연도 */
export const TREND_FIRST_YEAR = 2025;

/** 주간 그래프에서 고를 수 있는 기간(주) */
export const WEEKLY_RANGE_OPTIONS: readonly number[] = [8, 12, 26];
export const DEFAULT_WEEKLY_RANGE = 12;

export interface TrendNow {
  year: number;
  month: number;
}

/**
 * 단위별 기간 선택지. 주간은 최근 N주, 월간은 연도(그 해 1월부터 쌓은 월별 누적)다.
 */
export const getTrendRangeOptions = (
  unit: TrendUnit,
  now: TrendNow,
): number[] => {
  if (unit === "weekly") return [...WEEKLY_RANGE_OPTIONS];
  return Array.from(
    { length: Math.max(1, now.year - TREND_FIRST_YEAR + 1) },
    (_, index) => now.year - index,
  );
};

export const getDefaultTrendRange = (
  unit: TrendUnit,
  now: TrendNow,
): number => {
  if (unit === "weekly") return DEFAULT_WEEKLY_RANGE;
  // 1월에는 아직 끝난 달이 없어 올해 그래프가 비므로 작년을 기본으로 한다.
  return now.month === 1 && now.year > TREND_FIRST_YEAR
    ? now.year - 1
    : now.year;
};

export const formatTrendRange = (unit: TrendUnit, option: number): string =>
  unit === "weekly" ? `${option}주` : `${option}년`;

/** 단위별 표기: 구간 단위 접미사, 직전 구간 대비 라벨 */
export const TREND_UNIT_TEXT: Record<
  TrendUnit,
  { name: string; span: string; previous: string }
> = {
  weekly: { name: "주간", span: "주", previous: "전주 대비" },
  monthly: { name: "월간", span: "개월", previous: "전월 대비" },
};

export interface TrendPeriod {
  /** 구간 식별자 (예: 2026-W46, 2026-10) */
  key: string;
  start: string;
  end: string;
  /** 가로축 라벨 */
  label: string;
  /** 툴팁에 쓰는 상세 라벨 */
  detailLabel: string;
  /** 해당 구간 차트가 존재하는지 여부 */
  available: boolean;
  /** 아직 집계가 진행 중인 구간인지 여부 */
  inProgress: boolean;
}

export interface TrendPoint {
  rank: number;
  /** 순위를 매긴 기준 재생 수. 누적 그래프에서는 누적 값이다. */
  playCount: number;
  /** 해당 구간 하나에서만 재생한 횟수 */
  periodPlayCount: number;
}

export interface TrendSeries {
  id: string;
  name: string;
  /** 트랙의 경우 아티스트명 */
  subtitle: string | null;
  imageUrl: string | null;
  url: string | null;
  /** periods와 같은 길이. 해당 구간 차트에 없으면 null */
  points: (TrendPoint | null)[];
}

export interface RankTrends {
  unit: TrendUnit;
  /** 구간별 순위가 아니라 구간 시작부터 쌓은 누적 순위인지 여부 */
  cumulative: boolean;
  periods: TrendPeriod[];
  tracks: TrendSeries[];
  artists: TrendSeries[];
}

export const toTrendUnit = (value?: string): TrendUnit =>
  value === "monthly" ? "monthly" : "weekly";

export const toTrendRange = (
  unit: TrendUnit,
  value: string | undefined,
  now: TrendNow,
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return getTrendRangeOptions(unit, now).includes(parsed)
    ? parsed
    : getDefaultTrendRange(unit, now);
};

export const buildTrendHref = (
  unit: TrendUnit,
  range: number,
  view: "track" | "artist",
): string => {
  const params = new URLSearchParams();
  if (unit !== "weekly") params.set("unit", unit);
  params.set("range", String(range));
  if (view === "artist") params.set("view", "artist");
  return `/trends?${params.toString()}`;
};
