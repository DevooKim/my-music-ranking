import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

// 음악 테이블
export const music = pgTable('music', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  album: text('album'),
  genre: text('genre'),
  releaseYear: integer('release_year'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 랭킹 테이블
export const ranking = pgTable('ranking', {
  id: serial('id').primaryKey(),
  musicId: integer('music_id').notNull().references(() => music.id),
  rank: integer('rank').notNull(),
  score: integer('score'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 타입 추출
export type Music = typeof music.$inferSelect;
export type NewMusic = typeof music.$inferInsert;
export type Ranking = typeof ranking.$inferSelect;
export type NewRanking = typeof ranking.$inferInsert;
