import { describe, expect, test } from "bun:test";
import {
  addCalendarMonths,
  parseAuthorizedAt,
  planReauthReminder,
} from "../spotify-reauth-reminder";

const authorizedAt = new Date("2026-11-10T00:08:38+09:00");

describe("parseAuthorizedAt", () => {
  test("reads an ISO timestamp", () => {
    expect(parseAuthorizedAt("2026-11-10T00:08:38+09:00")?.toISOString()).toBe(
      "2026-11-09T15:08:38.000Z",
    );
  });

  test("rejects missing or invalid values", () => {
    expect(parseAuthorizedAt(undefined)).toBeNull();
    expect(parseAuthorizedAt("not-a-date")).toBeNull();
  });
});

describe("addCalendarMonths", () => {
  test("six months after 2026-11-10 00:08 KST is 2027-05-10 00:08 KST", () => {
    expect(addCalendarMonths(authorizedAt, 6).toISOString()).toBe(
      "2027-05-09T15:08:38.000Z",
    );
  });
});

describe("planReauthReminder", () => {
  test("does not remind more than 14 days out", () => {
    const plan = planReauthReminder({
      now: new Date("2027-04-25T00:08:38+09:00"),
      authorizedAt,
      sentThresholds: [],
    });
    expect(plan.remainingDays).toBe(15);
    expect(plan.dueThresholds).toEqual([]);
  });

  test("sends the 14-day reminder when 14 days remain", () => {
    const plan = planReauthReminder({
      now: new Date("2027-04-26T00:08:38+09:00"),
      authorizedAt,
      sentThresholds: [],
    });
    expect(plan.remainingDays).toBe(14);
    expect(plan.dueThresholds).toEqual([14]);
  });

  test("catches up a missed 14-day window at 10 days", () => {
    const plan = planReauthReminder({
      now: new Date("2027-04-30T00:08:38+09:00"),
      authorizedAt,
      sentThresholds: [],
    });
    expect(plan.remainingDays).toBe(10);
    expect(plan.dueThresholds).toEqual([14]);
  });

  test("does not resend a threshold that was already marked sent", () => {
    const plan = planReauthReminder({
      now: new Date("2027-04-30T00:08:38+09:00"),
      authorizedAt,
      sentThresholds: [14],
    });
    expect(plan.dueThresholds).toEqual([]);
  });

  test("sends 7, 3, 2, then 1 on those days", () => {
    expect(
      planReauthReminder({
        now: new Date("2027-05-03T00:08:38+09:00"),
        authorizedAt,
        sentThresholds: [14],
      }).dueThresholds,
    ).toEqual([7]);
    expect(
      planReauthReminder({
        now: new Date("2027-05-07T00:08:38+09:00"),
        authorizedAt,
        sentThresholds: [14, 7],
      }).dueThresholds,
    ).toEqual([3]);
    expect(
      planReauthReminder({
        now: new Date("2027-05-08T00:08:38+09:00"),
        authorizedAt,
        sentThresholds: [14, 7, 3],
      }).dueThresholds,
    ).toEqual([2]);
    expect(
      planReauthReminder({
        now: new Date("2027-05-09T00:08:38+09:00"),
        authorizedAt,
        sentThresholds: [14, 7, 3, 2],
      }).dueThresholds,
    ).toEqual([1]);
  });

  test("marks every crossed threshold when first noticed at 2 days", () => {
    const plan = planReauthReminder({
      now: new Date("2027-05-08T00:08:38+09:00"),
      authorizedAt,
      sentThresholds: [],
    });
    expect(plan.remainingDays).toBe(2);
    expect(plan.dueThresholds).toEqual([14, 7, 3, 2]);
  });

  test("does not remind after expiry", () => {
    const plan = planReauthReminder({
      now: new Date("2027-05-11T00:08:38+09:00"),
      authorizedAt,
      sentThresholds: [],
    });
    expect(plan.remainingDays).toBeLessThan(0);
    expect(plan.dueThresholds).toEqual([]);
  });
});
