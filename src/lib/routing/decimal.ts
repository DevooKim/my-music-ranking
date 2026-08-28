const DECIMAL_INTEGER = /^[0-9]+$/;

export const parseBoundedDecimal = (
  value: string,
  minimum: number,
  maximum: number,
): number | null => {
  if (!DECIMAL_INTEGER.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed >= minimum && parsed <= maximum ? parsed : null;
};
