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
        isoYear,
        isoWeek,
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
