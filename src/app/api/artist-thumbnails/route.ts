import { NextResponse } from "next/server";
import { getArtistThumbnailsForBrowser } from "@/lib/charts/artist-thumbnails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ARTIST_IDS = 300;
const MAX_ARTIST_ID_LENGTH = 64;

type LookupBody = {
  artistIds?: unknown;
};

const normalizeArtistIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];

const dedupe = (values: string[]): string[] => [...new Set(values)];

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as LookupBody;
    const artistIds = dedupe(normalizeArtistIds(payload.artistIds));
    if (artistIds.length > MAX_ARTIST_IDS) {
      return NextResponse.json(
        { error: `artistIds must be ${MAX_ARTIST_IDS} or fewer.` },
        { status: 400 },
      );
    }

    const hasInvalidIdLength = artistIds.some(
      (artistId) => artistId.length > MAX_ARTIST_ID_LENGTH,
    );
    if (hasInvalidIdLength) {
      return NextResponse.json(
        { error: `Each artistId must be <= ${MAX_ARTIST_ID_LENGTH} characters.` },
        { status: 400 },
      );
    }

    if (artistIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const items = await getArtistThumbnailsForBrowser(artistIds);

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json(
      { error: "유효하지 않은 요청입니다." },
      { status: 400 },
    );
  }
}
