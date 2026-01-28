import { execSync } from "child_process";

async function main(): Promise<void> {
  console.log("=== Full Reprocessing ===\n");

  console.log("Step 1/3: Reprocessing weekly charts...");
  execSync("npx tsx scripts/calc/reprocess-weekly.ts --all", { stdio: "inherit" });

  console.log("\nStep 2/3: Reprocessing monthly charts...");
  execSync("npx tsx scripts/calc/reprocess-monthly.ts --all", { stdio: "inherit" });

  console.log("\nStep 3/3: Reprocessing overall stats...");
  execSync("npx tsx scripts/calc/reprocess-stats.ts", { stdio: "inherit" });

  console.log("\n✅ Full reprocessing complete!");
}

main().catch((error) => {
  console.error("❌ Failed:", error);
  process.exit(1);
});
