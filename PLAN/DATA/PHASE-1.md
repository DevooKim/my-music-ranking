# Phase 1: 프로젝트 셋업

## 목표

기존 PostgreSQL/Drizzle 관련 의존성을 제거하고 DuckDB 환경을 구성합니다.

## 작업 목록

### 1.1 새 브랜치 생성

```bash
git checkout main
git pull origin main
git checkout -b feature/s3-duckdb
```

### 1.2 DuckDB 패키지 설치

```bash
bun add duckdb-async
bun add @aws-sdk/client-s3
```

**package.json 변경:**
```diff
{
  "dependencies": {
+   "duckdb-async": "^1.1.0",
+   "@aws-sdk/client-s3": "^3.x",
-   "drizzle-orm": "^x.x.x",
-   "@neondatabase/serverless": "^x.x.x",
  },
  "devDependencies": {
-   "drizzle-kit": "^x.x.x",
  }
}
```

### 1.3 PostgreSQL/Drizzle 관련 제거

**삭제할 파일/폴더:**
```
drizzle/
├── 0000_yielding_spacker_dave.sql
├── 0001_closed_lockjaw.sql
├── 0002_deep_professor_monster.sql
└── meta/
    ├── _journal.json
    ├── 0000_snapshot.json
    ├── 0001_snapshot.json
    └── 0002_snapshot.json

drizzle.config.ts
src/db/
├── index.ts
└── schema.ts
```

### 1.4 불필요한 스크립트 제거

**삭제할 파일:**
```
scripts/
├── generate-charts.ts    ← 차트 생성 (DuckDB 쿼리로 대체)
├── generate-current.ts   ← 현재 차트 (DuckDB 쿼리로 대체)
├── migrate.ts            ← Drizzle 마이그레이션
└── seed.ts               ← DB 시딩
```

### 1.5 기존 Lambda 정리

**삭제할 폴더:**
```
lambda/live-corrector/    ← 새로 작성 예정
```

## 체크리스트

- [ ] `feature/s3-duckdb` 브랜치 생성
- [ ] `duckdb-async` 패키지 설치
- [ ] `@aws-sdk/client-s3` 패키지 설치
- [ ] `drizzle-orm`, `drizzle-kit` 제거
- [ ] `@neondatabase/serverless` 제거
- [ ] `drizzle/` 폴더 삭제
- [ ] `drizzle.config.ts` 삭제
- [ ] `src/db/` 폴더 삭제
- [ ] `scripts/generate-charts.ts` 삭제
- [ ] `scripts/generate-current.ts` 삭제
- [ ] `scripts/migrate.ts` 삭제
- [ ] `scripts/seed.ts` 삭제
- [ ] `lambda/live-corrector/` 폴더 삭제

## 예상 소요 시간

1일
