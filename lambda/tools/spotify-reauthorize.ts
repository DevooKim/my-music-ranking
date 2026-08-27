import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const ENV_PATH = resolve(import.meta.dir, "../.env.lambda");

const parseEnvFile = (source: string): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2];
  }

  return result;
};

export const replaceEnvValue = (
  source: string,
  key: string,
  value: string,
): string => {
  const nextLine = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, () => nextLine);
  return `${source.trimEnd()}\n${nextLine}\n`;
};

const openBrowser = (url: string): void => {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
};

const readCallback = async (state: string): Promise<string> =>
  new Promise((resolveCode, rejectCode) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (error || !code || returnedState !== state) {
        response
          .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Spotify authorization failed. You can close this window.");
        server.close();
        rejectCode(new Error(error ?? "Invalid Spotify OAuth callback"));
        return;
      }

      response
        .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Spotify authorization updated. You can close this window.");
      server.close();
      resolveCode(code);
    });

    server.on("error", rejectCode);
    server.listen(8888, "127.0.0.1", () => {
      console.log(`Waiting for Spotify authorization at ${REDIRECT_URI}`);
    });
  });

const exchangeAuthorizationCode = async (
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<string> => {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const payload = (await response.json()) as {
    error?: unknown;
    refresh_token?: unknown;
  };

  if (!response.ok || typeof payload.refresh_token !== "string") {
    const code =
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(`Spotify authorization exchange failed: ${code}`);
  }

  return payload.refresh_token;
};

const main = async (): Promise<void> => {
  const source = await readFile(ENV_PATH, "utf8");
  const env = parseEnvFile(source);
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required in lambda/.env.lambda",
    );
  }

  const state = randomBytes(24).toString("hex");
  const authorizeUrl = new URL(SPOTIFY_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "user-read-recently-played",
    state,
  }).toString();

  const callback = readCallback(state);
  openBrowser(authorizeUrl.toString());
  const code = await callback;
  const refreshToken = await exchangeAuthorizationCode(
    code,
    clientId,
    clientSecret,
  );

  await writeFile(
    ENV_PATH,
    replaceEnvValue(source, "SPOTIFY_REFRESH_TOKEN", refreshToken),
    { mode: 0o600 },
  );
  await chmod(ENV_PATH, 0o600);
  console.log("Updated SPOTIFY_REFRESH_TOKEN in lambda/.env.lambda.");
  console.log("Run: cd lambda && ./deploy.sh");
};

if (import.meta.main) {
  await main();
}
