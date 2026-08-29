const ARTIST_THUMBNAIL_MAX_CONCURRENCY = 2;
const ARTIST_THUMBNAIL_WINDOW_MS = 60_000;
const ARTIST_THUMBNAIL_MAX_REQUESTS_PER_WINDOW = 30;

let activeArtistThumbnailRequests = 0;
const requestWindows = new Map<string, { startedAt: number; count: number }>();

export const takeArtistThumbnailRateLimit = (
  key: string,
  now = Date.now(),
): boolean => {
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= ARTIST_THUMBNAIL_WINDOW_MS) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= ARTIST_THUMBNAIL_MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
};

export const tryAcquireArtistThumbnailSlot = (): (() => void) | null => {
  if (activeArtistThumbnailRequests >= ARTIST_THUMBNAIL_MAX_CONCURRENCY) {
    return null;
  }
  activeArtistThumbnailRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeArtistThumbnailRequests = Math.max(
      0,
      activeArtistThumbnailRequests - 1,
    );
  };
};

export const getRequestClientKey = (request: Request): string => {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
};
