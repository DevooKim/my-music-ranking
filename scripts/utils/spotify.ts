import {
  ENABLE_ISRC_ENRICHMENT,
  SPOTIFY_LOCALE,
  SPOTIFY_MARKET,
  SPOTIFY_TOKEN,
} from "./config";

interface SpotifyArtist {
  id: string;
  name: string;
  external_urls?: {
    spotify?: string;
  };
}

interface SpotifyAlbum {
  id: string;
  name: string;
  images?: Array<{ url: string } | undefined>;
  artists?: SpotifyArtist[];
  total_tracks?: number;
  external_urls?: {
    spotify?: string;
  };
}

interface SpotifyTrackItem {
  id: string;
  name: string;
  album: SpotifyAlbum;
  artists: SpotifyArtist[];
  external_urls?: {
    spotify?: string;
  };
  external_ids?: {
    isrc?: string;
  };
  disc_number?: number;
  track_number?: number;
}

interface SpotifySearchResponse {
  tracks?: {
    items?: SpotifyTrackItem[];
  };
}

export interface EnrichedTrackMetadata {
  trackName: string;
  albumName: string;
  albumId: string;
  albumImageUrl: string;
  albumTotalTracks?: number;
  albumExternalUrl?: string | null;
  artistIds: string[];
  artistNames: string[];
  artistExternalUrls?: Array<string | null>;
  trackExternalUrl?: string | null;
  trackExternalIds?: string | null;
  discNumber?: number;
  trackNumber?: number;
}

const cache = new Map<string, EnrichedTrackMetadata | null>();
let warnedAboutToken = false;
const RETRY_DELAY_MS = 40_000;
const MAX_RETRIES = 2;

function canEnrich(): boolean {
  if (!ENABLE_ISRC_ENRICHMENT) return false;
  if (SPOTIFY_TOKEN) return true;
  if (!warnedAboutToken) {
    console.warn(
      "ISRC enrichment is enabled but SPOTIFY_TOKEN is missing. Skipping metadata updates.",
    );
    warnedAboutToken = true;
  }
  return false;
}

export function isIsrcEnrichmentEnabled(): boolean {
  return canEnrich();
}

export async function fetchTrackMetadataByIsrc(
  isrc: string,
): Promise<EnrichedTrackMetadata | null> {
  if (!isrc) return null;
  if (!canEnrich()) return null;

  if (cache.has(isrc)) {
    return cache.get(isrc) ?? null;
  }

  const params = new URLSearchParams({
    q: `isrc:${isrc}`,
    type: "track",
    limit: "1",
    market: SPOTIFY_MARKET,
  });

  try {
    let attempt = 0;

    while (true) {
      const response = await fetch(
        `https://api.spotify.com/v1/search?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${SPOTIFY_TOKEN}`,
            "accept-language": SPOTIFY_LOCALE,
          },
        },
      );

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : RETRY_DELAY_MS;
        const delay = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : RETRY_DELAY_MS;
        console.warn(
          `Spotify rate limit hit for ISRC ${isrc}. Waiting ${Math.round(delay / 1000)}s before retry (${attempt + 1}/${MAX_RETRIES}).`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        console.warn(`Spotify search failed (${response.status}): ${body}`);
        cache.set(isrc, null);
        return null;
      }

      const payload = (await response.json()) as SpotifySearchResponse;
      const track = payload.tracks?.items?.[0];

      if (!track) {
        cache.set(isrc, null);
        return null;
      }

      const metadata: EnrichedTrackMetadata = {
        trackName: track.name,
        albumName: track.album?.name ?? "",
        albumId: track.album?.id ?? "",
        albumImageUrl: track.album?.images?.[0]?.url ?? "",
        albumTotalTracks: track.album?.total_tracks,
        albumExternalUrl: track.album?.external_urls?.spotify ?? null,
        artistIds: track.artists?.map((artist) => artist.id) ?? [],
        artistNames: track.artists?.map((artist) => artist.name) ?? [],
        artistExternalUrls:
          track.artists?.map((artist) => artist.external_urls?.spotify ?? null) ??
          [],
        trackExternalUrl: track.external_urls?.spotify ?? null,
        trackExternalIds: track.external_ids?.isrc ?? null,
        discNumber: track.disc_number,
        trackNumber: track.track_number,
      };

      cache.set(isrc, metadata);

      return metadata;
    }
  } catch (error) {
    console.error(`Spotify search error for ISRC ${isrc}:`, error);
    cache.set(isrc, null);
    return null;
  }
}
