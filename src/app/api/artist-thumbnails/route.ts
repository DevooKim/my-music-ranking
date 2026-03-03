import { NextResponse } from "next/server";
import { getArtistThumbnailsForBrowser } from "@/lib/charts/artist-thumbnails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
