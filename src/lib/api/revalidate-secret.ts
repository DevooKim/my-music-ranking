import { timingSafeEqual } from "node:crypto";

export const hasValidRevalidationSecret = (
  expected: string | undefined,
  provided: string | undefined,
): boolean => {
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
};
