/**
 * 로컬 spotify-recently-played 데이터를 마이그레이션
 *
 * 기능:
 * 1. 로컬 파일 읽기 (연월별 폴더)
 * 2. Raw 데이터 마이그레이션 (주차별 병합 + 중복 제거)
 * 3. 한국어 메타데이터 변환 (ISRC 기반)
 * 4. Weekly/Monthly 차트 재생성
 * 5. track-stats 재생성
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getISOWeek, getISOWeekYear, parseISO } from "date-fns";
import { buildChart } from "../../lambda/shared/chart/builder";
import type {
  ChartResponse,
  PlayedItem,
  RawPlayedData,
  TrackStats,
} from "../../lambda/shared/types";
import { BUCKET } from "../utils/config";
import {
  getIsoWeekEndDate,
  getIsoWeekStartDate,
  getPreviousIsoWeek,
} from "../utils/iso-week";
import { s3Client } from "../utils/s3";
import {
  fetchTrackMetadataByIsrc,
  isIsrcEnrichmentEnabled,
} from "../utils/spotify";

const DOWNLOAD_DIR = path.join(__dirname, "../../data/spotify-raw");

interface LegacyRawItem {
  track: {
    id: string;
    name: string;
    album: {
      id: string;
      name: string;
      images?: Array<{ url: string }>;
      artists?: Array<{
        id: string;
        name: string;
        external_urls?: { spotify?: string };
      }>;
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

// Legacy 데이터를 PlayedItem으로 변환 (기본 변환, ISRC 조회 없이)
function convertLegacyItemBasic(legacyItem: LegacyRawItem): PlayedItem {
  const { track, played_at } = legacyItem;

  return {
    trackId: track.id,
    trackName: track.name,
    albumId: track.album.id,
    albumName: track.album.name,
    albumImageUrl: track.album.images?.[0]?.url || "",
    albumTotalTracks: track.album.total_tracks || 0,
    albumExternalUrls: {
      spotify: track.album.external_urls?.spotify || null,
    },
    artistIds: track.artists.map((a) => a.id),
    artistNames: track.artists.map((a) => a.name),
    artistExternalUrls: track.artists.map((a) => ({
      spotify: a.external_urls?.spotify || null,
    })),
    trackExternalUrls: {
      spotify: track.external_urls?.spotify || null,
    },
    trackExternalIds: {
      isrc: track.external_ids?.isrc || null,
    },
    discNumber: track.disc_number || 1,
    trackNumber: track.track_number || 1,
    playedAt: played_at,
    durationMs: track.duration_ms,
  };
}

// 한국어 메타데이터로 enrichment
async function enrichWithKoreanMetadata(item: PlayedItem): Promise<PlayedItem> {
  const isrc = item.trackExternalIds.isrc;

  if (!isrc || !isIsrcEnrichmentEnabled()) {
    return item;
  }

  try {
    const koreanMetadata = await fetchTrackMetadataByIsrc(isrc);
    if (koreanMetadata) {
      return {
        ...item,
        trackName: koreanMetadata.trackName,
        albumName: koreanMetadata.albumName,
        artistNames: koreanMetadata.artistNames,
      };
    }
  } catch (error) {
    console.warn(`Failed to fetch Korean metadata for ISRC ${isrc}:`, error);
  }

  return item;
}

// Phase 1: 로컬 파일에서 Raw 데이터 마이그레이션
async function migrateRawData(): Promise<Map<string, RawPlayedData>> {
  console.log("📦 Phase 1: 로컬 파일에서 Raw 데이터 마이그레이션 시작...\n");

  // 다운로드 디렉토리의 연월 폴더 목록
  const yearMonthDirs = await fs.readdir(DOWNLOAD_DIR);
  const sortedDirs = yearMonthDirs.filter((dir) => /^\d{6}$/.test(dir)).sort();

  console.log(`처리 대상 연월: ${sortedDirs.join(", ")}\n`);

  const weeklyData = new Map<string, Map<string, PlayedItem>>(); // Map<weekKey, Map<dedupeKey, item>>
  let totalProcessedFiles = 0;

  // 연월별로 순차 처리
  for (const yearMonth of sortedDirs) {
    const yearMonthDir = path.join(DOWNLOAD_DIR, yearMonth);
    const files = await fs.readdir(yearMonthDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) {
      console.log(`📅 ${yearMonth}: 파일 없음 (스킵)\n`);
      continue;
    }

    console.log(`📅 ${yearMonth}: ${jsonFiles.length}개 파일 처리 중...`);

    let processedFiles = 0;

    for (const fileName of jsonFiles) {
      try {
        const filePath = path.join(yearMonthDir, fileName);
        const content = await fs.readFile(filePath, "utf-8");
        const legacyData = JSON.parse(content) as LegacyRawData;

        if (!legacyData.items?.length) {
          processedFiles++;
          continue;
        }

        // items 처리 (기본 변환만, ISRC 조회 없이)
        for (const legacyItem of legacyData.items) {
          try {
            const item = convertLegacyItemBasic(legacyItem);
            const { isoYear, isoWeek } = getKstIsoWeek(item.playedAt);
            const weekKey = `${isoYear}-${String(isoWeek).padStart(2, "0")}`;

            if (!weeklyData.has(weekKey)) {
              weeklyData.set(weekKey, new Map());
            }

            const weekMap = weeklyData.get(weekKey);
            if (weekMap) {
              const dedupeKey = getDeduplicationKey(item);
              weekMap.set(dedupeKey, item); // 자동 중복 제거
            }
          } catch (itemError) {
            console.error(`    - item 변환 오류 (${fileName}):`, itemError);
          }
        }

        processedFiles++;
        totalProcessedFiles++;

        if (processedFiles % 100 === 0) {
          console.log(
            `  - 진행: ${processedFiles}/${jsonFiles.length} (${weeklyData.size}개 주차)`,
          );
        }
      } catch (error) {
        console.error(`  - 파일 처리 오류: ${fileName}`, error);
        processedFiles++;
        totalProcessedFiles++;
      }
    }

    console.log(`✅ ${yearMonth} 완료: ${processedFiles}개 파일 처리\n`);
  }

  console.log(
    `  - ${totalProcessedFiles}개 파일 처리 완료, ${weeklyData.size}개 주차 데이터\n`,
  );

  // 한국어 메타데이터 변환 (중복 제거된 unique items만)
  if (isIsrcEnrichmentEnabled()) {
    console.log("📝 한국어 메타데이터 변환 시작...");
    let enrichedCount = 0;
    let totalUnique = 0;

    for (const [, weekMap] of weeklyData.entries()) {
      const items = Array.from(weekMap.values());
      totalUnique += items.length;
    }

    console.log(`  - 총 ${totalUnique}개 unique 트랙 변환 예정\n`);

    for (const [, weekMap] of weeklyData.entries()) {
      const items = Array.from(weekMap.values());

      for (const item of items) {
        const enrichedItem = await enrichWithKoreanMetadata(item);
        weekMap.set(getDeduplicationKey(enrichedItem), enrichedItem);
        enrichedCount++;

        if (enrichedCount % 100 === 0) {
          console.log(`  - 진행: ${enrichedCount}/${totalUnique} 트랙 처리`);
        }
      }
    }

    console.log(`✅ 한국어 메타데이터 변환 완료: ${enrichedCount}개 트랙\n`);
  }

  // S3에 저장
  console.log("💾 S3에 Raw 데이터 저장 중...\n");
  const migratedData = new Map<string, RawPlayedData>();
  let totalItems = 0;

  for (const [weekKey, weekMap] of weeklyData.entries()) {
    const uniqueItems = Array.from(weekMap.values());

    // played_at 기준 정렬
    uniqueItems.sort((a, b) => a.playedAt.localeCompare(b.playedAt));

    const [yearStr, weekStr] = weekKey.split("-");
    const isoYear = Number.parseInt(yearStr, 10);
    const isoWeek = Number.parseInt(weekStr, 10);

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
      }),
    );

    migratedData.set(weekKey, rawData);
    totalItems += uniqueItems.length;

    console.log(`  - ${weekKey}: ${uniqueItems.length}개 → ${newKey}`);
  }

  console.log(
    `\n✅ Raw 데이터 마이그레이션 완료: ${migratedData.size}개 주차, 총 ${totalItems}개 items\n`,
  );
  return migratedData;
}

// Phase 2: Weekly 차트 재생성
async function regenerateWeeklyCharts(
  weeklyRawData: Map<string, RawPlayedData>,
): Promise<{ charts: Map<string, ChartResponse>; trackStats: TrackStats }> {
  console.log("📊 Phase 2: Weekly 차트 재생성 시작...\n");

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
      }),
    );

    console.log(
      `  - ${weekKey}: ${items.length}개 재생 기록 → Top ${chart.items.length} → ${chartKey}`,
    );
  }

  console.log(`\n✅ Weekly 차트 재생성 완료: ${charts.size}개 주차\n`);
  return { charts, trackStats };
}

// Phase 3: Monthly 차트 재생성
async function regenerateMonthlyCharts(
  weeklyRawData: Map<string, RawPlayedData>,
  trackStats: TrackStats,
): Promise<TrackStats> {
  console.log("📅 Phase 3: Monthly 차트 재생성 시작...\n");

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
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);

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
      }),
    );

    console.log(
      `  - ${monthKey}: ${items.length}개 재생 기록 → Top ${chart.items.length} → ${chartKey}`,
    );
  }

  console.log(`\n✅ Monthly 차트 재생성 완료: ${monthlyCharts.size}개 월\n`);
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
    }),
  );

  const trackCount = Object.keys(trackStats).length;
  console.log(`✅ track-stats 저장 완료: ${trackCount}개 트랙 → ${statsKey}\n`);
}

// 메인 실행
async function main() {
  console.log("🚀 로컬 파일 기반 마이그레이션 시작\n");
  console.log(
    `ISRC 기반 한국어 메타데이터 변환: ${isIsrcEnrichmentEnabled() ? "활성화" : "비활성화"}`,
  );
  console.log(`로컬 경로: ${DOWNLOAD_DIR}\n`);

  const startTime = Date.now();

  try {
    // Phase 1: Raw 데이터 마이그레이션
    const weeklyRawData = await migrateRawData();

    // Phase 2: Weekly 차트 재생성
    const { charts: weeklyCharts, trackStats: weeklyStats } =
      await regenerateWeeklyCharts(weeklyRawData);

    // Phase 3: Monthly 차트 재생성
    const finalStats = await regenerateMonthlyCharts(
      weeklyRawData,
      weeklyStats,
    );

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
