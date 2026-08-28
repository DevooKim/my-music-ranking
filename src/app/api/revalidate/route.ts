import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { buildRevalidationTags } from "@/lib/api/revalidate-payload";
import { hasValidRevalidationSecret } from "@/lib/api/revalidate-secret";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 16 * 1024;

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: noStoreHeaders });

export async function GET(): Promise<NextResponse> {
  return json({ error: "Method Not Allowed" }, 405);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (
    !hasValidRevalidationSecret(
      process.env.REVALIDATE_SECRET,
      request.headers.get("x-revalidate-secret") ?? undefined,
    )
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Request body too large" }, 413);
    }
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const tags = buildRevalidationTags(payload);
  if (!tags) return json({ error: "Invalid revalidation payload" }, 400);

  try {
    for (const tag of tags) revalidateTag(tag, "max");
  } catch (error) {
    console.error("[revalidate] tag invalidation failed", error);
    return json({ error: "Revalidation failed" }, 500);
  }

  return json({ revalidated: tags }, 200);
}
