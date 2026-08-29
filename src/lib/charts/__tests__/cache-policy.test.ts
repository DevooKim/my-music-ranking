import { describe, expect, test } from "bun:test";
import { getCachePolicy, noStoreCachePolicy } from "../cache-policy";
import { toApiResponse } from "../http";

describe("chart cache contracts", () => {
  test("keeps latest and negative-cache TTLs bounded", () => {
    expect(getCachePolicy("latest").maxAgeSeconds).toBeLessThanOrEqual(300);
    expect(
      getCachePolicy("latest").staleWhileRevalidateSeconds,
    ).toBeLessThanOrEqual(300);
    expect(
      getCachePolicy("latest_not_found").maxAgeSeconds,
    ).toBeLessThanOrEqual(120);
    expect(getCachePolicy("latest_not_found").staleWhileRevalidateSeconds).toBe(
      0,
    );
    expect(getCachePolicy("not_found").staleWhileRevalidateSeconds).toBe(0);
  });

  test("marks origin failures as no-store API responses", async () => {
    const response = toApiResponse({
      kind: "error",
      type: "weekly",
      statusCode: 500,
      message: "origin failed",
      cachePolicy: noStoreCachePolicy,
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
