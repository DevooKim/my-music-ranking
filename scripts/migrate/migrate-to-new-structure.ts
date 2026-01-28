/**
 * S3 구조 마이그레이션 스크립트
 * 
 * 기능:
 * 1. Raw 데이터 마이그레이션 (주차별 병합 + 중복 제거 + 한국어 메타데이터 변환)
 * 2. Weekly 차트 재생성 (Raw 데이터 기반)
 * 3. Monthly 차트 재생성 (Raw 데이터 기반)
 * 4. track-stats 재생성
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getISOWeek, getISOWeekYear, parseISO } from "date-fns";
import { buildChart } from "../../lambda/shared/chart/builder";
import type { ChartResponse, PlayedItem, RawPlayedData, TrackStats } from "../../lambda/shared/types";
import { BUCKET } from "../utils/config";
import { getIsoWeekEndDate, getIsoWeekStartDate, getPreviousIsoWeek } from "../utils/iso-week";
import { getObjectBody, listAllKeys, s3Client } from "../utils/s3";
import { fetchTrackMetadataByIsrc, isIsrcEnrichmentEnabled } from "../utils/spotify";

interface LegacyRawItem {
  track: {
    id: string;
    name: string;
    album: {
      id: string;
      name: string;
      images?: Array<{ url: string }>;
      artists?: Array<{ id: string; name: string; external_urls?: { spotify?: string } }>;
      total_tracks?: number;
      external_urls?: { spotify?: string };
    };
    artists: Array<{
      id: string;
      name: string;
      external_urls?: { spotify?: string };
    }>;
    external_urls?: { spotify?: string };
    external_ids?: { isrc?: string };
    disc_number?: number;
    track_number?: number;
    duration_ms: number;
  };
  played_at: string;
  context: unknown;
}

interface LegacyRawData {
  items: LegacyRawItem[];
}

// 중복 제거용 키 생성
function getDeduplicationKey(item: PlayedItem): string {
  return `${item.playedAt}_${item.trackId}`;
}

// KST 기준 ISO Week 계산
function getKstIsoWeek(playedAt: string): { isoYear: number; isoWeek: number } {
  const utcDate = parseISO(playedAt);
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  return {
    isoYear: getISOWeekYear(kstDate),
    isoWeek: getISOWeek(kstDate),
  };
}

// Legacy 데이터를 PlayedItem으로 변환 (한국어 메타데이터 포함)
async function convertLegacyItem(legacyItem: LegacyRawItem): Promise<PlayedItem> {
  const { track, played_at } = legacyItem;
  const isrc = track.external_ids?.isrc;
  
  let trackName = track.name;
  let albumName = track.album.name;
  let artistNames = track.artists.map((a) => a.name);
  // ISRC 기반 한국어 메타데이터 변환
  if (isrc && isIsrcEnrichmentEnabled()) {
    try {
      const koreanMetadata = await fetchTrackMetadataByIsrc(isrc);
      if (koreanMetadata) {
        trackName = koreanMetadata.trackName;
        albumName = koreanMetadata.albumName;
        artistNames = koreanMetadata.artistNames;
        // albumArtistNames는 Search API에서 제공하지 않으므로 artistNames로 대체
      }
    } catch (error) {
      console.warn(`Failed to fetch Korean metadata for ISRC ${isrc}:`, error);
    }
  }
  
  return {
    trackId: track.id,
    trackName,
    albumId: track.album.id,
    albumName,
    albumImageUrl: track.album.images?.[0]?.url || "",
    albumTotalTracks: track.album.total_tracks || 0,
    albumExternalUrls: {
      spotify: track.album.external_urls?.spotify || null,
    },
    artistIds: track.artists.map((a) => a.id),
    artistNames,
    artistExternalUrls: track.artists.map((a) => ({
      spotify: a.external_urls?.spotify || null,
    })),
    trackExternalUrls: {
      spotify: track.external_urls?.spotify || null,
    },
    trackExternalIds: {
      isrc: isrc || null,
    },
    discNumber: track.disc_number || 1,
    trackNumber: track.track_number || 1,
    playedAt: played_at,
    durationMs: track.duration_ms,
  };
}

// Phase 1: Raw 데이터 마이그레이션
async function migrateRawData(): Promise<Map<string, RawPlayedData>> {
  console.log("📦 Phase 1: Raw 데이터 마이그레이션 시작...");
  
  // 기존 raw 파일 목록 조회
  const legacyKeys = await listAllKeys("played/raw/");
  console.log(`  - 기존 raw 파일 ${legacyKeys.length}개 발견`);
  
  const weeklyData = new Map<string, PlayedItem[]>();
  
  // 모든 legacy 파일 처리
  for (const key of legacyKeys) {
    const body = await getObjectBody(key);
    if (!body) continue;
    
    const legacyData = JSON.parse(body) as LegacyRawData;
    
    for (const legacyItem of legacyData.items) {
      const item = await convertLegacyItem(legacyItem);
      const { isoYear, isoWeek } = getKstIsoWeek(item.playedAt);
      const weekKey = `${isoYear}-${String(isoWeek).padStart(2, "0")}`;
      
      if (!weeklyData.has(weekKey)) {
        weeklyData.set(weekKey, []);
      }
      const weekItems = weeklyData.get(weekKey);
      if (weekItems) {
        weekItems.push(item);
      }
    }
  }
  
  console.log(`  - ${weeklyData.size}개 주차의 데이터로 그룹핑 완료`);
  
  // 중복 제거 및 S3에 저장
  const migratedData = new Map<string, RawPlayedData>();
  
  for (const [weekKey, items] of weeklyData.entries()) {
    // 중복 제거
    const uniqueItems = Array.from(
      new Map(items.map((item) => [getDeduplicationKey(item), item])).values()
    );
    
    // played_at 기준 정렬
    uniqueItems.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
    
    const [yearStr, weekStr] = weekKey.split("-");
    const isoYear = Number.parseInt(yearStr);
    const isoWeek = Number.parseInt(weekStr);
    
    const rawData: RawPlayedData = {
      isoYear,
      isoWeek,
      items: uniqueItems,
    };
    
    // S3에 저장
    const newKey = `raw/${isoYear}/raw-week-${weekStr}.json`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: newKey,
        Body: JSON.stringify(rawData, null, 2),
        ContentType: "application/json",
      })
    );
    
    migratedData.set(weekKey, rawData);
    console.log(`  - ${weekKey}: ${items.length}개 → ${uniqueItems.length}개 (중복 제거) → ${newKey}`);
  }
  
  console.log(`✅ Raw 데이터 마이그레이션 완료: ${migratedData.size}개 주차\n`);
  return migratedData;
}

// Phase 2: Weekly 차트 재생성
async function regenerateWeeklyCharts(
  weeklyRawData: Map<string, RawPlayedData>
): Promise<{ charts: Map<string, ChartResponse>; trackStats: TrackStats }> {
  console.log("📊 Phase 2: Weekly 차트 재생성 시작...");
  
  // 주차별로 정렬
  const sortedWeeks = Array.from(weeklyRawData.keys()).sort();
  
  let trackStats: TrackStats = {};
  const charts = new Map<string, ChartResponse>();
  
  for (const weekKey of sortedWeeks) {
    const rawData = weeklyRawData.get(weekKey);
    if (!rawData) continue;
    const { isoYear, isoWeek, items } = rawData;
    
    // 이전 주 차트 조회
    const prevWeek = getPreviousIsoWeek(isoYear, isoWeek);
    const prevWeekKey = prevWeek
      ? `${prevWeek.isoYear}-${String(prevWeek.isoWeek).padStart(2, "0")}`
      : null;
    const lastChart = prevWeekKey ? charts.get(prevWeekKey) || null : null;
    
    // 차트 생성
    const startDate = getIsoWeekStartDate(isoYear, isoWeek);
    const endDate = getIsoWeekEndDate(isoYear, isoWeek);
    
    const { chart, updatedStats } = buildChart({
      items,
      chartType: "weekly",
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label: weekKey,
        isoYear,
        isoWeek,
      },
      lastChart,
      trackStats,
      limit: 100,
    });
    
    trackStats = updatedStats;
    charts.set(weekKey, chart);
    
    // S3에 저장
    const chartKey = `processed/weekly/${isoYear}/weekly-week-${String(isoWeek).padStart(2, "0")}.json`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: chartKey,
        Body: JSON.stringify(chart, null, 2),
        ContentType: "application/json",
      })
    );
    
    console.log(`  - ${weekKey}: ${items.length}개 재생 기록 → Top ${chart.items.length} → ${chartKey}`);
  }
  
  console.log(`✅ Weekly 차트 재생성 완료: ${charts.size}개 주차\n`);
  return { charts, trackStats };
}

// Phase 3: Monthly 차트 재생성
async function regenerateMonthlyCharts(
  weeklyRawData: Map<string, RawPlayedData>,
  trackStats: TrackStats
): Promise<TrackStats> {
  console.log("📅 Phase 3: Monthly 차트 재생성 시작...");
  
  // 월별로 데이터 그룹핑
  const monthlyData = new Map<string, PlayedItem[]>();
  
  for (const rawData of weeklyRawData.values()) {
    for (const item of rawData.items) {
      const date = parseISO(item.playedAt);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, []);
      }
      const monthItems = monthlyData.get(monthKey);
      if (monthItems) {
        monthItems.push(item);
      }
    }
  }
  
  // 월별로 정렬
  const sortedMonths = Array.from(monthlyData.keys()).sort();
  const monthlyCharts = new Map<string, ChartResponse>();
  
  for (const monthKey of sortedMonths) {
    const items = monthlyData.get(monthKey);
    if (!items) continue;
    const [yearStr, monthStr] = monthKey.split("-");
    const year = Number.parseInt(yearStr);
    const month = Number.parseInt(monthStr);
    
    // 이전 달 차트 조회
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const lastChart = monthlyCharts.get(prevMonthKey) || null;
    
    // 기간 계산
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    
    const { chart, updatedStats } = buildChart({
      items,
      chartType: "monthly",
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label: monthKey,
        year,
        month,
      },
      lastChart,
      trackStats,
      limit: 100,
    });
    
    trackStats = updatedStats;
    monthlyCharts.set(monthKey, chart);
    
    // S3에 저장
    const chartKey = `processed/monthly/${year}/monthly-month-${monthStr}.json`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: chartKey,
        Body: JSON.stringify(chart, null, 2),
        ContentType: "application/json",
      })
    );
    
    console.log(`  - ${monthKey}: ${items.length}개 재생 기록 → Top ${chart.items.length} → ${chartKey}`);
  }
  
  console.log(`✅ Monthly 차트 재생성 완료: ${monthlyCharts.size}개 월\n`);
  return trackStats;
}

// Phase 4: track-stats 저장
async function saveTrackStats(trackStats: TrackStats): Promise<void> {
  console.log("💾 Phase 4: track-stats 저장...");
  
  const statsKey = "metadata/track-stats.json";
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: statsKey,
      Body: JSON.stringify(trackStats, null, 2),
      ContentType: "application/json",
    })
  );
  
  const trackCount = Object.keys(trackStats).length;
  console.log(`✅ track-stats 저장 완료: ${trackCount}개 트랙 → ${statsKey}\n`);
}

// 메인 실행
async function main() {
  console.log("🚀 S3 구조 마이그레이션 시작\n");
  console.log(`ISRC 기반 한국어 메타데이터 변환: ${isIsrcEnrichmentEnabled() ? "활성화" : "비활성화"}\n`);
  
  const startTime = Date.now();
  
  try {
    // Phase 1: Raw 데이터 마이그레이션
    const weeklyRawData = await migrateRawData();
    
    // Phase 2: Weekly 차트 재생성
    const { charts: weeklyCharts, trackStats: weeklyStats } = await regenerateWeeklyCharts(weeklyRawData);
    
    // Phase 3: Monthly 차트 재생성
    const finalStats = await regenerateMonthlyCharts(weeklyRawData, weeklyStats);
    
    // Phase 4: track-stats 저장
    await saveTrackStats(finalStats);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 마이그레이션 완료! (소요 시간: ${duration}초)`);
    console.log(`\n📊 요약:`);
    console.log(`  - Raw 데이터: ${weeklyRawData.size}개 주차`);
    console.log(`  - Weekly 차트: ${weeklyCharts.size}개 주차`);
    console.log(`  - Track Stats: ${Object.keys(finalStats).length}개 트랙`);
  } catch (error) {
    console.error("❌ 마이그레이션 실패:", error);
    process.exit(1);
  }
}

main();
