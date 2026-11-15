import {
  buildReauthReminderPayload,
  sendDiscordNotification,
} from "./discord-notify";
import { getS3Json, putS3Json, s3Paths } from "./s3";

export const REFRESH_TOKEN_LIFETIME_MONTHS = 6;
export const REAUTH_REMINDER_THRESHOLDS = [14, 7, 3, 2, 1] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReauthReminderState = {
  authorizedAt: string;
  sentThresholds: number[];
};

export const addCalendarMonths = (date: Date, months: number): Date => {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

export const parseAuthorizedAt = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
};

export const planReauthReminder = (input: {
  now: Date;
  authorizedAt: Date;
  sentThresholds: number[];
}): {
  expiry: Date;
  remainingDays: number;
  dueThresholds: number[];
} => {
  const expiry = addCalendarMonths(
    input.authorizedAt,
    REFRESH_TOKEN_LIFETIME_MONTHS,
  );
  const remainingDays = Math.floor(
    (expiry.getTime() - input.now.getTime()) / DAY_MS,
  );
  if (remainingDays < 0) {
    return { expiry, remainingDays, dueThresholds: [] };
  }

  const sent = new Set(input.sentThresholds);
  const dueThresholds = REAUTH_REMINDER_THRESHOLDS.filter(
    (threshold) => remainingDays <= threshold && !sent.has(threshold),
  );

  return { expiry, remainingDays, dueThresholds };
};

export async function maybeSendReauthReminder(
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const authorizedAtRaw = env.SPOTIFY_AUTHORIZED_AT;
  const authorizedAt = parseAuthorizedAt(authorizedAtRaw);
  if (!authorizedAt || !authorizedAtRaw) {
    console.log("[reauth-reminder] skipped: SPOTIFY_AUTHORIZED_AT is not set");
    return false;
  }

  const stored = (await getS3Json<ReauthReminderState>(
    s3Paths.spotifyReauthReminder(),
  )) ?? {
    authorizedAt: authorizedAtRaw,
    sentThresholds: [],
  };
  const sentThresholds =
    stored.authorizedAt === authorizedAtRaw ? stored.sentThresholds : [];
  const plan = planReauthReminder({
    now,
    authorizedAt,
    sentThresholds,
  });

  if (plan.dueThresholds.length === 0) return false;

  const sent = await sendDiscordNotification(
    buildReauthReminderPayload({
      remainingDays: plan.remainingDays,
      expiry: plan.expiry.toISOString(),
    }),
    env.DISCORD_WEBHOOK_URL,
  );
  if (!sent) return false;

  await putS3Json(s3Paths.spotifyReauthReminder(), {
    authorizedAt: authorizedAtRaw,
    sentThresholds: [...new Set([...sentThresholds, ...plan.dueThresholds])],
  } satisfies ReauthReminderState);

  return true;
}
