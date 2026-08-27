import { describe, expect, test } from "bun:test";
import { replaceEnvValue } from "../../tools/spotify-reauthorize";
import { refreshAccessToken, SpotifyTokenRefreshError } from "../spotify";

const env = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REFRESH_TOKEN: "refresh-token",
};

describe("Spotify token refresh", () => {
  test("returns a valid access token", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ access_token: "access-token" });

    await expect(refreshAccessToken({ env, fetchImpl })).resolves.toBe(
      "access-token",
    );
  });

  test("marks an expired refresh token as requiring reauthorization", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json(
        {
          error: "invalid_grant",
          error_description: "Refresh token expired",
        },
        { status: 400 },
      );

    try {
      await refreshAccessToken({ env, fetchImpl });
      throw new Error("Expected refreshAccessToken to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SpotifyTokenRefreshError);
      expect(error).toMatchObject({
        status: 400,
        code: "invalid_grant",
        requiresReauthorization: true,
      });
      expect((error as Error).message).not.toContain("Refresh token expired");
    }
  });

  test("does not classify unrelated token failures as expiration", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ error: "invalid_client" }, { status: 401 });

    await expect(refreshAccessToken({ env, fetchImpl })).rejects.toMatchObject({
      status: 401,
      code: "invalid_client",
      requiresReauthorization: false,
    });
  });

  test("fails before making a request when credentials are missing", async () => {
    let requested = false;
    const fetchImpl: typeof fetch = async () => {
      requested = true;
      return Response.json({ access_token: "access-token" });
    };

    await expect(refreshAccessToken({ env: {}, fetchImpl })).rejects.toThrow(
      "Spotify credentials are not configured",
    );
    expect(requested).toBe(false);
  });

  test("replaces the refresh token without changing surrounding settings", () => {
    expect(
      replaceEnvValue(
        "SPOTIFY_CLIENT_ID=id\nSPOTIFY_REFRESH_TOKEN=old\nAWS_REGION=region\n",
        "SPOTIFY_REFRESH_TOKEN",
        "new-$&-token",
      ),
    ).toBe(
      "SPOTIFY_CLIENT_ID=id\nSPOTIFY_REFRESH_TOKEN=new-$&-token\nAWS_REGION=region\n",
    );
  });
});
