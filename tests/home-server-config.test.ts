import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("home-server deployment configuration", () => {
  test("uses standalone Debian Node 22 and a non-root runtime", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("node:22-bookworm-slim");
    expect(read("next.config.ts")).toContain('output: "standalone"');
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("duckdb-httpfs-smoke.cjs");
  });

  test("applies the identical cache skip variable to bypass and no-cache", () => {
    const nginx = read("docker/nginx/nginx.conf");
    expect(nginx).toContain("proxy_cache_bypass $cache_skip;");
    expect(nginx).toContain(
      "proxy_no_cache $cache_skip $skip_set_cookie $skip_response_cache $skip_status;",
    );
    expect(nginx).toContain("text/x-component");
    expect(nginx).toContain("/api/artist-thumbnails");
    expect(nginx).toContain("$http_cookie");
    expect(nginx).toContain("$http_upgrade");
  });

  test("keeps operational services off the public bind address", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toContain('"127.0.0.1:8080:80"');
    expect(compose).toContain('"127.0.0.1:3001:3001"');
    expect(compose).not.toContain('"3000:3000"');
  });
});
