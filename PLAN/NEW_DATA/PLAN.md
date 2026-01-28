# 목표
- s3구조 새롭게 설계
- `PLAN/DATA/*`를 기반으로 구조 변경
- 변경된 구조에 맞게 람다 및 기능 수정
  - `lambda/*` 참고
- s3의 raw 데이터를 신규 구조에 맞게 마이그레이션

# s3 구조
- `{bucket}/metadata/*` : 메타데이터 저장
- `{bucket}/raw/*` : 원본 데이터 저장 (기존 raw)
- `{bucket}/processed/monthly/*` : 월간 집계 데이터 저장 (기존 chartMonthly)
- `{bucket}/processed/weekly/*` : 주간 집계 데이터 저장 (기존 chartWeekly)
- `{bucket}/metadata/track-stats.json` : 통계 데이터 저장 (기존 trackStats.json)

# 람다
## collector
- 예시 데이터 `PLAN/NEW_DATA/EXAMPLE_DATA/recently-data.json`
- 2시간마다 실행
- raw 데이터 수집 후 s3에 저장
- 파일명은 `{bucket}/raw/YYYY-Wnn.json` (예: 2026-W01.json)로 저장. KST 기준
  - 동일 주간에는 items를 누적
  - played_at + item.id 기준 중복 제거
- 데이터 수집 후 data.next를 메타데이터로 저장. (`metadata/recently-played/next.json`)
  - 람다가 실행할 때 next로 다음 데이터 수집
  - 없는 경우 `https://api.spotify.com/v1/me/player/recently-played?&limit=50`
- raw데이터 구조는 현재와 동일.

## weekly-processor
- 매주 월요일 00:30 KST에 실행
- raw 데이터 기반으로 주간 집계 데이터 생성
- `{bucket}/processed/weekly/{YYYY}/YYYY-Wnn.json`로 저장
- 데이터 구조는 현재와 동일.

## monthly-processor
- 매월 1일 01:00 KST에 실행
- raw 데이터 기반으로 월간 집계 데이터 생성
- `{bucket}/processed/monthly/{YYYY}/YYYY-MM.json`로 저장
- 데이터 구조는 현재와 동일.