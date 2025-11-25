import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
	played,
	track,
	album,
	artist,
	trackArtist,
	albumArtist,
} from "@/db/schema";
import { and, between, desc, eq, sql, count } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
	from: z.string().transform((val) => new Date(val)).refine((date) => !Number.isNaN(date.getTime()), {
		message: "Invalid date format for 'from'",
	}),
	to: z.string().transform((val) => new Date(val)).refine((date) => !Number.isNaN(date.getTime()), {
		message: "Invalid date format for 'to'",
	}),
	type: z.enum(["track", "album", "artist"]),
});

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		
		const parseResult = querySchema.safeParse({
			from: searchParams.get("from"),
			to: searchParams.get("to"),
			type: searchParams.get("type"),
		});

		if (!parseResult.success) {
			return NextResponse.json(
				{ error: parseResult.error.issues },
				{ status: 400 }
			);
		}

		const { from: fromDate, to: toDate, type } = parseResult.data;

		let result: {
			playCount: number | string;
			trackId: string | null;
			trackName: string | null;
			trackUrl: string | null;
			albumId: string | null;
			albumName: string | null;
			albumImage: string | null;
			artistId: string | null;
			artistName: string | null;
		}[];

		if (type === "track") {
			// Group by Track
            // We need to join track -> album
            // And track -> trackArtist -> artist (take primary artist)
			result = await db
				.select({
					playCount: count(played.id),
					trackId: track.id,
					trackName: track.name,
					trackUrl: track.externalUrl,
					albumId: album.id,
					albumName: album.name,
					albumImage: album.imageUrlMedium,
					artistId: artist.id,
					artistName: artist.name,
				})
				.from(played)
				.innerJoin(track, eq(played.trackId, track.id))
				.innerJoin(album, eq(track.albumId, album.id))
				.innerJoin(trackArtist, eq(track.id, trackArtist.trackId))
				.innerJoin(artist, eq(trackArtist.artistId, artist.id))
				.where(
					and(
						between(played.playedAt, fromDate, toDate),
                        eq(trackArtist.position, 0) // Prefer primary artist
					)
				)
				.groupBy(
					track.id,
					track.name,
					track.externalUrl,
					album.id,
					album.name,
					album.imageUrlMedium,
					artist.id,
					artist.name
				)
				.orderBy(desc(count(played.id)));
		} else if (type === "album") {
			// Group by Album
            // Join track -> album
            // Join album -> albumArtist -> artist (primary)
			result = await db
				.select({
					playCount: count(played.id),
					trackId: sql<null>`null`,
					trackName: sql<null>`null`,
					trackUrl: sql<null>`null`,
					albumId: album.id,
					albumName: album.name,
					albumImage: album.imageUrlMedium,
					artistId: artist.id,
					artistName: artist.name,
				})
				.from(played)
				.innerJoin(track, eq(played.trackId, track.id))
				.innerJoin(album, eq(track.albumId, album.id))
                .innerJoin(albumArtist, eq(album.id, albumArtist.albumId))
				.innerJoin(artist, eq(albumArtist.artistId, artist.id))
				.where(
					and(
						between(played.playedAt, fromDate, toDate),
                        eq(albumArtist.position, 0) // Prefer primary artist
					)
				)
				.groupBy(
					album.id,
					album.name,
					album.imageUrlMedium,
					artist.id,
					artist.name
				)
				.orderBy(desc(count(played.id)));
		} else {
			// Group by Artist
            // Join track -> trackArtist -> artist
            // Count plays for each artist
			result = await db
				.select({
					playCount: count(played.id),
					trackId: sql<null>`null`,
					trackName: sql<null>`null`,
					trackUrl: sql<null>`null`,
					albumId: sql<null>`null`,
					albumName: sql<null>`null`,
					albumImage: sql<null>`null`,
					artistId: artist.id,
					artistName: artist.name,
				})
				.from(played)
				.innerJoin(track, eq(played.trackId, track.id))
				.innerJoin(trackArtist, eq(track.id, trackArtist.trackId))
				.innerJoin(artist, eq(trackArtist.artistId, artist.id))
				.where(between(played.playedAt, fromDate, toDate))
				.groupBy(artist.id, artist.name)
				.orderBy(desc(count(played.id)));
		}

        // Format response to match requested structure exactly
        const formatted = result.map(item => ({
            count: Number(item.playCount),
            track: item.trackId ? {
                id: item.trackId,
                name: item.trackName,
                url: item.trackUrl,
            } : null,
            album: item.albumId ? {
                id: item.albumId,
                name: item.albumName,
                image: item.albumImage,
            } : null,
            artist: item.artistId ? {
                id: item.artistId,
                name: item.artistName,
                // image: removed as requested
            } : null,
        }));

		return NextResponse.json(formatted);
	} catch (error) {
		console.error("Stats API Error:", error);
		return NextResponse.json(
			{ error: "Internal Server Error" },
			{ status: 500 },
		);
	}
}
