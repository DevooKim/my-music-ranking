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
