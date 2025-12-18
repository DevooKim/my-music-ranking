// DuckDB 클라이언트
export { getDuckDB, queryAll, closeDuckDB } from "@/lib/duckdb/client";

// 차트 계산기
export { 
  aggregatePlaysFromS3, 
  assignRanks,
  getWeeklyS3Pattern,
  getMonthlyS3Pattern,
  getYearlyS3Pattern,
  type AggregatedTrack,
} from "./calculator";

// 차트 비교기
export { compareWithLastChart, getRankChange } from "./comparator";

// 통계 관리자
export { updateTrackStats, getStatsForChart } from "./stats-manager";

// 차트 빌더
export { buildChart, buildRealtimeChart } from "./builder";
