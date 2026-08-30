import { TZDate } from "@date-fns/tz";
import {
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from "date-fns";
import { buildChart } from "../shared/chart";
import {
  buildTrackStatsNotificationPayload,
  sendDiscordNotification,
} from "../shared/discord-notify";
import {
  buildTrackStatsRevalidationPayloads,
  revalidateChartCache,
} from "../shared/revalidate";
import { getS3Json, putS3Json, s3Paths } from "../shared/s3";
import { getTrackStats, putTrackStats } from "../shared/track-stats-storage";
import type { ChartResponse, RawPlayedData, TrackStats } from "../shared/types";

const KOREA_TIMEZONE = "Asia/Seoul";
type LambdaContextLike = { memoryLimitInMB?: number | string };
const REENTRY_LOOKBACK_WEEKS = 4;

async function getRecentTrackIdsFromPreviousWeeks(
  fromDate: Date,
  lookbackWeeks = REENTRY_LOOKBACK_WEEKS,
): Promise<Set<string>> {
  const trackIds = new Set<string>();
  let cursor = fromDate;

  for (let step = 0; step < lookbackWeeks; step += 1) {
    const previous = subWeeks(cursor, 1);
    const previousIsoYear = getISOWeekYear(previous);
    const previousIsoWeek = getISOWeek(previous);
    cursor = previous;

    const previousChart = await getS3Json<ChartResponse>(
      s3Paths.weeklyProcessed(previousIsoYear, previousIsoWeek),
    );
    if (!previousChart?.items?.length) continue;

    for (const item of previousChart.items) {
      trackIds.add(item.trackId);
    }
  }

  return trackIds;
}

function getLambdaRuntime(startMs: number, context?: LambdaContextLike) {
  const memory = process.memoryUsage();
  const memoryLimitMB = context?.memoryLimitInMB
    ? Number(context.memoryLimitInMB)
    : undefined;

  return {
    executionMs: Date.now() - startMs,
    memoryUsedMB: memory.heapUsed / 1024 / 1024,
    memoryRssMB: memory.rss / 1024 / 1024,
    memoryLimitMB: Number.isFinite(memoryLimitMB) ? memoryLimitMB : undefined,
  };
}

function isDiscordEnabled(): boolean {
  return process.env.DISCORD_NOTIFICATION_ENABLED === "true";
}

function getDiscordWebhook(): string | undefined {
  return process.env.DISCORD_WEBHOOK_URL;
}

async function notifyDiscord(
  payload: ReturnType<typeof buildTrackStatsNotificationPayload>,
): Promise<void> {
  if (!isDiscordEnabled()) return;
  await sendDiscordNotification(payload, getDiscordWebhook());
}

export const handler = async (
  _event: unknown,
  context?: LambdaContextLike,
): Promise<void> => {
  const totalStart = Date.now();
  const now = new TZDate(new Date(), KOREA_TIMEZONE);

  // 지난 주 정보 계산
  const lastWeek = subWeeks(now, 1);
  const isoYear = getISOWeekYear(lastWeek);
  const isoWeek = getISOWeek(lastWeek);
  const startDate = startOfISOWeek(lastWeek);
  const endDate = endOfISOWeek(lastWeek);
  const periodLabel = `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;

  console.log(`Processing ${periodLabel}`);

  try {
    const trackStatsRead = await getTrackStats();

    // 1. Raw 파일 읽기 (단일 파일)
    const readStart = Date.now();
    const rawData = await getS3Json<RawPlayedData>(
      s3Paths.raw(isoYear, isoWeek),
    );
    const readDuration = Date.now() - readStart;
    const rawItems = rawData?.items?.length ?? 0;
    if (!rawData || rawData.items.length === 0) {
      console.log("No raw data found for this week");
      await notifyDiscord(
        buildTrackStatsNotificationPayload({
          functionName: "weekly-processor",
          eventLabel: "track-stats.process.success",
          periodLabel,
          mode: "build + update",
          status: "success",
          trackStatsRead,
          counts: {
            rawItems,
            aggregatedTracks: 0,
            chartItems: 0,
            updatedTrackCount: 0,
          },
          durationsMs: {
            total: Date.now() - totalStart,
            readTrackStats: trackStatsRead.durationMs,
            buildChart: 0,
            writeTrackStats: 0,
          },
          runtime: getLambdaRuntime(totalStart, context),
          errors: [],
        }),
      );
      return;
    }

    const weeklyItems = rawData.items;
    console.log(`Loaded ${weeklyItems.length} items from raw data`);

    // 2. 지난주 차트 읽기 (LW 계산용)
    const prevWeek = subWeeks(lastWeek, 1);
    const prevIsoYear = getISOWeekYear(prevWeek);
    const prevIsoWeek = getISOWeek(prevWeek);
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.weeklyProcessed(prevIsoYear, prevIsoWeek),
    );

    // 3. track-stats 사용/갱신
    const recentTrackIds = await getRecentTrackIdsFromPreviousWeeks(lastWeek);
    const buildStart = Date.now();
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
      recentlySeenTrackIds: recentTrackIds,
      trackStats: trackStatsRead.data,
    });
    const buildDuration = Date.now() - buildStart;

    // 5. 차트 저장
    await putS3Json(s3Paths.weeklyProcessed(isoYear, isoWeek), chart);
    await revalidateChartCache({
      kind: "chart",
      chartType: "weekly",
      isoYear,
      isoWeek,
    });
    console.log(`Saved weekly chart: ${chart.items.length} items`);

    // 6. track-stats 업데이트
    const writeStart = Date.now();
    const trackStatsWrite = await putTrackStats(updatedStats);
    for (const payload of buildTrackStatsRevalidationPayloads(
      trackStatsWrite.partialFailure,
    )) {
      await revalidateChartCache(payload);
    }
    const writeDuration = Date.now() - writeStart;
    console.log(`Updated track stats`);

    const status = trackStatsWrite.partialFailure ? "partial" : "success";
    const eventLabel = trackStatsWrite.partialFailure
      ? "track-stats.process.partial_write"
      : "track-stats.process.success";

    await notifyDiscord(
      buildTrackStatsNotificationPayload({
        functionName: "weekly-processor",
        eventLabel,
        periodLabel,
        mode: "build + update",
        status,
        trackStatsRead,
        trackStatsWrite,
        counts: {
          rawItems: rawItems,
          aggregatedTracks: weeklyItems.length,
          chartItems: chart.items.length,
          updatedTrackCount: chart.items.length,
        },
        durationsMs: {
          total: Date.now() - totalStart,
          readTrackStats: trackStatsRead.durationMs + readDuration,
          buildChart: buildDuration,
          writeTrackStats: writeDuration,
        },
        runtime: getLambdaRuntime(totalStart, context),
        errors: trackStatsWrite.warnings,
      }),
    );
  } catch (error) {
    console.error("Weekly processing failed:", error);
    try {
      const message = error instanceof Error ? error.message : String(error);
      await notifyDiscord(
        buildTrackStatsNotificationPayload({
          functionName: "weekly-processor",
          eventLabel: "track-stats.process.fail",
          periodLabel,
          mode: "build + update",
          status: "error",
          trackStatsRead: {
            data: {} as TrackStats,
            used: "unknown",
            bytesReadByFormat: {
              json: 0,
              parquet: 0,
            },
            fallbackUsed: false,
            durationMs: 0,
            bytesRead: 0,
            attemptedFormats: [],
          },
          counts: {
            rawItems: 0,
            aggregatedTracks: 0,
            chartItems: 0,
            updatedTrackCount: 0,
          },
          durationsMs: {
            total: Date.now() - totalStart,
            readTrackStats: 0,
            buildChart: 0,
            writeTrackStats: 0,
          },
          runtime: getLambdaRuntime(totalStart, context),
          errors: [message],
        }),
      );
    } catch (notifyError) {
      console.warn("Failed to send discord notification:", notifyError);
    }
    throw error;
  }
};
