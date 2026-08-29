const duckdb = require("duckdb");

const run = (connection, sql) => new Promise((resolve, reject) => {
  connection.run(sql, (error) => (error ? reject(error) : resolve()));
});
const all = (connection, sql) => new Promise((resolve, reject) => {
  connection.all(sql, (error, rows) => (error ? reject(error) : resolve(rows)));
});

(async () => {
  const database = new duckdb.Database(":memory:");
  const connection = database.connect();
  try {
    await run(connection, "INSTALL httpfs; LOAD httpfs;");
    const rows = await all(connection, "SELECT 1 AS smoke");
    if (rows[0].smoke !== 1) throw new Error("DuckDB smoke query returned an unexpected result");
    console.log("DuckDB native/httpfs smoke test passed");
  } finally {
    connection.close();
    database.close();
  }
})().catch((error) => {
  console.error("DuckDB native/httpfs smoke test failed:", error.message);
  process.exitCode = 1;
});
