/**
 * S3의 raw 데이터로부터 processed 차트와 track-stats 재생성
 *
 * 기능:
 * 1. S3에서 raw 데이터 읽기 (raw/{YYYY}/raw-week-{nn}.json)
 * 2. Weekly 차트 재생성
 * 3. Monthly 차트 재생성
 * 4. track-stats 재생성
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseISO } from "date-fns";
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
import { listAllKeys, s3Client } from "../utils/s3";

// S3에서 raw 데이터 읽기
async function loadRawDataFromS3(): Promise<Map<string, RawPlayedData>> {
  console.log("📦 S3에서 Raw 데이터 로드 중...\n");

  const rawKeys = await listAllKeys("raw/");
  const rawDataFiles = rawKeys.filter((key) =>
    key.match(/^raw\/\d{4}\/raw-week-\d{2}\.json$/),
  );

  console.log(`  - 발견된 raw 데이터 파일: ${rawDataFiles.length}개\n`);

  const weeklyRawData = new Map<string, RawPlayedData>();
  let processedFiles = 0;

  for (const key of rawDataFiles) {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: key,
        }),
      );

      const content = await response.Body?.transformToString();
      if (!content) {
        console.warn(`  - ${key}: 내용 없음 (스킵)`);
        continue;
      }

      const rawData = JSON.parse(content) as RawPlayedData;
      const weekKey = `${rawData.isoYear}-${String(rawData.isoWeek).padStart(2, "0")}`;

      weeklyRawData.set(weekKey, rawData);
      processedFiles++;

      if (processedFiles % 10 === 0) {
        console.log(`  - 진행: ${processedFiles}/${rawDataFiles.length}`);
      }
    } catch (error) {
      console.error(`  - ${key} 로드 실패:`, error);
    }
  }

  console.log(
    `\n✅ Raw 데이터 로드 완료: ${weeklyRawData.size}개 주차 데이터\n`,
  );
  return weeklyRawData;
}

// Weekly 차트 재생성
async function regenerateWeeklyCharts(
  weeklyRawData: Map<string, RawPlayedData>,
): Promise<{ charts: Map<string, ChartResponse>; trackStats: TrackStats }> {
  console.log("📊 Weekly 차트 재생성 시작...\n");

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

// Monthly 차트 재생성
async function regenerateMonthlyCharts(
  weeklyRawData: Map<string, RawPlayedData>,
  trackStats: TrackStats,
): Promise<TrackStats> {
  console.log("📅 Monthly 차트 재생성 시작...\n");

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

// track-stats 저장
async function saveTrackStats(trackStats: TrackStats): Promise<void> {
  console.log("💾 track-stats 저장...");

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
  console.log("🚀 S3 Raw 데이터로부터 Processed 차트 재생성 시작\n");

  const startTime = Date.now();

  try {
    // 1. S3에서 raw 데이터 로드
    const weeklyRawData = await loadRawDataFromS3();

    // 2. Weekly 차트 재생성
    const { charts: weeklyCharts, trackStats: weeklyStats } =
      await regenerateWeeklyCharts(weeklyRawData);

    // 3. Monthly 차트 재생성
    const finalStats = await regenerateMonthlyCharts(
      weeklyRawData,
      weeklyStats,
    );

    // 4. track-stats 저장
    await saveTrackStats(finalStats);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 재생성 완료! (소요 시간: ${duration}초)`);
    console.log(`\n📊 요약:`);
    console.log(`  - Raw 데이터: ${weeklyRawData.size}개 주차`);
    console.log(`  - Weekly 차트: ${weeklyCharts.size}개 주차`);
    console.log(`  - Track Stats: ${Object.keys(finalStats).length}개 트랙`);
  } catch (error) {
    console.error("❌ 재생성 실패:", error);
    process.exit(1);
  }
}

main();
