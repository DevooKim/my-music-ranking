// 클라이언트 컴포넌트에서도 가져다 쓰는 타입·상수. 서버 전용 모듈을 import하지 않는다.
export const TREND_TOP_N = 10;

export type TrendUnit = "weekly" | "monthly";

/** 단위별로 고를 수 있는 기간 범위 (주 / 개월 수) */
export const TREND_RANGE_OPTIONS: Record<TrendUnit, readonly number[]> = {
  weekly: [8, 12, 26],
  monthly: [6, 12],
};

export const DEFAULT_TREND_RANGE: Record<TrendUnit, number> = {
  weekly: 12,
  monthly: 6,
};

/** 단위별 표기: 범위 접미사, 직전 구간 대비 라벨 */
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
  playCount: number;
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
  periods: TrendPeriod[];
  tracks: TrendSeries[];
  artists: TrendSeries[];
}

export const toTrendUnit = (value?: string): TrendUnit =>
  value === "monthly" ? "monthly" : "weekly";

export const toTrendRange = (unit: TrendUnit, value?: string): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return TREND_RANGE_OPTIONS[unit].includes(parsed)
    ? parsed
    : DEFAULT_TREND_RANGE[unit];
};

export const buildTrendHref = (
  unit: TrendUnit,
  range: number,
  view: "track" | "artist",
): string => {
  const params = new URLSearchParams();
  if (unit !== "weekly") params.set("unit", unit);
  if (range !== DEFAULT_TREND_RANGE[unit]) params.set("range", String(range));
  if (view === "artist") params.set("view", "artist");
  const query = params.toString();
  return query ? `/trends?${query}` : "/trends";
};
