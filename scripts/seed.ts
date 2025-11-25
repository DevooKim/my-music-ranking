import { drizzle } from "drizzle-orm/bun-sql";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import * as schema from "../src/db/schema";

// Load environment variables
config({ path: ".env.local" });

interface SpotifyImage {
  height: number;
  url: string;
  width: number;
}

interface SpotifyArtist {
  external_urls: { spotify: string };
  id: string;
  name: string;
  uri: string;
}

interface SpotifyAlbum {
  album_type: string;
  artists: SpotifyArtist[];
  external_urls: { spotify: string };
  id: string;
  images: SpotifyImage[];
  name: string;
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  uri: string;
}

interface SpotifyTrack {
  album: SpotifyAlbum;
  artists: SpotifyArtist[];
  disc_number: number;
  duration_ms: number;
  explicit: boolean;
  external_urls: { spotify: string };
  id: string;
  is_local: boolean;
  name: string;
  popularity: number;
  preview_url: string | null;
  track_number: number;
  uri: string;
}

interface SpotifyRecentlyPlayedItem {
  track: SpotifyTrack;
  played_at: string;
  context: {
    uri: string;
    external_urls: { spotify: string };
  } | null;
}

interface SpotifyRecentlyPlayed {
  items: SpotifyRecentlyPlayedItem[];
}

async function seedDatabase() {
  console.log("🌱 Starting database seeding...");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const db = drizzle(process.env.DATABASE_URL, { schema });

  try {
    // Read the seed data file
    const seedData = await readFile(
      "./data/seeds/recently-played.json",
      "utf-8",
    );
    const data: SpotifyRecentlyPlayed = JSON.parse(seedData);

    console.log(`📊 Found ${data.items.length} tracks to seed`);

    // Track statistics
    let artistsInserted = 0;
    let albumsInserted = 0;
    let tracksInserted = 0;
    let playedInserted = 0;

    // Process each item
    for (const item of data.items) {
      const { track, played_at, context } = item;

      // 1. Insert artists (both album and track artists)
      const allArtists = new Map<string, SpotifyArtist>();

      // Collect all unique artists
      for (const artist of track.album.artists) {
        allArtists.set(artist.id, artist);
      }
      for (const artist of track.artists) {
        allArtists.set(artist.id, artist);
      }

      // Insert artists
      for (const artist of allArtists.values()) {
        await db
          .insert(schema.artist)
          .values({
            id: artist.id,
            name: artist.name,
            externalUrl: artist.external_urls.spotify,
            spotifyUri: artist.uri,
          })
          .onConflictDoNothing();
        artistsInserted++;
      }

      // 2. Insert album
      const images = track.album.images;

      // Convert release_date to valid date format based on precision
      const formatReleaseDate = (
        releaseDate: string,
        precision: string,
      ): string => {
        switch (precision) {
          case "year":
            return `${releaseDate}-01-01`;
          case "month":
            return `${releaseDate}-01`;
          case "day":
          default:
            return releaseDate;
        }
      };

      await db
        .insert(schema.album)
        .values({
          id: track.album.id,
          name: track.album.name,
          albumType: track.album.album_type,
          releaseDate: formatReleaseDate(
            track.album.release_date,
            track.album.release_date_precision,
          ),
          releaseDatePrecision: track.album.release_date_precision,
          totalTracks: track.album.total_tracks,
          externalUrl: track.album.external_urls.spotify,
          spotifyUri: track.album.uri,
          imageUrlLarge: images.find((img) => img.height === 640)?.url,
          imageUrlMedium: images.find((img) => img.height === 300)?.url,
          imageUrlSmall: images.find((img) => img.height === 64)?.url,
        })
        .onConflictDoNothing();
      albumsInserted++;

      // 3. Insert album-artist relationships
      for (let i = 0; i < track.album.artists.length; i++) {
        await db
          .insert(schema.albumArtist)
          .values({
            albumId: track.album.id,
            artistId: track.album.artists[i].id,
            position: i,
          })
          .onConflictDoNothing();
      }

      // 4. Insert track
      await db
        .insert(schema.track)
        .values({
          id: track.id,
          albumId: track.album.id,
          name: track.name,
          discNumber: track.disc_number,
          trackNumber: track.track_number,
          durationMs: track.duration_ms,
          explicit: track.explicit,
          popularity: track.popularity,
          previewUrl: track.preview_url,
          externalUrl: track.external_urls.spotify,
          spotifyUri: track.uri,
          isLocal: track.is_local,
        })
        .onConflictDoNothing();
      tracksInserted++;

      // 5. Insert track-artist relationships
      for (let i = 0; i < track.artists.length; i++) {
        await db
          .insert(schema.trackArtist)
          .values({
            trackId: track.id,
            artistId: track.artists[i].id,
            position: i,
          })
          .onConflictDoNothing();
      }

      // 6. Insert played record
      await db
        .insert(schema.played)
        .values({
          trackId: track.id,
          playedAt: new Date(played_at),
          contextUri: context?.uri,
          contextUrl: context?.external_urls.spotify,
        })
        .onConflictDoNothing();
      playedInserted++;
    }

    console.log("\n✅ Seeding completed successfully!");
    console.log(`   Artists: ${artistsInserted} processed`);
    console.log(`   Albums: ${albumsInserted} processed`);
    console.log(`   Tracks: ${tracksInserted} processed`);
    console.log(`   Played records: ${playedInserted} inserted`);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  } finally {
  }
}

seedDatabase();
