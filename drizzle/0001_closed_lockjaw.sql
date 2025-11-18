DROP INDEX "unique_play";--> statement-breakpoint
CREATE UNIQUE INDEX "unique_play" ON "played" USING btree ("track_id","played_at");