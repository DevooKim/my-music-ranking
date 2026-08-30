import { TZDate } from "@date-fns/tz";
import {
  eachWeekOfInterval,
  endOfMonth,
  getISOWeek,
  getISOWeekYear,
  startOfMonth,
  subMonths,
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
import type {
  ChartResponse,
  PlayedItem,
  RawPlayedData,
  TrackStats,
} from "../shared/types";

const KOREA_TIMEZONE = "Asia/Seoul";
type LambdaContextLike = { memoryLimitInMB?: number | string };

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

function toKstDate(isoString: string): TZDate {
  return new TZDate(isoString, KOREA_TIMEZONE);
}

export const handler = async (
  _event: unknown,
  context?: LambdaContextLike,
): Promise<void> => {
  const totalStart = Date.now();
  const now = new TZDate(new Date(), KOREA_TIMEZONE);

  // 지난 달 정보
  const lastMonth = subMonths(now, 1);
  const year = lastMonth.getFullYear();
  const month = lastMonth.getMonth() + 1;
  const startDate = startOfMonth(lastMonth);
  const endDate = endOfMonth(lastMonth);
  const periodLabel = `${year}-${String(month).padStart(2, "0")}`;

  console.log(`Processing monthly chart: ${periodLabel}`);

  try {
    const trackStatsRead = await getTrackStats();

    // 1. 해당 월에 걸쳐있는 모든 주차의 raw 파일 읽기
    const weeks = eachWeekOfInterval(
      { start: startDate, end: endDate },
      { weekStartsOn: 1 },
    );
    const allItems: PlayedItem[] = [];

    const rawReadStart = Date.now();
    for (const weekStart of weeks) {
      const isoYear = getISOWeekYear(weekStart);
      const isoWeek = getISOWeek(weekStart);

      const rawData = await getS3Json<RawPlayedData>(
        s3Paths.raw(isoYear, isoWeek),
      );

      if (rawData) {
        // 해당 월의 데이터만 필터링 (played_at 기준)
        const filtered = rawData.items.filter((item) => {
          const playedDate = toKstDate(item.playedAt);
          return playedDate >= startDate && playedDate <= endDate;
        });
        allItems.push(...filtered);
      }
    }
    const rawReadDuration = Date.now() - rawReadStart;

    console.log(`Loaded ${allItems.length} items from raw files`);

    if (allItems.length === 0) {
      console.log("No items found for this month");
      await notifyDiscord(
        buildTrackStatsNotificationPayload({
          functionName: "monthly-processor",
          eventLabel: "track-stats.process.success",
          periodLabel,
          mode: "build + update",
          status: "success",
          trackStatsRead,
          counts: {
            rawItems: 0,
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

    // 2. 지난달 차트 읽기 (LM 계산용)
    const prevMonth = subMonths(lastMonth, 1);
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.monthlyProcessed(
        prevMonth.getFullYear(),
        prevMonth.getMonth() + 1,
      ),
    );

    // 3. track-stats.json 읽기
    const buildStart = Date.now();
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
      trackStats: trackStatsRead.data,
    });
    const buildDuration = Date.now() - buildStart;

    // 5. 차트 저장
    await putS3Json(s3Paths.monthlyProcessed(year, month), chart);
    await revalidateChartCache({
      kind: "chart",
      chartType: "monthly",
      year,
      month,
    });
    console.log(`Saved monthly chart: ${chart.items.length} items`);

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
        functionName: "monthly-processor",
        eventLabel,
        periodLabel,
        mode: "build + update",
        status,
        trackStatsRead,
        trackStatsWrite,
        counts: {
          rawItems: allItems.length,
          aggregatedTracks: allItems.length,
          chartItems: chart.items.length,
          updatedTrackCount: chart.items.length,
        },
        durationsMs: {
          total: Date.now() - totalStart,
          readTrackStats: trackStatsRead.durationMs + rawReadDuration,
          buildChart: buildDuration,
          writeTrackStats: writeDuration,
        },
        runtime: getLambdaRuntime(totalStart, context),
        errors: trackStatsWrite.warnings,
      }),
    );
  } catch (error) {
    console.error("Monthly processing failed:", error);
    try {
      const message = error instanceof Error ? error.message : String(error);
      await notifyDiscord(
        buildTrackStatsNotificationPayload({
          functionName: "monthly-processor",
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
    console.error("Monthly processing failed:", error);
    throw error;
  }
};
