import { z } from "zod";

// Spotify Artist Schema
export const spotifyArtistSchema = z.object({
	external_urls: z.object({
		spotify: z.string().url(),
	}),
	href: z.string().url().optional(),
	id: z.string(),
	name: z.string(),
	type: z.literal("artist").optional(),
	uri: z.string(),
});

// Spotify Image Schema
export const spotifyImageSchema = z.object({
	height: z.number(),
	url: z.string().url(),
	width: z.number(),
});

// Spotify Album Schema
export const spotifyAlbumSchema = z.object({
	album_type: z.string(),
	artists: z.array(spotifyArtistSchema),
	external_urls: z.object({
		spotify: z.string().url(),
	}),
	href: z.string().url().optional(),
	id: z.string(),
	images: z.array(spotifyImageSchema),
	name: z.string(),
	release_date: z.string(),
	release_date_precision: z.enum(["year", "month", "day"]),
	total_tracks: z.number(),
	type: z.literal("album").optional(),
	uri: z.string(),
});

// Spotify Track Schema
export const spotifyTrackSchema = z.object({
	album: spotifyAlbumSchema,
	artists: z.array(spotifyArtistSchema),
	disc_number: z.number(),
	duration_ms: z.number(),
	explicit: z.boolean(),
	external_urls: z.object({
		spotify: z.string().url(),
	}),
	href: z.string().url().optional(),
	id: z.string(),
	is_local: z.boolean(),
	isrc: z.string().optional(),
	name: z.string(),
	popularity: z.number().optional(),
	preview_url: z.string().url().nullable(),
	track_number: z.number(),
	type: z.literal("track").optional(),
	uri: z.string(),
});

// Spotify Context Schema
export const spotifyContextSchema = z
	.object({
		uri: z.string(),
		external_urls: z.object({
			spotify: z.string().url(),
		}),
		href: z.string().url().optional(),
		type: z.string().optional(),
	})
	.nullable();

// Spotify Recently Played Item Schema
export const spotifyRecentlyPlayedItemSchema = z.object({
	track: spotifyTrackSchema,
	played_at: z.string().datetime(),
	context: spotifyContextSchema,
});

// Spotify Recently Played Response Schema
export const spotifyRecentlyPlayedSchema = z.object({
	items: z.array(spotifyRecentlyPlayedItemSchema),
	next: z.string().url().optional(),
	cursors: z
		.object({
			after: z.string().optional(),
			before: z.string().optional(),
		})
		.optional(),
	limit: z.number().optional(),
	href: z.string().url().optional(),
});

// Type exports
export type SpotifyArtist = z.infer<typeof spotifyArtistSchema>;
export type SpotifyImage = z.infer<typeof spotifyImageSchema>;
export type SpotifyAlbum = z.infer<typeof spotifyAlbumSchema>;
export type SpotifyTrack = z.infer<typeof spotifyTrackSchema>;
export type SpotifyContext = z.infer<typeof spotifyContextSchema>;
export type SpotifyRecentlyPlayedItem = z.infer<
	typeof spotifyRecentlyPlayedItemSchema
>;
export type SpotifyRecentlyPlayed = z.infer<
	typeof spotifyRecentlyPlayedSchema
>;
