import { describe, expect, test } from "bun:test";
import {
  buildCollectorFailurePayload,
  buildReauthReminderPayload,
  sendDiscordNotification,
} from "../discord-notify";

describe("buildCollectorFailurePayload", () => {
  test("marks token expiry as reauthorization", () => {
    const payload = buildCollectorFailurePayload({
      message: "Spotify reauthorization required (invalid_grant; HTTP 400)",
      requiresReauthorization: true,
    });

    expect(payload.embeds[0]?.title).toBe(
      "collector: Spotify reauthorization required",
    );
    expect(payload.embeds[0]?.fields).toEqual(
      expect.arrayContaining([
        { name: "function", value: "collector", inline: true },
        { name: "reason", value: "reauthorization", inline: true },
      ]),
    );
  });

  test("uses a generic title for other collector failures", () => {
    const payload = buildCollectorFailurePayload({
      message: "Spotify API failed: 500",
      requiresReauthorization: false,
    });

    expect(payload.embeds[0]?.title).toBe("collector failed");
    expect(payload.embeds[0]?.fields).toEqual(
      expect.arrayContaining([
        { name: "reason", value: "error", inline: true },
        { name: "message", value: "Spotify API failed: 500", inline: false },
      ]),
    );
  });

  test("clips oversized error messages to Discord field limit", () => {
    const payload = buildCollectorFailurePayload({
      message: "x".repeat(2000),
      requiresReauthorization: false,
    });
    const message = payload.embeds[0]?.fields.find(
      (field) => field.name === "message",
    )?.value;

    expect(message).toHaveLength(1024);
    expect(message?.endsWith("…")).toBe(true);
  });
});

describe("buildReauthReminderPayload", () => {
  test("titles a 14-day reminder", () => {
    const payload = buildReauthReminderPayload({
      remainingDays: 14,
      expiry: "2027-05-09T15:08:38.000Z",
    });
    expect(payload.embeds[0]?.title).toBe("Spotify 재승인 14일 전");
  });

  test("titles expiry-day reminder as today", () => {
    const payload = buildReauthReminderPayload({
      remainingDays: 0,
      expiry: "2027-05-09T15:08:38.000Z",
    });
    expect(payload.embeds[0]?.title).toBe("Spotify 재승인 오늘");
  });
});

describe("sendDiscordNotification", () => {
  test("skips when webhook URL is missing", async () => {
    await expect(
      sendDiscordNotification({
        username: "my-music-ranking",
        embeds: [],
      }),
    ).resolves.toBe(false);
  });
});
