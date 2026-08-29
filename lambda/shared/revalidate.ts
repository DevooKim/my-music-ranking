export type RevalidatePayload =
  | { kind: "chart"; chartType: "weekly"; isoYear: number; isoWeek: number }
  | { kind: "chart"; chartType: "monthly"; year: number; month: number }
  | { kind: "chart"; chartType: "yearly"; year: number }
  | { kind: "weekly-artist"; isoYear: number; isoWeek: number }
  | { kind: "track-stats" };

export interface RevalidateRequest {
  url: string;
  init: RequestInit;
}
export interface RevalidateOptions {
  endpoint?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
}
export interface RevalidateResult {
  attempted: boolean;
  ok: boolean;
  attempts: number;
  status?: number;
}

export const shouldRevalidateAfterTrackStatsWrite = (
  partialFailure: boolean,
): boolean => !partialFailure;
export const buildTrackStatsRevalidationPayloads = (
  partialFailure: boolean,
): RevalidatePayload[] => (partialFailure ? [] : [{ kind: "track-stats" }]);
export const buildRawWeeklyRevalidationPayloads = (
  isoYear: number,
  isoWeek: number,
): RevalidatePayload[] => [
  { kind: "chart", chartType: "weekly", isoYear, isoWeek },
  { kind: "weekly-artist", isoYear, isoWeek },
];

export const buildRevalidateRequest = (
  payload: RevalidatePayload,
  endpoint: string,
  secret: string,
): RevalidateRequest | null => {
  const url = endpoint.trim();
  if (!url || !secret) return null;
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify(payload),
    },
  };
};

const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;
const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const retryAfterMs = (response: Response): number => {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0
    ? Math.min(value * 1000, 2_000)
    : 0;
};

export const revalidateChartCache = async (
  payload: RevalidatePayload,
  options: RevalidateOptions = {},
): Promise<RevalidateResult> => {
  const request = buildRevalidateRequest(
    payload,
    options.endpoint ?? process.env.REVALIDATE_ENDPOINT_URL ?? "",
    options.secret ?? process.env.REVALIDATE_SECRET ?? "",
  );
  if (!request) return { attempted: false, ok: false, attempts: 0 };

  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 3);
  const baseDelayMs = Math.min(Math.max(options.baseDelayMs ?? 250, 0), 2_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(
          Math.min(options.timeoutMs ?? 3_000, 5_000),
        ),
      });
      if (response.ok) {
        console.info("[revalidate] success", {
          kind: payload.kind,
          attempts: attempt,
        });
        return {
          attempted: true,
          ok: true,
          attempts: attempt,
          status: response.status,
        };
      }
      if (!retryableStatus(response.status) || attempt === maxAttempts) {
        console.warn("[revalidate] failed", {
          kind: payload.kind,
          attempts: attempt,
          status: response.status,
        });
        return {
          attempted: true,
          ok: false,
          attempts: attempt,
          status: response.status,
        };
      }
      await wait(
        Math.max(retryAfterMs(response), baseDelayMs * 2 ** (attempt - 1)),
      );
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn("[revalidate] failed", {
          kind: payload.kind,
          attempts: attempt,
          error: error instanceof Error ? error.name : "unknown",
        });
        return { attempted: true, ok: false, attempts: attempt };
      }
      await wait(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return { attempted: true, ok: false, attempts: maxAttempts };
};

export const dispatchRevalidationRequests = async (
  payloads: readonly RevalidatePayload[],
  revalidate: (
    payload: RevalidatePayload,
  ) => Promise<RevalidateResult | undefined>,
): Promise<Array<RevalidateResult | undefined>> =>
  Promise.all(payloads.map((payload) => revalidate(payload)));
