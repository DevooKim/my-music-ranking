# Phase 3: 차트 계산 로직

## 목표

Lambda에서 사용할 차트 계산 로직과 통계 관리 함수를 구현합니다.  
(DuckDB는 필요시 도입 - 현재는 순수 JS로 구현)

## 작업 목록

### 3.1 차트 계산기

**파일:** `src/lib/chart/calculator.ts`

```typescript
import type { PlayedItem, ChartItem } from "@/lib/types/played";

interface AggregatedTrack {
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

// 재생 기록을 트랙별로 집계
export function aggregatePlays(items: PlayedItem[]): AggregatedTrack[] {
  const trackMap = new Map<string, AggregatedTrack>();
  
  for (const item of items) {
    const existing = trackMap.get(item.trackId);
    
    if (existing) {
      existing.playCount += 1;
      existing.totalDurationMs += item.durationMs;
    } else {
      trackMap.set(item.trackId, {
        trackId: item.trackId,
        trackName: item.trackName,
        albumId: item.albumId,
        albumName: item.albumName,
        albumImageUrl: item.albumImageUrl,
        artistIds: item.artistIds,
        artistNames: item.artistNames,
        playCount: 1,
        totalDurationMs: item.durationMs,
      });
    }
  }
  
  // playCount 내림차순 정렬
  return Array.from(trackMap.values())
    .sort((a, b) => b.playCount - a.playCount);
}

// 집계된 트랙에 순위 부여
export function assignRanks(
  tracks: AggregatedTrack[],
  limit = 100
): Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[] {
  return tracks.slice(0, limit).map((track, index) => ({
    rank: index + 1,
    ...track,
  }));
}
```

### 3.2 차트 비교기 (LW/LM/LY 계산)

**파일:** `src/lib/chart/comparator.ts`

```typescript
import type { ChartItem, ChartResponse } from "@/lib/types/played";

// 지난 차트와 비교하여 lastRank 계산
export function compareWithLastChart(
  currentItems: Omit<ChartItem, "lastRank" | "peakRank" | "weeksOnChart">[],
  lastChart: ChartResponse | null
): Omit<ChartItem, "peakRank" | "weeksOnChart">[] {
  const lastRankMap = new Map<string, number>();
  
  if (lastChart) {
    for (const item of lastChart.items) {
      lastRankMap.set(item.trackId, item.rank);
    }
  }
  
  return currentItems.map((item) => ({
    ...item,
    lastRank: lastRankMap.get(item.trackId) ?? null,
  }));
}

// 순위 변동 계산 헬퍼
export function getRankChange(current: number, last: number | null): string {
  if (last === null) return "NEW";
  if (current < last) return `▲${last - current}`;
  if (current > last) return `▼${current - last}`;
  return "-";
}
```

### 3.3 트랙 통계 관리자

**파일:** `src/lib/chart/stats-manager.ts`

```typescript
import type { ChartItem, TrackStats } from "@/lib/types/played";

type ChartType = "weekly" | "monthly" | "yearly";

interface UpdateResult {
  stats: TrackStats;
  updated: string[];  // 업데이트된 trackId 목록
}

// 차트 결과로 트랙 통계 업데이트
export function updateTrackStats(
  currentStats: TrackStats,
  chartItems: Omit<ChartItem, "peakRank" | "weeksOnChart">[],
  chartType: ChartType,
  period: string  // "2025-W01", "2025-01", "2025"
): UpdateResult {
  const stats = { ...currentStats };
  const updated: string[] = [];
  
  for (const item of chartItems) {
    const existing = stats[item.trackId];
    
    if (!existing) {
      // 새 트랙
      stats[item.trackId] = createNewTrackStats(item, chartType, period);
      updated.push(item.trackId);
    } else {
      // 기존 트랙 업데이트
      const wasUpdated = updateExistingStats(existing, item, chartType, period);
      if (wasUpdated) updated.push(item.trackId);
    }
  }
  
  return { stats, updated };
}

function createNewTrackStats(
  item: Omit<ChartItem, "peakRank" | "weeksOnChart">,
  chartType: ChartType,
  period: string
): TrackStats[string] {
  const base = {
    weeklyPeakRank: Infinity,
    weeklyPeakPeriod: "",
    totalWeeksOnChart: 0,
    monthlyPeakRank: Infinity,
    monthlyPeakPeriod: "",
    totalMonthsOnChart: 0,
    yearlyPeakRank: Infinity,
    yearlyPeakPeriod: 0,
    totalYearsOnChart: 0,
    trackName: item.trackName,
    artistNames: item.artistNames,
  };
  
  if (chartType === "weekly") {
    base.weeklyPeakRank = item.rank;
    base.weeklyPeakPeriod = period;
    base.totalWeeksOnChart = 1;
  } else if (chartType === "monthly") {
    base.monthlyPeakRank = item.rank;
    base.monthlyPeakPeriod = period;
    base.totalMonthsOnChart = 1;
  } else {
    base.yearlyPeakRank = item.rank;
    base.yearlyPeakPeriod = parseInt(period);
    base.totalYearsOnChart = 1;
  }
  
  return base;
}

function updateExistingStats(
  existing: TrackStats[string],
  item: Omit<ChartItem, "peakRank" | "weeksOnChart">,
  chartType: ChartType,
  period: string
): boolean {
  let updated = false;
  
  if (chartType === "weekly") {
    existing.totalWeeksOnChart += 1;
    if (item.rank < existing.weeklyPeakRank) {
      existing.weeklyPeakRank = item.rank;
      existing.weeklyPeakPeriod = period;
      updated = true;
    }
  } else if (chartType === "monthly") {
    existing.totalMonthsOnChart += 1;
    if (item.rank < existing.monthlyPeakRank) {
      existing.monthlyPeakRank = item.rank;
      existing.monthlyPeakPeriod = period;
      updated = true;
    }
  } else {
    existing.totalYearsOnChart += 1;
    if (item.rank < existing.yearlyPeakRank) {
      existing.yearlyPeakRank = item.rank;
      existing.yearlyPeakPeriod = parseInt(period);
      updated = true;
    }
  }
  
  // 트랙 메타 업데이트
  existing.trackName = item.trackName;
  existing.artistNames = item.artistNames;
  
  return updated;
}

// 통계에서 peak/weeks 정보 가져오기
export function getStatsForChart(
  stats: TrackStats,
  trackId: string,
  chartType: ChartType
): { peakRank: number; periodsOnChart: number } {
  const trackStats = stats[trackId];
  
  if (!trackStats) {
    return { peakRank: Infinity, periodsOnChart: 0 };
  }
  
  if (chartType === "weekly") {
    return {
      peakRank: trackStats.weeklyPeakRank,
      periodsOnChart: trackStats.totalWeeksOnChart,
    };
  } else if (chartType === "monthly") {
    return {
      peakRank: trackStats.monthlyPeakRank,
      periodsOnChart: trackStats.totalMonthsOnChart,
    };
  } else {
    return {
      peakRank: trackStats.yearlyPeakRank,
      periodsOnChart: trackStats.totalYearsOnChart,
    };
  }
}
```

### 3.4 차트 생성 통합 함수

**파일:** `src/lib/chart/builder.ts`

```typescript
import type { PlayedItem, ChartItem, ChartResponse, TrackStats } from "@/lib/types/played";
import { aggregatePlays, assignRanks } from "./calculator";
import { compareWithLastChart } from "./comparator";
import { updateTrackStats, getStatsForChart } from "./stats-manager";

type ChartType = "weekly" | "monthly" | "yearly";

interface BuildChartInput {
  items: PlayedItem[];
  chartType: ChartType;
  period: {
    start: string;
    end: string;
    label: string;  // "2025-W01", "2025-01", "2025"
  };
  lastChart: ChartResponse | null;
  trackStats: TrackStats;
  limit?: number;
}

interface BuildChartResult {
  chart: ChartResponse;
  updatedStats: TrackStats;
}

export function buildChart(input: BuildChartInput): BuildChartResult {
  const { items, chartType, period, lastChart, trackStats, limit = 100 } = input;
  
  // 1. 집계
  const aggregated = aggregatePlays(items);
  
  // 2. 순위 부여
  const ranked = assignRanks(aggregated, limit);
  
  // 3. 지난 차트와 비교 (lastRank)
  const withLastRank = compareWithLastChart(ranked, lastChart);
  
  // 4. 통계 업데이트
  const { stats: updatedStats } = updateTrackStats(
    trackStats,
    withLastRank,
    chartType,
    period.label
  );
  
  // 5. peak/weeks 정보 추가
  const finalItems: ChartItem[] = withLastRank.map((item) => {
    const { peakRank, periodsOnChart } = getStatsForChart(
      updatedStats,
      item.trackId,
      chartType
    );
    
    return {
      ...item,
      peakRank: Math.min(peakRank, item.rank),
      weeksOnChart: periodsOnChart,
    };
  });
  
  // 6. 차트 응답 생성
  const chart: ChartResponse = {
    type: chartType,
    period: {
      start: period.start,
      end: period.end,
      ...(chartType === "weekly" && {
        isoYear: parseInt(period.label.split("-W")[0]),
        isoWeek: parseInt(period.label.split("-W")[1]),
      }),
      ...(chartType === "monthly" && {
        year: parseInt(period.label.split("-")[0]),
        month: parseInt(period.label.split("-")[1]),
      }),
      ...(chartType === "yearly" && {
        year: parseInt(period.label),
      }),
    },
    generatedAt: new Date().toISOString(),
    items: finalItems,
  };
  
  return { chart, updatedStats };
}
```

### 3.5 인덱스 파일

**파일:** `src/lib/chart/index.ts`

```typescript
export { aggregatePlays, assignRanks } from "./calculator";
export { compareWithLastChart, getRankChange } from "./comparator";
export { updateTrackStats, getStatsForChart } from "./stats-manager";
export { buildChart } from "./builder";
```

## 파일 구조

```
src/lib/chart/
├── index.ts           ← 내보내기
├── calculator.ts      ← 집계 및 순위 부여
├── comparator.ts      ← 지난 차트 비교
├── stats-manager.ts   ← 트랙 통계 관리
└── builder.ts         ← 차트 생성 통합
```

## 체크리스트

- [ ] `src/lib/chart/calculator.ts` 생성
- [ ] `src/lib/chart/comparator.ts` 생성
- [ ] `src/lib/chart/stats-manager.ts` 생성
- [ ] `src/lib/chart/builder.ts` 생성
- [ ] `src/lib/chart/index.ts` 생성
- [ ] 단위 테스트 작성

## 예상 소요 시간

1일
