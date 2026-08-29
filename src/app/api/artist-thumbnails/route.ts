import { NextResponse } from "next/server";
import {
  getRequestClientKey,
  takeArtistThumbnailRateLimit,
  tryAcquireArtistThumbnailSlot,
} from "@/lib/api/request-limits";
import { getArtistThumbnailsForBrowser } from "@/lib/charts/artist-thumbnails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ARTIST_IDS = 300;
const MAX_ARTIST_ID_LENGTH = 64;
const MAX_BODY_BYTES = 32 * 1024;
const noStoreHeaders = { "Cache-Control": "no-store" };

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

const readBodyWithLimit = async (request: Request): Promise<string> => {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("body-too-large");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("body-too-large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
};

export async function POST(req: Request) {
  const clientKey = getRequestClientKey(req);
  if (!takeArtistThumbnailRateLimit(clientKey)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다." },
      { status: 429, headers: { ...noStoreHeaders, "Retry-After": "60" } },
    );
  }

  const release = tryAcquireArtistThumbnailSlot();
  if (!release) {
    return NextResponse.json(
      { error: "처리 중인 요청이 많습니다." },
      { status: 429, headers: { ...noStoreHeaders, "Retry-After": "2" } },
    );
  }

  try {
    const payload = JSON.parse(await readBodyWithLimit(req)) as LookupBody;
    const artistIds = dedupe(normalizeArtistIds(payload.artistIds));
    if (artistIds.length > MAX_ARTIST_IDS) {
      return NextResponse.json(
        { error: `artistIds must be ${MAX_ARTIST_IDS} or fewer.` },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const hasInvalidIdLength = artistIds.some(
      (artistId) => artistId.length > MAX_ARTIST_ID_LENGTH,
    );
    if (hasInvalidIdLength) {
      return NextResponse.json(
        {
          error: `Each artistId must be <= ${MAX_ARTIST_ID_LENGTH} characters.`,
        },
        { status: 400, headers: noStoreHeaders },
      );
    }

    if (artistIds.length === 0) {
      return NextResponse.json({ items: [] }, { headers: noStoreHeaders });
    }

    const items = await getArtistThumbnailsForBrowser(artistIds);

    return NextResponse.json({ items }, { headers: noStoreHeaders });
  } catch (error) {
    const tooLarge =
      error instanceof Error && error.message === "body-too-large";
    return NextResponse.json(
      {
        error: tooLarge
          ? "요청 본문이 너무 큽니다."
          : "유효하지 않은 요청입니다.",
      },
      { status: tooLarge ? 413 : 400, headers: noStoreHeaders },
    );
  } finally {
    release();
  }
}
