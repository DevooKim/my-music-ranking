CREATE TABLE "album" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"album_type" varchar(50),
	"release_date" date,
	"release_date_precision" varchar(20),
	"total_tracks" integer,
	"external_url" text,
	"spotify_uri" varchar(255),
	"image_url_large" text,
	"image_url_medium" text,
	"image_url_small" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "album_artist" (
	"album_id" varchar(255) NOT NULL,
	"artist_id" varchar(255) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "album_artist_album_id_artist_id_pk" PRIMARY KEY("album_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "artist" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"external_url" text,
	"spotify_uri" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "played" (
	"id" serial PRIMARY KEY NOT NULL,
	"track_id" varchar(255) NOT NULL,
	"played_at" timestamp NOT NULL,
	"context_uri" varchar(255),
	"context_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"album_id" varchar(255),
	"name" varchar(500) NOT NULL,
	"disc_number" integer,
	"track_number" integer,
	"duration_ms" integer,
	"explicit" boolean,
	"isrc" varchar(50),
	"popularity" integer,
	"preview_url" text,
	"external_url" text,
	"spotify_uri" varchar(255),
	"is_local" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_artist" (
	"track_id" varchar(255) NOT NULL,
	"artist_id" varchar(255) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "track_artist_track_id_artist_id_pk" PRIMARY KEY("track_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "track_name" (
	"id" serial PRIMARY KEY NOT NULL,
	"track_id" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"kor_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "track_name_track_id_unique" UNIQUE("track_id")
);
--> statement-breakpoint
ALTER TABLE "album_artist" ADD CONSTRAINT "album_artist_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_artist" ADD CONSTRAINT "album_artist_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "played" ADD CONSTRAINT "played_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_album_id_album_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."album"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artist" ADD CONSTRAINT "track_artist_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artist" ADD CONSTRAINT "track_artist_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_name" ADD CONSTRAINT "track_name_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_played_at" ON "played" USING btree ("played_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_track_id" ON "played" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "unique_play" ON "played" USING btree ("track_id","played_at");