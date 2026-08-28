import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("home-server deployment configuration", () => {
  test("uses standalone Debian Node 22 and a non-root runtime", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("node:22-bookworm-slim");
    expect(read("next.config.ts")).toContain('output: "standalone"');
    expect(dockerfile).toContain("USER root");
    expect(dockerfile).toContain(
      "gosu nextjs node scripts/duckdb-httpfs-smoke.cjs",
    );
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
    expect(nginx).toContain(
      'map "$cache_skip:$skip_set_cookie:$skip_status:$html_upstream_status" $html_cache_control',
    );
    expect(nginx).toContain("map $upstream_status $html_upstream_status");
    expect(nginx).toContain('"0:0:0:200" "public, max-age=0, s-maxage=300"');
    expect(nginx).toContain('"0:0:0:404" "public, max-age=0, s-maxage=120"');
    expect(nginx).toContain("~^0:1: BYPASS;");
    expect(nginx).toContain("~^0:0:1: BYPASS;");
    expect(nginx).toContain("proxy_ignore_headers Cache-Control Expires;");
    expect(nginx).toContain("location = / {");
    expect(nginx).toContain("location ~ ^/(weekly|monthly|yearly)");
  });

  test("uses immediate Next invalidation without a nested latest cache", () => {
    expect(read("src/app/api/revalidate/route.ts")).toContain("{ expire: 0 }");
    expect(read("src/lib/charts/s3.ts")).toContain("{ expire: 0 }");
    expect(read("src/lib/charts/repository.ts")).toContain(
      'scope === "latest"',
    );
  });

  test("keeps operational services off the public bind address", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toContain('"127.0.0.1:8080:80"');
    expect(compose).toContain('"127.0.0.1:3001:3001"');
    expect(compose).not.toContain('"3000:3000"');
  });

  test("rollback helper verifies the recorded immutable image", () => {
    const helper = read("ops/rollback-home-server.sh");
    expect(helper).toContain("IMAGE_ID");
    expect(helper).toContain("docker image inspect");
    expect(helper).toContain("IMAGE_ID mismatch");
    expect(helper).toContain("--force-recreate");
    expect(helper).toContain("clear-nginx-cache.sh");
  });

  test("integration matrix covers every downstream cache guard", () => {
    const integration = read("tests/home-server-integration.sh");
    expect(integration).toContain("RSC: 1");
    expect(integration).toContain("Authorization: Bearer integration");
    expect(integration).toContain("-X POST");
    expect(integration).toContain("Set-Cookie");
    expect(integration).toContain("cache-test-client-error");
    expect(integration).toContain("cache-test-server-error");
    expect(integration).toContain("cache-control:");
  });
});
