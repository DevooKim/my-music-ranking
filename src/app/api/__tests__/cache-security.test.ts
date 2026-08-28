import { describe, expect, test } from "bun:test";
import { POST as thumbnails } from "../artist-thumbnails/route";
import { GET as monthly } from "../charts/monthly/[year]/[month]/route";
import { GET as weekly } from "../charts/weekly/[isoYear]/[isoWeek]/route";
import { GET as yearly } from "../charts/yearly/[year]/route";
import { GET as live } from "../health/live/route";
import { POST as revalidate, GET as revalidateGet } from "../revalidate/route";

describe("runtime endpoint safety", () => {
  test("liveness is never cacheable", () => {
    const response = live();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  type RouteCase = [
    string,
    (params: Record<string, string>) => Promise<Response>,
    Record<string, string>,
  ];
  const routeCases: RouteCase[] = [
    [
      "weekly text",
      (params) =>
        weekly(new Request("http://localhost"), {
          params: Promise.resolve(
            params as { isoYear: string; isoWeek: string },
          ),
        }),
      { isoYear: "2026junk", isoWeek: "01" },
    ],
    [
      "weekly fraction",
      (params) =>
        weekly(new Request("http://localhost"), {
          params: Promise.resolve(
            params as { isoYear: string; isoWeek: string },
          ),
        }),
      { isoYear: "2026", isoWeek: "10.5" },
    ],
    [
      "weekly overflow",
      (params) =>
        weekly(new Request("http://localhost"), {
          params: Promise.resolve(
            params as { isoYear: string; isoWeek: string },
          ),
        }),
      { isoYear: "9007199254740992", isoWeek: "01" },
    ],
    [
      "monthly text",
      (params) =>
        monthly(new Request("http://localhost"), {
          params: Promise.resolve(params as { year: string; month: string }),
        }),
      { year: "2026", month: "1x" },
    ],
    [
      "monthly bounds",
      (params) =>
        monthly(new Request("http://localhost"), {
          params: Promise.resolve(params as { year: string; month: string }),
        }),
      { year: "1999", month: "01" },
    ],
    [
      "yearly fraction",
      (params) =>
        yearly(new Request("http://localhost"), {
          params: Promise.resolve(params as { year: string }),
        }),
      { year: "2026.5" },
    ],
    [
      "yearly overflow",
      (params) =>
        yearly(new Request("http://localhost"), {
          params: Promise.resolve(params as { year: string }),
        }),
      { year: "9007199254740992" },
    ],
  ];

  test.each(
    routeCases,
  )("rejects invalid route numbers: %s", async (_label, handler, params) => {
    const response = await handler(params);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("revalidation rejects unauthenticated and wrong-method requests", async () => {
    expect((await revalidateGet()).status).toBe(405);
    expect(
      (
        await revalidate(
          new Request("http://localhost", { method: "POST", body: "{}" }),
        )
      ).status,
    ).toBe(401);
  });

  test("thumbnail endpoint rejects an oversized body", async () => {
    const response = await thumbnails(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-length": "40000" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
