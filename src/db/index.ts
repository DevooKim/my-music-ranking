import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL environment variable is not set");
}

// Create Drizzle instance with Bun SQL
export const db = drizzle(process.env.DATABASE_URL, { schema });
