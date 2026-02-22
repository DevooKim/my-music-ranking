# raw 기반 실시간 주차 랭킹 + 기존 SSG/ISR 하이브리드 구성 계획

## 개요
과거(완료) 데이터는 기존 처리본(processed) S3 + SSG/ISR 캐시 전략을 유지하고, 
현재 진행 중인 주간 랭킹은 raw 데이터를 실시간 집계해 `이번 주차`로 노출한다. 
월간/연간은 완료 구간은 processed 유지, 현재 진행 구간은 필요한 경우만 raw로 보정한다.

## 목표 및 성공 기준
1. 메인 페이지에서 항상 최신 주차 랭킹이 보이며, 현재 진행 주차는 raw 기반 즉시 반영
2. 과거 데이터(완료 구간)는 정적 경로로 빠르게 조회(빌드 아티팩트 우선)
3. 브라우저/클라이언트에서 S3를 직접 읽지 않음
4. 같은 조회가 반복되더라도 서버 캐시가 효율적으로 재사용됨
5. 처리 실패/지연 시에도 fallback(예: latest processed)으로 빈 화면 방지

## 데이터 조회 설계
1. 소스 우선순위
   1. 과거 완료 구간은 `processed`
   2. 현재 진행 구간은 `raw`
   3. 소스 없음 시 processed fallback 또는 404 + 캐시 정책 적용
2. 주간 현재 구간 판별
   1. `now = Asia/Seoul`
   2. ISO week 기준으로 `latest`가 완료 주차인지 진행 주차인지 판별
3. 월간/연간 current 보정
   1. 월/년 처리 완료 구간은 processed
   2. 월초/년초~현재 진행 구간은 raw 집계 보정(옵션)
4. 동일 집계 규칙
   1. raw 아이템 기준 점수/집계 로직은 기존 `buildChart` 스키마와 일치
   2. 응답 메타에 `source`(`raw|processed|mixed`) 명시
   3. `isLive` 플래그로 UI 구분 가능하게 함

## API 설계
1. 라우트
   1. `GET /api/charts/weekly/latest`
      1. 완료주차면 processed, 진행주차면 raw 집계 결과 반환
      2. `source`, `isLive`, `generatedAt` 응답에 포함
   2. `GET /api/charts/weekly/current`
      1. 현재 주차만 raw 집계 전용
      2. 실시간 갱신 기대 동작으로 캐시 TTL 짧게 설정
   3. `GET /api/charts/monthly/current` (선택)
      1. 현재 월 진행 구간만 raw 집계
   4. `GET /api/charts/yearly/current` (선택)
      1. 현재 년 진행 구간만 raw 집계
2. 공통 응답 메타
   1. `source: "raw" | "processed" | "mixed"`
   2. `isLive: boolean`
   3. `generatedAt: string`
   4. `cacheHint` 또는 HTTP Cache-Control를 통해 캐시 정책 반영

## 렌더링 전략(SSG/ISR + ISR on-demand)
1. 과거 라우트 유지
   1. `src/app/weekly/[isoYear]/[isoWeek]`
   2. `src/app/monthly/[year]/[month]`
   3. `src/app/yearly/[year]`
   4. 기본 SSG/ISR 적용, 존재하면 long cache, 404는 짧은 캐시
2. 현재 라우트 분리
   1. latest/현재 주차는 정적 미리생성 대상에서 분리하거나 짧은 ISR 캐시로 처리
   2. raw 기반 응답은 캐시 짧게 유지(권장 30~60초)
3. 메인 페이지
   1. 1순위 섹션은 `현재 주차` 표시
   2. 라벨로 processed/live 구분 표시
4. 캐시 정책
   1. processed found: 길게
   2. raw live: 짧게
   3. not_found: TTL 짧게(재조회 유도)

## 구현 항목
1. 공유 라이브러리
   1. `src/lib/charts/live-raw.ts` 추가
      1. raw 조회 및 집계
      2. 기간 판별 유틸 (현재 주/월/년 여부)
   2. `src/lib/charts/charts.ts`에 source별 response meta 확장
2. API
   1. weekly latest/current 분기 로직 추가
   2. 월/년 current 엔드포인트는 2차 반영 여부 결정 후 추가
3. UI
   1. 메인 페이지 데이터 소스 표시와 새로고침/갱신성 가시화
   2. 과거 페이지 링크를 completed/current 상태와 분리
4. 서버/캐시
   1. S3 접근은 API/서버 컴포넌트만 수행
   2. raw miss/processed hit/mixed 응답 메트릭 로그 태깅

## 리스크 및 대응
1. 월/년 current 집계 비용 증가
   1. 초기엔 weekly only로 런칭 후 월/년 점진 적용
2. raw 데이터 품질 문제
   1. 중복/형식 이상치에 대한 방어 파서 및 집계 정합성 로그
3. 캐시와 실시간성 충돌
   1. live 경로에 대해서는 캐시 헤더를 반드시 짧게 고정
4. 사용자 혼란
   1. 라벨 표기로 실시간/완료본을 명시

## 배포/운영 시나리오
1. 1단계: weekly latest/current만 적용
2. 2단계: 월간 current 선택 적용
3. 3단계: 연간 current 선택 적용
4. 4단계: 랭킹 표시 정책 정리 후 아티스트 랭킹, 상세로 확장

## 테스트 시나리오
1. 경계 시간 테스트
   1. 월요일 00:30 KST 기준 주차 전환
   2. 타임존 오프셋 시뮬레이션
2. 데이터 존재성 테스트
   1. raw 있음 + processed 없음
   2. raw 없음 + processed 있음 fallback
   3. 양쪽 없음 404 및 캐시 동작
3. 성능 테스트
   1. raw 단일 주간 집계 P95
   2. current 월/년 집계 시 다중 raw 병합 성능(옵션)
4. 캐시 테스트
   1. live 응답이 짧은 TTL로 갱신되는지
   2. 과거 page 404 캐시 회수 시간

## raw 수집 주기(2시간) 기반 캐시 정렬

- Collector 수집 주기: `cron(0 0/2 * * ? *)` (2시간 = `7200`초)
- `latest` 정책은 과거 규칙과 분리해 동적 계산한다.
- 기본 규칙(환경변수 오버라이드 가능):
  - `latest_found.maxAge = clamp(7200 / 2, 600, 3600) = 3600`
  - `latest_found.swr = 3600`
  - `latest_not_found.maxAge = clamp(7200 / 12, 60, 600) = 600`
  - `latest_not_found.swr = clamp(7200 / 60, 30, 120) = 120`
- 과거 조회는 기존:
  - found: 기본 30일
  - not_found: 120초 + 600초 SWR
- 적용 가능한 환경변수:
  - `SPOTIFY_RAW_COLLECTION_INTERVAL_SECONDS`
  - `CHART_LATEST_CACHE_MAX_AGE_SECONDS`
  - `CHART_LATEST_CACHE_SWR_SECONDS`
  - `CHART_LATEST_NOT_FOUND_CACHE_MAX_AGE_SECONDS`
  - `CHART_LATEST_NOT_FOUND_CACHE_SWR_SECONDS`
  - `CHART_FOUND_CACHE_MAX_AGE_SECONDS`
  - `CHART_FOUND_CACHE_SWR_SECONDS`
  - `CHART_NOT_FOUND_CACHE_MAX_AGE_SECONDS`
  - `CHART_NOT_FOUND_CACHE_SWR_SECONDS`
