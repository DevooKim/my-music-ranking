# Phase 3: DuckDB 통합

## 목표

DuckDB 클라이언트를 구성하고 S3에서 JSON을 직접 쿼리하는 함수를 구현합니다.

## 작업 목록

### 3.1 DuckDB 클라이언트 설정

**파일:** `src/lib/duckdb/client.ts`

```typescript
import { Database } from "duckdb-async";

let db: Database | null = null;

export async function getDuckDB(): Promise<Database> {
  if (db) return db;
  
  db = await Database.create(":memory:");
  
  // httpfs 확장 로드 (S3 접근용)
  await db.run("INSTALL httpfs");
  await db.run("LOAD httpfs");
  
  // S3 설정
  await db.run(`SET s3_region = '${process.env.S3_REGION || "ap-northeast-2"}'`);
  await db.run(`SET s3_access_key_id = '${process.env.AWS_ACCESS_KEY_ID}'`);
  await db.run(`SET s3_secret_access_key = '${process.env.AWS_SECRET_ACCESS_KEY}'`);
  
  return db;
}

// 연결 종료 (필요시)
export async function closeDuckDB(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
```

### 3.2 S3 JSON 읽기 유틸리티

**파일:** `src/lib/duckdb/s3-reader.ts`

```typescript
import { getDuckDB } from "./client";
import { s3Paths } from "@/lib/utils/s3-paths";

// S3에서 JSON 파일 목록 조회
export async function listS3JsonFiles(prefix: string): Promise<string[]> {
  const db = await getDuckDB();
  const s3Url = s3Paths.toS3Url(prefix);
  
  try {
    const result = await db.all(`
      SELECT file FROM glob('${s3Url}')
    `);
    return result.map((row: any) => row.file);
  } catch (error) {
    console.error("Failed to list S3 files:", error);
    return [];
  }
}

// S3 JSON 파일들을 DuckDB 테이블로 로드
export async function loadJsonToTable(
  s3Pattern: string,
  tableName: string
): Promise<void> {
  const db = await getDuckDB();
  const s3Url = s3Paths.toS3Url(s3Pattern);
  
  await db.run(`
    CREATE OR REPLACE TABLE ${tableName} AS
    SELECT 
      unnest(items) as item,
      isoYear,
      isoWeek
    FROM read_json_auto('${s3Url}')
  `);
}
```

### 3.3 차트 쿼리 함수 - 실시간

**파일:** `src/lib/duckdb/queries/realtime.ts`

```typescript
import { getDuckDB } from "../client";
import { s3Paths } from "@/lib/utils/s3-paths";
import { getCurrentISOWeek } from "@/lib/utils/iso-week";
import type { ChartItem, ChartResponse } from "@/lib/types/played";

export async function queryRealtimeChart(limit = 100): Promise<ChartResponse> {
  const db = await getDuckDB();
  const now = new Date();
  const { isoYear, isoWeek } = getCurrentISOWeek(now);
  
  // 현재 주의 raw 데이터 조회
  const rawUrl = s3Paths.toS3Url(s3Paths.rawWeekGlob(isoYear, isoWeek));
  
  const query = `
    WITH played AS (
      SELECT unnest(items) as item
      FROM read_json_auto('${rawUrl}')
    )
    SELECT 
      item.trackId as trackId,
      item.trackName as trackName,
      item.albumId as albumId,
      item.albumName as albumName,
      item.albumImageUrl as albumImageUrl,
      item.artistIds as artistIds,
      item.artistNames as artistNames,
      COUNT(*) as playCount,
      SUM(item.durationMs) as totalDurationMs
    FROM played
    GROUP BY 
      item.trackId, item.trackName, item.albumId, 
      item.albumName, item.albumImageUrl, item.artistIds, item.artistNames
    ORDER BY playCount DESC
    LIMIT ${limit}
  `;
  
  const results = await db.all(query);
  
  const items: ChartItem[] = results.map((row: any, index: number) => ({
    rank: index + 1,
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: row.artistIds,
    artistNames: row.artistNames,
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
  }));
  
  return {
    type: "realtime",
    period: {
      start: now.toISOString(),
      end: now.toISOString(),
    },
    generatedAt: now.toISOString(),
    items,
  };
}
```

### 3.4 차트 쿼리 함수 - 주간

**파일:** `src/lib/duckdb/queries/weekly.ts`

```typescript
import { getDuckDB } from "../client";
import { s3Paths } from "@/lib/utils/s3-paths";
import { getISOWeekRange } from "@/lib/utils/iso-week";
import type { ChartItem, ChartResponse } from "@/lib/types/played";

export async function queryWeeklyChart(
  isoYear: number,
  isoWeek: number,
  limit = 100
): Promise<ChartResponse> {
  const db = await getDuckDB();
  const weeklyUrl = s3Paths.toS3Url(s3Paths.weekly(isoYear, isoWeek));
  const { start, end } = getISOWeekRange(isoYear, isoWeek);
  
  const query = `
    WITH played AS (
      SELECT unnest(items) as item
      FROM read_json_auto('${weeklyUrl}')
    )
    SELECT 
      item.trackId as trackId,
      item.trackName as trackName,
      item.albumId as albumId,
      item.albumName as albumName,
      item.albumImageUrl as albumImageUrl,
      item.artistIds as artistIds,
      item.artistNames as artistNames,
      COUNT(*) as playCount,
      SUM(item.durationMs) as totalDurationMs
    FROM played
    GROUP BY 
      item.trackId, item.trackName, item.albumId, 
      item.albumName, item.albumImageUrl, item.artistIds, item.artistNames
    ORDER BY playCount DESC
    LIMIT ${limit}
  `;
  
  const results = await db.all(query);
  
  const items: ChartItem[] = results.map((row: any, index: number) => ({
    rank: index + 1,
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: row.artistIds,
    artistNames: row.artistNames,
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
  }));
  
  return {
    type: "weekly",
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    generatedAt: new Date().toISOString(),
    items,
  };
}
```

### 3.5 차트 쿼리 함수 - 월간

**파일:** `src/lib/duckdb/queries/monthly.ts`

```typescript
import { getDuckDB } from "../client";
import { s3Paths } from "@/lib/utils/s3-paths";
import { startOfMonth, endOfMonth, getISOWeek, getISOWeekYear, eachWeekOfInterval } from "date-fns";
import type { ChartItem, ChartResponse } from "@/lib/types/played";

export async function queryMonthlyChart(
  year: number,
  month: number,
  limit = 100
): Promise<ChartResponse> {
  const db = await getDuckDB();
  
  const start = startOfMonth(new Date(year, month - 1));
  const end = endOfMonth(new Date(year, month - 1));
  
  // 해당 월에 포함된 모든 ISO 주차 계산
  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
  const weeklyUrls = weeks.map((weekStart) => {
    const isoYear = getISOWeekYear(weekStart);
    const isoWeek = getISOWeek(weekStart);
    return s3Paths.toS3Url(s3Paths.weekly(isoYear, isoWeek));
  });
  
  // UNION ALL로 여러 weekly 파일 조회
  const urlList = weeklyUrls.map((url) => `'${url}'`).join(", ");
  
  const query = `
    WITH played AS (
      SELECT unnest(items) as item
      FROM read_json_auto([${urlList}])
    ),
    filtered AS (
      SELECT item
      FROM played
      WHERE item.playedAt >= '${start.toISOString()}'
        AND item.playedAt <= '${end.toISOString()}'
    )
    SELECT 
      item.trackId as trackId,
      item.trackName as trackName,
      item.albumId as albumId,
      item.albumName as albumName,
      item.albumImageUrl as albumImageUrl,
      item.artistIds as artistIds,
      item.artistNames as artistNames,
      COUNT(*) as playCount,
      SUM(item.durationMs) as totalDurationMs
    FROM filtered
    GROUP BY 
      item.trackId, item.trackName, item.albumId, 
      item.albumName, item.albumImageUrl, item.artistIds, item.artistNames
    ORDER BY playCount DESC
    LIMIT ${limit}
  `;
  
  const results = await db.all(query);
  
  const items: ChartItem[] = results.map((row: any, index: number) => ({
    rank: index + 1,
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: row.artistIds,
    artistNames: row.artistNames,
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
  }));
  
  return {
    type: "monthly",
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    generatedAt: new Date().toISOString(),
    items,
  };
}
```

### 3.6 차트 쿼리 함수 - 연간

**파일:** `src/lib/duckdb/queries/yearly.ts`

```typescript
import { getDuckDB } from "../client";
import { s3Paths } from "@/lib/utils/s3-paths";
import type { ChartItem, ChartResponse } from "@/lib/types/played";

export async function queryYearlyChart(
  year: number,
  limit = 100
): Promise<ChartResponse> {
  const db = await getDuckDB();
  
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  
  // 해당 연도의 모든 weekly 파일 조회
  const weeklyPattern = s3Paths.toS3Url(s3Paths.weeklyYearGlob(year));
  
  const query = `
    WITH played AS (
      SELECT unnest(items) as item
      FROM read_json_auto('${weeklyPattern}')
    ),
    filtered AS (
      SELECT item
      FROM played
      WHERE item.playedAt >= '${start.toISOString()}'
        AND item.playedAt <= '${end.toISOString()}'
    )
    SELECT 
      item.trackId as trackId,
      item.trackName as trackName,
      item.albumId as albumId,
      item.albumName as albumName,
      item.albumImageUrl as albumImageUrl,
      item.artistIds as artistIds,
      item.artistNames as artistNames,
      COUNT(*) as playCount,
      SUM(item.durationMs) as totalDurationMs
    FROM filtered
    GROUP BY 
      item.trackId, item.trackName, item.albumId, 
      item.albumName, item.albumImageUrl, item.artistIds, item.artistNames
    ORDER BY playCount DESC
    LIMIT ${limit}
  `;
  
  const results = await db.all(query);
  
  const items: ChartItem[] = results.map((row: any, index: number) => ({
    rank: index + 1,
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: row.artistIds,
    artistNames: row.artistNames,
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
  }));
  
  return {
    type: "yearly",
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    generatedAt: new Date().toISOString(),
    items,
  };
}
```

### 3.7 쿼리 인덱스 파일

**파일:** `src/lib/duckdb/queries/index.ts`

```typescript
export { queryRealtimeChart } from "./realtime";
export { queryWeeklyChart } from "./weekly";
export { queryMonthlyChart } from "./monthly";
export { queryYearlyChart } from "./yearly";
```

## 파일 구조

```
src/lib/duckdb/
├── client.ts           ← DuckDB 인스턴스 관리
├── s3-reader.ts        ← S3 파일 읽기 유틸리티
└── queries/
    ├── index.ts
    ├── realtime.ts
    ├── weekly.ts
    ├── monthly.ts
    └── yearly.ts
```

## 체크리스트

- [ ] `src/lib/duckdb/client.ts` 생성
- [ ] `src/lib/duckdb/s3-reader.ts` 생성
- [ ] `src/lib/duckdb/queries/realtime.ts` 생성
- [ ] `src/lib/duckdb/queries/weekly.ts` 생성
- [ ] `src/lib/duckdb/queries/monthly.ts` 생성
- [ ] `src/lib/duckdb/queries/yearly.ts` 생성
- [ ] `src/lib/duckdb/queries/index.ts` 생성
- [ ] 로컬 테스트 (샘플 데이터)

## 예상 소요 시간

1일
