import { getISOWeek, getISOWeekYear, subWeeks, startOfISOWeek, endOfISOWeek } from "date-fns";
import { buildChart } from "../shared/chart";
import { s3Paths, getS3Json, putS3Json } from "../shared/s3";
import type { RawPlayedData, ChartResponse, TrackStats } from "../shared/types";

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
    // 1. Raw 파일 읽기 (단일 파일)
    const rawData = await getS3Json<RawPlayedData>(s3Paths.raw(isoYear, isoWeek));
    
    if (!rawData || rawData.items.length === 0) {
      console.log("No raw data found for this week");
      return;
    }
    
    const weeklyItems = rawData.items;
    console.log(`Loaded ${weeklyItems.length} items from raw data`);
    
    // 2. 지난주 차트 읽기 (LW 계산용)
    const prevWeek = subWeeks(lastWeek, 1);
    const prevIsoYear = getISOWeekYear(prevWeek);
    const prevIsoWeek = getISOWeek(prevWeek);
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.weeklyProcessed(prevIsoYear, prevIsoWeek)
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
        isoYear,
        isoWeek,
      },
      lastChart,
      trackStats,
      limit: 100,
    });
    
    // 5. 차트 저장
    await putS3Json(s3Paths.weeklyProcessed(isoYear, isoWeek), chart);
    console.log(`Saved weekly chart: ${chart.items.length} items`);
    
    // 6. track-stats 업데이트
    await putS3Json(s3Paths.trackStats(), updatedStats);
    console.log(`Updated track stats`);
    
  } catch (error) {
    console.error("Weekly processing failed:", error);
    throw error;
  }
};
