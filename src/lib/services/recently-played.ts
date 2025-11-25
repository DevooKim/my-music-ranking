import { db } from "@/db";
import * as schema from "@/db/schema";
import type { SpotifyRecentlyPlayed } from "@/lib/validations/spotify";

export async function processRecentlyPlayed(
  data: SpotifyRecentlyPlayed,
): Promise<void> {
  // Process each item
  for (const item of data.items) {
    const { track, played_at, context } = item;
    const playedAtDate = new Date(played_at);

    // 1. Collect all unique artists
    const allArtists = new Map<string, (typeof track.artists)[0]>();
    for (const artist of track.album.artists) {
      allArtists.set(artist.id, artist);
    }
    for (const artist of track.artists) {
      allArtists.set(artist.id, artist);
    }

    // 3. Insert artists
    for (const artist of allArtists.values()) {
      await db
        .insert(schema.artist)
        .values({
          id: artist.id,
          name: artist.name,
          externalUrl: artist.external_urls.spotify,
          spotifyUri: artist.uri,
        })
        .onConflictDoUpdate({
          target: schema.artist.id,
          set: {
            name: artist.name,
            externalUrl: artist.external_urls.spotify,
            spotifyUri: artist.uri,
            updatedAt: new Date(),
          },
        });
    }

    // 4. Insert album
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

    const formattedReleaseDate = formatReleaseDate(
      track.album.release_date,
      track.album.release_date_precision,
    );

    await db
      .insert(schema.album)
      .values({
        id: track.album.id,
        name: track.album.name,
        albumType: track.album.album_type,
        releaseDate: formattedReleaseDate,
        releaseDatePrecision: track.album.release_date_precision,
        totalTracks: track.album.total_tracks,
        externalUrl: track.album.external_urls.spotify,
        spotifyUri: track.album.uri,
        imageUrlLarge: images.find((img) => img.height === 640)?.url,
        imageUrlMedium: images.find((img) => img.height === 300)?.url,
        imageUrlSmall: images.find((img) => img.height === 64)?.url,
      })
      .onConflictDoUpdate({
        target: schema.album.id,
        set: {
          name: track.album.name,
          albumType: track.album.album_type,
          releaseDate: formattedReleaseDate,
          releaseDatePrecision: track.album.release_date_precision,
          totalTracks: track.album.total_tracks,
          externalUrl: track.album.external_urls.spotify,
          spotifyUri: track.album.uri,
          imageUrlLarge: images.find((img) => img.height === 640)?.url,
          imageUrlMedium: images.find((img) => img.height === 300)?.url,
          imageUrlSmall: images.find((img) => img.height === 64)?.url,
          updatedAt: new Date(),
        },
      });

    // 5. Insert album-artist relationships
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

    // 6. Insert track
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
        isrc: track.isrc,
        popularity: track.popularity,
        previewUrl: track.preview_url,
        externalUrl: track.external_urls.spotify,
        spotifyUri: track.uri,
        isLocal: track.is_local,
      })
      .onConflictDoUpdate({
        target: schema.track.id,
        set: {
          albumId: track.album.id,
          name: track.name,
          discNumber: track.disc_number,
          trackNumber: track.track_number,
          durationMs: track.duration_ms,
          explicit: track.explicit,
          isrc: track.isrc,
          popularity: track.popularity,
          previewUrl: track.preview_url,
          externalUrl: track.external_urls.spotify,
          spotifyUri: track.uri,
          isLocal: track.is_local,
          updatedAt: new Date(),
        },
      });

    // 7. Insert track-artist relationships
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

    // 8. Insert played record (skip if duplicate due to unique constraint)
    await db
      .insert(schema.played)
      .values({
        trackId: track.id,
        playedAt: playedAtDate,
        contextUri: context?.uri,
        contextUrl: context?.external_urls.spotify,
      })
      .onConflictDoNothing();
  }
}
