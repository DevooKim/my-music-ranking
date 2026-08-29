import { NextResponse } from "next/server";
import type { ChartQueryResult } from "@/lib/charts/types";

type CacheMeta = NonNullable<ChartQueryResult["cachePolicy"]>;

const withCacheMeta = <T extends object>(
  payload: T,
  cachePolicy: CacheMeta,
) => ({
  ...payload,
  _cache: {
    scope: cachePolicy.scope,
    maxAgeSeconds: cachePolicy.maxAgeSeconds,
    staleWhileRevalidateSeconds: cachePolicy.staleWhileRevalidateSeconds,
  },
});

const cacheHeaders = (policy: CacheMeta): Record<string, string> => ({
  "Cache-Control": policy.cacheControl,
  "X-Accel-Expires": String(policy.maxAgeSeconds),
  Vary: "Accept",
});

export const toApiResponse = (result: ChartQueryResult): NextResponse => {
  if (result.kind === "found") {
    const payload = {
      ...result.chart,
      ...(result.artistItems ? { artistItems: result.artistItems } : {}),
    };
    return NextResponse.json(withCacheMeta(payload, result.cachePolicy), {
      status: 200,
      headers: cacheHeaders(result.cachePolicy),
    });
  }

  if (result.kind === "not_found") {
    return NextResponse.json(
      withCacheMeta(result.response, result.cachePolicy),
      {
        status: 404,
        headers: cacheHeaders(result.cachePolicy),
      },
    );
  }

  return NextResponse.json(
    withCacheMeta(
      { error: result.message, type: result.type },
      result.cachePolicy,
    ),
    { status: result.statusCode, headers: cacheHeaders(result.cachePolicy) },
  );
};
