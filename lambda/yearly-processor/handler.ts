import { TZDate } from "@date-fns/tz";
import {
  eachWeekOfInterval,
  endOfYear,
  getISOWeek,
  getISOWeekYear,
  startOfYear,
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
  context: Parameters<typeof buildTrackStatsNotificationPayload>[0],
): Promise<void> {
  if (!isDiscordEnabled()) return;
  await sendDiscordNotification(context, getDiscordWebhook());
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

  // 지난 해 정보
  const lastYear = new Date(
    Date.UTC(
      now.getUTCFullYear() - 1,
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
    ),
  );
  const year = lastYear.getFullYear();
  const startDate = startOfYear(lastYear);
  const endDate = endOfYear(lastYear);
  const periodLabel = `${year}`;

  console.log(`Processing yearly chart: ${periodLabel}`);

  try {
    const trackStatsRead = await getTrackStats();

    // 지난 1년치 raw 파일에서 해당 연도 데이터 수집
    const weeks = eachWeekOfInterval(
      { start: startDate, end: endDate },
      { weekStartsOn: 1 },
    );

    const allItems: (RawPlayedData["items"][number] & { playedAt: string })[] =
      [];
    const rawReadStart = Date.now();
    for (const weekStart of weeks) {
      const isoYear = getISOWeekYear(weekStart);
      const isoWeek = getISOWeek(weekStart);

      const rawData = await getS3Json<RawPlayedData>(
        s3Paths.raw(isoYear, isoWeek),
      );
      if (!rawData?.items?.length) continue;

      const filtered = rawData.items.filter((item) => {
        const playedAt = toKstDate(item.playedAt);
        return playedAt >= startDate && playedAt <= endDate;
      });
      allItems.push(...filtered);
    }
    const rawReadDuration = Date.now() - rawReadStart;

    if (allItems.length === 0) {
      console.log("No items found for this year");
      await notifyDiscord(
        buildTrackStatsNotificationPayload({
          functionName: "yearly-processor",
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

    const prevYear = new Date(Date.UTC(year - 1, 0, 1));
    const previousYear = prevYear.getFullYear();
    const lastChart = await getS3Json<ChartResponse>(
      s3Paths.yearlyProcessed(previousYear),
    );

    const buildStart = Date.now();
    const { chart, updatedStats } = buildChart({
      items: allItems,
      chartType: "yearly",
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label: periodLabel,
        year,
      },
      lastChart,
      trackStats: trackStatsRead.data,
    });
    const buildDuration = Date.now() - buildStart;

    const chartWithoutEntryStatus = {
      ...chart,
      items: chart.items.map((item) => ({ ...item, entryStatus: null })),
    };

    await putS3Json(s3Paths.yearlyProcessed(year), chartWithoutEntryStatus);
    await revalidateChartCache({ kind: "chart", chartType: "yearly", year });
    console.log(
      `Saved yearly chart: ${chartWithoutEntryStatus.items.length} items`,
    );

    const writeStart = Date.now();
    const trackStatsWrite = await putTrackStats(updatedStats);
    for (const payload of buildTrackStatsRevalidationPayloads(
      trackStatsWrite.partialFailure,
    )) {
      await revalidateChartCache(payload);
    }
    const writeDuration = Date.now() - writeStart;
    const status = trackStatsWrite.partialFailure ? "partial" : "success";
    const eventLabel = trackStatsWrite.partialFailure
      ? "track-stats.process.partial_write"
      : "track-stats.process.success";

    await notifyDiscord(
      buildTrackStatsNotificationPayload({
        functionName: "yearly-processor",
        eventLabel,
        periodLabel,
        mode: "build + update",
        status,
        trackStatsRead,
        trackStatsWrite,
        counts: {
          rawItems: allItems.length,
          aggregatedTracks: allItems.length,
          chartItems: chartWithoutEntryStatus.items.length,
          updatedTrackCount: chartWithoutEntryStatus.items.length,
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
    console.error("Yearly processing failed:", error);
    try {
      const message = error instanceof Error ? error.message : String(error);
      await notifyDiscord(
        buildTrackStatsNotificationPayload({
          functionName: "yearly-processor",
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
    console.error("Yearly processing failed:", error);
    throw error;
  }
};
