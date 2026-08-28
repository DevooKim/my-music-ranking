import { describe, expect, test } from "bun:test";
import { revalidateChartCache } from "../revalidate";

describe("Lambda revalidation delivery", () => {
  test("retries bounded transient failures and reports success", async () => {
    let calls = 0;
    const result = await revalidateChartCache(
      { kind: "track-stats" },
      {
        endpoint: "https://example.invalid/api/revalidate",
        secret: "test-secret",
        baseDelayMs: 0,
        fetchImpl: async () => {
          calls += 1;
          return calls === 1
            ? new Response(null, { status: 503 })
            : new Response(null, { status: 200 });
        },
      },
    );
    expect(result).toEqual({
      attempted: true,
      ok: true,
      attempts: 2,
      status: 200,
    });
    expect(calls).toBe(2);
  });

  test("does not retry a permanent client error", async () => {
    let calls = 0;
    const result = await revalidateChartCache(
      { kind: "track-stats" },
      {
        endpoint: "https://example.invalid/api/revalidate",
        secret: "test-secret",
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 401 });
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});
