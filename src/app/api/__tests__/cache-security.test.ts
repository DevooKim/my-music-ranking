import { describe, expect, test } from "bun:test";
import { POST as thumbnails } from "../artist-thumbnails/route";
import { GET as live } from "../health/live/route";
import { POST as revalidate, GET as revalidateGet } from "../revalidate/route";

describe("runtime endpoint safety", () => {
  test("liveness is never cacheable", () => {
    const response = live();
    expect(response.status).toBe(200);
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
