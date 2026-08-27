import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchArtistsFromSpotify } from "@/lib/charts/artist-thumbnails";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  mock.restore();
});

describe("Spotify Development Mode artist lookup", () => {
  test("fetches artists individually with bounded concurrency", async () => {
    const artistIds = Array.from(
      { length: 12 },
      (_, index) => `artist-${index + 1}`,
    );
    const requestedUrls = [];
    let activeRequests = 0;
    let peakRequests = 0;

    globalThis.fetch = mock(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;

      const id = decodeURIComponent(url.split("/").at(-1) || "");
      return Response.json({ id, images: [] });
    });

    const artists = await fetchArtistsFromSpotify("access-token", artistIds);

    expect(artists.size).toBe(artistIds.length);
    expect(peakRequests).toBeLessThanOrEqual(5);
    expect(requestedUrls).toHaveLength(artistIds.length);
    expect(requestedUrls.every((url) => !url.includes("?ids="))).toBe(true);
    expect(requestedUrls).toContain(
      "https://api.spotify.com/v1/artists/artist-1",
    );
  });

  test("retries a rate-limited artist using Retry-After", async () => {
    let requestCount = 0;

    globalThis.fetch = mock(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return Response.json({ id: "artist-1", images: [] });
    });

    const artists = await fetchArtistsFromSpotify("access-token", ["artist-1"]);

    expect(requestCount).toBe(2);
    expect(artists.get("artist-1")?.id).toBe("artist-1");
  });

  test("keeps failed lookups out of the refresh result", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 500 }));
    const warn = mock(() => {});
    console.warn = warn;

    const artists = await fetchArtistsFromSpotify("access-token", ["artist-1"]);

    expect(artists.has("artist-1")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
