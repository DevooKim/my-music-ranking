# 기존 데이터 마이그레이션 계획

## 현황 분석

### 기존 데이터 위치
- **S3 버킷:** `my-music-ranking`
- **경로:** `spotify-recently-played/`
- **파일 형식:** `YYYYMMDDHH.json` (예: `2025091715.json`)
- **샘플 URL:** https://my-music-ranking.s3.ap-northeast-2.amazonaws.com/spotify-recently-played/2025091715.json

### 기존 데이터 구조
```json
{
  "items": [
    {
      "track": {
        "id": "trackId",
        "name": "trackName",
        "album": {
          "id": "albumId",
          "name": "albumName",
          "images": [{"url": "imageUrl", "height": 640}]
        },
        "artists": [
          {"id": "artistId", "name": "artistName"}
        ],
        "duration_ms": 192000
      },
      "played_at": "2025-09-17T12:26:02.395Z",
      "context": null
    }
  ],
  "next": "nextPageUrl",
  "cursors": {...},
  "limit": 50
}
```

### 새로운 데이터 구조

#### 1. Raw 데이터 (`played/raw/{isoYear}/{isoWeek}/{timestamp}.json`)
```typescript
{
  collectedAt: "2025-09-17T12:00:00.000Z",
  isoYear: 2025,
  isoWeek: 38,
  items: [
    {
      trackId: "62n4Fv2LF86hDkJyeb5NZf",
      trackName: "Know You Did",
      albumId: "3B6D95jRuk3UfNeKSmdlLo",
      albumName: "Know You Did / Say Yes",
      albumImageUrl: "https://i.scdn.co/image/...",
      artistIds: ["3zyq3DzSd4aue9Q7s1qMVu"],
      artistNames: ["bongjeingan"],
      playedAt: "2025-09-17T12:26:02.395Z",
      durationMs: 192000
    }
  ]
}
```

## 마이그레이션 전략

### 1단계: 기존 데이터 분석 스크립트 작성

**목적:** 기존 S3 데이터의 범위와 구조 파악

**작업:**
```typescript
// scripts/analyze-legacy-data.ts
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { parseISO, getISOWeek, getISOWeekYear } from "date-fns";

interface LegacyDataSummary {
  totalFiles: number;
  dateRange: { earliest: string; latest: string };
  weekCoverage: Map<string, number>; // "2025-W38" -> file count
  totalTracks: number;
  sampleData: any[];
}

async function analyzeLegacyData(): Promise<LegacyDataSummary> {
  const s3 = new S3Client({ region: "ap-northeast-2" });
  const bucket = "my-music-ranking";
  const prefix = "spotify-recently-played/";
  
  let continuationToken: string | undefined;
  const files: string[] = [];
  
  // 1. 모든 파일 목록 수집
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    
    const response = await s3.send(command);
    const keys = response.Contents?.map(obj => obj.Key!).filter(Boolean) || [];
    files.push(...keys);
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  console.log(`Found ${files.length} files`);
  
  // 2. 파일명에서 날짜 추출 및 주차 매핑
  const weekCoverage = new Map<string, number>();
  let earliest: Date | null = null;
  let latest: Date | null = null;
  
  for (const key of files) {
    const match = key.match(/(\d{10})\.json$/);
    if (!match) continue;
    
    const dateStr = match[1]; // YYYYMMDDHH
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6));
    const day = parseInt(dateStr.substring(6, 8));
    const hour = parseInt(dateStr.substring(8, 10));
    
    const date = new Date(year, month - 1, day, hour);
    
    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
    
    const isoYear = getISOWeekYear(date);
    const isoWeek = getISOWeek(date);
    const weekKey = `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
    
    weekCoverage.set(weekKey, (weekCoverage.get(weekKey) || 0) + 1);
  }
  
  // 3. 샘플 데이터 수집 (처음 5개 파일)
  const sampleData = [];
  for (const key of files.slice(0, 5)) {
    const response = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    const body = await response.Body?.transformToString();
    if (body) {
      const data = JSON.parse(body);
      sampleData.push({ key, itemCount: data.items?.length || 0 });
    }
  }
  
  return {
    totalFiles: files.length,
    dateRange: {
      earliest: earliest?.toISOString() || "N/A",
      latest: latest?.toISOString() || "N/A",
    },
    weekCoverage,
    totalTracks: 0, // 실제 계산 시 추가
    sampleData,
  };
}

// 실행
analyzeLegacyData().then(summary => {
  console.log("\n=== Legacy Data Summary ===");
  console.log(`Total files: ${summary.totalFiles}`);
  console.log(`Date range: ${summary.dateRange.earliest} ~ ${summary.dateRange.latest}`);
  console.log(`\nWeek Coverage (${summary.weekCoverage.size} weeks):`);
  
  const sortedWeeks = Array.from(summary.weekCoverage.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [week, count] of sortedWeeks) {
    console.log(`  ${week}: ${count} files`);
  }
  
  console.log("\nSample data:");
  for (const sample of summary.sampleData) {
    console.log(`  ${sample.key}: ${sample.itemCount} items`);
  }
});
```

### 2단계: 데이터 변환 스크립트 작성

**목적:** 기존 형식 → 새로운 형식으로 변환

**작업:**
```typescript
// scripts/migrate-legacy-data.ts
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseISO, getISOWeek, getISOWeekYear } from "date-fns";
import type { PlayedItem, RawPlayedData } from "../lambda/shared/types";

const s3 = new S3Client({ region: "ap-northeast-2" });
const BUCKET = "my-music-ranking";

interface LegacySpotifyItem {
  track: {
    id: string;
    name: string;
    album: {
      id: string;
      name: string;
      images: { url: string; height: number }[];
    };
    artists: { id: string; name: string }[];
    duration_ms: number;
  };
  played_at: string;
  context: any;
}

interface LegacySpotifyData {
  items: LegacySpotifyItem[];
  next?: string;
  cursors?: any;
  limit?: number;
}

function transformLegacyToNew(
  legacyData: LegacySpotifyData,
  timestamp: string
): RawPlayedData {
  const firstPlayedAt = parseISO(legacyData.items[0]?.played_at || timestamp);
  const isoYear = getISOWeekYear(firstPlayedAt);
  const isoWeek = getISOWeek(firstPlayedAt);
  
  const items: PlayedItem[] = legacyData.items.map(item => ({
    trackId: item.track.id,
    trackName: item.track.name,
    albumId: item.track.album.id,
    albumName: item.track.album.name,
    albumImageUrl: item.track.album.images[0]?.url || "",
    artistIds: item.track.artists.map(a => a.id),
    artistNames: item.track.artists.map(a => a.name),
    playedAt: item.played_at,
    durationMs: item.track.duration_ms,
  }));
  
  return {
    collectedAt: timestamp,
    isoYear,
    isoWeek,
    items,
  };
}

async function migrateFile(legacyKey: string): Promise<void> {
  // 1. 기존 파일 읽기
  const response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: legacyKey,
  }));
  
  const body = await response.Body?.transformToString();
  if (!body) {
    console.warn(`Empty file: ${legacyKey}`);
    return;
  }
  
  const legacyData: LegacySpotifyData = JSON.parse(body);
  
  // 2. 타임스탬프 추출 (YYYYMMDDHH.json)
  const match = legacyKey.match(/(\d{4})(\d{2})(\d{2})(\d{2})\.json$/);
  if (!match) {
    console.warn(`Invalid filename format: ${legacyKey}`);
    return;
  }
  
  const [, year, month, day, hour] = match;
  const timestamp = `${year}-${month}-${day}T${hour}:00:00.000Z`;
  
  // 3. 변환
  const newData = transformLegacyToNew(legacyData, timestamp);
  
  // 4. 새 위치에 저장
  const newKey = `played/raw/${newData.isoYear}/${String(newData.isoWeek).padStart(2, "0")}/${timestamp.replace(/[:.]/g, "-")}.json`;
  
  // 파일 명 변경
  // 기존: timestamp.json
  // 변경: YYYYMMDD_HHmm.json
  const newFileName = `${timestamp.replace(/-/g, "").slice(0, 8)}_${timestamp.slice(11, 13)}${timestamp.slice(14, 16)}.json`;
  const finalKey = `played/raw/${newData.isoYear}/${String(newData.isoWeek).padStart(2, "0")}/${newFileName}`;
  
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: finalKey,
    Body: JSON.stringify(newData, null, 2),
    ContentType: "application/json",
  }));
  
  console.log(`✓ Migrated: ${legacyKey} → ${finalKey}`);
}

async function migrateBatch(
  legacyKeys: string[],
  concurrency: number = 5
): Promise<void> {
  for (let i = 0; i < legacyKeys.length; i += concurrency) {
    const batch = legacyKeys.slice(i, i + concurrency);
    await Promise.all(batch.map(key => migrateFile(key)));
    console.log(`Progress: ${Math.min(i + concurrency, legacyKeys.length)}/${legacyKeys.length}`);
  }
}

// 실행 예시
async function main() {
  // 1. 먼저 analyze-legacy-data.ts 실행하여 파일 목록 확인
  // 2. 확인 후 마이그레이션 실행
  
  const legacyPrefix = "spotify-recently-played/";
  const s3 = new S3Client({ region: "ap-northeast-2" });
  
  // 파일 목록 가져오기
  const files: string[] = [];
  let continuationToken: string | undefined;
  
  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: legacyPrefix,
      ContinuationToken: continuationToken,
    }));
    
    const keys = response.Contents?.map(obj => obj.Key!).filter(Boolean) || [];
    files.push(...keys);
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  console.log(`Found ${files.length} files to migrate`);
  console.log("Starting migration...");
  
  await migrateBatch(files, 10); // 동시에 10개씩 처리
  
  console.log("\n✓ Migration complete!");
}

// Dry-run 모드 (실제 저장 안함)
async function dryRun() {
  const sampleKey = "spotify-recently-played/2025091715.json";
  
  const response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: sampleKey,
  }));
  
  const body = await response.Body?.transformToString();
  if (!body) return;
  
  const legacyData = JSON.parse(body);
  const newData = transformLegacyToNew(legacyData, "2025-09-17T15:00:00.000Z");
  
  console.log("=== Sample Transformation ===");
  console.log("\nOriginal (first item):");
  console.log(JSON.stringify(legacyData.items[0], null, 2));
  console.log("\nTransformed:");
  console.log(JSON.stringify(newData, null, 2));
}

// 실행
if (process.argv.includes("--dry-run")) {
  dryRun();
} else if (process.argv.includes("--migrate")) {
  main();
} else {
  console.log("Usage:");
  console.log("  bun run scripts/migrate-legacy-data.ts --dry-run   # 샘플 확인");
  console.log("  bun run scripts/migrate-legacy-data.ts --migrate   # 실제 마이그레이션");
}
```

#### ISRC 기반 메타데이터 정정 (추가)

- 각 트랙의 `external_ids.isrc` 값을 이용해 Spotify Search API(`type=track`, `q=isrc:...`)를 조회한다.
- 응답에서 최신 `album.name`, `album.artists`, `track.name`, `artists` 정보를 꺼내어 변환된 데이터에 반영한다.
- 동일한 ISRC에 대해서는 캐시를 적용해 불필요한 API 호출을 방지한다.
- 토큰(`SPOTIFY_TOKEN`) 또는 지역/언어(`SPOTIFY_MARKET`, `SPOTIFY_LOCALE`) 설정이 없으면 자동으로 fallback 하며 기존 레거시 데이터 그대로 사용한다.

### 3단계: 중복 제거 로직 추가

**문제:** 기존 collector가 2시간마다 최근 50개를 가져오므로 중복 가능성 있음

**해결:**
```typescript
// lambda/shared/mapper.ts에 이미 구현되어 있음
export function deduplicatePlayedItems(items: PlayedItem[]): PlayedItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.trackId}:${item.playedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

**마이그레이션 시 주차별 중복 제거:**
```typescript
// scripts/deduplicate-week.ts
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { RawPlayedData, PlayedItem } from "../lambda/shared/types";

async function deduplicateWeek(isoYear: number, isoWeek: number): Promise<void> {
  const s3 = new S3Client({ region: "ap-northeast-2" });
  const bucket = "my-music-ranking";
  const prefix = `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/`;
  
  // 1. 해당 주차의 모든 파일 읽기
  const response = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  }));
  
  const keys = response.Contents?.map(obj => obj.Key!).filter(Boolean) || [];
  console.log(`Found ${keys.length} files for ${isoYear}-W${isoWeek}`);
  
  // 2. 모든 아이템 수집
  const allItems: PlayedItem[] = [];
  for (const key of keys) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await obj.Body?.transformToString();
    if (!body) continue;
    
    const data: RawPlayedData = JSON.parse(body);
    allItems.push(...data.items);
  }
  
  console.log(`Total items before dedup: ${allItems.length}`);
  
  // 3. 중복 제거
  const seen = new Set<string>();
  const uniqueItems = allItems.filter(item => {
    const key = `${item.trackId}:${item.playedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`Total items after dedup: ${uniqueItems.length}`);
  console.log(`Removed ${allItems.length - uniqueItems.length} duplicates`);
  
  // 4. 결과를 주차별 파일로 저장 (선택적)
  // 필요 시 weekly 데이터로 바로 생성 가능
}
```

### 4단계: 주차별 병합 및 차트 생성

**목적:** 마이그레이션된 데이터로 주간 차트 생성

**작업:**
```typescript
// scripts/generate-historical-charts.ts
import { buildChart } from "../lambda/shared/chart/builder";
import { getS3Json, putS3Json, s3Paths } from "../lambda/shared/s3";
import { startOfISOWeek, endOfISOWeek, format } from "date-fns";

async function generateWeeklyChart(isoYear: number, isoWeek: number): Promise<void> {
  // 1. raw 데이터 읽기
  const prefix = `played/raw/${isoYear}/${String(isoWeek).padStart(2, "0")}/`;
  // ... (위 deduplicateWeek와 유사한 로직)
  
  // 2. 차트 생성
  const chart = await buildChart(uniqueItems, "weekly", {
    isoYear,
    isoWeek,
    start: format(startOfISOWeek(new Date(isoYear, 0, 1 + (isoWeek - 1) * 7)), "yyyy-MM-dd"),
    end: format(endOfISOWeek(new Date(isoYear, 0, 1 + (isoWeek - 1) * 7)), "yyyy-MM-dd"),
  });
  
  // 3. 저장
  const chartKey = s3Paths.chartWeekly(isoYear, isoWeek);
  await putS3Json(chartKey, chart);
  
  console.log(`✓ Generated chart for ${isoYear}-W${isoWeek}`);
}

async function generateAllHistoricalCharts(): Promise<void> {
  // analyze-legacy-data.ts 결과를 바탕으로 모든 주차에 대해 실행
  const weeks = [
    { year: 2025, week: 38 },
    // ... 기타 주차들
  ];
  
  for (const { year, week } of weeks) {
    await generateWeeklyChart(year, week);
  }
}
```

## 실행 계획

### 준비 단계
1. ✅ 분석 스크립트 작성 완료
2. ✅ 변환 스크립트 작성 완료
3. ✅ 중복 제거 로직 검증

### 실행 단계
```bash
# 1. 기존 데이터 분석
bun run scripts/analyze-legacy-data.ts > legacy-analysis.txt

# 2. 샘플 변환 테스트
bun run scripts/migrate-legacy-data.ts --dry-run

# 3. 실제 마이그레이션 (백업 권장)
bun run scripts/migrate-legacy-data.ts --migrate

# 4. 주차별 중복 제거 및 검증
bun run scripts/verify-migration.ts

# 5. 히스토리컬 차트 생성
bun run scripts/generate-historical-charts.ts
```

### 검증 단계
1. 마이그레이션된 파일 수 확인
2. 샘플 데이터 비교 (원본 vs 변환)
3. 주차별 아이템 수 집계
4. API 테스트 (실시간/주간/월간 차트)

## 롤백 계획

### 원본 데이터 보존
- 기존 `spotify-recently-played/` 폴더는 삭제하지 않고 유지
- 마이그레이션은 새로운 경로 (`played/raw/`)에만 저장

### 문제 발생 시
1. 새로운 경로 데이터 삭제
2. 스크립트 수정 후 재실행
3. 기존 collector Lambda는 계속 동작 중이므로 신규 데이터는 정상 수집됨

## 타임라인

| 단계 | 작업 | 예상 소요 시간 |
|------|------|----------------|
| 1 | 분석 스크립트 실행 | 10분 |
| 2 | 샘플 변환 테스트 | 30분 |
| 3 | 실제 마이그레이션 | 1-2시간 (파일 수에 따라) |
| 4 | 중복 제거 및 검증 | 1시간 |
| 5 | 히스토리컬 차트 생성 | 2-3시간 |
| 6 | API 테스트 및 검증 | 1시간 |
| **합계** | | **6-8시간** |

## 리스크 및 대응

| 리스크 | 대응 방안 |
|--------|----------|
| 중복 데이터 발생 | 중복 제거 로직 강화, 주차별 검증 |
| 데이터 누락 | 원본 파일 유지, 마이그레이션 전후 카운트 비교 |
| 타임존 문제 | ISO 8601 형식 일관성 유지, played_at 기준 주차 계산 |
| S3 비용 | 점진적 마이그레이션, batch 크기 조정 |
| Lambda 타임아웃 | weekly/monthly processor는 기존 데이터 건너뛰기, 신규 데이터만 처리 |

## 참고사항

### 기존 경로와 새 경로 비교
```
기존: spotify-recently-played/2025091715.json
신규: played/raw/2025/38/2025-09-17T15-00-00-000Z.json
```

### 데이터 크기 추정
- 기존 파일 1개 = 약 50개 트랙 = 약 20-30KB
- 1주일 = 84개 파일 (2시간 x 7일) = 약 2-3MB
- 1년 = 약 100-150MB

### 후속 작업
1. 기존 collector Lambda 경로 변경 (새 경로로 저장)
2. 기존 `spotify-recently-played/` 폴더 아카이브
3. 모니터링 설정 (CloudWatch)

# 데이터 보존 정책
# 기존 데이터는 삭제하지 않고 새 경로에만 복사합니다.
# 따라서 마이그레이션 후에도 기존 데이터는 안전하게 유지됩니다.
