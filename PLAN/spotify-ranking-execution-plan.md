# Spotify 재생 기록 랭킹 앱 실행 계획 (과거 데이터 조회 기반 캐시 전략 확정)

## 요약
- **핵심 목표**: Lambda가 생성한 `processed` 산출물만 사용해 주간/월간/연간 랭킹을 제공한다.
- **제약 반영**: 과거 데이터를 빌드 시점 SSG로 모두 생성하지 않고, 요청 시점부터 캐시 기반으로 생성한다.
- **캐시 정책**: 데이터 존재 시(`found`)는 장기 캐시, 미존재 시(`not-found`)는 짧은 캐시로 재확인한다.
- **클라이언트 제약**: 클라이언트(브라우저)는 S3에 직접 접근하지 않고 오직 앱 API만 호출한다.
- **기능 범위**: `/weekly`, `/monthly`, `/yearly` 라우팅 분리 + 메인은 이번 주차 우선 표시.

## 1) 공개 인터페이스/타입 변경

### 1.1 타입 정의 (신규/정리)
- `src/lib/domain/charts/types.ts`에서 핵심 타입을 정리한다.
- `ChartType = "weekly" | "monthly" | "yearly"`
- `ChartPeriod`는 `start`, `end`, `isoYear`, `isoWeek`, `year`, `month`를 optional 조합으로 허용한다.
- `ChartItem`은 `rank`, `trackId`, `trackName`, `albumId`, `albumName`, `albumImageUrl`, `artistIds`, `artistNames`, `playCount`, `totalDurationMs`, `lastRank`, `peakRank`, `weeksOnChart`를 포함한다.
- `ChartResponse`는 `type`, `period`, `generatedAt`, `items`를 포함한다.
- `ChartNotReady`는 `status: "not_ready"`, `period`, `nextExpectedAt?`, `detail?`를 포함해 404 상황을 명시적으로 반환한다.

### 1.2 API 엔드포인트 (최종 확정)
- `GET /api/charts/weekly/latest`
- `GET /api/charts/weekly/[isoYear]/[isoWeek]`
- `GET /api/charts/monthly/[year]/[month]`
- `GET /api/charts/yearly/[year]`
- `GET /api/charts/index` (탐색용 메타 선택적, 과거 목록 구성 시 사용)
- 모든 API는 응답에 `Cache-Control` 헤더를 부여하며, found/ not-found 정책을 구분해 응답한다.

### 1.3 S3 키 접근 규격
- 주간: `processed/weekly/{isoYear}/weekly-week-{WW}.json`
- 월간: `processed/monthly/{year}/monthly-month-{MM}.json`
- 연간: `processed/yearly/yearly-{year}.json`
- 과거 인덱스(옵션): `metadata/charts/index.json` 또는 `list` 대체키 fallback

## 2) 렌더링 전략 (분리)

### 2.1 페이지 렌더링 모드
- `app/page.tsx`는 현재 주차 랭킹을 최우선 노출한다.
- `app/weekly/[isoYear]/[isoWeek]/page.tsx`는 요청 기반 동적 생성 후 캐시한다.
- `app/monthly/[year]/[month]/page.tsx`는 요청 기반 동적 생성 후 캐시한다.
- `app/yearly/[year]/page.tsx`는 요청 기반 동적 생성 후 캐시한다.

### 2.2 과거 데이터 생성 전략
- 과거 기간(`weekly/monthly/yearly`)에 대해 `generateStaticParams()`를 사용해 빌드 시점 전체 생성하지 않는다.
- 최초 요청 시점에만 데이터 조회(서버) 후 렌더 결과를 캐시한다.
- 과거 페이지는 “캐시로 빠르게 재사용”이 핵심이다.

### 2.3 실패/빈 데이터 처리
- `found` 응답: 정상 차트 렌더, 장기 캐시 헤더 적용.
- `not_found` 또는 `not_ready` 응답: 빈 화면/안내 화면 + 짧은 재조회 캐시.
- 파싱 실패/외부 의존 실패: 500 fallback UI를 보여주고 재시도 액션 노출.

### 2.4 클라이언트/서버 경계
- 서버 레이어: S3 조회, 파싱, 캐시 헤더 계산, 에러 매핑.
- 클라이언트 레이어: 렌더링 및 라우팅 이동/탭 전환, 재시도 트리거만 담당.
- 브라우저 번들에서 S3 SDK 노출 금지.

## 3) 캐시 정책 (최종 고정)

### 3.1 found 응답
- 헤더: `Cache-Control: public, max-age=2592000, stale-while-revalidate=2592000` (30일)
- 목적: 과거 데이터의 높은 정적성 최대한 활용, 비용 최소화.

### 3.2 not-found/not-ready 응답
- 헤더: `Cache-Control: public, max-age=120, stale-while-revalidate=600`
- 목적: 미생성 데이터는 빠르게 재확인하되 과도한 재요청 방지.

### 3.3 최신 주차 경로
- `latest`는 단기 ISR 계열 정책을 우선 적용.
- 권장 기본값: `max-age=600` (환경변수로 조정 가능)

### 3.4 캐시 정책 일관성
- API 응답 헤더와 페이지 렌더 정책 값을 동일 규약으로 동기화한다.
- 응답 본문에 `cachePolicy` 메타를 포함해 디버깅과 테스트를 지원한다.

## 4) lib 구조(구현 위치 고정)

### 4.1 서버/인프라 분리
- `src/lib/domain/charts/` : 타입, 포맷 규칙, 기간 계산 유틸.
- `src/lib/infrastructure/s3/` : S3 클라이언트, 키 생성, JSON 파싱/오류 매핑.
- `src/lib/server/charts/` : ChartRepository, 조회 유즈케이스, 캐시 정책 반환.
- `src/lib/ui/charts/` : 랭킹 목록/탭/상태 컴포넌트.

### 4.2 레거시 처리
- 기존 `src/lib/chart`, `src/lib/duckdb`, `src/lib/utils`는 참고 전용 `src/lib/legacy`로 이전해 새 로직에서 직접 의존하지 않는다.

## 5) 구현 단계
1. API 라우트 스펙 확정 및 에러/응답 스키마 고정.
2. S3 키 해석기와 차트 조회 리포지토리 구현.
3. 과거 라우트(page) 3개 그룹과 메인 페이지를 API 기반 렌더링으로 전환.
4. cache headers를 API/페이지에 주입하는 공통 유틸 작성.
5. 클라이언트에서 브라우저 직접 S3 호출 코드 제거 및 API 호출만 허용.
6. not-found/not-ready 상태 UI 패턴 및 재시도 액션 구현.
7. 옵션으로 `GET /api/charts/index`를 추가해 기간 이동 UX 개선.
8. 라우트별 성능 테스트 후 TTL 조정.

## 6) 테스트/검증 시나리오
1. 현재 주차(`weekly/latest`)가 즉시 렌더되는지 확인.
2. 과거 주간 요청 시 첫 응답 후 이후 응답에서 캐시 히트가 발생하는지 확인.
3. 과거 월간/연간 파일 미존재 시 120초 캐시 with revalidate가 적용되는지 확인.
4. 10~30초 이내 뒤 같은 누락 경로가 반복 호출 시 캐시 동작을 보이는지 검증.
5. 파일 존재 시 30일 캐시 헤더가 응답 헤더에 존재하는지 확인.
6. 클라이언트 번들에서 `@aws-sdk/client-s3`가 번들되지 않는지 정적 검사.
7. `generatedAt` 역전/파싱 오류 등 예외 시 fallback UI가 깨지지 않는지 확인.
8. 모바일/데스크톱에서 주/월/년 전환 및 빈 데이터 메시지 동작 점검.

## 7) 가정 및 기본값
- 캐시 기본값: found 30일, not-found 120초.
- S3 처리본은 유효한 정답 소스이며 웹 런타임 DuckDB는 사용하지 않는다.
- 처리본 미존재 구간이 일부 존재할 수 있으므로 not-found 재확인 정책을 반드시 유지한다.
- 연간 데이터는 존재 여부는 런타임 조회로 판단한다.
- 과거 기간 전체 사전 SSG(빌드 시) 생성을 적용하지 않는다.

## 8) raw 수집 주기 기반 캐시 정렬(2시간 기준)

### 8.1 수집 주기
- Lambda `CollectorFunction` 스케줄: `cron(0 0/2 * * ? *)`
- 수집 주기 변수: `SPOTIFY_RAW_COLLECTION_INTERVAL_SECONDS`
  - 기본값: `7200`초(2시간)

### 8.2 정책 수식
- `latest`(현재 주차 처리본 존재 시, 최신 캐시):
  - `latest_found.maxAge = clamp( R / 2, 600, 3600 )`
  - `latest_found.swr = latest_found.maxAge`
  - 기본값( R = 7200 ) → `3600`
- `latest_not_found`(현재 주차 미생성/미준비 시 404):
  - `latest_not_found.maxAge = clamp( R / 12, 60, 600 )`
  - `latest_not_found.swr = clamp( R / 60, 30, 120 )`
  - 기본값( R = 7200 ) → `600 / 120`
- `found` / `not_found`는 기존 규칙 유지(과거 라우트 동작 변경 없음).

### 8.3 환경변수 오버라이드(기본값 대체)
- `CHART_LATEST_CACHE_MAX_AGE_SECONDS` (default: `3600`)
- `CHART_LATEST_CACHE_SWR_SECONDS` (default: `3600`)
- `CHART_LATEST_NOT_FOUND_CACHE_MAX_AGE_SECONDS` (default: `600`)
- `CHART_LATEST_NOT_FOUND_CACHE_SWR_SECONDS` (default: `120`)
- 기존 과거 정책 변수:
  - `CHART_FOUND_CACHE_MAX_AGE_SECONDS`
  - `CHART_FOUND_CACHE_SWR_SECONDS`
  - `CHART_NOT_FOUND_CACHE_MAX_AGE_SECONDS`
  - `CHART_NOT_FOUND_CACHE_SWR_SECONDS`

### 8.4 주차 경계 동작 기대
- 월요일 00:30 전환 직후에 `GET /api/charts/weekly/latest`는 새 주차의 처리본 존재 유무를 반영.
- 처리본 미생성일 때는 `Cache-Control: public, max-age=600, stale-while-revalidate=120` 기본값이 적용.
- 처리본 존재 시에는 `Cache-Control: public, max-age=3600, stale-while-revalidate=3600` 기본값이 적용.

## 9) 원샷 processed 재생성 스크립트(일회용)

- 파일: `lambda/tools/rebuild-processed.ts`
- 목적: `raw`만 존재할 때 누락된 `processed` 산출물을 한 번에 다시 생성.
- 기본 시작점:
  - `2025-W38` (사용자 확인 반영).
- 범위 규칙:
  - `--from` 미지정 시 `2025-W38`로 고정.
  - `--to` 미지정 시 S3 `raw/` 하위에서 탐지한 마지막 주차까지 자동 확장.
- 재생성 범위:
  - `--scope` 기본값 `all`
    - `weekly`: 주간만 재생성
    - `monthly`: 월간만 재생성
    - `all`: 주간 + 월간
- 트랙 통계 처리:
  - 기본 `--reset-track-stats`(기본값 true): 기존 `metadata/track-stats.json`을 백업 후 `{}`로 재시작.
  - `--no-reset-track-stats`: 기존 track-stats를 계속 사용해 증분 재계산.
- 실행 예시:
  - `bun run lambda/tools/rebuild-processed.ts --scope all --from 2025-W38 --dry-run`
  - `bun run lambda/tools/rebuild-processed.ts --scope weekly --from 2025-W38 --to 2026-W52`
- 추가:
  - `--list-raw-weeks`로 현재 S3 raw 주차 목록 확인 후 실행 범위를 검증.
