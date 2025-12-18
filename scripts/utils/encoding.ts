import iconv from "iconv-lite";

const REPLACEMENT_CHAR = "\uFFFD";
const FALLBACK_ENCODINGS = ["euc-kr", "cp949"];

export function decodeLegacyJson(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes(REPLACEMENT_CHAR)) {
    return utf8;
  }

  for (const encoding of FALLBACK_ENCODINGS) {
    try {
      const decoded = iconv.decode(buffer, encoding);
      if (!decoded.includes(REPLACEMENT_CHAR)) {
        return decoded;
      }
    } catch (error) {
      console.warn(`Failed to decode legacy payload with ${encoding}:`, error);
    }
  }

  return utf8;
}
