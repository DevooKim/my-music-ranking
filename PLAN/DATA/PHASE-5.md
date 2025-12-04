# Phase 5: Next.js API

## 목표

차트 API를 구현합니다:
- **실시간 차트**: DuckDB로 S3 raw JSON 쿼리 (2시간 캐싱)
- **주간/월간/연간**: Lambda가 계산한 S3 차트 JSON 반환

## API 구조

```
src/app/api/v1/charts/
├── realtime/
│   └── route.ts      ← 실시간 차트 (2시간 캐싱) - DuckDB
├── weekly/
│   └── route.ts      ← 주간 차트 (4시간 캐싱) - S3 JSON
├── monthly/
│   └── route.ts      ← 월간 차트 (24시간 캐싱) - S3 JSON
└── yearly/
    └── route.ts      ← 연간 차트 (1주일 캐싱) - S3 JSON
```

## 작업 목록

### 5.1 DuckDB 클라이언트 (실시간 차트용)

**파일:** `src/lib/duckdb/client.ts`

```typescript
import * as duckdb from "duckdb";

let db: duckdb.Database | null = null;
let conn: duckdb.Connection | null = null;

const BUCKET = process.env.S3_BUCKET || "my-music-ranking";
const REGION = process.env.S3_REGION || "ap-northeast-2";

export async function getDuckDB(): Promise<duckdb.Connection> {
  if (conn) return conn;
  
  db = new duckdb.Database(":memory:");
  conn = db.connect();
  
  // S3 확장 설치 및 설정
  await runQuery(conn, "INSTALL httpfs; LOAD httpfs;");
  await runQuery(conn, `SET s3_region='${REGION}';`);
  await runQuery(conn, `SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID}';`);
  await runQuery(conn, `SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY}';`);
  
  return conn;
}

function runQuery(conn: duckdb.Connection, sql: string): Promise<void> {
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
  if (conn) conn.close();
  if (db) db.close();
  conn = null;
  db = null;
}
```

### 5.2 실시간 차트 쿼리

**파일:** `src/lib/duckdb/queries/realtime.ts`

```typescript
import { getDuckDB, queryAll } from "../client";
import { getCurrentISOWeek } from "@/lib/utils/iso-week";

const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

interface RawChartRow {
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

export async function queryRealtimeChart(limit = 50) {
  const conn = await getDuckDB();
  const { isoYear, isoWeek } = getCurrentISOWeek();
  
  // 현재 주의 raw 폴더에서 모든 JSON 파일 읽기
  const s3Path = `s3://${BUCKET}/played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/*.json`;
  
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
  
  const rows = await queryAll<RawChartRow>(conn, sql);
  
  return rows.map((row, index) => ({
    rank: index + 1,
    trackId: row.trackId,
    trackName: row.trackName,
    albumId: row.albumId,
    albumName: row.albumName,
    albumImageUrl: row.albumImageUrl,
    artistIds: JSON.parse(row.artistIds),
    artistNames: JSON.parse(row.artistNames),
    playCount: Number(row.playCount),
    totalDurationMs: Number(row.totalDurationMs),
    lastRank: null,   // 실시간 차트는 이전 비교 없음
    peakRank: null,
    weeksOnChart: null,
  }));
}
```

### 5.3 S3 클라이언트

**파일:** `src/lib/s3/client.ts`

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION || "ap-northeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

export async function getS3Json<T>(key: string): Promise<T | null> {
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));
    
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (error: any) {
    if (error.name === "NoSuchKey") return null;
    throw error;
  }
}

export const s3Paths = {
  chartWeekly: (isoYear: number, isoWeek: number) =>
    `played/charts/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,
  
  chartMonthly: (year: number, month: number) =>
    `played/charts/monthly/${year}/month-${String(month).padStart(2, "0")}.json`,
  
  chartYearly: (year: number) =>
    `played/charts/yearly/${year}.json`,
};
```

### 5.4 실시간 차트 API

**파일:** `src/app/api/v1/charts/realtime/route.ts`

```typescript
import { NextResponse } from "next/server";
import { queryRealtimeChart } from "@/lib/duckdb/queries/realtime";
import { getCurrentISOWeek, getISOWeekRange } from "@/lib/utils/iso-week";
import type { ChartResponse } from "@/lib/types/played";

// ISR: 2시간마다 재검증 (Lambda 수집 주기와 동일)
export const revalidate = 7200;

export async function GET() {
  try {
    const { isoYear, isoWeek } = getCurrentISOWeek();
    const { start, end } = getISOWeekRange(isoYear, isoWeek);
    
    // DuckDB로 현재 주의 raw 데이터 집계
    const items = await queryRealtimeChart(50);
    
    const response: ChartResponse = {
      type: "realtime",
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        isoYear,
        isoWeek,
      },
      items,
      generatedAt: new Date().toISOString(),
    };
    
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=7200, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("Realtime chart error:", error);
    return NextResponse.json(
      { error: "Failed to fetch realtime chart" },
      { status: 500 }
    );
  }
}
```

### 5.5 주간 차트 API

**파일:** `src/app/api/v1/charts/weekly/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { getS3Json, s3Paths } from "@/lib/s3/client";
import type { ChartResponse } from "@/lib/types/played";

// ISR: 4시간마다 재검증
export const revalidate = 14400;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 쿼리 파라미터 또는 현재 주
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(getISOWeekYear(now)));
    const week = parseInt(searchParams.get("week") || String(getISOWeek(now)));
    
    // S3에서 차트 JSON 가져오기
    const chart = await getS3Json<ChartResponse>(
      s3Paths.chartWeekly(year, week)
    );
    
    if (!chart) {
      return NextResponse.json(
        { error: "Chart not found", year, week },
        { status: 404 }
      );
    }
    
    return NextResponse.json(chart, {
      headers: {
        "Cache-Control": "public, s-maxage=14400, stale-while-revalidate=7200",
      },
    });
  } catch (error) {
    console.error("Weekly chart error:", error);
    return NextResponse.json(
      { error: "Failed to fetch weekly chart" },
      { status: 500 }
    );
  }
}
```

### 5.3 월간 차트 API

**파일:** `src/app/api/v1/charts/monthly/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getS3Json, s3Paths } from "@/lib/s3/client";
import type { ChartResponse } from "@/lib/types/played";

// ISR: 24시간마다 재검증
export const revalidate = 86400;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
    
    // 유효성 검사
    if (month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid month (1-12)" },
        { status: 400 }
      );
    }
    
    // S3에서 차트 JSON 가져오기
    const chart = await getS3Json<ChartResponse>(
      s3Paths.chartMonthly(year, month)
    );
    
    if (!chart) {
      return NextResponse.json(
        { error: "Chart not found", year, month },
        { status: 404 }
      );
    }
    
    return NextResponse.json(chart, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200",
      },
    });
  } catch (error) {
    console.error("Monthly chart error:", error);
    return NextResponse.json(
      { error: "Failed to fetch monthly chart" },
      { status: 500 }
    );
  }
}
```

### 5.4 연간 차트 API

**파일:** `src/app/api/v1/charts/yearly/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getS3Json, s3Paths } from "@/lib/s3/client";
import type { ChartResponse } from "@/lib/types/played";

// ISR: 1주일마다 재검증
export const revalidate = 604800;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    
    // 유효성 검사
    if (year < 2020 || year > now.getFullYear()) {
      return NextResponse.json(
        { error: `Invalid year (2020-${now.getFullYear()})` },
        { status: 400 }
      );
    }
    
    // S3에서 차트 JSON 가져오기
    const chart = await getS3Json<ChartResponse>(
      s3Paths.chartYearly(year)
    );
    
    if (!chart) {
      return NextResponse.json(
        { error: "Chart not found", year },
        { status: 404 }
      );
    }
    
    return NextResponse.json(chart, {
      headers: {
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Yearly chart error:", error);
    return NextResponse.json(
      { error: "Failed to fetch yearly chart" },
      { status: 500 }
    );
  }
}
```

### 5.5 기존 API 정리

**삭제할 파일:**
```
src/app/api/v1/recently-played/route.ts   ← Lambda로 대체
src/app/api/v1/stats/route.ts             ← 차트 API로 대체
```

## API 사용 예시

### 주간 차트
```bash
GET /api/v1/charts/weekly              # 이번 주
GET /api/v1/charts/weekly?year=2025&week=49
```

### 월간 차트
```bash
GET /api/v1/charts/monthly             # 이번 달
GET /api/v1/charts/monthly?year=2025&month=12
```

### 연간 차트
```bash
GET /api/v1/charts/yearly              # 올해
GET /api/v1/charts/yearly?year=2024
```

## 응답 형식

```typescript
{
  "type": "weekly",
  "period": {
    "start": "2025-12-01T00:00:00.000Z",
    "end": "2025-12-07T23:59:59.999Z",
    "isoYear": 2025,
    "isoWeek": 49
  },
  "generatedAt": "2025-12-08T00:30:00.000Z",
  "items": [
    {
      "rank": 1,
      "lastRank": 3,           // 지난주 순위 (null = NEW)
      "peakRank": 1,           // 역대 최고 순위
      "weeksOnChart": 5,       // 차트 진입 주차
      "trackId": "xxx",
      "trackName": "Song Name",
      "albumId": "yyy",
      "albumName": "Album Name",
      "albumImageUrl": "https://...",
      "artistIds": ["aaa", "bbb"],
      "artistNames": ["Artist 1", "Artist 2"],
      "playCount": 15,
      "totalDurationMs": 3150000
    }
  ]
}
```

## 캐싱 전략 요약

| 차트 | revalidate | Cache-Control | stale-while-revalidate |
|------|------------|---------------|------------------------|
| 주간 | 4시간 | s-maxage=14400 | 2시간 |
| 월간 | 24시간 | s-maxage=86400 | 12시간 |
| 연간 | 1주일 | s-maxage=604800 | 24시간 |

## 체크리스트

- [ ] `src/lib/s3/client.ts` 생성
- [ ] `src/app/api/v1/charts/weekly/route.ts` 생성
- [ ] `src/app/api/v1/charts/monthly/route.ts` 생성
- [ ] `src/app/api/v1/charts/yearly/route.ts` 생성
- [ ] `src/app/api/v1/recently-played/route.ts` 삭제
- [ ] `src/app/api/v1/stats/route.ts` 삭제
- [ ] 로컬 테스트
- [ ] Vercel 배포 테스트

## 예상 소요 시간

1일
