import { deduplicatePlayedItems } from "../../lambda/shared/mapper";
import type { TrackStats, PlayedItem } from "../../lambda/shared/types";
import { buildChart } from "../../lambda/shared/chart/builder";
import { getS3Json, putS3Json, s3Paths } from "../../lambda/shared/s3";
import { fetchRawWeekData, listRawWeeks } from "../utils/raw-data";

async function main(): Promise<void> {
  console.log("=== Overall Stats Reprocessing ===\n");

  // 모든 주 데이터 수집
  const weeks = await listRawWeeks();
  console.log(`Found ${weeks.length} weeks of data\n`);

  const allItems: PlayedItem[] = [];
  let totalRawItems = 0;

  console.log("Collecting all raw data...");
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    const { items } = await fetchRawWeekData(week.isoYear, week.isoWeek);
    
    allItems.push(...items);
    totalRawItems += items.length;

    if ((i + 1) % 10 === 0 || i === weeks.length - 1) {
      console.log(`  Progress: ${i + 1}/${weeks.length} weeks (${totalRawItems} raw items)`);
    }
  }

  if (allItems.length === 0) {
    console.log("No data found");
    return;
  }

  console.log(`\nDeduplicating ${allItems.length} items...`);
  const deduped = deduplicatePlayedItems(allItems);
  console.log(`After deduplication: ${deduped.length} unique plays`);

  // 전체 기간 계산
  const playedDates = deduped.map(item => new Date(item.playedAt));
  const startDate = new Date(Math.min(...playedDates.map(d => d.getTime())));
  const endDate = new Date(Math.max(...playedDates.map(d => d.getTime())));

  console.log(`\nPeriod: ${startDate.toISOString()} ~ ${endDate.toISOString()}`);

  let trackStats = await getS3Json<TrackStats>(s3Paths.trackStats()) ?? {};

  console.log("\nBuilding overall chart...");
  const { chart, updatedStats } = buildChart({
    items: deduped,
    chartType: "weekly", // stats는 chartType이 따로 없으므로 weekly 사용
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      label: "all-time",
    },
    lastChart: null,
    trackStats,
    limit: 500, // Stats는 더 많은 항목 포함
  });

  // Stats 저장 (경로 확인 필요)
  const statsPath = "played/charts/stats/all-time.json";
  await putS3Json(statsPath, chart);
  console.log(`\nSaved stats chart: ${chart.items.length} tracks`);

  // trackStats도 업데이트
  await putS3Json(s3Paths.trackStats(), updatedStats);
  console.log("Updated track stats");

  console.log("\n✅ Overall stats reprocessing complete");
  console.log(`   Total plays: ${deduped.length}`);
  console.log(`   Unique tracks: ${chart.items.length}`);
  console.log(`   Period: ${startDate.toLocaleDateString()} ~ ${endDate.toLocaleDateString()}`);
}

main().catch((error) => {
  console.error("❌ Failed:", error);
  process.exit(1);
});
