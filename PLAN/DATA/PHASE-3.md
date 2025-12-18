# Phase 3: 차트 계산 로직

## 목표

**Lambda에서** 사용할 차트 계산 로직을 DuckDB로 구현합니다.  
Lambda가 주간/월간/연간 차트를 계산하여 S3에 JSON으로 저장합니다.

> **참고:** Next.js API는 Lambda가 생성한 S3 JSON을 읽어서 반환만 합니다.  
> 실시간 차트만 Next.js에서 DuckDB로 직접 집계합니다. (Phase 5 참조)

## 작업 목록

### 3.1 DuckDB 클라이언트

**파일:** `src/lib/duckdb/client.ts`

```typescript
import * as duckdb from "duckdb";

let db: duckdb.Database | null = null;
let conn: duckdb.Connection | null = null;
let initialized = false;

const REGION = process.env.S3_REGION || "ap-northeast-2";

export async function getDuckDB(): Promise<duckdb.Connection> {
  if (conn && initialized) return conn;
  
  db = new duckdb.Database(":memory:");
  conn = db.connect();
  
  // S3 확장 설치 및 설정
  await runQuery(conn, "INSTALL httpfs; LOAD httpfs;");
  await runQuery(conn, `SET s3_region='${REGION}';`);
  
  // AWS 자격 증명 설정 (환경 변수가 있는 경우)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    await runQuery(conn, `SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID}';`);
    await runQuery(conn, `SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY}';`);
  }
  
  initialized = true;
  return conn;
}

export function runQuery(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function queryAll<T>(conn: duckdb.Connection, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export async function closeDuckDB(): Promise<void> {
  if (conn) {
    conn.close();
  }
  if (db) {
    db.close();
  }
  conn = null;
  db = null;
  initialized = false;
}
```

### 3.2 차트 계산기 (DuckDB 사용)

**파일:** `src/lib/chart/calculator.ts`

```typescript
import { getDuckDB, queryAll } from "@/lib/duckdb/client";
import type { ChartItem } from "@/lib/types/played";

const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

interface AggregatedRow {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string;   // JSON 배열 문자열
  artistNames: string; // JSON 배열 문자열
  playCount: number;
  totalDurationMs: number;
}

export interface AggregatedTrack {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playCount: number;
  totalDurationMs: number;
}

/**
 * S3의 raw JSON 파일들을 DuckDB로 집계
 * @param s3Pattern S3 glob 패턴 (예: "played/raw/2025/01/*.json")
 * @param limit 결과 제한
 */
export async function aggregatePlaysFromS3(
  s3Pattern: string,
  limit = 100
): Promise<AggregatedTrack[]> {
  const conn = await getDuckDB();
  const s3Path = `s3://${BUCKET}/${s3Pattern}`;
  
  const sql = `
    WITH flattened AS (
      SELECT 
        unnest(items) as item
      FROM read_json_auto('${s3Path}', union_by_name=true)
    )
    SELECT 
      item.trackId as trackId,
      item.trackName as trackName,
      item.albumId as albumId,
      item.albumName as albumName,
      item.albumImageUrl as albumImageUrl,
      json(item.artistIds) as artistIds,
      json(item.artistNames) as artistNames,
      COUNT(*) as playCount,
      SUM(item.durationMs) as totalDurationMs
    FROM flattened
    GROUP BY 
      item.trackId, item.trackName, item.albumId, 
      item.albumName, item.albumImageUrl, 
      item.artistIds, item.artistNames
    ORDER BY playCount DESC
    LIMIT ${limit}
  `;
  
  const rows = await queryAll<AggregatedRow>(conn, sql);
  
  return rows.map((row) => ({
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: JSON.parse(row.artistIds),
    artistNames: JSON.parse(row.artistNames),
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
  }));
}

/**
 * 주간 차트용 S3 패턴 생성
 */
export function getWeeklyS3Pattern(isoYear: number, isoWeek: number): string {
  return `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/*.json`;
}

/**
 * 월간 차트용 S3 패턴 생성 (해당 월의 모든 주)
 */
export function getMonthlyS3Pattern(year: number, month: number): string {
  // 월간은 해당 월에 속하는 모든 raw 파일 조회
  // 월별 폴더 구조가 아닌 경우 glob 패턴 조정 필요
  return `played/raw/${year}/*/*.json`;
}

/**
 * 연간 차트용 S3 패턴 생성
 */
export function getYearlyS3Pattern(year: number): string {
  return `played/raw/${year}/**/*.json`;
}

/**
 * 집계된 트랙에 순위 부여
 */
export function assignRanks(
  tracks: AggregatedTrack[],
  limit = 100
): Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[] {
  return tracks.slice(0, limit).map((track, index) => ({
    rank: index + 1,
    ...track,
  }));
}
```

### 3.2 차트 비교기 (LW/LM/LY 계산)

**파일:** `src/lib/chart/comparator.ts`

```typescript
import type { ChartItem, ChartResponse } from "@/lib/types/played";

// 지난 차트와 비교하여 lastRank 계산
export function compareWithLastChart(
  currentItems: Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[],
  lastChart: ChartResponse | null
): Omit<ChartItem, "peakRank" | "weeksOnChart">[] {
  const lastRankMap = new Map<string, number>();
  
  if (lastChart) {
    for (const item of lastChart.items) {
      lastRankMap.set(item.trackId, item.rank);
    }
  }
  
  return currentItems.map((item) => ({
    ...item,
    lastRank: lastRankMap.get(item.trackId) ?? null,
  }));
}

// 순위 변동 계산 헬퍼
export function getRankChange(current: number, last: number | null): string {
  if (last === null) return "NEW";
  if (current < last) return `${last - current}`;
  if (current > last) return `${current - last}`;
  return "-";
}
```

### 3.3 트랙 통계 관리자

**파일:** `src/lib/chart/stats-manager.ts`

```typescript
import type { ChartItem, TrackStats } from "@/lib/types/played";

type ChartType = "weekly" | "monthly" | "yearly";

interface UpdateResult {
  stats: TrackStats;
  updated: string[];  // 업데이트된 trackId 목록
}

// 차트 결과로 트랙 통계 업데이트
export function updateTrackStats(
  currentStats: TrackStats,
  chartItems: Omit<ChartItem, "peakRank" | "weeksOnChart">[],
  chartType: ChartType,
  period: string  // "2025-W01", "2025-01", "2025"
): UpdateResult {
  const stats = { ...currentStats };
  const updated: string[] = [];
  
  for (const item of chartItems) {
    const existing = stats[item.trackId];
    
    if (!existing) {
      // 새 트랙
      stats[item.trackId] = createNewTrackStats(item, chartType, period);
      updated.push(item.trackId);
    } else {
      // 기존 트랙 업데이트
      const wasUpdated = updateExistingStats(existing, item, chartType, period);
      if (wasUpdated) updated.push(item.trackId);
    }
  }
  
  return { stats, updated };
}

function createNewTrackStats(
  item: Omit<ChartItem, "peakRank" | "weeksOnChart">,
  chartType: ChartType,
  period: string
): TrackStats[string] {
  const base = {
    weeklyPeakRank: Infinity,
    weeklyPeakPeriod: "",
    totalWeeksOnChart: 0,
    monthlyPeakRank: Infinity,
    monthlyPeakPeriod: "",
    totalMonthsOnChart: 0,
    yearlyPeakRank: Infinity,
    yearlyPeakPeriod: 0,
    totalYearsOnChart: 0,
    trackName: item.trackName,
    artistNames: item.artistNames,
  };
  
  if (chartType === "weekly") {
    base.weeklyPeakRank = item.rank;
    base.weeklyPeakPeriod = period;
    base.totalWeeksOnChart = 1;
  } else if (chartType === "monthly") {
    base.monthlyPeakRank = item.rank;
    base.monthlyPeakPeriod = period;
    base.totalMonthsOnChart = 1;
  } else {
    base.yearlyPeakRank = item.rank;
    base.yearlyPeakPeriod = parseInt(period);
    base.totalYearsOnChart = 1;
  }
  
  return base;
}

function updateExistingStats(
  existing: TrackStats[string],
  item: Omit<ChartItem, "peakRank" | "weeksOnChart">,
  chartType: ChartType,
  period: string
): boolean {
  let updated = false;
  
  if (chartType === "weekly") {
    existing.totalWeeksOnChart += 1;
    if (item.rank < existing.weeklyPeakRank) {
      existing.weeklyPeakRank = item.rank;
      existing.weeklyPeakPeriod = period;
      updated = true;
    }
  } else if (chartType === "monthly") {
    existing.totalMonthsOnChart += 1;
    if (item.rank < existing.monthlyPeakRank) {
      existing.monthlyPeakRank = item.rank;
      existing.monthlyPeakPeriod = period;
      updated = true;
    }
  } else {
    existing.totalYearsOnChart += 1;
    if (item.rank < existing.yearlyPeakRank) {
      existing.yearlyPeakRank = item.rank;
      existing.yearlyPeakPeriod = parseInt(period);
      updated = true;
    }
  }
  
  // 트랙 메타 업데이트
  existing.trackName = item.trackName;
  existing.artistNames = item.artistNames;
  
  return updated;
}

// 통계에서 peak/weeks 정보 가져오기
export function getStatsForChart(
  stats: TrackStats,
  trackId: string,
  chartType: ChartType
): { peakRank: number; periodsOnChart: number } {
  const trackStats = stats[trackId];
  
  if (!trackStats) {
    return { peakRank: Infinity, periodsOnChart: 0 };
  }
  
  if (chartType === "weekly") {
    return {
      peakRank: trackStats.weeklyPeakRank,
      periodsOnChart: trackStats.totalWeeksOnChart,
    };
  } else if (chartType === "monthly") {
    return {
      peakRank: trackStats.monthlyPeakRank,
      periodsOnChart: trackStats.totalMonthsOnChart,
    };
  } else {
    return {
      peakRank: trackStats.yearlyPeakRank,
      periodsOnChart: trackStats.totalYearsOnChart,
    };
  }
}
```

### 3.4 차트 생성 통합 함수

**파일:** `src/lib/chart/builder.ts`

```typescript
import type { ChartItem, ChartResponse, TrackStats } from "@/lib/types/played";
import { 
  aggregatePlaysFromS3, 
  assignRanks,
  getWeeklyS3Pattern,
  getMonthlyS3Pattern,
  getYearlyS3Pattern,
} from "./calculator";
import { compareWithLastChart } from "./comparator";
import { updateTrackStats, getStatsForChart } from "./stats-manager";

type ChartType = "weekly" | "monthly" | "yearly";

interface BuildChartInput {
  chartType: ChartType;
  period: {
    start: string;
    end: string;
    label: string;  // "2025-W01", "2025-01", "2025"
    // 주간용
    isoYear?: number;
    isoWeek?: number;
    // 월간용
    year?: number;
    month?: number;
  };
  lastChart: ChartResponse | null;
  trackStats: TrackStats;
  limit?: number;
}

interface BuildChartResult {
  chart: ChartResponse;
  updatedStats: TrackStats;
}

/**
 * S3 패턴 결정
 */
function getS3Pattern(chartType: ChartType, period: BuildChartInput["period"]): string {
  if (chartType === "weekly" && period.isoYear && period.isoWeek) {
    return getWeeklyS3Pattern(period.isoYear, period.isoWeek);
  } else if (chartType === "monthly" && period.year && period.month) {
    return getMonthlyS3Pattern(period.year, period.month);
  } else if (chartType === "yearly" && period.year) {
    return getYearlyS3Pattern(period.year);
  }
  throw new Error(`Invalid period for chartType: ${chartType}`);
}

/**
 * DuckDB를 사용하여 S3에서 직접 차트 생성
 */
export async function buildChart(input: BuildChartInput): Promise<BuildChartResult> {
  const { chartType, period, lastChart, trackStats, limit = 100 } = input;
  
  // 1. S3 패턴 결정 및 DuckDB로 집계
  const s3Pattern = getS3Pattern(chartType, period);
  const aggregated = await aggregatePlaysFromS3(s3Pattern, limit);
  
  // 2. 순위 부여
  const ranked = assignRanks(aggregated, limit);
  
  // 3. 지난 차트와 비교 (lastRank)
  const withLastRank = compareWithLastChart(ranked, lastChart);
  
  // 4. 통계 업데이트
  const { stats: updatedStats } = updateTrackStats(
    trackStats,
    withLastRank,
    chartType,
    period.label
  );
  
  // 5. peak/weeks 정보 추가
  const finalItems: ChartItem[] = withLastRank.map((item) => {
    const { peakRank, periodsOnChart } = getStatsForChart(
      updatedStats,
      item.trackId,
      chartType
    );
    
    return {
      ...item,
      peakRank: Math.min(peakRank, item.rank),
      weeksOnChart: periodsOnChart,
    };
  });
  
  // 6. 차트 응답 생성
  const chart: ChartResponse = {
    type: chartType,
    period: {
      start: period.start,
      end: period.end,
      ...(chartType === "weekly" && {
        isoYear: period.isoYear,
        isoWeek: period.isoWeek,
      }),
      ...(chartType === "monthly" && {
        year: period.year,
        month: period.month,
      }),
      ...(chartType === "yearly" && {
        year: period.year,
      }),
    },
    generatedAt: new Date().toISOString(),
    items: finalItems,
  };
  
  return { chart, updatedStats };
}

/**
 * 실시간 차트 생성 (현재 주 기준)
 */
export async function buildRealtimeChart(
  isoYear: number,
  isoWeek: number,
  limit = 50
): Promise<ChartResponse> {
  const s3Pattern = getWeeklyS3Pattern(isoYear, isoWeek);
  const aggregated = await aggregatePlaysFromS3(s3Pattern, limit);
  const ranked = assignRanks(aggregated, limit);
  
  return {
    type: "realtime",
    period: {
      start: new Date().toISOString(),
      end: new Date().toISOString(),
      isoYear,
      isoWeek,
    },
    generatedAt: new Date().toISOString(),
    items: ranked.map((item) => ({
      ...item,
      lastRank: null,
      peakRank: null,
      weeksOnChart: null,
    })),
  };
}
```

### 3.5 인덱스 파일

**파일:** `src/lib/chart/index.ts`

```typescript
// DuckDB 클라이언트
export { getDuckDB, queryAll, closeDuckDB } from "@/lib/duckdb/client";

// 차트 계산기
export { 
  aggregatePlaysFromS3, 
  assignRanks,
  getWeeklyS3Pattern,
  getMonthlyS3Pattern,
  getYearlyS3Pattern,
  type AggregatedTrack,
} from "./calculator";

// 차트 비교기
export { compareWithLastChart, getRankChange } from "./comparator";

// 통계 관리자
export { updateTrackStats, getStatsForChart } from "./stats-manager";

// 차트 빌더
export { buildChart, buildRealtimeChart } from "./builder";
```

### 3.6 DuckDB 인덱스 파일

**파일:** `src/lib/duckdb/index.ts`

```typescript
export { getDuckDB, queryAll, runQuery, closeDuckDB } from "./client";
```

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                         Lambda (Phase 4)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  DuckDB로 S3 raw JSON 집계 → 차트 JSON 생성 → S3 저장    │   │
│  │  - 주간 차트: 매주 월요일 생성                            │   │
│  │  - 월간 차트: 매월 1일 생성                               │   │
│  │  - 연간 차트: 매년 1월 1일 생성                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                            S3                                    │
│  played/charts/                                                  │
│  ├── weekly/2025/week-01.json    ← Lambda가 생성                │
│  ├── monthly/2025/month-01.json  ← Lambda가 생성                │
│  └── yearly/2025.json            ← Lambda가 생성                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js API (Phase 5)                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  GET /api/v1/charts/weekly   → S3 JSON 읽기 (캐싱)        │   │
│  │  GET /api/v1/charts/monthly  → S3 JSON 읽기 (캐싱)        │   │
│  │  GET /api/v1/charts/yearly   → S3 JSON 읽기 (캐싱)        │   │
│  │  GET /api/v1/charts/realtime → DuckDB 실시간 집계 (유일)  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 파일 구조

```
src/lib/
├── duckdb/
│   ├── index.ts          ← DuckDB 내보내기
│   └── client.ts         ← DuckDB 연결 및 쿼리 헬퍼
└── chart/
    ├── index.ts          ← 차트 모듈 내보내기
    ├── calculator.ts     ← DuckDB 집계 및 순위 부여
    ├── comparator.ts     ← 지난 차트 비교
    ├── stats-manager.ts  ← 트랙 통계 관리
    └── builder.ts        ← 차트 생성 통합
```

> **사용처:**
> - `calculator.ts`, `builder.ts`: Lambda + Next.js 실시간 차트
> - `comparator.ts`, `stats-manager.ts`: Lambda에서만 사용

## 주요 변경사항 (순수 JS → DuckDB)

| 항목 | 기존 | DuckDB |
|------|------|--------|
| 데이터 로드 | 메모리에 모든 JSON 로드 | S3 직접 쿼리 |
| 집계 방식 | Map을 사용한 수동 집계 | SQL GROUP BY |
| 정렬 | Array.sort() | SQL ORDER BY |
| 메모리 사용량 | 데이터 크기에 비례 | 스트리밍 처리 |
| 확장성 | 제한적 | 대용량 데이터 지원 |

## DuckDB 쿼리 예시

### 주간 차트 쿼리
```sql
WITH flattened AS (
  SELECT unnest(items) as item
  FROM read_json_auto('s3://my-music-ranking/played/raw/2025/01/*.json', union_by_name=true)
)
SELECT 
  item.trackId as trackId,
  item.trackName as trackName,
  COUNT(*) as playCount,
  SUM(item.durationMs) as totalDurationMs
FROM flattened
GROUP BY item.trackId, item.trackName, ...
ORDER BY playCount DESC
LIMIT 100
```

### 월간 차트 쿼리 (날짜 필터링)
```sql
WITH flattened AS (
  SELECT unnest(items) as item
  FROM read_json_auto('s3://my-music-ranking/played/raw/2025/*/*.json', union_by_name=true)
)
SELECT ...
FROM flattened
WHERE item.playedAt >= '2025-01-01' AND item.playedAt < '2025-02-01'
GROUP BY ...
ORDER BY playCount DESC
LIMIT 100
```

## 체크리스트

- [x] `src/lib/duckdb/client.ts` 생성
- [x] `src/lib/duckdb/index.ts` 생성
- [x] `src/lib/chart/calculator.ts` 생성 (DuckDB 사용)
- [x] `src/lib/chart/comparator.ts` 생성
- [x] `src/lib/chart/stats-manager.ts` 생성
- [x] `src/lib/chart/builder.ts` 생성 (DuckDB 사용)
- [x] `src/lib/chart/index.ts` 생성
- [x] `duckdb` 패키지 설치 (`bun add duckdb`)
- [ ] 단위 테스트 작성

## 의존성

```json
{
  "dependencies": {
    "duckdb": "^1.1.3"
  }
}
```

## 예상 소요 시간

1일
