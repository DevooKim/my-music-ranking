const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const DEFAULT_RECENTLY_PLAYED_URL = `${SPOTIFY_API_URL}/me/player/recently-played?limit=50`;

type SpotifyTokenResponse = {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export class SpotifyTokenRefreshError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requiresReauthorization: boolean;

  constructor(status: number, code: string | null) {
    const requiresReauthorization = code === "invalid_grant";
    super(
      requiresReauthorization
        ? `Spotify reauthorization required (${code}; HTTP ${status})`
        : `Token refresh failed: ${status}${code ? ` (${code})` : ""}`,
    );
    this.name = "SpotifyTokenRefreshError";
    this.status = status;
    this.code = code;
    this.requiresReauthorization = requiresReauthorization;
  }
}

const readTokenResponse = async (
  response: Response,
): Promise<SpotifyTokenResponse> => {
  try {
    return (await response.json()) as SpotifyTokenResponse;
  } catch {
    return {};
  }
};

const toNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

interface RefreshAccessTokenOptions {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export async function refreshAccessToken(
  options: RefreshAccessTokenOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Spotify credentials are not configured");
  }

  const tokenParams = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  } satisfies Record<string, string>;

  const response = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(tokenParams),
  });

  const data = await readTokenResponse(response);
  if (!response.ok) {
    throw new SpotifyTokenRefreshError(
      response.status,
      toNonEmptyString(data.error),
    );
  }

  const accessToken = toNonEmptyString(data.access_token);
  if (!accessToken) {
    throw new SpotifyTokenRefreshError(response.status, "invalid_response");
  }

  return accessToken;
}

// next URL 또는 기본 URL로 API 호출
export async function fetchRecentlyPlayedByUrl(
  accessToken: string,
  url?: string | null,
): Promise<SpotifyRecentlyPlayedResponse> {
  const targetUrl = url || DEFAULT_RECENTLY_PLAYED_URL;

  const response = await fetch(targetUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!response.ok) {
    throw new Error(`Spotify API failed: ${response.status}`);
  }

  return response.json();
}

// after 타임스탬프로 URL 생성
export function buildAfterUrl(afterTimestamp: number): string {
  return `${SPOTIFY_API_URL}/me/player/recently-played?after=${afterTimestamp}&limit=50`;
}

export interface SpotifyRecentlyPlayedResponse {
  items: SpotifyPlayedItem[];
  next: string | null;
  cursors: {
    after: string;
    before: string;
  } | null;
  limit: number;
  href: string;
}

interface SpotifyPlayedItem {
  track: SpotifyTrack;
  played_at: string;
}

interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  album: {
    id: string;
    name: string;
    images?: { url: string }[];
    total_tracks?: number;
    external_urls?: { spotify?: string };
  };
  artists: { id: string; name: string; external_urls?: { spotify?: string } }[];
  external_urls?: { spotify?: string };
  external_ids?: { isrc?: string };
  disc_number: number;
  track_number: number;
}

// 레거시 함수 (하위 호환성)
export async function fetchRecentlyPlayed(
  accessToken: string,
  { limit = 50, after }: { limit?: number; after?: number } = {},
): Promise<SpotifyRecentlyPlayedResponse> {
  const query = after ? `?limit=${limit}&after=${after}` : `?limit=${limit}`;

  const response = await fetch(
    `${SPOTIFY_API_URL}/me/player/recently-played${query}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Spotify API failed: ${response.status}`);
  }

  return response.json();
}
