import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import * as schema from "../src/db/schema";
import { sql, desc, count } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Load environment variables
config({ path: ".env.local" });

interface CurrentJsonTrack {
	rank: number;
	trackId: string;
	trackName: string;
	artists: Array<{
		id: string;
		name: string;
	}>;
	album: {
		id: string;
		name: string;
		imageUrl: string | null;
	};
	playCount: number;
	lastPlayed: string;
}

interface CurrentJson {
	lastUpdated: string;
	totalPlays: number;
	tracks: CurrentJsonTrack[];
}

/**
 * Script to manually generate current.json from existing database data
 */
async function main() {
	console.log("📊 Starting current.json generation...");

	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL is not set");
	}

	// Create database connection
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	const db = drizzle(pool, { schema });

	try {
		// 1. Get track play counts with latest played_at
		const trackStats = await db
			.select({
				trackId: schema.played.trackId,
				playCount: count(schema.played.id).as("play_count"),
				lastPlayed: sql<Date>`MAX(${schema.played.playedAt})`.as("last_played"),
			})
			.from(schema.played)
			.groupBy(schema.played.trackId)
			.orderBy(desc(count(schema.played.id)));

		console.log(`📈 Found ${trackStats.length} unique tracks`);

		// 2. Get total plays count
		const totalPlaysResult = await db
			.select({ total: count(schema.played.id) })
			.from(schema.played);
		const totalPlays = totalPlaysResult[0]?.total || 0;

		// 3. Build track data with relations
		const tracks: CurrentJsonTrack[] = [];

		for (let i = 0; i < trackStats.length; i++) {
			const stat = trackStats[i];

			// Get track with album
			const trackResult = await db
				.select({
					id: schema.track.id,
					name: schema.track.name,
					albumId: schema.track.albumId,
					albumName: schema.album.name,
					imageUrl: schema.album.imageUrlLarge,
				})
				.from(schema.track)
				.leftJoin(
					schema.album,
					sql`${schema.track.albumId} = ${schema.album.id}`,
				)
				.where(sql`${schema.track.id} = ${stat.trackId}`)
				.limit(1);

			if (trackResult.length === 0) {
				console.warn(`⚠️  Track not found: ${stat.trackId}`);
				continue;
			}

			const trackData = trackResult[0];

			// Get track artists (ordered by position)
			const artistsResult = await db
				.select({
					id: schema.artist.id,
					name: schema.artist.name,
					position: schema.trackArtist.position,
				})
				.from(schema.trackArtist)
				.innerJoin(
					schema.artist,
					sql`${schema.trackArtist.artistId} = ${schema.artist.id}`,
				)
				.where(sql`${schema.trackArtist.trackId} = ${stat.trackId}`)
				.orderBy(schema.trackArtist.position);

			tracks.push({
				rank: i + 1,
				trackId: trackData.id,
				trackName: trackData.name,
				artists: artistsResult.map((a) => ({
					id: a.id,
					name: a.name,
				})),
				album: {
					id: trackData.albumId || "",
					name: trackData.albumName || "",
					imageUrl: trackData.imageUrl || null,
				},
				playCount: Number(stat.playCount),
				lastPlayed: stat.lastPlayed.toISOString(),
			});
		}

		// 4. Create JSON structure
		const currentJson: CurrentJson = {
			lastUpdated: new Date().toISOString(),
			totalPlays,
			tracks,
		};

		// 5. Write to file
		const dataDir = path.join(process.cwd(), "data");
		const filePath = path.join(dataDir, "current.json");

		// Ensure data directory exists
		await mkdir(dataDir, { recursive: true });

		// Write JSON file
		await writeFile(filePath, JSON.stringify(currentJson, null, 2), "utf-8");

		console.log(`✅ current.json generated successfully at ${filePath}`);
		console.log(`   Total plays: ${totalPlays}`);
		console.log(`   Unique tracks: ${tracks.length}`);
	} catch (error) {
		console.error("❌ Error generating current.json:", error);
		throw error;
	} finally {
		await pool.end();
	}
}

main();
