#!/usr/bin/env bash
set -euo pipefail

# weeksOnChart를 "연속 진입 기간" 기준으로 다시 계산한다.
# raw 데이터 시작 주차(2025-W38)부터 최신 raw 주차까지 처리본을 재생성한다.
# (weekly/monthly/yearly 모두 재생성)

bun run lambda/tools/rebuild-processed.ts --scope all --from 2025-W38 "$@"
