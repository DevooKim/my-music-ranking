import * as duckdb from "duckdb";

let db: duckdb.Database | null = null;
let conn: duckdb.Connection | null = null;
let initialized = false;

const REGION = process.env.S3_REGION || "ap-northeast-2";

export async function getDuckDB(): Promise<duckdb.Connection> {
  if (conn && initialized) return conn;
  
  db = new duckdb.Database(":memory:");
  conn = db.connect();
  
  // S3 확장 설치 및 설정
  await runQuery(conn, "INSTALL httpfs; LOAD httpfs;");
  await runQuery(conn, `SET s3_region='${REGION}';`);
  
  // AWS 자격 증명 설정 (환경 변수가 있는 경우)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    await runQuery(conn, `SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID}';`);
    await runQuery(conn, `SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY}';`);
  }
  
  initialized = true;
  return conn;
}

export function runQuery(conn: duckdb.Connection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function queryAll<T>(conn: duckdb.Connection, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export async function closeDuckDB(): Promise<void> {
  if (conn) {
    conn.close();
  }
  if (db) {
    db.close();
  }
  conn = null;
  db = null;
  initialized = false;
}
