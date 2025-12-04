# Phase 5: Next.js API 수정

## 목표

DuckDB 쿼리 함수를 사용하여 차트 API를 구현하고 ISR 캐싱을 적용합니다.

## API 구조

```
src/app/api/v1/charts/
├── realtime/
│   └── route.ts      ← 실시간 차트 (2시간 캐싱)
├── weekly/
│   └── route.ts      ← 주간 차트 (4시간 캐싱)
├── monthly/
│   └── route.ts      ← 월간 차트 (24시간 캐싱)
└── yearly/
    └── route.ts      ← 연간 차트 (1주일 캐싱)
```

## 작업 목록

### 5.1 실시간 차트 API

**파일:** `src/app/api/v1/charts/realtime/route.ts`

```typescript
import { NextResponse } from "next/server";
import { queryRealtimeChart } from "@/lib/duckdb/queries";

// ISR: 2시간마다 재검증
export const revalidate = 7200;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 100);
    
    const chart = await queryRealtimeChart(limit);
    
    return NextResponse.json(chart, {
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

### 5.2 주간 차트 API

**파일:** `src/app/api/v1/charts/weekly/route.ts`

```typescript
import { NextResponse } from "next/server";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { queryWeeklyChart } from "@/lib/duckdb/queries";

// ISR: 4시간마다 재검증
export const revalidate = 14400;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 쿼리 파라미터 또는 현재 주
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(getISOWeekYear(now)));
    const week = parseInt(searchParams.get("week") || String(getISOWeek(now)));
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 100);
    
    const chart = await queryWeeklyChart(year, week, limit);
    
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
import { queryMonthlyChart } from "@/lib/duckdb/queries";

// ISR: 24시간마다 재검증
export const revalidate = 86400;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 쿼리 파라미터 또는 현재 월
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 100);
    
    // 유효성 검사
    if (month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid month (1-12)" },
        { status: 400 }
      );
    }
    
    const chart = await queryMonthlyChart(year, month, limit);
    
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
import { queryYearlyChart } from "@/lib/duckdb/queries";

// ISR: 1주일마다 재검증
export const revalidate = 604800;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // 쿼리 파라미터 또는 현재 연도
    const now = new Date();
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 100);
    
    // 유효성 검사
    if (year < 2020 || year > now.getFullYear()) {
      return NextResponse.json(
        { error: `Invalid year (2020-${now.getFullYear()})` },
        { status: 400 }
      );
    }
    
    const chart = await queryYearlyChart(year, limit);
    
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

### 5.6 API 라우트 인덱스 (선택)

**파일:** `src/app/api/v1/charts/route.ts`

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    endpoints: {
      realtime: "/api/v1/charts/realtime",
      weekly: "/api/v1/charts/weekly?year=2025&week=49",
      monthly: "/api/v1/charts/monthly?year=2025&month=12",
      yearly: "/api/v1/charts/yearly?year=2025",
    },
    params: {
      limit: "결과 개수 (최대 100)",
      year: "연도 (ISO year for weekly)",
      week: "ISO 주차 (1-53)",
      month: "월 (1-12)",
    },
  });
}
```

## API 사용 예시

### 실시간 차트
```bash
GET /api/v1/charts/realtime
GET /api/v1/charts/realtime?limit=50
```

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
    "end": "2025-12-07T23:59:59.999Z"
  },
  "generatedAt": "2025-12-04T12:00:00.000Z",
  "items": [
    {
      "rank": 1,
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
| 실시간 | 2시간 | s-maxage=7200 | 1시간 |
| 주간 | 4시간 | s-maxage=14400 | 2시간 |
| 월간 | 24시간 | s-maxage=86400 | 12시간 |
| 연간 | 1주일 | s-maxage=604800 | 24시간 |

## 체크리스트

- [ ] `src/app/api/v1/charts/realtime/route.ts` 생성
- [ ] `src/app/api/v1/charts/weekly/route.ts` 생성
- [ ] `src/app/api/v1/charts/monthly/route.ts` 생성
- [ ] `src/app/api/v1/charts/yearly/route.ts` 생성
- [ ] `src/app/api/v1/charts/route.ts` 생성 (선택)
- [ ] `src/app/api/v1/recently-played/route.ts` 삭제
- [ ] `src/app/api/v1/stats/route.ts` 삭제
- [ ] 로컬 테스트
- [ ] Vercel 배포 테스트

## 예상 소요 시간

1일
