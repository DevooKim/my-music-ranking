import { NextResponse } from "next/server";
import type { ChartQueryResult } from "@/lib/charts/types";

type CacheMeta = NonNullable<ChartQueryResult["cachePolicy"]>;

const withCacheMeta = <T extends object>(payload: T, cachePolicy: CacheMeta) => ({
  ...payload,
  _cache: {
    scope: cachePolicy.scope,
    maxAgeSeconds: cachePolicy.maxAgeSeconds,
    staleWhileRevalidateSeconds: cachePolicy.staleWhileRevalidateSeconds,
  },
});

export const toApiResponse = (result: ChartQueryResult): NextResponse => {
  if (result.kind === "found") {
    return NextResponse.json(withCacheMeta(result.chart, result.cachePolicy), {
      status: 200,
      headers: {
        "Cache-Control": result.cachePolicy.cacheControl,
        Vary: "Accept",
      },
    });
  }

  if (result.kind === "not_found") {
    return NextResponse.json(withCacheMeta(result.response, result.cachePolicy), {
      status: 404,
      headers: {
        "Cache-Control": result.cachePolicy.cacheControl,
        Vary: "Accept",
      },
    });
  }

  return NextResponse.json(
    withCacheMeta(
      {
        error: result.message,
        type: result.type,
      },
      result.cachePolicy,
    ),
    {
      status: result.statusCode,
      headers: {
        "Cache-Control": result.cachePolicy.cacheControl,
        Vary: "Accept",
      },
    },
  );
};
