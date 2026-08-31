import { describe, expect, test } from "bun:test";
import {
  shouldUseNavigationNetworkFirst,
  shouldUseShellCache,
} from "../policy";

describe("service worker cache policy", () => {
  test("allows only explicit shell assets", () => {
    expect(
      shouldUseShellCache("https://music.example/", "https://music.example"),
    ).toBe(true);
    expect(
      shouldUseShellCache(
        "https://music.example/manifest.webmanifest",
        "https://music.example",
      ),
    ).toBe(true);
  });

  test("does not intercept API, RSC, or arbitrary same-origin GETs", () => {
    expect(
      shouldUseShellCache(
        "https://music.example/api/charts/weekly/latest",
        "https://music.example",
      ),
    ).toBe(false);
    expect(
      shouldUseShellCache(
        "https://music.example/weekly/2026/07?_rsc=abc",
        "https://music.example",
      ),
    ).toBe(false);
    expect(
      shouldUseShellCache(
        "https://music.example/unknown.js",
        "https://music.example",
      ),
    ).toBe(false);
  });

  test("uses network-first navigation with the cached root as offline fallback", () => {
    expect(
      shouldUseNavigationNetworkFirst(
        "https://music.example/",
        "https://music.example",
        "navigate",
      ),
    ).toBe(true);
    expect(
      shouldUseNavigationNetworkFirst(
        "https://music.example/charts",
        "https://music.example",
        "navigate",
      ),
    ).toBe(true);
    expect(
      shouldUseNavigationNetworkFirst(
        "https://music.example/api/charts/weekly/latest",
        "https://music.example",
        "cors",
      ),
    ).toBe(false);
    expect(
      shouldUseNavigationNetworkFirst(
        "https://music.example/charts?_rsc=abc",
        "https://music.example",
        "same-origin",
      ),
    ).toBe(false);
  });
});
