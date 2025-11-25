# 음악 차트 플랫폼 데이터 구조 및 업데이트 시스템

Spotify 재생 기록을 수집하여 실시간/주간/월간/연간 차트를 제공하는 시스템입니다. DB는 원본 데이터만 저장하고, 차트 결과물은 파일 시스템(현재)과 S3(과거/확정)에 JSON으로 저장하여 DB 부담을 최소화합니다.

---

## 1. DB 스키마 구성

### 기존 유지

- `artist`, `album`, `track`, `trackArtist`, `albumArtist`, `trackName`, `played` - 현재 schema.ts 그대로 유지

### 신규 추가

| 테이블       | 용도                     | 주요 컬럼                           |
| ------------ | ------------------------ | ----------------------------------- |
| `chartIndex` | S3 과거 차트 목록 인덱스 | chartType, year, week, month, s3Key |

> **참고**: `trackChartHistory`는 DB 대신 파일 시스템(`data/cache/track-history.json`)으로 관리

---

## 2. 저장소 구조

### 파일 시스템 (서버 로컬 - 빠른 갱신 필요한 현재 데이터)

```
data/
├── current/
│   ├── charts/
│   │   ├── realtime.json       ← 실시간 (2시간마다 갱신)
│   │   └── weekly.json         ← 이번 주 (4시간마다 갱신)
│   └── artists/
│       ├── realtime.json       ← 아티스트 실시간
│       └── weekly.json         ← 아티스트 이번 주
└── cache/
    └── track-history.json      ← PEAK/WEEKS 계산용 (주간 차트 생성 시 갱신)
```

### S3 (과거 확정 데이터 + 월간/연간)

```
s3://bucket/
├── charts/
│   ├── weekly/{year}/{week}.json   ← 과거 주간 (확정)
│   ├── monthly/{year}/{month}.json ← 월간 (현재 포함, 24시간마다 갱신)
│   └── yearly/{year}.json          ← 연간 (현재 포함, 1주일마다 갱신)
└── artists/
    ├── weekly/{year}/{week}.json   ← 과거 주간 (확정)
    ├── monthly/{year}/{month}.json ← 월간
    └── yearly/{year}.json          ← 연간
```

---

## 3. 데이터 흐름 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  1단계: 재생 기록 수집 (기존 Lambda 수정)                         │
├─────────────────────────────────────────────────────────────────┤
│  Lambda (5분마다) - live-corrector                               │
│  ├── Spotify API → recently played 조회                         │
│  ├── S3에 원본 저장 (기존 유지)                                  │
│  └── POST /api/v1/recently-played 호출 (신규 추가)              │
│       → played 테이블에 저장                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2단계: 차트 생성 (Cron Job 또는 Lambda)                         │
├─────────────────────────────────────────────────────────────────┤
│  realtime-chart-generator (2시간마다)                            │
│  ├── DB: played 최근 24시간 집계                                 │
│  ├── 파일: data/current/charts/realtime.json 저장               │
│  └── 파일: data/current/artists/realtime.json 저장              │
│                                                                  │
│  weekly-chart-generator (4시간마다)                              │
│  ├── DB: played 이번 주 집계                                     │
│  ├── 파일: track-history.json 조회/업데이트 (PEAK, WEEKS)        │
│  ├── 파일: data/current/charts/weekly.json 저장                 │
│  ├── 파일: data/current/artists/weekly.json 저장                │
│  └── (월요일 00:00) 지난주 차트 → S3 확정 저장 + chartIndex 업데이트│
│                                                                  │
│  monthly-chart-generator (24시간마다)                            │
│  ├── DB: played 이번 달 집계                                     │
│  ├── S3: charts/monthly/{year}/{month}.json 저장                │
│  ├── S3: artists/monthly/{year}/{month}.json 저장               │
│  └── DB: chartIndex 업데이트                                     │
│                                                                  │
│  yearly-chart-generator (1주일마다)                              │
│  ├── DB: played 올해 집계                                        │
│  ├── S3: charts/yearly/{year}.json 저장                         │
│  ├── S3: artists/yearly/{year}.json 저장                        │
│  └── DB: chartIndex 업데이트                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3단계: 서빙 (Next.js ISR)                                       │
├─────────────────────────────────────────────────────────────────┤
│  파일 시스템에서 직접 읽기 (현재 데이터)                          │
│  ├── 실시간: data/current/charts/realtime.json (revalidate 2시간)│
│  └── 이번 주: data/current/charts/weekly.json (revalidate 4시간) │
│                                                                  │
│  S3에서 fetch (과거/월간/연간)                                   │
│  ├── 과거 주간: 정적 (재검증 없음)                                │
│  ├── 월간: 현재 월만 revalidate 24시간                           │
│  └── 연간: 현재 연만 revalidate 1주일                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 차트별 스펙 요약

### 트랙 차트

| 차트      | 표시 컬럼             | 갱신 주기 | 저장소      | DB 사용    |
| --------- | --------------------- | --------- | ----------- | ---------- |
| 실시간    | 순위, 재생수          | 2시간     | 파일 시스템 | played만   |
| 이번 주   | 순위, LW, PEAK, WEEKS | 4시간     | 파일 시스템 | played만   |
| 과거 주간 | 순위, LW, PEAK, WEEKS | 확정      | S3          | chartIndex |
| 월간      | 순위, 재생수          | 24시간    | S3          | chartIndex |
| 연간      | 순위, 재생수          | 1주일     | S3          | chartIndex |

### 아티스트 차트

| 차트      | 표시 컬럼            | 갱신 주기 | 저장소      | DB 사용    |
| --------- | -------------------- | --------- | ----------- | ---------- |
| 실시간    | 순위, 재생수, 트랙수 | 2시간     | 파일 시스템 | played만   |
| 이번 주   | 순위, 재생수, 트랙수 | 4시간     | 파일 시스템 | played만   |
| 과거 주간 | 순위, 재생수, 트랙수 | 확정      | S3          | chartIndex |
| 월간      | 순위, 재생수, 트랙수 | 24시간    | S3          | chartIndex |
| 연간      | 순위, 재생수, 트랙수 | 1주일     | S3          | chartIndex |

---

## 5. Lambda/Cron 구성

| 작업                            | 스케줄      | 역할                                                      |
| ------------------------------- | ----------- | --------------------------------------------------------- |
| `live-corrector` (Lambda, 수정) | 5분마다     | Spotify 수집 → S3 저장 → **POST /api/v1/recently-played** |
| `realtime-chart-generator`      | 2시간마다   | 트랙 + 아티스트 실시간 차트 → 파일 시스템                 |
| `weekly-chart-generator`        | 4시간마다   | 트랙 + 아티스트 이번 주 차트 → 파일 시스템                |
| `weekly-chart-finalizer`        | 매주 월요일 | 지난주 차트 확정 → S3 저장                                |
| `monthly-chart-generator`       | 24시간마다  | 트랙 + 아티스트 월간 차트 → S3                            |
| `yearly-chart-generator`        | 1주일마다   | 트랙 + 아티스트 연간 차트 → S3                            |

---

## 6. 구현 순서

1. **DB 스키마 추가** - `chartIndex` 테이블 생성
2. **파일 시스템 구조 생성** - `data/current/`, `data/cache/` 디렉토리
3. **live-corrector 수정** - scheduled-event-logger.ts에 POST API 호출 추가
4. **차트 생성 로직 구현** - 실시간 → 주간 → 월간 → 연간 순서
5. **S3 버킷 설정** - 과거 차트 저장용 경로 및 CloudFront 연동
6. **Next.js 페이지 구현** - 파일 시스템/S3에서 차트 데이터 읽기, ISR 적용

---

## 7. 신규 DB 스키마 상세

### chartIndex

```typescript
export const chartIndex = pgTable(
  "chart_index",
  {
    id: serial("id").primaryKey(),
    chartType: varchar("chart_type", { length: 30 }).notNull(),
    // 'track-weekly' | 'track-monthly' | 'track-yearly'
    // 'artist-weekly' | 'artist-monthly' | 'artist-yearly'
    year: integer("year").notNull(),
    week: integer("week"), // 주간 차트용
    month: integer("month"), // 월간 차트용
    s3Key: text("s3_key").notNull(), // S3 파일 경로
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueChart: uniqueIndex("unique_chart_index").on(
      table.chartType,
      table.year,
      table.week,
      table.month
    ),
    chartTypeIdx: index("idx_chart_type").on(table.chartType),
  })
);
```

---

## 8. 파일 시스템 캐시 구조

### track-history.json (PEAK/WEEKS 계산용)

```json
[
  {
    "trackId": "62n4Fv2LF86hDkJyeb5NZf",
    "peakRank": 1,
    "currentStreak": 5,
    "lastChartYear": 2025,
    "lastChartWeek": 47
  }
]
```

---

## 9. 차트 JSON 구조

### 트랙 실시간 차트 (data/current/charts/realtime.json)

```json
{
  "chartType": "track-realtime",
  "generatedAt": "2025-01-15T02:00:00Z",
  "periodHours": 24,
  "entries": [
    {
      "rank": 1,
      "track": {
        "id": "62n4Fv2LF86hDkJyeb5NZf",
        "name": "Know You Did",
        "externalUrl": "https://open.spotify.com/track/..."
      },
      "album": {
        "id": "3B6D95jRuk3UfNeKSmdlLo",
        "name": "Know You Did / Say Yes",
        "imageUrl": "https://i.scdn.co/image/..."
      },
      "artists": [{ "id": "3zyq3DzSd4aue9Q7s1qMVu", "name": "bongjeingan" }],
      "playCount": 15
    }
  ]
}
```

### 트랙 주간 차트 (data/current/charts/weekly.json 또는 S3)

```json
{
  "chartType": "track-weekly",
  "year": 2025,
  "week": 48,
  "status": "in-progress",
  "periodStart": "2025-11-25T00:00:00Z",
  "periodEnd": "2025-12-01T23:59:59Z",
  "generatedAt": "2025-11-25T14:00:00Z",
  "entries": [
    {
      "rank": 1,
      "track": { "id": "xxx", "name": "...", "externalUrl": "..." },
      "album": { "id": "xxx", "name": "...", "imageUrl": "..." },
      "artists": [{ "id": "xxx", "name": "..." }],
      "playCount": 25,
      "lw": 2,
      "peak": 1,
      "weeks": 5,
      "isNew": false,
      "isReEntry": false
    }
  ]
}
```

### 아티스트 실시간 차트 (data/current/artists/realtime.json)

```json
{
  "chartType": "artist-realtime",
  "generatedAt": "2025-01-15T02:00:00Z",
  "periodHours": 24,
  "entries": [
    {
      "rank": 1,
      "artist": {
        "id": "3zyq3DzSd4aue9Q7s1qMVu",
        "name": "bongjeingan",
        "externalUrl": "https://open.spotify.com/artist/..."
      },
      "playCount": 45,
      "trackCount": 8
    }
  ]
}
```

### 아티스트 주간 차트 (data/current/artists/weekly.json 또는 S3)

```json
{
  "chartType": "artist-weekly",
  "year": 2025,
  "week": 48,
  "status": "in-progress",
  "periodStart": "2025-11-25T00:00:00Z",
  "periodEnd": "2025-12-01T23:59:59Z",
  "generatedAt": "2025-11-25T14:00:00Z",
  "entries": [
    {
      "rank": 1,
      "artist": {
        "id": "3zyq3DzSd4aue9Q7s1qMVu",
        "name": "bongjeingan",
        "externalUrl": "https://open.spotify.com/artist/..."
      },
      "playCount": 120,
      "trackCount": 15
    }
  ]
}
```

---

## 10. 데이터 복구

파일 시스템 데이터가 유실되어도 **played 테이블에서 완전 복구 가능**:

```
서버 재시작 또는 파일 유실 감지
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  복구 스크립트 실행                                       │
├─────────────────────────────────────────────────────────┤
│  1. data/current/ 디렉토리 확인 → 없으면 생성            │
│                                                          │
│  2. 실시간 차트 재생성                                    │
│     └── DB: played 최근 24시간 집계 → realtime.json      │
│                                                          │
│  3. 이번 주 차트 재생성                                   │
│     ├── DB: played 이번 주 집계                          │
│     ├── S3: 지난주 차트 조회 (LW 계산용)                  │
│     └── weekly.json 생성                                 │
│                                                          │
│  4. track-history.json 복구                              │
│     └── S3 과거 주간 차트들 순회하며 히스토리 재구성       │
└─────────────────────────────────────────────────────────┘
```

---

## Further Considerations

1. **Lambda vs Cron Job?** - 단일 서버라면 Next.js Cron 또는 node-cron 사용 가능

2. **주간 차트 기준일?** - 월요일~일요일 / 일요일~토요일 중 선택

3. **API 인증 방식?** - live-corrector → Next.js API 호출 시 API Key / IAM 인증 중 선택

## 추가 비용 절감 팁

1. CloudFront 캐싱 활용
  - S3 직접 접근 → CloudFront 경유
  - S3 GET 요청 감소
  - 전송 비용 감소

2. 차트 데이터 압축
```javascript
// gzip 압축으로 저장
await s3Client.send(new PutObjectCommand({
  Bucket: bucket,
  Key: key,
  Body: gzipSync(JSON.stringify(chartData)),
  ContentType: "application/json",
  ContentEncoding: "gzip",
}));
```

3. Lambda 메모리 최적화
  - MemorySize: 128