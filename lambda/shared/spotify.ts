const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const DEFAULT_RECENTLY_PLAYED_URL = `${SPOTIFY_API_URL}/me/player/recently-played?limit=50`;

export async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN!;

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
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
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Spotify API failed: ${response.status}`);
  }

  return response.json();
}
