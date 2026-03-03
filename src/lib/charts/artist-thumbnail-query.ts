type ArtistThumbnailApiItem = {
  artistId: string;
  thumbnailUrl: string | null;
};

type ArtistThumbnailApiResponse = {
  items?: ArtistThumbnailApiItem[];
};

const normalizeArtistIds = (artistIds: readonly string[]): string[] => [
  ...new Set(
    artistIds
      .map((artistId) => (typeof artistId === "string" ? artistId.trim() : ""))
      .filter((artistId) => artistId.length > 0),
  ),
];

export const fetchArtistThumbnails = async (
  artistIds: readonly string[],
): Promise<ArtistThumbnailApiItem[]> => {
  const normalized = normalizeArtistIds(artistIds).sort((a, b) =>
    a.localeCompare(b),
  );
  if (normalized.length === 0) return [];

  const response = await fetch("/api/artist-thumbnails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artistIds: normalized }),
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as ArtistThumbnailApiResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .filter((item) => item?.artistId)
    .map((item) => ({
      artistId: item.artistId,
      thumbnailUrl: item.thumbnailUrl ?? null,
    }));
};
