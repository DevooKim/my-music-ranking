import {
	pgTable,
	varchar,
	text,
	timestamp,
	integer,
	boolean,
	serial,
	date,
	index,
	uniqueIndex,
	primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Artist Table
export const artist = pgTable("artist", {
	id: varchar("id", { length: 255 }).primaryKey(), // Spotify artist ID
	name: varchar("name", { length: 500 }).notNull(),
	externalUrl: text("external_url"),
	spotifyUri: varchar("spotify_uri", { length: 255 }),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Album Table
export const album = pgTable("album", {
	id: varchar("id", { length: 255 }).primaryKey(), // Spotify album ID
	name: varchar("name", { length: 500 }).notNull(),
	albumType: varchar("album_type", { length: 50 }), // single, album, compilation
	releaseDate: date("release_date"),
	releaseDatePrecision: varchar("release_date_precision", { length: 20 }), // year, month, day
	totalTracks: integer("total_tracks"),
	externalUrl: text("external_url"),
	spotifyUri: varchar("spotify_uri", { length: 255 }),
	imageUrlLarge: text("image_url_large"), // 640x640
	imageUrlMedium: text("image_url_medium"), // 300x300
	imageUrlSmall: text("image_url_small"), // 64x64
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Track Table
export const track = pgTable("track", {
	id: varchar("id", { length: 255 }).primaryKey(), // Spotify track ID
	albumId: varchar("album_id", { length: 255 }).references(() => album.id),
	name: varchar("name", { length: 500 }).notNull(),
	discNumber: integer("disc_number"),
	trackNumber: integer("track_number"),
	durationMs: integer("duration_ms"),
	explicit: boolean("explicit"),
	isrc: varchar("isrc", { length: 50 }),
	popularity: integer("popularity"),
	previewUrl: text("preview_url"),
	externalUrl: text("external_url"),
	spotifyUri: varchar("spotify_uri", { length: 255 }),
	isLocal: boolean("is_local").default(false),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Track-Artist Relationship Table
export const trackArtist = pgTable(
	"track_artist",
	{
		trackId: varchar("track_id", { length: 255 })
			.notNull()
			.references(() => track.id),
		artistId: varchar("artist_id", { length: 255 })
			.notNull()
			.references(() => artist.id),
		position: integer("position").default(0).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.trackId, table.artistId] }),
	}),
);

// Album-Artist Relationship Table
export const albumArtist = pgTable(
	"album_artist",
	{
		albumId: varchar("album_id", { length: 255 })
			.notNull()
			.references(() => album.id),
		artistId: varchar("artist_id", { length: 255 })
			.notNull()
			.references(() => artist.id),
		position: integer("position").default(0).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.albumId, table.artistId] }),
	}),
);

// Track Name Table (for translations)
export const trackName = pgTable("track_name", {
	id: serial("id").primaryKey(),
	trackId: varchar("track_id", { length: 255 })
		.notNull()
		.unique()
		.references(() => track.id),
	name: text("name").notNull(), // 원본 이름
	korName: text("kor_name"), // 한국어 번역
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Played Table
export const played = pgTable(
	"played",
	{
		id: serial("id").primaryKey(),
		trackId: varchar("track_id", { length: 255 })
			.notNull()
			.references(() => track.id),
		playedAt: timestamp("played_at").notNull(),
		contextUri: varchar("context_uri", { length: 255 }),
		contextUrl: text("context_url"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		playedAtIdx: index("idx_played_at").on(table.playedAt.desc()),
		trackIdIdx: index("idx_track_id").on(table.trackId),
		// Unique constraint for preventing duplicates (track + played_at combination must be unique)
		uniquePlay: uniqueIndex("unique_play").on(table.trackId, table.playedAt),
	}),
);

// Relations
export const artistRelations = relations(artist, ({ many }) => ({
	trackArtists: many(trackArtist),
	albumArtists: many(albumArtist),
}));

export const albumRelations = relations(album, ({ many }) => ({
	tracks: many(track),
	albumArtists: many(albumArtist),
}));

export const trackRelations = relations(track, ({ one, many }) => ({
	album: one(album, {
		fields: [track.albumId],
		references: [album.id],
	}),
	trackArtists: many(trackArtist),
	trackName: one(trackName, {
		fields: [track.id],
		references: [trackName.trackId],
	}),
	played: many(played),
}));

export const trackArtistRelations = relations(trackArtist, ({ one }) => ({
	track: one(track, {
		fields: [trackArtist.trackId],
		references: [track.id],
	}),
	artist: one(artist, {
		fields: [trackArtist.artistId],
		references: [artist.id],
	}),
}));

export const albumArtistRelations = relations(albumArtist, ({ one }) => ({
	album: one(album, {
		fields: [albumArtist.albumId],
		references: [album.id],
	}),
	artist: one(artist, {
		fields: [albumArtist.artistId],
		references: [artist.id],
	}),
}));

export const trackNameRelations = relations(trackName, ({ one }) => ({
	track: one(track, {
		fields: [trackName.trackId],
		references: [track.id],
	}),
}));

export const playedRelations = relations(played, ({ one }) => ({
	track: one(track, {
		fields: [played.trackId],
		references: [track.id],
	}),
}));
