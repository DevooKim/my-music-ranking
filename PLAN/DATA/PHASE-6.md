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
│  Lambda Merger      │  (매주 월요일)
│  → S3 weekly JSON   │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Next.js + DuckDB   │  (ISR 캐싱)
│  → 차트 API         │
└─────────────────────┘
```

## 기술 스택

- **Frontend/API**: Next.js 15
- **Query Engine**: DuckDB (in-memory)
- **Storage**: S3 (JSON)
- **Serverless**: AWS Lambda + SAM
- **Deployment**: Vercel

## S3 데이터 구조

```
s3://my-music-ranking/played/
├── raw/{isoYear}/{isoWeek}/{timestamp}.json
└── weekly/{isoYear}/week-{isoWeek}.json
```

## API 엔드포인트

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `/api/v1/charts/realtime` | 실시간 차트 | 2시간 |
| `/api/v1/charts/weekly` | 주간 차트 | 4시간 |
| `/api/v1/charts/monthly` | 월간 차트 | 24시간 |
| `/api/v1/charts/yearly` | 연간 차트 | 1주일 |

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
    
    it("handles year-start correctly (Jan 1, 2025)", () => {
      const date = new Date("2025-01-01");
      const result = getCurrentISOWeek(date);
      
      // 2025-01-01 is ISO week 1 of 2025
      expect(result.isoYear).toBe(2025);
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
  
  describe("getISOWeekRange", () => {
    it("returns correct date range for a week", () => {
      const { start, end } = getISOWeekRange(2025, 49);
      
      expect(start.toISOString().slice(0, 10)).toBe("2025-12-01");
      expect(end.toISOString().slice(0, 10)).toBe("2025-12-07");
    });
  });
});
```

**파일:** `__tests__/lib/utils/s3-paths.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { s3Paths } from "@/lib/utils/s3-paths";

describe("s3-paths", () => {
  describe("raw", () => {
    it("generates correct raw path", () => {
      const path = s3Paths.raw(2025, 49, "2025-12-04T02-00-00Z");
      expect(path).toBe("played/raw/2025/49/2025-12-04T02-00-00Z.json");
    });
    
    it("pads week number", () => {
      const path = s3Paths.raw(2025, 1, "2025-01-01T00-00-00Z");
      expect(path).toBe("played/raw/2025/01/2025-01-01T00-00-00Z.json");
    });
  });
  
  describe("weekly", () => {
    it("generates correct weekly path", () => {
      const path = s3Paths.weekly(2025, 49);
      expect(path).toBe("played/weekly/2025/week-49.json");
    });
    
    it("pads week number", () => {
      const path = s3Paths.weekly(2025, 1);
      expect(path).toBe("played/weekly/2025/week-01.json");
    });
  });
  
  describe("toS3Url", () => {
    it("generates correct S3 URL", () => {
      const url = s3Paths.toS3Url("played/weekly/2025/week-49.json");
      expect(url).toContain("s3://");
      expect(url).toContain("played/weekly/2025/week-49.json");
    });
  });
});
```

**파일:** `__tests__/lib/duckdb/queries.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDuckDB, closeDuckDB } from "@/lib/duckdb/client";

describe("duckdb client", () => {
  beforeAll(async () => {
    // 테스트용 환경변수 설정
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_REGION = "ap-northeast-2";
  });
  
  afterAll(async () => {
    await closeDuckDB();
  });
  
  it("creates in-memory database", async () => {
    const db = await getDuckDB();
    expect(db).toBeDefined();
  });
  
  it("can execute simple query", async () => {
    const db = await getDuckDB();
    const result = await db.all("SELECT 1 + 1 as sum");
    expect(result[0].sum).toBe(2);
  });
});
```

### 6.5 Vitest 설정 (없는 경우)

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
│   ├── PHASE-1.md
│   ├── PHASE-2.md
│   ├── PHASE-3.md
│   ├── PHASE-4.md
│   ├── PHASE-5.md
│   └── PHASE-6.md
├── lambda/
│   ├── collector/
│   ├── merger/
│   ├── shared/
│   └── template.yaml
├── src/
│   ├── app/
│   │   ├── api/v1/charts/
│   │   │   ├── realtime/route.ts
│   │   │   ├── weekly/route.ts
│   │   │   ├── monthly/route.ts
│   │   │   └── yearly/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── lib/
│       ├── duckdb/
│       │   ├── client.ts
│       │   ├── s3-reader.ts
│       │   └── queries/
│       ├── types/
│       │   └── played.ts
│       └── utils/
│           ├── iso-week.ts
│           ├── s3-paths.ts
│           └── spotify-mapper.ts
├── __tests__/
│   └── lib/
│       ├── utils/
│       │   ├── iso-week.test.ts
│       │   └── s3-paths.test.ts
│       └── duckdb/
│           └── queries.test.ts
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
- [ ] `src/lib/utils/chart-storage.ts` 삭제
- [ ] `src/lib/types/chart.ts` 삭제 (새 타입으로 교체)
- [ ] `.env.example` 업데이트
- [ ] `README.md` 업데이트
- [ ] `__tests__/lib/utils/iso-week.test.ts` 생성
- [ ] `__tests__/lib/utils/s3-paths.test.ts` 생성
- [ ] `__tests__/lib/duckdb/queries.test.ts` 생성
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
   - DuckDB 쿼리 튜닝
   - ISR 캐시 히트율 모니터링
