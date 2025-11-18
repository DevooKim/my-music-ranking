import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "dotenv";

// Load environment variables
config({ path: ".env.local" });

async function runMigration() {
	console.log("🚀 Starting migration...");

	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL is not set");
	}

	// Create postgres connection
	const sql = postgres(process.env.DATABASE_URL, { max: 1 });
	const db = drizzle(sql);

	try {
		// Run migrations
		await migrate(db, { migrationsFolder: "./drizzle" });
		console.log("✅ Migration completed successfully!");
	} catch (error) {
		console.error("❌ Migration failed:", error);
		throw error;
	} finally {
		await sql.end();
	}
}

runMigration();
