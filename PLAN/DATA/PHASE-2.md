# Phase 2: S3 구조 설계

## 목표

S3 경로 규칙과 JSON 스키마를 정의하고 유틸리티 함수를 구현합니다.

## S3 버킷 구조

```
s3://my-music-ranking/
└── played/
    ├── raw/                              ← Lambda collector가 적재
    │   └── {isoYear}/{isoWeek}/
    │       ├── 2025-12-04T00-00-00Z.json
    │       ├── 2025-12-04T02-00-00Z.json
    │       └── ...
    ├── weekly/                           ← Lambda weekly-processor가 병합
    │   └── {isoYear}/
    │       └── week-{isoWeek}.json
    ├── charts/                           ← Lambda가 계산한 차트 결과
    │   ├── weekly/{isoYear}/
    │   │   └── week-{isoWeek}.json       ← LW, peak, weeks 포함
    │   ├── monthly/{year}/
    │   │   └── month-{month}.json        ← LM, peak, months 포함
    │   └── yearly/
    │       └── {year}.json               ← LY, peak, years 포함
    └── stats/
        └── track-stats.json              ← 트랙별 누적 통계
```

## 데이터 흐름

```
raw (재생 기록)     →  weekly (병합)     →  charts/weekly (차트)
                                              ↓
                                         charts/monthly (집계)
                                              ↓
                                         charts/yearly (집계)
                                              
                   track-stats.json ← 모든 차트 생성 시 업데이트
```

## 작업 목록

### 2.1 S3 경로 유틸리티 생성

**파일:** `src/lib/utils/s3-paths.ts`

```typescript
const BUCKET = process.env.S3_BUCKET || "my-music-ranking";
const BASE_PATH = "played";

export const s3Paths = {
  bucket: BUCKET,
  
  // raw/{isoYear}/{isoWeek}/{timestamp}.json
  raw: (isoYear: number, isoWeek: number, timestamp: string) =>
    `${BASE_PATH}/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/${timestamp}.json`,
  
  // raw/{isoYear}/{isoWeek}/*.json (glob pattern)
  rawWeekGlob: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/*.json`,
  
  // weekly/{isoYear}/week-{isoWeek}.json
  weekly: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,
  
  // weekly/{isoYear}/*.json (glob pattern)
  weeklyYearGlob: (isoYear: number) =>
    `${BASE_PATH}/weekly/${isoYear}/*.json`,
  
  // S3 URL
  toS3Url: (path: string) => `s3://${BUCKET}/${path}`,
};
```

### 2.2 ISO 주차 유틸리티 생성

**파일:** `src/lib/utils/iso-week.ts`

```typescript
import { getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek, subWeeks } from "date-fns";

export interface ISOWeekInfo {
  isoYear: number;
  isoWeek: number;
  startDate: Date;
  endDate: Date;
}

// 현재 ISO 주차 정보
export function getCurrentISOWeek(date: Date = new Date()): ISOWeekInfo {
  return {
    isoYear: getISOWeekYear(date),
    isoWeek: getISOWeek(date),
    startDate: startOfISOWeek(date),
    endDate: endOfISOWeek(date),
  };
}

// 이전 ISO 주차 정보 (병합 시 사용)
export function getPreviousISOWeek(date: Date = new Date()): ISOWeekInfo {
  const lastWeek = subWeeks(date, 1);
  return getCurrentISOWeek(lastWeek);
}

// ISO 주차로부터 날짜 범위 계산
export function getISOWeekRange(isoYear: number, isoWeek: number): { start: Date; end: Date } {
  // ISO 주차의 첫 번째 날 (월요일) 찾기
  const jan4 = new Date(isoYear, 0, 4);
  const startOfYear = startOfISOWeek(jan4);
  const start = new Date(startOfYear);
  start.setDate(start.getDate() + (isoWeek - 1) * 7);
  
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
}

// 타임스탬프 포맷 (S3 파일명용)
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
```

### 2.3 JSON 스키마/타입 정의

**파일:** `src/lib/types/played.ts`

```typescript
// 개별 재생 기록
export interface PlayedItem {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playedAt: string;  // ISO 8601
  durationMs: number;
}

// Raw JSON (2시간마다 수집)
export interface RawPlayedData {
  collectedAt: string;  // ISO 8601
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
}

// Weekly JSON (월요일 병합) - 재생 기록 원본
export interface WeeklyPlayedData {
  isoYear: number;
  isoWeek: number;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  totalCount: number;
  items: PlayedItem[];
}

// 차트 아이템 (집계 결과) - LW/peak/weeks 포함
export interface ChartItem {
  rank: number;
  lastRank: number | null;   // 지난 기간 순위 (null = NEW)
  peakRank: number;          // 역대 최고 순위
  weeksOnChart: number;      // 차트 진입 횟수 (주간) / monthsOnChart, yearsOnChart
  
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

// 차트 응답 (charts/ 경로에 저장)
export interface ChartResponse {
  type: "weekly" | "monthly" | "yearly";
  period: {
    start: string;
    end: string;
    isoYear?: number;   // weekly용
    isoWeek?: number;   // weekly용
    year?: number;      // monthly, yearly용
    month?: number;     // monthly용
  };
  generatedAt: string;
  items: ChartItem[];
}

// 트랙별 누적 통계 (stats/track-stats.json)
export interface TrackStats {
  [trackId: string]: {
    // 주간 통계
    weeklyPeakRank: number;
    weeklyPeakPeriod: string;     // "2025-W01"
    totalWeeksOnChart: number;
    
    // 월간 통계
    monthlyPeakRank: number;
    monthlyPeakPeriod: string;    // "2025-01"
    totalMonthsOnChart: number;
    
    // 연간 통계
    yearlyPeakRank: number;
    yearlyPeakPeriod: number;     // 2025
    totalYearsOnChart: number;
    
    // 트랙 메타 (캐시용)
    trackName: string;
    artistNames: string[];
  };
}
```
```

### 2.4 Spotify → PlayedItem 변환 함수

**파일:** `src/lib/utils/spotify-mapper.ts`

```typescript
import type { PlayedItem } from "@/lib/types/played";

// Spotify API 응답에서 필요한 필드만 추출
export function mapSpotifyToPlayedItem(spotifyItem: any): PlayedItem {
  const { track, played_at } = spotifyItem;
  
  return {
    trackId: track.id,
    trackName: track.name,
    albumId: track.album.id,
    albumName: track.album.name,
    albumImageUrl: track.album.images?.[0]?.url || "",
    artistIds: track.artists.map((a: any) => a.id),
    artistNames: track.artists.map((a: any) => a.name),
    playedAt: played_at,
    durationMs: track.duration_ms,
  };
}

// 중복 제거 (같은 트랙 + 같은 시간)
export function deduplicatePlayedItems(items: PlayedItem[]): PlayedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.trackId}-${item.playedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

## 환경변수

**.env.example:**
```
S3_BUCKET=my-music-ranking
S3_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```

## 체크리스트

- [x] `src/lib/utils/s3-paths.ts` 생성
- [x] `src/lib/utils/iso-week.ts` 생성
- [x] `src/lib/types/played.ts` 생성
- [x] `src/lib/utils/spotify-mapper.ts` 생성
- [x] `.env.example` 업데이트
- [x] `date-fns` 패키지 설치 확인

## 예상 소요 시간

1일
