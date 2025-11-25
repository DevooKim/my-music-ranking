import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { config } from "dotenv";

// Load environment variables
config({ path: ".env.local" });

async function runMigration() {
  console.log("🚀 Starting migration...");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const db = drizzle(process.env.DATABASE_URL);

  try {
    // Run migrations
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

runMigration();
