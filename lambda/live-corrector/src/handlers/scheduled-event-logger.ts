import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-northeast-2",
});

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const accessToken = await getSpotifyAccessToken();

    const recentlyPlayed = await getRecentlyPlayedTracks(accessToken);

    console.log(
      `Fetched ${recentlyPlayed.items.length} recently played tracks.`
    );

    await saveToS3(recentlyPlayed);

    return {
      statusCode: 200,
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        data: recentlyPlayed,
      }),
    };
  } catch (error) {
    console.error("Error performing:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error performing.",
        error: (error as Error).message,
      }),
    };
  }
};

async function getSpotifyAccessToken(): Promise<string> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
      ).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN || "",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getRecentlyPlayedTracks(accessToken: string) {
  const response = await fetch(
    "https://api.spotify.com/v1/me/player/recently-played?limit=50",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to get recently played tracks: ${response.statusText}`
    );
  }

  const data = await response.json();

  if (data.items) {
    data.items.forEach((item: any) => {
      if (item.track?.available_markets) {
        delete item.track.available_markets;
      }
      if (item.track?.album?.available_markets) {
        delete item.track.album.available_markets;
      }
    });
  }

  return data;
}

async function saveToS3(data: unknown) {
  const now = new Date();
  const timestamp =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0") +
    now.getHours().toString().padStart(2, "0");

  const key = `spotify-recently-played/${timestamp}.json`;

  const putCommand = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  });

  await s3Client.send(putCommand);
}
