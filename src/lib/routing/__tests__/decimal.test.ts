import { describe, expect, test } from "bun:test";
import { parseBoundedDecimal } from "../decimal";

describe("route decimal parser", () => {
  test("accepts bounded integer decimals, including zero-padded route values", () => {
    expect(parseBoundedDecimal("2026", 2000, 2500)).toBe(2026);
    expect(parseBoundedDecimal("01", 1, 53)).toBe(1);
    expect(parseBoundedDecimal("12", 1, 12)).toBe(12);
  });

  test.each([
    "2026junk",
    "10.5",
    "",
    "-1",
    "+1",
    "0x10",
    "9007199254740992",
  ])("rejects non-decimal or unsafe value %s", (value) => {
    expect(parseBoundedDecimal(value, 1, 2500)).toBeNull();
  });

  test.each([
    ["1999", 2000, 2500],
    ["2501", 2000, 2500],
    ["00", 1, 53],
    ["54", 1, 53],
  ])("rejects out-of-bounds value %s", (value, minimum, maximum) => {
    expect(parseBoundedDecimal(value, minimum, maximum)).toBeNull();
  });
});
