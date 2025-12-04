# Phase 4: Lambda 함수

## 목표

Spotify 재생 기록을 수집하는 collector와 주간 데이터를 병합하는 merger Lambda를 구현합니다.

## Lambda 구조

```
lambda/
├── collector/              ← 2시간마다 실행
│   ├── handler.ts
│   ├── package.json
│   └── tsconfig.json
├── merger/                 ← 매주 월요일 실행
│   ├── handler.ts
│   ├── package.json
│   └── tsconfig.json
├── shared/                 ← 공통 유틸리티
│   ├── spotify.ts
│   ├── s3.ts
│   └── types.ts
└── template.yaml           ← SAM 템플릿
```

## 작업 목록

### 4.1 Collector Lambda

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

### 4.2 Merger Lambda

**파일:** `lambda/merger/handler.ts`

```typescript
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getISOWeek, getISOWeekYear, subWeeks, startOfISOWeek, endOfISOWeek, format } from "date-fns";
import type { RawPlayedData, WeeklyPlayedData, PlayedItem } from "../shared/types";

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
  
  console.log(`Merging ISO ${isoYear}-W${isoWeek}`);
  
  try {
    // 1. 지난 주의 모든 raw 파일 목록 조회
    const prefix = `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/`;
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
    }));
    
    if (!listResult.Contents || listResult.Contents.length === 0) {
      console.log("No raw files found for this week");
      return;
    }
    
    // 2. 모든 raw 파일 읽기 및 병합
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
    
    // 3. 중복 제거 (trackId + playedAt 기준)
    const seen = new Set<string>();
    const dedupedItems = allItems.filter((item) => {
      const key = `${item.trackId}-${item.playedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // 4. 시간순 정렬
    dedupedItems.sort((a, b) => 
      new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
    );
    
    // 5. Weekly JSON 생성
    const weeklyData: WeeklyPlayedData = {
      isoYear,
      isoWeek,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      totalCount: dedupedItems.length,
      items: dedupedItems,
    };
    
    // 6. S3에 저장
    const weeklyKey = `played/weekly/${isoYear}/week-${String(isoWeek).padStart(2, "0")}.json`;
    
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: weeklyKey,
      Body: JSON.stringify(weeklyData, null, 2),
      ContentType: "application/json",
    }));
    
    console.log(`Saved weekly data to s3://${BUCKET}/${weeklyKey}`);
    console.log(`Total items: ${dedupedItems.length}`);
    
    // 7. Raw 파일 삭제 (선택적)
    if (process.env.DELETE_RAW_AFTER_MERGE === "true") {
      const deleteObjects = listResult.Contents.map((obj) => ({ Key: obj.Key! }));
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: deleteObjects },
      }));
      console.log(`Deleted ${deleteObjects.length} raw files`);
    }
    
  } catch (error) {
    console.error("Merge failed:", error);
    throw error;
  }
};
```

### 4.3 Shared 모듈 - Spotify

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

### 4.4 Shared 모듈 - Mapper

**파일:** `lambda/shared/mapper.ts`

```typescript
import type { PlayedItem } from "./types";

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

### 4.5 Shared 모듈 - Types

**파일:** `lambda/shared/types.ts`

```typescript
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
```

### 4.6 SAM 템플릿

**파일:** `lambda/template.yaml`

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Music Ranking Data Collectors

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
            Description: Collect every 2 hours

  MergerFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: merger/
      Handler: handler.handler
      Description: Merge weekly raw data
      Timeout: 60
      Environment:
        Variables:
          DELETE_RAW_AFTER_MERGE: "false"
      Policies:
        - S3CrudPolicy:
            BucketName: !Ref S3Bucket
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            # 매주 월요일 00:30 KST (일요일 15:30 UTC)
            Schedule: cron(30 15 ? * SUN *)
            Description: Merge every Monday

Outputs:
  S3BucketName:
    Value: !Ref S3Bucket
  CollectorFunctionArn:
    Value: !GetAtt CollectorFunction.Arn
  MergerFunctionArn:
    Value: !GetAtt MergerFunction.Arn
```

### 4.7 패키지 설정

**파일:** `lambda/collector/package.json`

```json
{
  "name": "music-ranking-collector",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "esbuild handler.ts --bundle --platform=node --target=node20 --outfile=dist/handler.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
```

**파일:** `lambda/merger/package.json`

```json
{
  "name": "music-ranking-merger",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "esbuild handler.ts --bundle --platform=node --target=node20 --outfile=dist/handler.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
```

## 환경변수

```
SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx
SPOTIFY_REFRESH_TOKEN=xxx
S3_BUCKET=my-music-ranking
S3_REGION=ap-northeast-2
DELETE_RAW_AFTER_MERGE=false
```

## 체크리스트

- [ ] `lambda/collector/handler.ts` 생성
- [ ] `lambda/collector/package.json` 생성
- [ ] `lambda/merger/handler.ts` 생성
- [ ] `lambda/merger/package.json` 생성
- [ ] `lambda/shared/spotify.ts` 생성
- [ ] `lambda/shared/mapper.ts` 생성
- [ ] `lambda/shared/types.ts` 생성
- [ ] `lambda/template.yaml` 생성
- [ ] SAM 빌드 테스트
- [ ] SAM 로컬 테스트
- [ ] AWS 배포

## 예상 소요 시간

2일
