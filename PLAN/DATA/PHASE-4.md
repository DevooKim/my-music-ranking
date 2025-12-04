# Phase 4: Lambda 함수

## 목표

Spotify 재생 기록을 수집하는 collector, 주간 데이터를 병합하고 차트를 생성하는 weekly-processor, 월간 차트를 생성하는 monthly-processor Lambda를 구현합니다.

## Lambda 구조

```
lambda/
├── collector/              ← 2시간마다 실행
│   ├── handler.ts
│   ├── package.json
│   └── tsconfig.json
├── weekly-processor/       ← 매주 월요일 실행
│   ├── handler.ts
│   ├── package.json
│   └── tsconfig.json
├── monthly-processor/      ← 매월 1일 실행
│   ├── handler.ts
│   ├── package.json
│   └── tsconfig.json
├── shared/                 ← 공통 유틸리티
│   ├── spotify.ts
│   ├── s3.ts
│   ├── chart.ts           ← Phase 3 로직 복사
│   └── types.ts
└── template.yaml           ← SAM 템플릿
```

## 작업 목록

### 4.1 Collector Lambda (기존과 동일)

**파일:** `lambda/collector/handler.ts`

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { fetchRecentlyPlayed, refreshAccessToken } from "../shared/spotify";
import { mapSpotifyToPlayedItem, deduplicatePlayedItems } from "../shared/mapper";
import type { RawPlayedData, PlayedItem } from "../shared/types";

const s3 = new S3Client({ region: process.env.S3_REGION || "ap-northeast-2" });
const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

export const handler = async (): Promise<void> => {
  const now = new Date();
  const isoYear = getISOWeekYear(now);
  const isoWeek = getISOWeek(now);
  
  console.log(`Collecting for ISO ${isoYear}-W${isoWeek}`);
  
  try {
    // 1. Access Token 갱신
    const accessToken = await refreshAccessToken();
    
    // 2. 최근 재생 기록 조회 (최대 50건)
    const spotifyData = await fetchRecentlyPlayed(accessToken);
    
    // 3. 필요한 필드만 추출
    const items: PlayedItem[] = spotifyData.items.map(mapSpotifyToPlayedItem);
    const dedupedItems = deduplicatePlayedItems(items);
    
    // 4. S3에 저장
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const key = `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/${timestamp}.json`;
    
    const rawData: RawPlayedData = {
      collectedAt: now.toISOString(),
      isoYear,
      isoWeek,
      items: dedupedItems,
    };
    
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(rawData, null, 2),
      ContentType: "application/json",
    }));
    
    console.log(`Saved ${dedupedItems.length} items to s3://${BUCKET}/${key}`);
    
  } catch (error) {
    console.error("Collection failed:", error);
    throw error;
  }
};
```

### 4.2 Weekly Processor Lambda (차트 생성 포함)

**파일:** `lambda/weekly-processor/handler.ts`

```typescript
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getISOWeek, getISOWeekYear, subWeeks, startOfISOWeek, endOfISOWeek, format } from "date-fns";
import { buildChart } from "../shared/chart";
import { s3Paths, getS3Json, putS3Json } from "../shared/s3";
import type { RawPlayedData, WeeklyPlayedData, PlayedItem, ChartResponse, TrackStats } from "../shared/types";

const s3 = new S3Client({ region: process.env.S3_REGION || "ap-northeast-2" });
const BUCKET = process.env.S3_BUCKET || "my-music-ranking";

export const handler = async (): Promise<void> => {
  const now = new Date();
  
  // 지난 주 정보 계산
  const lastWeek = subWeeks(now, 1);
  const isoYear = getISOWeekYear(lastWeek);
  const isoWeek = getISOWeek(lastWeek);
  const startDate = startOfISOWeek(lastWeek);
  const endDate = endOfISOWeek(lastWeek);
  const periodLabel = `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
  
  console.log(`Processing ${periodLabel}`);
  
  try {
    // 1. Raw 파일 병합 → Weekly 저장
    const weeklyItems = await mergeRawFiles(isoYear, isoWeek);
    
    const weeklyData: WeeklyPlayedData = {
      isoYear,
      isoWeek,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      totalCount: weeklyItems.length,
      items: weeklyItems,
    };
    
    await putS3Json(s3Paths.weekly(isoYear, isoWeek), weeklyData);
    console.log(`Saved weekly data: ${weeklyItems.length} items`);
    
    // 2. 지난주 차트 읽기 (LW 계산용)
    const prevWeek = subWeeks(lastWeek, 1);
    const prevIsoYear = getISOWeekYear(prevWeek);
    const prevIsoWeek = getISOWeek(prevWeek);
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.chartWeekly(prevIsoYear, prevIsoWeek)
    );
    
    // 3. track-stats.json 읽기
    const trackStats = await getS3Json<TrackStats>(s3Paths.trackStats()) || {};
    
    // 4. 차트 생성
    const { chart, updatedStats } = buildChart({
      items: weeklyItems,
      chartType: "weekly",
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label: periodLabel,
      },
      lastChart,
      trackStats,
      limit: 100,
    });
    
    // 5. 차트 저장
    await putS3Json(s3Paths.chartWeekly(isoYear, isoWeek), chart);
    console.log(`Saved weekly chart: ${chart.items.length} items`);
    
    // 6. track-stats 업데이트
    await putS3Json(s3Paths.trackStats(), updatedStats);
    console.log(`Updated track stats`);
    
  } catch (error) {
    console.error("Weekly processing failed:", error);
    throw error;
  }
};

async function mergeRawFiles(isoYear: number, isoWeek: number): Promise<PlayedItem[]> {
  const prefix = `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/`;
  
  const listResult = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  
  if (!listResult.Contents || listResult.Contents.length === 0) {
    console.log("No raw files found");
    return [];
  }
  
  const allItems: PlayedItem[] = [];
  
  for (const obj of listResult.Contents) {
    if (!obj.Key) continue;
    
    const getResult = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: obj.Key,
    }));
    
    const bodyString = await getResult.Body?.transformToString();
    if (!bodyString) continue;
    
    const rawData: RawPlayedData = JSON.parse(bodyString);
    allItems.push(...rawData.items);
  }
  
  // 중복 제거
  const seen = new Set<string>();
  const deduped = allItems.filter((item) => {
    const key = `${item.trackId}-${item.playedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // 시간순 정렬
  return deduped.sort((a, b) => 
    new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
  );
}
```

### 4.3 Monthly Processor Lambda

**파일:** `lambda/monthly-processor/handler.ts`

```typescript
import { subMonths, startOfMonth, endOfMonth, format, eachWeekOfInterval, getISOWeek, getISOWeekYear } from "date-fns";
import { buildChart } from "../shared/chart";
import { s3Paths, getS3Json, putS3Json } from "../shared/s3";
import type { WeeklyPlayedData, PlayedItem, ChartResponse, TrackStats } from "../shared/types";

export const handler = async (): Promise<void> => {
  const now = new Date();
  
  // 지난 달 정보
  const lastMonth = subMonths(now, 1);
  const year = lastMonth.getFullYear();
  const month = lastMonth.getMonth() + 1;
  const startDate = startOfMonth(lastMonth);
  const endDate = endOfMonth(lastMonth);
  const periodLabel = `${year}-${String(month).padStart(2, "0")}`;
  
  console.log(`Processing monthly chart: ${periodLabel}`);
  
  try {
    // 1. 해당 월의 모든 weekly 파일 읽기
    const weeks = eachWeekOfInterval({ start: startDate, end: endDate }, { weekStartsOn: 1 });
    const allItems: PlayedItem[] = [];
    
    for (const weekStart of weeks) {
      const isoYear = getISOWeekYear(weekStart);
      const isoWeek = getISOWeek(weekStart);
      
      const weeklyData = await getS3Json<WeeklyPlayedData>(
        s3Paths.weekly(isoYear, isoWeek)
      );
      
      if (weeklyData) {
        // 해당 월의 데이터만 필터링
        const filtered = weeklyData.items.filter((item) => {
          const playedDate = new Date(item.playedAt);
          return playedDate >= startDate && playedDate <= endDate;
        });
        allItems.push(...filtered);
      }
    }
    
    console.log(`Loaded ${allItems.length} items from weekly files`);
    
    // 2. 지난달 차트 읽기 (LM 계산용)
    const prevMonth = subMonths(lastMonth, 1);
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.chartMonthly(prevMonth.getFullYear(), prevMonth.getMonth() + 1)
    );
    
    // 3. track-stats.json 읽기
    const trackStats = await getS3Json<TrackStats>(s3Paths.trackStats()) || {};
    
    // 4. 차트 생성
    const { chart, updatedStats } = buildChart({
      items: allItems,
      chartType: "monthly",
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label: periodLabel,
      },
      lastChart,
      trackStats,
      limit: 100,
    });
    
    // 5. 차트 저장
    await putS3Json(s3Paths.chartMonthly(year, month), chart);
    console.log(`Saved monthly chart: ${chart.items.length} items`);
    
    // 6. track-stats 업데이트
    await putS3Json(s3Paths.trackStats(), updatedStats);
    console.log(`Updated track stats`);
    
  } catch (error) {
    console.error("Monthly processing failed:", error);
    throw error;
  }
};
```

### 4.4 Shared - S3 유틸리티

**파일:** `lambda/shared/s3.ts`

```typescript
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.S3_REGION || "ap-northeast-2" });
const BUCKET = process.env.S3_BUCKET || "my-music-ranking";
const BASE_PATH = "played";

export const s3Paths = {
  raw: (isoYear: number, isoWeek: number, timestamp: string) =>
    `${BASE_PATH}/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/${timestamp}.json`,
  
  weekly: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,
  
  chartWeekly: (isoYear: number, isoWeek: number) =>
    `${BASE_PATH}/charts/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`,
  
  chartMonthly: (year: number, month: number) =>
    `${BASE_PATH}/charts/monthly/${year}/month-${String(month).padStart(2, "0")}.json`,
  
  chartYearly: (year: number) =>
    `${BASE_PATH}/charts/yearly/${year}.json`,
  
  trackStats: () =>
    `${BASE_PATH}/stats/track-stats.json`,
};

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

export async function putS3Json(key: string, data: unknown): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  }));
}
```

### 4.5 Shared 모듈 - Spotify

**파일:** `lambda/shared/spotify.ts`

```typescript
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";

export async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN!;
  
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

export async function fetchRecentlyPlayed(accessToken: string, limit = 50): Promise<any> {
  const response = await fetch(
    `${SPOTIFY_API_URL}/me/player/recently-played?limit=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`Spotify API failed: ${response.status}`);
  }
  
  return response.json();
}
```

### 4.6 Shared 모듈 - Chart (Phase 3 로직)

**파일:** `lambda/shared/chart.ts`

```typescript
// Phase 3의 차트 로직을 Lambda용으로 복사
// src/lib/chart/* 내용과 동일

export { aggregatePlays, assignRanks } from "./chart/calculator";
export { compareWithLastChart } from "./chart/comparator";
export { updateTrackStats, getStatsForChart } from "./chart/stats-manager";
export { buildChart } from "./chart/builder";
```

### 4.7 Shared 모듈 - Types

**파일:** `lambda/shared/types.ts`

```typescript
// Phase 2의 타입 정의와 동일
export interface PlayedItem {
  trackId: string;
  trackName: string;
  albumId: string;
  albumName: string;
  albumImageUrl: string;
  artistIds: string[];
  artistNames: string[];
  playedAt: string;
  durationMs: number;
}

export interface RawPlayedData {
  collectedAt: string;
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
}

export interface WeeklyPlayedData {
  isoYear: number;
  isoWeek: number;
  startDate: string;
  endDate: string;
  totalCount: number;
  items: PlayedItem[];
}

export interface ChartItem {
  rank: number;
  lastRank: number | null;
  peakRank: number;
  weeksOnChart: number;
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

export interface ChartResponse {
  type: "weekly" | "monthly" | "yearly";
  period: {
    start: string;
    end: string;
    isoYear?: number;
    isoWeek?: number;
    year?: number;
    month?: number;
  };
  generatedAt: string;
  items: ChartItem[];
}

export interface TrackStats {
  [trackId: string]: {
    weeklyPeakRank: number;
    weeklyPeakPeriod: string;
    totalWeeksOnChart: number;
    monthlyPeakRank: number;
    monthlyPeakPeriod: string;
    totalMonthsOnChart: number;
    yearlyPeakRank: number;
    yearlyPeakPeriod: number;
    totalYearsOnChart: number;
    trackName: string;
    artistNames: string[];
  };
}
```

### 4.8 SAM 템플릿

**파일:** `lambda/template.yaml`

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Music Ranking Lambda Functions

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs20.x
    MemorySize: 256
    Environment:
      Variables:
        S3_BUCKET: !Ref S3Bucket
        S3_REGION: !Ref AWS::Region

Parameters:
  SpotifyClientId:
    Type: String
    NoEcho: true
  SpotifyClientSecret:
    Type: String
    NoEcho: true
  SpotifyRefreshToken:
    Type: String
    NoEcho: true

Resources:
  S3Bucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-music-ranking

  # 2시간마다 Spotify 재생 기록 수집
  CollectorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: collector/
      Handler: handler.handler
      Description: Collect Spotify recently played tracks
      Environment:
        Variables:
          SPOTIFY_CLIENT_ID: !Ref SpotifyClientId
          SPOTIFY_CLIENT_SECRET: !Ref SpotifyClientSecret
          SPOTIFY_REFRESH_TOKEN: !Ref SpotifyRefreshToken
      Policies:
        - S3WritePolicy:
            BucketName: !Ref S3Bucket
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            Schedule: rate(2 hours)

  # 매주 월요일: raw 병합 + 주간 차트 생성
  WeeklyProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: weekly-processor/
      Handler: handler.handler
      Description: Merge weekly raw data and generate weekly chart
      Timeout: 120
      MemorySize: 512
      Policies:
        - S3CrudPolicy:
            BucketName: !Ref S3Bucket
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            # 매주 월요일 00:30 KST (일요일 15:30 UTC)
            Schedule: cron(30 15 ? * SUN *)

  # 매월 1일: 월간 차트 생성
  MonthlyProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: monthly-processor/
      Handler: handler.handler
      Description: Generate monthly chart
      Timeout: 120
      MemorySize: 512
      Policies:
        - S3CrudPolicy:
            BucketName: !Ref S3Bucket
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            # 매월 1일 01:00 KST (전날 16:00 UTC)
            Schedule: cron(0 16 L * ? *)

Outputs:
  S3BucketName:
    Value: !Ref S3Bucket
  CollectorFunctionArn:
    Value: !GetAtt CollectorFunction.Arn
  WeeklyProcessorFunctionArn:
    Value: !GetAtt WeeklyProcessorFunction.Arn
  MonthlyProcessorFunctionArn:
    Value: !GetAtt MonthlyProcessorFunction.Arn
```

## 환경변수

```
SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx
SPOTIFY_REFRESH_TOKEN=xxx
S3_BUCKET=my-music-ranking
S3_REGION=ap-northeast-2
```

## 체크리스트

- [ ] `lambda/collector/handler.ts` 생성
- [ ] `lambda/weekly-processor/handler.ts` 생성
- [ ] `lambda/monthly-processor/handler.ts` 생성
- [ ] `lambda/shared/s3.ts` 생성
- [ ] `lambda/shared/spotify.ts` 생성
- [ ] `lambda/shared/chart.ts` 생성 (Phase 3 로직)
- [ ] `lambda/shared/types.ts` 생성
- [ ] `lambda/template.yaml` 생성
- [ ] SAM 빌드 테스트
- [ ] SAM 로컬 테스트
- [ ] AWS 배포

## 예상 소요 시간

2일
