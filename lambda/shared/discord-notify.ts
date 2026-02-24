import type { TrackStatsReadResult, TrackStatsWriteResult } from "./track-stats-storage";

const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;

export type NotificationStatus = "success" | "partial" | "error";

interface NotificationCounts {
  rawItems: number;
  aggregatedTracks: number;
  chartItems: number;
  updatedTrackCount: number;
}

interface NotificationDurations {
  total: number;
  readTrackStats: number;
  buildChart: number;
  writeTrackStats: number;
}

interface LambdaRuntimeStats {
  executionMs: number;
  memoryUsedMB: number;
  memoryRssMB: number;
  memoryLimitMB?: number;
}

export interface TrackStatsNotificationContext {
  functionName: "weekly-processor" | "monthly-processor";
  eventLabel: string;
  periodLabel: string;
  mode: string;
  status: NotificationStatus;
  trackStatsRead: TrackStatsReadResult;
  trackStatsWrite?: TrackStatsWriteResult;
  counts: NotificationCounts;
  durationsMs: NotificationDurations;
  runtime?: LambdaRuntimeStats;
  errors?: string[];
}

type DiscordField = {
  name: string;
  value: string;
  inline: boolean;
};

type DiscordEmbed = {
  title: string;
  color: number;
  fields: DiscordField[];
};

export interface DiscordWebhookPayload {
  username: string;
  embeds: DiscordEmbed[];
}

function toReadSourceLabel(read: TrackStatsReadResult): string {
  const fallbackSource = read.fallbackFrom ?? "unknown";
  if (read.sourceError) {
    if (read.used === "both") {
      const fallbackTarget = read.fallbackFrom
        ? read.fallbackFrom === "json" ? "parquet" : "json"
        : "unknown";
      return `${fallbackTarget}(fallback_${fallbackSource}:${read.sourceError})`;
    }
    return `${read.used}(${read.sourceError})`;
  }
  if (read.used === "both") {
    if (read.fallbackFrom) {
      return `${read.fallbackFrom === "json" ? "parquet" : "json"}(${fallbackSource}_fallback)`;
    }
    return "both";
  }
  return read.used;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: NotificationStatus): number {
  if (status === "success") return 0x2fbd5a;
  if (status === "partial") return 0xe67e22;
  return 0xe74c3c;
}

function sectionHeader(label: string): DiscordField {
  return {
    name: "\u200b",
    value: `**${label}**`,
    inline: false,
  };
}

export function buildTrackStatsNotificationPayload(context: TrackStatsNotificationContext): DiscordWebhookPayload {
  const readSource = toReadSourceLabel(context.trackStatsRead);
  const jsonReadBytes = formatBytes(context.trackStatsRead.bytesReadByFormat.json || 0);
  const jsonWriteBytes = formatBytes(context.trackStatsWrite?.bytes.json || 0);
  const parquetReadBytes = formatBytes(context.trackStatsRead.bytesReadByFormat.parquet || 0);
  const parquetWriteBytes = formatBytes(context.trackStatsWrite?.bytes.parquet || 0);
  const executionMs = context.runtime?.executionMs ?? context.durationsMs.total;
  const memoryUsedMb = context.runtime?.memoryUsedMB.toFixed(1) ?? null;
  const memoryLimit = context.runtime?.memoryLimitMB && context.runtime.memoryLimitMB > 0
    ? context.runtime.memoryLimitMB
    : null;
  const memoryValue = memoryUsedMb === null
    ? "N/A"
    : memoryLimit
      ? `${memoryUsedMb} MB / limit ${memoryLimit} MB`
      : `${memoryUsedMb} MB`;

  const fields: DiscordField[] = [
    sectionHeader("function"),
    {
      name: "name",
      value: context.functionName,
      inline: true,
    },
    {
      name: "Result",
      value: context.status,
      inline: true,
    },
    sectionHeader("track-stats source"),
    {
      name: "sourceRead",
      value: readSource,
      inline: true,
    },
    {
      name: "fallbackUsed",
      value: String(context.trackStatsRead.fallbackUsed),
      inline: true,
    },
    sectionHeader("track-stats size"),
    {
      name: "json size",
      value: `${jsonReadBytes}/${jsonWriteBytes}`,
      inline: true,
    },
    {
      name: "parquet size",
      value: `${parquetReadBytes}/${parquetWriteBytes}`,
      inline: true,
    },
    sectionHeader("lambda"),
    {
      name: "duration",
      value: `${executionMs} ms`,
      inline: true,
    },
    {
      name: "memory",
      value: memoryValue,
      inline: true,
    },
  ];

  return {
    username: "my-music-ranking",
    embeds: [
      {
        title: "track-stats",
        color: statusColor(context.status),
        fields,
      },
    ],
  };
}

export async function sendDiscordNotification(
  payload: DiscordWebhookPayload,
  webhookUrl?: string | null,
  timeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS,
): Promise<boolean> {
  if (!webhookUrl) {
    console.log("[Discord] notification skipped: webhook URL is not set");
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = `Discord API error: ${response.status} ${response.statusText}`;
      console.warn(message);
      return false;
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Discord notification failed (non-blocking):", message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
