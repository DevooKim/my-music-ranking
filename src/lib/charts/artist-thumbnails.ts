import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  getJsonFromPrivateS3,
  putJsonToS3,
} from "@/lib/charts/s3";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const ARTIST_REQUEST_CONCURRENCY = 5;
const SPOTIFY_RATE_LIMIT_MAX_RETRIES = 2;
const DEFAULT_RETRY_AFTER_SECONDS = 1;

const parseIntOrDefault = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseEnvBoolean = (value: string | undefined, fallback = false): boolean =>
  value === undefined ? fallback : value.toLowerCase() === "true";

const ARTIST_THUMBNAIL_TTL_DAYS = parseIntOrDefault(
  process.env.ARTIST_THUMBNAIL_TTL_DAYS,
  14,
);
const ARTIST_THUMBNAIL_TTL_MS = Math.max(1, ARTIST_THUMBNAIL_TTL_DAYS) * 24 * 60 * 60 * 1000;
const ARTIST_THUMBNAIL_USE_LOCAL_FS = parseEnvBoolean(
  process.env.ARTIST_THUMBNAIL_USE_LOCAL_FS,
  false,
);
const ARTIST_THUMBNAIL_LOCAL_ROOT = join(
  process.cwd(),
  process.env.ARTIST_THUMBNAIL_LOCAL_CACHE_DIR?.trim().length
    ? process.env.ARTIST_THUMBNAIL_LOCAL_CACHE_DIR.trim()
    : ".cache/artist-thumbnails",
);

const normalizeArtistId = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export interface StoredArtistThumbnail {
  artistId: string;
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface ArtistThumbnailLookupResult {
  artistId: string;
  thumbnailUrl: string | null;
  updatedAt: string | null;
  needsRefresh: boolean;
}

export type ArtistThumbnailLookup = ArtistThumbnailLookupResult;

export interface SpotifyImage {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface SpotifyArtist {
  id?: unknown;
  images?: unknown;
}

const isSafeImage = (value: unknown): value is SpotifyImage => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.url === "string" && item.url.length > 0;
};

const toSafeImageList = (images: unknown): SpotifyImage[] =>
  Array.isArray(images)
    ? images.filter((item): item is SpotifyImage => isSafeImage(item))
    : [];

const toSafeNumber = (value: unknown): number => {
  if (typeof value !== "number") return Number.NaN;
  if (!Number.isFinite(value)) return Number.NaN;
  return value;
};

const toSafeString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const isStaleRecord = (record: StoredArtistThumbnail | null): boolean => {
  if (!record) return true;
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt >= ARTIST_THUMBNAIL_TTL_MS;
};

const isStoredArtistThumbnail = (value: unknown): value is StoredArtistThumbnail => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.artistId === "string" &&
    candidate.artistId.length > 0 &&
    typeof candidate.updatedAt === "string" &&
    candidate.updatedAt.length > 0 &&
    (candidate.thumbnailUrl === null || typeof candidate.thumbnailUrl === "string")
  );
};

export const artistThumbnailS3Key = (artistId: string): string =>
  `artist/${encodeURIComponent(artistId)}/thumbnail.json`;

const localThumbnailPath = (artistId: string): string => {
  const normalizedArtistId = encodeURIComponent(normalizeArtistId(artistId));
  return join(
    ARTIST_THUMBNAIL_LOCAL_ROOT,
    "artist",
    normalizedArtistId,
    "thumbnail.json",
  );
};

const readArtistThumbnailFromLocal = async (
  artistId: string,
): Promise<StoredArtistThumbnail | null> => {
  const filePath = localThumbnailPath(artistId);
  try {
    const rawText = await readFile(filePath, "utf8");
    const raw = JSON.parse(rawText) as unknown;
    if (!isStoredArtistThumbnail(raw)) {
      return null;
    }

    return {
      artistId: toSafeString(raw.artistId),
      thumbnailUrl: raw.thumbnailUrl,
      updatedAt: toSafeString(raw.updatedAt),
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const writeArtistThumbnailToLocal = async (entry: StoredArtistThumbnail): Promise<void> => {
  const filePath = localThumbnailPath(entry.artistId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(entry));
};

const chunk = <T,>(values: T[], size: number): T[][] => {
  if (size <= 0) return [values];
  const buckets: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    buckets.push(values.slice(i, i + size));
  }
  return buckets;
};

const pickThumbnailUrl = (images: SpotifyImage[]): string | null => {
  if (images.length === 0) return null;

  const preferredOrder: Record<number, number> = {
    320: 0,
    160: 1,
    640: 2,
  };

  const getPreferred = (image: SpotifyImage): number | null => {
    const height = toSafeNumber(image.height);
    const width = toSafeNumber(image.width);
    if (Number.isFinite(height)) {
      return preferredOrder[height] === undefined ? null : height;
    }
    if (Number.isFinite(width)) {
      return preferredOrder[width] === undefined ? null : width;
    }
    return null;
  };

  const sorted = [...images]
    .filter((image) => typeof image.width === "number" || typeof image.height === "number")
    .sort((a, b) => {
      const aHeight = toSafeNumber(a.height);
      const bHeight = toSafeNumber(b.height);
      const aWidth = toSafeNumber(a.width);
      const bWidth = toSafeNumber(b.width);
      const aSize = Number.isFinite(aHeight)
        ? aHeight
        : Number.isFinite(aWidth)
          ? aWidth
          : 0;
      const bSize = Number.isFinite(bHeight)
        ? bHeight
        : Number.isFinite(bWidth)
          ? bWidth
          : 0;
      return bSize - aSize;
    });

  const withPreferredHeights = sorted.filter((image) => getPreferred(image) !== null);

  if (withPreferredHeights.length > 0) {
    return withPreferredHeights
      .sort((a, b) => {
        const aPreferred = getPreferred(a) as number;
        const bPreferred = getPreferred(b) as number;
        const aRank = preferredOrder[aPreferred];
        const bRank = preferredOrder[bPreferred];

        if (aRank !== bRank) return aRank - bRank;
        return bPreferred - aPreferred;
      })[0].url as string;
  }

  return (sorted[0]?.url as string | undefined) ?? null;
};

const readArtistThumbnail = async (
  artistId: string,
): Promise<StoredArtistThumbnail | null> => {
  if (ARTIST_THUMBNAIL_USE_LOCAL_FS) {
    return readArtistThumbnailFromLocal(artistId);
  }

  const key = artistThumbnailS3Key(artistId);
  const raw = await getJsonFromPrivateS3<unknown>(key);

  if (!isStoredArtistThumbnail(raw)) {
    return null;
  }

  return {
    artistId: toSafeString(raw.artistId),
    thumbnailUrl: raw.thumbnailUrl,
    updatedAt: toSafeString(raw.updatedAt),
  };
};

const writeArtistThumbnail = async (
  entry: StoredArtistThumbnail,
): Promise<void> => {
  const key = artistThumbnailS3Key(entry.artistId);
  if (ARTIST_THUMBNAIL_USE_LOCAL_FS) {
    await writeArtistThumbnailToLocal(entry);
    return;
  }

  await putJsonToS3(key, entry);
};

const getAccessToken = async (): Promise<string> => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error("Spotify client credentials are not configured for artist thumbnail update.");
  }

  const tokenParams = new URLSearchParams();
  tokenParams.set("grant_type", refreshToken ? "refresh_token" : "client_credentials");
  if (refreshToken) {
    tokenParams.set("refresh_token", refreshToken);
  }

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: tokenParams,
  });

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed: ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: unknown };
  return toSafeString(payload.access_token);
};

const isValidAccessToken = (value: string): boolean => value.length > 0;

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const retryAfterMilliseconds = (response: Response): number => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : DEFAULT_RETRY_AFTER_SECONDS * 1000;
};

const fetchArtistFromSpotify = async (
  accessToken: string,
  artistId: string,
): Promise<SpotifyArtist | null> => {
  for (
    let attempt = 0;
    attempt <= SPOTIFY_RATE_LIMIT_MAX_RETRIES;
    attempt += 1
  ) {
    const response = await fetch(
      `${SPOTIFY_API_URL}/artists/${encodeURIComponent(artistId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      },
    );

    if (response.status === 429 && attempt < SPOTIFY_RATE_LIMIT_MAX_RETRIES) {
      await wait(retryAfterMilliseconds(response));
      continue;
    }

    if (response.status === 404) return null;

    if (!response.ok) {
      throw new Error(
        `Spotify artist lookup failed for ${artistId}: ${response.status}`,
      );
    }

    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object") {
      throw new Error(
        `Spotify artist lookup returned invalid data for ${artistId}`,
      );
    }

    const candidate = payload as Record<string, unknown>;
    const id = toSafeString(candidate.id);
    if (!id) {
      throw new Error(`Spotify artist lookup returned no id for ${artistId}`);
    }

    return {
      id,
      images: candidate.images,
    };
  }

  return null;
};

export const fetchArtistsFromSpotify = async (
  accessToken: string,
  ids: readonly string[],
): Promise<Map<string, SpotifyArtist | null>> => {
  const byId = new Map<string, SpotifyArtist | null>();

  for (const group of chunk([...ids], ARTIST_REQUEST_CONCURRENCY)) {
    const results = await Promise.allSettled(
      group.map((artistId) => fetchArtistFromSpotify(accessToken, artistId)),
    );

    for (const [index, result] of results.entries()) {
      const artistId = group[index];
      if (result.status === "fulfilled") {
        byId.set(artistId, result.value);
      } else {
        console.warn(
          `Failed to refresh Spotify artist ${artistId}:`,
          result.reason,
        );
      }
    }
  }

  return byId;
};

const refreshArtistThumbnails = async (
  artistIds: readonly string[],
): Promise<void> => {
  const deduped = [
    ...new Set(
      artistIds.map(normalizeArtistId).filter((artistId) => artistId.length > 0),
    ),
  ];
  if (deduped.length === 0) return;

  const accessToken = await getAccessToken();
  if (!isValidAccessToken(accessToken)) return;

  const now = new Date().toISOString();
  const byId = await fetchArtistsFromSpotify(accessToken, deduped);

  await Promise.all(
    deduped.map(async (artistId) => {
      if (!byId.has(artistId)) return;
      const artist = byId.get(artistId);
      const thumbnailUrl = artist
        ? pickThumbnailUrl(toSafeImageList(artist.images))
        : null;
      await writeArtistThumbnail({
        artistId,
        thumbnailUrl,
        updatedAt: now,
      });
    }),
  );
};

export const getArtistThumbnailCacheMap = async (
  artistIds: readonly string[],
): Promise<Map<string, StoredArtistThumbnail | null>> => {
  const normalized = [
    ...new Set(
      artistIds.map(normalizeArtistId).filter((artistId) => artistId.length > 0),
    ),
  ];
  const entries = await Promise.all(
    normalized.map(async (artistId) => {
      const entry = await readArtistThumbnail(artistId);
      return [artistId, entry] as const;
    }),
  );

  return new Map(entries);
};

export const getArtistThumbnailLookup = async (
  artistIds: readonly string[],
  options: { skipAutoRefresh?: boolean } = {},
): Promise<ArtistThumbnailLookup[]> => {
  try {
    const cache = await getArtistThumbnailCacheMap(artistIds);

    const lookups: ArtistThumbnailLookup[] = [];
    const staleIds: string[] = [];

    for (const rawArtistId of artistIds) {
      const artistId = normalizeArtistId(rawArtistId);
      if (!artistId) {
        continue;
      }

      const entry = cache.get(artistId) ?? null;
      const needsRefresh = isStaleRecord(entry);
      lookups.push({
        artistId,
        thumbnailUrl: entry?.thumbnailUrl ?? null,
        updatedAt: entry?.updatedAt ?? null,
        needsRefresh,
      });

      if (needsRefresh && artistId) staleIds.push(artistId);
    }

    const shouldAutoRefresh =
      !options.skipAutoRefresh &&
      parseEnvBoolean(process.env.ARTIST_THUMBNAIL_AUTO_REFRESH, true);
    if (staleIds.length > 0 && shouldAutoRefresh) {
      void refreshArtistThumbnails(staleIds).catch(() => {});
    }

    return lookups;
  } catch (error) {
    console.error("Failed to load artist thumbnail cache:", error);
    return artistIds.map((artistId) => ({
      artistId,
      thumbnailUrl: null,
      updatedAt: null,
      needsRefresh: true,
    }));
  }
};

export const getArtistThumbnailsForBrowser = async (
  artistIds: readonly string[],
): Promise<ArtistThumbnailLookup[]> => {
  if (!artistIds.length) return [];
  const normalized = [
    ...new Set(
      artistIds.map(normalizeArtistId).filter((artistId) => artistId.length > 0),
    ),
  ];
  if (!normalized.length) return [];

  const staleAware = await getArtistThumbnailLookup(normalized, { skipAutoRefresh: true });
  const staleIds = staleAware
    .filter((entry) => entry.needsRefresh)
    .map((entry) => entry.artistId);

  if (
    staleIds.length > 0 &&
    parseEnvBoolean(process.env.ARTIST_THUMBNAIL_AUTO_REFRESH, true)
  ) {
    await refreshArtistThumbnails(staleIds).catch(() => {});
    return getArtistThumbnailLookup(normalized, { skipAutoRefresh: true });
  }

  return staleAware;
};
