# S3 JSON 기반 음악 차트 시스템

## 개요

PostgreSQL/Drizzle 기반에서 **S3 JSON** 기반으로 데이터 아키텍처를 전환합니다.

## 최종 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  Lambda (2시간마다) - collector                              │
│  └── Spotify API → S3 raw JSON 저장                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Lambda (매주 월요일) - weekly-processor                     │
│  ├── raw JSON → weekly JSON 병합                            │
│  ├── 주간 차트 계산 (LW, peak, weeks 포함)                   │
│  └── track-stats.json 업데이트                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Lambda (매월 1일) - monthly-processor                       │
│  ├── weekly 차트 집계 → 월간 차트                            │
│  └── LM, peak, months 계산                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  S3 (데이터 저장소)                                          │
│  └── played/                                                │
│      ├── raw/{isoYear}/{isoWeek}/YYYYMMDD_HHmm.json         │
│      ├── weekly/{isoYear}/week-{isoWeek}.json               │
│      ├── charts/                                            │
│      │   ├── weekly/{isoYear}/week-{isoWeek}.json           │
│      │   ├── monthly/{year}/month-{month}.json              │
│      │   └── yearly/{year}.json                             │
│      └── stats/track-stats.json                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js                                                     │
│  ├── 실시간 차트: DuckDB로 raw JSON 쿼리 (revalidate 2시간)  │
│  ├── 주간 차트: charts/weekly JSON 반환 (revalidate 4시간)   │
│  ├── 월간 차트: charts/monthly JSON 반환 (revalidate 24시간) │
│  └── 연간 차트: charts/yearly JSON 반환 (revalidate 1주일)   │
└─────────────────────────────────────────────────────────────┘
```

## Phase 목록

| Phase | 제목 | 예상 소요 |
|-------|------|----------|
| [Phase 1](./PHASE-1.md) | 프로젝트 셋업 | 1일 |
| [Phase 2](./PHASE-2.md) | S3 구조 및 타입 설계 | 1일 |
| [Phase 3](./PHASE-3.md) | 차트 계산 로직 | 1일 |
| [Phase 4](./PHASE-4.md) | Lambda 함수 | 2일 |
| [Phase 5](./PHASE-5.md) | Next.js API | 1일 |
| [Phase 6](./PHASE-6.md) | 정리 및 테스트 | 1일 |

## 주요 변경점 (기존 대비)

| 항목 | 기존 계획 | 변경된 계획 |
|------|----------|------------|
| 실시간 차트 | DuckDB 전체 사용 | DuckDB로 raw만 쿼리 |
| 주간/월간/연간 차트 | DuckDB 쿼리 | Lambda 사전 계산 |
| LW/peak/weeks | ❌ 없음 | ✅ track-stats.json |
| Next.js 역할 | 전체 집계 | 실시간만 DuckDB, 나머지는 JSON 전달 |
| DuckDB | 전체 사용 | 실시간 차트 전용 |

## 데이터 규모

| 항목 | 값 |
|------|-----|
| 연간 재생 기록 | ~10,000건 |
| 주당 재생 기록 | ~192건 |
| 주당 JSON 용량 | ~550KB |
| 연간 누적 데이터 | ~28MB |

## S3 비용 (월간)

| 항목 | 비용 |
|------|------|
| 저장 | $0.001 |
| PUT 요청 | $0.002 |
| GET 요청 | $0.0004 |
| 데이터 전송 | $0.063 |
| **합계** | **~$0.07/월** |

## 브랜치 전략

```
main
  └── feature/s3-duckdb
```
