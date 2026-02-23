# Spotify 개인 재생 기록 랭킹 앱 기획 (API 캐시 우선, processed JSON 기반)

## 1) 방향 요약
- 목표: Lambda가 생성하는 `processed` 산출물(`weekly/monthly/yearly`)을 기준으로, 주간/월간/연간 랭킹을 렌더링한다.
- 핵심 원칙
  - 웹/클라이언트는 S3에 직접 접근하지 않는다.
  - 과거 데이터는 빌드 시점 SSG 생성하지 않는다.
  - 과거 데이터는 요청 시점부터 조회 + 장기 캐싱한다.
  - 현재 주차/최근 구간은 단기 캐시로 최신성 확보한다.
- 현재 주차 랭킹이 메인 우선 노출된다.

## 2) 범위/제외 항목
- 포함
  - 주간/월간/연간 라우팅 분리
  - 오늘/이번 주차 메인 표시
  - 과거 기간 탐색(주/월/년별 조회)
  - API 기반 조회 + 캐시 정책 정교화
  - 향후 artist 랭킹/상세 확장 가능한 구조 설계
- 제외
  - Lambda 핵심 로직 재작성은 기본 제외 (필요 시 연간 처리 보완은 별도 이슈)
  - DuckDB를 웹 런타임 조회에서 사용하지 않음

## 3) 현재 상태 반영 가정
- Lambda 산출물 키
  - 주간: `processed/weekly/{isoYear}/weekly-week-{WW}.json`
  - 월간: `processed/monthly/{year}/monthly-month-{MM}.json`
  - 연간: `processed/yearly/yearly-{year}.json`
- 과거 데이터는 기본적으로 불변(imutable)으로 간주하되, 미생성/미처리 구간은 존재할 수 있음.
- 시간대/주차 계산은 KST ISO 기준(월요일 시작).

## 4) 공개 인터페이스(공유 타입)
- 추천 타입 정의: `/Users/hyunwookim/Dev/project/my-music-ranking/src/lib/domain/charts/types.ts`
- 핵심 타입
  - `ChartType = "weekly" | "monthly" | "yearly"`
  - `ChartResponse { type, period, generatedAt, items }`
  - `ChartPeriod`(주/월/년 메타 정보)
  - `ChartItem`(rank, ids, names, playCount, totalDurationMs, lastRank, peakRank, weeksOnChart)
  - `ChartNotReadyResponse`(`missing`, `nextExpectedAt` optional)
- API
  - `GET /api/charts/weekly/[isoYear]/[isoWeek]`
  - `GET /api/charts/monthly/[year]/[month]`
  - `GET /api/charts/yearly/[year]`
  - `GET /api/charts/weekly/latest`
  - (선택) `GET /api/charts/index`(과거 탐색용 캐시 메타)

## 5) 아키텍처(최종)
- 데이터 조회 계층
  - `/src/lib/infrastructure/s3/*`: S3 키 해석 + JSON 로딩 + 파싱 에러 처리 전담
  - `/src/lib/server/charts/*`: `ChartRepository` + 기간별 조회 유즈케이스
- API 라우트
  - Next.js App Router `src/app/api/charts/*/route.ts`
  - 클라이언트는 이 API만 호출
- UI 렌더링
  - `/` + `/weekly/latest`: 현재 주차 랭킹 우선 노출
  - `/weekly/[isoYear]/[isoWeek]`, `/monthly/[year]/[month]`, `/yearly/[year]`
- 과거 페이지 정책
  - `generateStaticParams`로 과거 전체 경로 선생성하지 않음
  - 요청 시점에 동적으로 생성 후 캐싱

## 6) 캐시 정책 (최종 결정)
- `found`(조회 성공)
  - 장기 캐시(기본 30일): `max-age=2592000, stale-while-revalidate=2592000`
  - 목적: 과거는 거의 변경되지 않으므로 반복 요청 비용 최소화
- `not found`(아직 미생성/미처리)
  - 짧은 캐시: `max-age=120, stale-while-revalidate=600`
  - 목적: Lambda 재처리/다음 실행 반영을 빠르게 재확인
- `latest`(현재 주차)
  - 단기 ISR: `max-age=600` 수준(15~60분 범위에서 조정 가능)
- 캐시 정책은 API 응답 헤더 + 페이지/라우트 캐시 정책으로 일치

## 6-1) 렌더링 전략 (분리)
- 렌더링 우선순위: `SSG 고정 생성`을 과거 전체에 적용하지 않고, `요청 기반 캐시 렌더`를 기본으로 설계

### 6-1-1. 페이지별 렌더링 모드
- `/` (현재 주차)
  - 서버 컴포넌트 렌더
  - `api/charts/weekly/latest` 조회 후 결과 캐시
  - 변경성이 있으므로 단기 ISR 패턴(`revalidate` 약 10분~1시간)
  - 목적: 최신성 + 비용 균형
- `/weekly/[isoYear]/[isoWeek]`
  - 과거/미래 구간 모두 서버 렌더 + 최초 요청 시 생성
  - found: 장기 캐시(30일)
  - not-found: 단기 캐시(120초)로 재확인
- `/monthly/[year]/[month]`, `/yearly/[year]`
  - 위와 동일한 요청 기반 생성 + 캐시 정책 적용
  - 기간 데이터 유무에 따라 found/not-found 분기

### 6-1-2. 생성 위치 정책
- API 라우트는 실제 조회/파싱/오류 매핑을 담당
  - `/api/charts/*` 응답을 기준으로 페이지 렌더 결과를 생성
  - 페이지는 최대한 얇은 래퍼로 유지
- 과거 기간은 빌드 타임 `generateStaticParams` 미사용
  - 앱 시작/빌드 시점에서는 라우트 pre-generate 하지 않음
  - 첫 요청에서 단일 라우트 단위로 캐싱되어 유지

### 6-1-3. 실패/빈 데이터 처리 정책
- `found`: 정상 HTML + 캐시 헤더 적용
- `not-found`/`not-ready`: 사용자에게 상태를 명확히 노출
  - 예: “집계 데이터가 아직 준비되지 않았습니다. 조금 뒤 다시 시도”
- 렌더 실패(`500`, 파싱 실패)는 fallback UI + 재시도 버튼으로 분리

### 6-1-4. 클라이언트/서버 경계
- 클라이언트 컴포넌트는 랭킹 리스트 표시/탭 이동 같은 상호작용만 담당
- 데이터 fetch는 서버에서만 수행
- 결과적으로 페이지당 JS 실행량 감소 및 TTFB 안정화

## 7) S3 접근 원칙
- 브라우저 번들/클라이언트 코드에서 `@aws-sdk/client-s3` 미포함.
- 모든 S3 조회는 서버 레이어에서만 수행.
- 클라이언트는 `/api/charts/*`로만 통신.

## 8) 라우팅/동작 요약
- `/`:
  - `api/charts/weekly/latest` 호출 → 이번 주차 랭킹 노출
  - 주/월/년 탭 및 과거 이동 버튼 표시
- `/weekly/[isoYear]/[isoWeek]`:
  - 처리본 파일이 있으면 즉시 반환
  - 없으면 404/NotReady 응답 + 짧은 재확인 캐시
- `/monthly/[year]/[month]`, `/yearly/[year]` 동일 패턴
- 경로 목록은 인덱스 API를 이용해 UI에서 생성(목록 렌더링에만 사용)

## 9) lib 정리
- 기존 `src/lib` 하위 구조를 신규 경계로 재배치
  - `src/lib/legacy/*`: 기존 파일 임시 보관(참고만)
  - `src/lib/domain/charts/*`: 타입/도메인 규칙
  - `src/lib/server/charts/*`: 조회 유즈케이스(캐시 정책 결합)
  - `src/lib/ui/charts/*`: 카드/목록 컴포넌트
  - `src/lib/infrastructure/s3/*`: S3 어댑터
- `src/lib/chart`, `src/lib/duckdb`, `src/lib/utils`의 기존 코드는 리팩터링 대상(참조 제외)

## 10) 실행 단계
1. API 설계 확정: 경로별 응답 스키마 + 캐시 헤더 규약 고정
2. S3 리포지토리 구현: processed 키 해석, 조회 실패 타입 분기
3. 라우트/페이지 연결: `/weekly/latest`/`/weekly/[year]/[week]`/`/monthly/...`/`/yearly/...`
4. 클라이언트는 API-only 접근으로 전환
5. 캐시 헤더 적용 및 NotFound/NotReady 상태 UI 처리
6. 재검증 보완(선택): Lambda 연동 webhook or 재검증 API
7. 비용/성능 점검: 과도한 캐시 미스율, 실패 재시도 패턴 확인

## 11) 테스트/검증 시나리오
- 메인에서 현재 주차 랭킹이 정상 노출되는지
- 과거 주/월/년 경로 첫 요청 시 조회 후 캐시로 재사용되는지
- 미생성 기간 요청이 `not-found`로 짧은 TTL 반환되는지
- 처리본 파일이 생성된 뒤 짧은 시간 내 반영되는지
- 클라이언트 번들에서 S3 관련 코드를 직접 참조하지 않는지 정적 분석
- API 실패/파싱 실패가 전체 페이지로 전파되지 않고 fallback 상태로 처리되는지
- mobile/desktop에서 탐색 UX(주차 이동/월 이동/연도 이동)가 동작하는지

## 12) 가정/기본값
- 기본 캐시 TTL: found `30d`, not-found `120s`
- `weeks/months/years` 탐색은 `index` 메타 또는 실패 시 최소 범위 탐색으로 진행
- 초기 릴리즈는 연간 라우트 read-through 캐시 우선, webhook은 추후 강화
