import { subMonths, startOfMonth, endOfMonth, eachWeekOfInterval, getISOWeek, getISOWeekYear } from "date-fns";
import { buildChart } from "../shared/chart";
import { s3Paths, getS3Json, putS3Json } from "../shared/s3";
import type { RawPlayedData, PlayedItem, ChartResponse, TrackStats } from "../shared/types";

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
    // 1. 해당 월에 걸쳐있는 모든 주차의 raw 파일 읽기
    const weeks = eachWeekOfInterval({ start: startDate, end: endDate }, { weekStartsOn: 1 });
    const allItems: PlayedItem[] = [];
    
    for (const weekStart of weeks) {
      const isoYear = getISOWeekYear(weekStart);
      const isoWeek = getISOWeek(weekStart);
      
      const rawData = await getS3Json<RawPlayedData>(
        s3Paths.raw(isoYear, isoWeek)
      );
      
      if (rawData) {
        // 해당 월의 데이터만 필터링 (played_at 기준)
        const filtered = rawData.items.filter((item) => {
          const playedDate = new Date(item.playedAt);
          return playedDate >= startDate && playedDate <= endDate;
        });
        allItems.push(...filtered);
      }
    }
    
    console.log(`Loaded ${allItems.length} items from raw files`);
    
    if (allItems.length === 0) {
      console.log("No items found for this month");
      return;
    }
    
    // 2. 지난달 차트 읽기 (LM 계산용)
    const prevMonth = subMonths(lastMonth, 1);
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.monthlyProcessed(prevMonth.getFullYear(), prevMonth.getMonth() + 1)
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
        year,
        month,
      },
      lastChart,
      trackStats,
    });
    
    // 5. 차트 저장
    await putS3Json(s3Paths.monthlyProcessed(year, month), chart);
    console.log(`Saved monthly chart: ${chart.items.length} items`);
    
    // 6. track-stats 업데이트
    await putS3Json(s3Paths.trackStats(), updatedStats);
    console.log(`Updated track stats`);
    
  } catch (error) {
    console.error("Monthly processing failed:", error);
    throw error;
  }
};
