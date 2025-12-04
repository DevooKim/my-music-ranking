# Phase 6: 정리 및 테스트

## 목표

불필요한 파일을 정리하고, 테스트를 작성하며, 문서를 업데이트합니다.

## 작업 목록

### 6.1 불필요한 파일 삭제

**삭제할 파일/폴더:**

```
# 기존 데이터 폴더
data/
├── current/                  ← JSON 차트 파일
│   ├── artists/
│   │   ├── realtime.json
│   │   └── weekly.json
│   └── charts/
│       ├── realtime.json
│       └── weekly.json
├── cache/                    ← 로컬 캐시
│   └── track-history.json
└── example/
    └── stats.json

# 기존 서비스 코드
src/lib/services/
├── recently-played.ts
└── chart/
    ├── index.ts
    ├── monthly.ts
    ├── realtime.ts
    ├── weekly.ts
    └── yearly.ts

# 기존 유틸리티
src/lib/utils/
├── chart-storage.ts
└── s3-storage.ts (교체)

# 기존 타입
src/lib/types/
└── chart.ts (교체)

# 기존 검증
src/lib/validations/
└── spotify.ts

# 주의: src/lib/duckdb/는 삭제하지 않음
# → 실시간 차트 쿼리용으로 유지
```

### 6.2 환경변수 정리

**파일:** `.env.example`

```bash
# ===================
# S3 Configuration
# ===================
S3_BUCKET=my-music-ranking
S3_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# ===================
# Spotify API (Lambda용)
# ===================
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REFRESH_TOKEN=your_refresh_token

# ===================
# 삭제된 환경변수
# ===================
# DATABASE_URL (PostgreSQL 제거)
# NEON_DATABASE_URL (Neon 제거)
```

### 6.3 README 업데이트

**파일:** `README.md`

```markdown
# My Music Ranking

Spotify 재생 기록 기반 개인 음악 차트 서비스

## 아키텍처

```
┌─────────────────────┐
│  Spotify API        │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Lambda Collector   │  (2시간마다)
│  → S3 raw JSON      │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Lambda Weekly      │  (매주 월요일)
│  Processor          │
│  → S3 weekly + 차트 │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Lambda Monthly     │  (매월 1일)
│  Processor          │
│  → S3 월간 차트     │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Next.js            │  (ISR 캐싱)
│  → 차트 JSON 반환   │
└─────────────────────┘
```

## 기술 스택

- **Frontend/API**: Next.js 16
- **Storage**: S3 (JSON)
- **Serverless**: AWS Lambda + SAM
- **Deployment**: Vercel

## S3 데이터 구조

```
s3://my-music-ranking/played/
├── raw/{isoYear}/{isoWeek}/{timestamp}.json    ← 2시간마다 수집
├── weekly/{isoYear}/week-{isoWeek}.json        ← 재생 기록 병합
├── charts/
│   ├── weekly/{isoYear}/week-{isoWeek}.json    ← 주간 차트 (LW/peak/weeks)
│   ├── monthly/{year}/month-{month}.json       ← 월간 차트
│   └── yearly/{year}.json                      ← 연간 차트
└── stats/track-stats.json                      ← 트랙별 누적 통계
```

## API 엔드포인트

| Endpoint | Description | Source | Cache |
|----------|-------------|--------|-------|
| `/api/v1/charts/realtime` | 실시간 차트 | DuckDB | 2시간 |
| `/api/v1/charts/weekly` | 주간 차트 | S3 JSON | 4시간 |
| `/api/v1/charts/monthly` | 월간 차트 | S3 JSON | 24시간 |
| `/api/v1/charts/yearly` | 연간 차트 | S3 JSON | 1주일 |

## 차트 응답 형식

```json
{
  "type": "weekly",
  "period": { "start": "...", "end": "...", "isoYear": 2025, "isoWeek": 49 },
  "items": [
    {
      "rank": 1,
      "lastRank": 3,        // 지난주 순위 (null = NEW)
      "peakRank": 1,        // 역대 최고 순위
      "weeksOnChart": 5,    // 차트 진입 횟수
      "trackId": "...",
      "trackName": "...",
      "playCount": 15
    }
  ]
}
```

## 로컬 개발

```bash
# 의존성 설치
bun install

# 환경변수 설정
cp .env.example .env.local

# 개발 서버 실행
bun dev
```

## Lambda 배포

```bash
cd lambda
sam build
sam deploy --guided
```

## 비용

- S3: ~$0.07/월
- Lambda: 프리티어 범위 내
```

### 6.4 테스트 작성

**파일:** `__tests__/lib/utils/iso-week.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { getCurrentISOWeek, getPreviousISOWeek, getISOWeekRange } from "@/lib/utils/iso-week";

describe("iso-week", () => {
  describe("getCurrentISOWeek", () => {
    it("returns correct ISO week for mid-year date", () => {
      const date = new Date("2025-06-15");
      const result = getCurrentISOWeek(date);
      
      expect(result.isoYear).toBe(2025);
      expect(result.isoWeek).toBe(24);
    });
    
    it("handles year-end correctly (Dec 31, 2025)", () => {
      const date = new Date("2025-12-31");
      const result = getCurrentISOWeek(date);
      
      // 2025-12-31 is ISO week 1 of 2026
      expect(result.isoYear).toBe(2026);
      expect(result.isoWeek).toBe(1);
    });
  });
  
  describe("getPreviousISOWeek", () => {
    it("returns previous week", () => {
      const date = new Date("2025-12-08"); // Week 50
      const result = getPreviousISOWeek(date);
      
      expect(result.isoYear).toBe(2025);
      expect(result.isoWeek).toBe(49);
    });
  });
});
```

**파일:** `__tests__/lib/chart/calculator.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { aggregatePlays, assignRanks } from "@/lib/chart/calculator";
import type { PlayedItem } from "@/lib/types/played";

describe("chart calculator", () => {
  const sampleItems: PlayedItem[] = [
    { trackId: "a", trackName: "Song A", albumId: "1", albumName: "Album 1", albumImageUrl: "", artistIds: ["x"], artistNames: ["Artist X"], playedAt: "2025-12-01T10:00:00Z", durationMs: 200000 },
    { trackId: "a", trackName: "Song A", albumId: "1", albumName: "Album 1", albumImageUrl: "", artistIds: ["x"], artistNames: ["Artist X"], playedAt: "2025-12-01T12:00:00Z", durationMs: 200000 },
    { trackId: "b", trackName: "Song B", albumId: "2", albumName: "Album 2", albumImageUrl: "", artistIds: ["y"], artistNames: ["Artist Y"], playedAt: "2025-12-01T14:00:00Z", durationMs: 180000 },
  ];
  
  describe("aggregatePlays", () => {
    it("aggregates play counts correctly", () => {
      const result = aggregatePlays(sampleItems);
      
      expect(result[0].trackId).toBe("a");
      expect(result[0].playCount).toBe(2);
      expect(result[1].trackId).toBe("b");
      expect(result[1].playCount).toBe(1);
    });
    
    it("calculates total duration", () => {
      const result = aggregatePlays(sampleItems);
      
      expect(result[0].totalDurationMs).toBe(400000);
      expect(result[1].totalDurationMs).toBe(180000);
    });
  });
  
  describe("assignRanks", () => {
    it("assigns correct ranks", () => {
      const aggregated = aggregatePlays(sampleItems);
      const ranked = assignRanks(aggregated, 10);
      
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(2);
    });
  });
});
```

**파일:** `__tests__/lib/chart/stats-manager.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { updateTrackStats, getStatsForChart } from "@/lib/chart/stats-manager";
import type { TrackStats } from "@/lib/types/played";

describe("stats-manager", () => {
  describe("updateTrackStats", () => {
    it("creates new track stats", () => {
      const currentStats: TrackStats = {};
      const chartItems = [
        { rank: 1, trackId: "a", trackName: "Song A", lastRank: null, /* ... */ } as any,
      ];
      
      const { stats } = updateTrackStats(currentStats, chartItems, "weekly", "2025-W49");
      
      expect(stats["a"]).toBeDefined();
      expect(stats["a"].weeklyPeakRank).toBe(1);
      expect(stats["a"].totalWeeksOnChart).toBe(1);
    });
    
    it("updates peak rank when improved", () => {
      const currentStats: TrackStats = {
        "a": {
          weeklyPeakRank: 5,
          weeklyPeakPeriod: "2025-W48",
          totalWeeksOnChart: 3,
          monthlyPeakRank: Infinity,
          monthlyPeakPeriod: "",
          totalMonthsOnChart: 0,
          yearlyPeakRank: Infinity,
          yearlyPeakPeriod: 0,
          totalYearsOnChart: 0,
          trackName: "Song A",
          artistNames: ["Artist X"],
        },
      };
      
      const chartItems = [
        { rank: 2, trackId: "a", trackName: "Song A", lastRank: 5 } as any,
      ];
      
      const { stats } = updateTrackStats(currentStats, chartItems, "weekly", "2025-W49");
      
      expect(stats["a"].weeklyPeakRank).toBe(2);
      expect(stats["a"].totalWeeksOnChart).toBe(4);
    });
  });
});
```

### 6.5 Vitest 설정

**파일:** `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

**package.json 스크립트 추가:**
```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

### 6.6 최종 파일 구조

```
my-music-ranking/
├── PLAN/DATA/
│   ├── README.md
│   ├── PHASE-1.md ~ PHASE-6.md
├── lambda/
│   ├── collector/
│   │   └── handler.ts
│   ├── weekly-processor/
│   │   └── handler.ts
│   ├── monthly-processor/
│   │   └── handler.ts
│   ├── shared/
│   │   ├── s3.ts
│   │   ├── spotify.ts
│   │   ├── chart.ts
│   │   └── types.ts
│   └── template.yaml
├── src/
│   ├── app/
│   │   ├── api/v1/charts/
│   │   │   ├── realtime/route.ts  ← DuckDB 쿼리
│   │   │   ├── weekly/route.ts    ← S3 JSON
│   │   │   ├── monthly/route.ts   ← S3 JSON
│   │   │   └── yearly/route.ts    ← S3 JSON
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── lib/
│       ├── duckdb/                 ← 실시간 차트 전용
│       │   ├── client.ts
│       │   └── queries/
│       │       └── realtime.ts
│       ├── s3/
│       │   └── client.ts
│       ├── chart/                  ← Lambda에서 사용
│       │   ├── calculator.ts
│       │   ├── comparator.ts
│       │   ├── stats-manager.ts
│       │   ├── builder.ts
│       │   └── index.ts
│       ├── types/
│       │   └── played.ts
│       └── utils/
│           ├── iso-week.ts
│           ├── s3-paths.ts
│           └── spotify-mapper.ts
├── __tests__/
│   └── lib/
│       ├── duckdb/
│       │   └── realtime.test.ts
│       ├── utils/
│       │   └── iso-week.test.ts
│       └── chart/
│           ├── calculator.test.ts
│           └── stats-manager.test.ts
├── data/
│   └── seeds/
│       └── recently-played.json  ← 샘플 데이터 유지
├── .env.example
├── README.md
├── package.json
├── vitest.config.ts
└── ...
```

## 체크리스트

- [ ] `data/current/` 삭제
- [ ] `data/cache/` 삭제
- [ ] `data/example/` 삭제
- [ ] `src/lib/services/` 삭제
- [ ] `src/lib/duckdb/` → 새로 작성 (realtime 쿼리용)
- [ ] `src/lib/utils/chart-storage.ts` 삭제
- [ ] `src/lib/types/chart.ts` 삭제 (새 타입으로 교체)
- [ ] `.env.example` 업데이트
- [ ] `README.md` 업데이트
- [ ] 테스트 파일 생성
- [ ] `vitest.config.ts` 설정
- [ ] 테스트 실행 및 통과 확인
- [ ] PR 생성 및 코드 리뷰

## 예상 소요 시간

1일

## 마이그레이션 완료 후

1. **모니터링 설정**
   - CloudWatch 알람 (Lambda 에러)
   - S3 버킷 메트릭

2. **백업 전략**
   - S3 버전 관리 활성화
   - 또는 주기적 스냅샷

3. **성능 최적화**
   - ISR 캐시 히트율 모니터링
   - Lambda 콜드 스타트 최적화
