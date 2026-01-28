import { refreshAccessToken, fetchRecentlyPlayedByUrl, buildAfterUrl } from "../shared/spotify";
import {
  mapSpotifyToPlayedItem,
  deduplicatePlayedItems,
  groupByWeek,
} from "../shared/mapper";
import { s3Paths, getS3Json, putS3Json } from "../shared/s3";
import type { RawPlayedData, PlayedItem, NextMetadata } from "../shared/types";

export const handler = async (): Promise<void> => {
  // API 요청 전 현재 시간 기록 (items가 없을 경우 after URL 생성에 사용)
  const requestTimestamp = Date.now();

  console.log(`Collector started at ${new Date(requestTimestamp).toISOString()}`);

  try {
    // 1. 메타데이터에서 next URL 읽기
    const metadata = await getS3Json<NextMetadata>(s3Paths.nextMetadata());
    const nextUrl = metadata?.next || null;

    console.log(`Next URL from metadata: ${nextUrl || "using default URL"}`);

    // 2. Access Token 갱신
    const accessToken = await refreshAccessToken();

    // 3. Spotify API 호출
    const spotifyData = await fetchRecentlyPlayedByUrl(accessToken, nextUrl);

    console.log(`API response: ${spotifyData.items.length} items, next: ${spotifyData.next || "null"}`);

    // 4. 응답 처리
    if (spotifyData.items.length === 0) {
      // items가 없으면 현재 시간으로 after URL 생성하여 메타데이터 업데이트
      const newNextUrl = buildAfterUrl(requestTimestamp);
      await putS3Json(s3Paths.nextMetadata(), {
        next: newNextUrl,
        updatedAt: new Date().toISOString(),
      } satisfies NextMetadata);

      console.log(`No items, updated next URL to: ${newNextUrl}`);
      return;
    }

    // 5. 필요한 필드만 추출
    const items: PlayedItem[] = spotifyData.items.map(mapSpotifyToPlayedItem);

    // 6. items를 재생 시각(played_at) 기준으로 주차별 그룹핑 (KST 기준)
    const weekGroups = groupByWeek(items);

    console.log(`Grouped into ${weekGroups.length} week(s): ${weekGroups.map((g) => `${g.isoYear}-W${g.isoWeek}(${g.items.length})`).join(", ")}`);

    // 7. 각 주차별로 처리
    for (const group of weekGroups) {
      const { isoYear, isoWeek, items: newItems } = group;
      const rawKey = s3Paths.raw(isoYear, isoWeek);

      // a. 기존 raw 파일 읽기 (있으면)
      const existingData = await getS3Json<RawPlayedData>(rawKey);
      const existingItems = existingData?.items || [];

      // b. items 병합 및 중복 제거
      const mergedItems = [...existingItems, ...newItems];
      const dedupedItems = deduplicatePlayedItems(mergedItems);

      // 시간순 정렬
      dedupedItems.sort(
        (a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
      );

      // c. raw 파일 저장
      const rawData: RawPlayedData = {
        isoYear,
        isoWeek,
        items: dedupedItems,
      };

      await putS3Json(rawKey, rawData);
      console.log(`Saved ${dedupedItems.length} items to ${rawKey} (added ${dedupedItems.length - existingItems.length} new)`);
    }

    // 8. next 메타데이터 업데이트
    const newNextUrl = spotifyData.next || buildAfterUrl(requestTimestamp);
    await putS3Json(s3Paths.nextMetadata(), {
      next: newNextUrl,
      updatedAt: new Date().toISOString(),
    } satisfies NextMetadata);

    console.log(`Updated next metadata: ${newNextUrl}`);
  } catch (error) {
    console.error("Collection failed:", error);
    throw error;
  }
};
