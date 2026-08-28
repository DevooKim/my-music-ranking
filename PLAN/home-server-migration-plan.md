# 홈서버 이전 및 웹 캐시 구축 계획

## 1. 목표

Vercel에서 제공하던 웹 실행 환경과 공유 캐시를 개인 홈서버로 이전한다.
기존 AWS Lambda, EventBridge, S3 데이터 파이프라인은 유지하며, 공개 웹 요청은 Tailscale Funnel과 Nginx를 통해 제공한다.

핵심 목표는 다음과 같다.

- 인프라 통제권 확보 및 Vercel 종속성 제거
- 데이터가 드물게 변경되는 특성에 맞는 장기 HTTP 응답 캐시
- 최신 데이터 생성 후 최대 5분 이내 웹 반영
- Next.js 또는 S3 일시 장애 시 stale 응답 제공
- 향후 정적 artifact 구조로 전환할 수 있는 단계적 구성

## 2. 확정된 범위

### 포함

- Tailscale Funnel을 통한 공개 HTTPS 접근
- Docker Compose 기반 Nginx, Next.js, Uptime Kuma 실행
- Next.js standalone 빌드
- Debian 기반 Node.js 22 이미지
- Nginx HTML/API 응답 캐시
- Next RSC, POST, 재검증 및 헬스체크 요청의 캐시 우회
- 최신/과거/404별 캐시 TTL 분리
- origin 장애 시 stale 응답
- Nginx 캐시 영속 볼륨
- 전체 Nginx 캐시 수동 삭제 절차
- `/api/revalidate` 보호 강화
- Docker Compose secrets 적용
- Vercel Analytics 및 Speed Insights 제거
- Docker 로그 rotation
- Spotify February 2026 API 대응 확인
- 캐시, 재검증, 장애 및 재부팅 복구 검증
- standalone + Nginx 정상 MISS→HIT 및 RSC/cookie-first cache matrix 검증

### 제외

- Redis
- CDN
- AWS Lambda, EventBridge, S3 이전
- S3 버킷 또는 공개 범위 변경
- CI/CD 및 배포 자동화
- 커스텀 도메인
- 정적 artifact 전환
- 다중 Next.js 인스턴스

## 3. 목표 아키텍처

```text
Internet
  → Tailscale Funnel (*.ts.net)
  → host loopback의 Nginx container port
       ├─ 일반 HTML 응답 캐시
       ├─ chart GET API 응답 캐시
       ├─ RSC/POST/revalidation/health BYPASS
       └─ X-Cache-Status 응답 헤더
  → Next.js 16 standalone container
       ├─ RSC/SSR
       ├─ Next Data Cache
       ├─ S3/DuckDB 조회
       └─ tag revalidation
  → 기존 AWS S3

AWS EventBridge/Lambda
  ├─ Spotify recently-played 수집
  ├─ 주간/월간/연간 집계
  ├─ S3 write
  └─ Funnel URL의 POST /api/revalidate
       → Next revalidateTag()
```

Tailscale은 호스트 OS에서 실행한다. Docker Compose에는 Nginx, Next.js, Uptime Kuma만 포함한다.

## 4. Git 기준점 및 작업 보호

현재 로컬 상태는 다음 특성이 있다.

- 로컬 `main`이 `origin/main`과 서로 갈라져 있음
- 로컬에 대규모 미커밋 변경이 존재함
- `origin/main`에는 Spotify 아티스트 개별 조회 커밋 `f898d07`이 존재함
- 현재 로컬 작업 트리의 활성 코드는 여전히 제거된 `/artists?ids=` 호출을 포함함

따라서 현재 작업 트리에서 직접 `pull`, `rebase`, `reset`하지 않는다.

권장 시작 절차:

1. 현재 상태를 백업 브랜치 또는 별도 worktree로 보존한다.
2. 최신 `origin/main`에서 홈서버 이전 전용 브랜치를 생성한다.
3. `f898d07` 포함 여부와 관련 테스트를 확인한다.
4. 필요한 로컬 변경만 검토 후 선택적으로 이식한다.
5. 기존 미커밋 작업을 자동으로 덮어쓰거나 폐기하지 않는다.

## 5. Spotify February 2026 대응

Development Mode에서는 batch artist endpoint가 제거되었다.

제거 대상:

```text
GET /v1/artists?ids=id1,id2,...
```

대체 방식:

```text
GET /v1/artists/{id}
```

`origin/main`의 `f898d07`에서 다음 대응이 구현된 상태다.

- 아티스트 개별 조회
- 최대 동시성 5개
- HTTP 429 `Retry-After` 재시도
- HTTP 404를 null 썸네일로 처리
- 일부 요청 실패 시 전체 batch 실패 방지
- 관련 테스트 추가

홈서버 작업 기준 브랜치에서 아래를 확인한다.

- 활성 코드에 `/artists?ids=`가 존재하지 않는다.
- `/me/player/recently-played` 수집은 기존 방식으로 동작한다.
- 앱 소유자의 Spotify Premium 상태와 refresh token이 유효하다.
- 관련 테스트가 통과한다.

## 6. Next.js self-host 설정

### 6.1 Standalone 출력

`next.config.ts`에 standalone 출력을 설정한다.

```ts
const nextConfig = {
  output: "standalone",
  reactCompiler: true,
  serverExternalPackages: ["duckdb"],
};
```

standalone 결과물과 정적 자산을 production image에 포함한다.

- `.next/standalone`
- `.next/static`
- `public`

### 6.2 런타임 이미지

- Node.js 22
- Debian 계열 이미지 사용
- Alpine/musl은 사용하지 않음
- `duckdb` native binary가 대상 CPU와 libc에서 로드되는지 빌드 및 실행 단계에서 확인
- root의 최소 entrypoint만 host-owned `0400` Compose secret을 읽는다.
- entrypoint가 `gosu`로 Node를 UID 1001 non-root 사용자에 drop하고 `exec`한다.
- 최종 Node 프로세스 UID와 DuckDB/httpfs를 이미지/통합 smoke에서 검증한다.
- Next 포트는 Docker 내부 네트워크에만 노출

### 6.3 Next 캐시

- 단일 Next 인스턴스를 사용한다.
- Redis/custom cache handler는 추가하지 않는다.
- Next `.next/cache`는 영속 볼륨 대상에서 제외한다.
- 배포 또는 image 교체 시 Next 내부 캐시가 초기화되는 것을 허용한다.
- 장기 응답 캐시는 Nginx가 담당한다.

## 7. Docker Compose 구성

예상 서비스:

```text
services:
  web:       Next.js standalone
  nginx:     public response cache/reverse proxy
  uptime:    Uptime Kuma
```

운영 원칙:

- `web`은 외부 포트를 publish하지 않는다.
- `nginx`만 host loopback에 publish한다.
- Tailscale Funnel이 loopback Nginx 포트로 전달한다.
- 모든 서비스에 restart policy를 설정한다.
- Nginx cache directory는 named volume으로 유지한다.
- Docker socket을 애플리케이션 컨테이너에 mount하지 않는다.

예상 volume:

```text
nginx_cache     Nginx 응답 캐시 영속화
uptime_data     Uptime Kuma 설정 및 이력
```

## 8. Docker Compose secrets

시크릿은 Git과 Docker image에 포함하지 않는다.

예상 파일:

```text
.secrets/
├── aws_access_key_id
├── aws_secret_access_key
├── spotify_client_id
├── spotify_client_secret
├── spotify_refresh_token
└── revalidate_secret
```

운영 규칙:

- `.secrets/`를 `.gitignore`에 추가
- host 파일 권한을 소유자 read-only 수준으로 제한
- Compose `secrets`를 통해 `/run/secrets/*`에 read-only mount
- 로그와 health response에 secret 값을 출력하지 않음

현재 애플리케이션과 AWS SDK는 일반 환경변수를 읽으므로 secret file을 mount하는 것만으로는 충분하지 않다. root 권한의 최소 Next 컨테이너 entrypoint가 시작 전에 다음 값을 `/run/secrets/*`에서 읽어 export한 뒤 `gosu nextjs`로 Node를 UID 1001에 drop하도록 구성한다.

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN
REVALIDATE_SECRET
```

Swarm이 아닌 Docker Compose secrets는 host 파일 자체를 암호화하지 않는다. host 계정 및 파일 권한 보호가 전제다.

## 9. Tailscale Funnel

### 9.1 배치

- Tailscale daemon은 호스트 OS에서 실행
- Funnel은 HTTPS public endpoint를 제공
- backend는 host loopback의 Nginx 포트
- 초기 서비스 주소는 Tailscale의 `*.ts.net` hostname 사용

개념 예시:

```text
https://home-server.<tailnet>.ts.net
  → http://127.0.0.1:<nginx-loopback-port>
```

### 9.2 제약

- 임의의 커스텀 도메인은 이번 단계에서 사용하지 않는다.
- Funnel은 CDN이 아니므로 캐시는 홈서버 Nginx가 담당한다.
- Funnel 장애 시 별도 공개 fallback을 구성하지 않는다.
- Funnel의 포트 및 bandwidth 제한이 개인 서비스 트래픽에 적합한지 실제 운영 중 관측한다.

## 10. Nginx 캐시 설계

### 10.1 캐시 대상

다음 GET/HEAD 응답만 캐시 후보로 삼는다.

- `/`
- `/weekly/...`
- `/monthly/...`
- `/yearly/...`
- `/api/charts/...`
- Next static assets

다음은 항상 cache bypass 또는 no-store 처리한다.

- POST 및 GET/HEAD 이외 method
- `/api/revalidate`
- `/api/health/*`
- `/api/artist-thumbnails` POST
- `RSC: 1` 요청
- Next router prefetch/segment prefetch 요청
- 인증 또는 session cookie가 존재하는 요청
- WebSocket/upgrade 요청

RSC 응답은 일반 HTML과 동일 cache key를 사용하면 안 된다. 이번 단계에서는 RSC cache key를 별도로 구현하지 않고 Nginx cache를 우회한다.

### 10.2 TTL

| 대상 | fresh TTL | stale 허용 |
|---|---:|---:|
| `/` 및 최신 주간 API/HTML | 5분 | Nginx stale 정책 적용(OSS hard guarantee 아님) |
| 과거 차트 200 API | 30일 | Nginx `inactive=30d` 운영 상한(엄격한 상한 아님) |
| 동적 차트 HTML(현재/과거 공통 namespace) | 5분 | Nginx stale 정책 적용(OSS hard guarantee 아님) |
| 미생성/미래 404 | 2분 | SWR 없음; 장기 stale에서 분리하도록 운영 |
| 5xx | 신규 저장 안 함 | 기존 성공 응답이 있으면 stale 제공(OSS semantics) |
| `/_next/static/*` | 1년 | immutable |
| `/sw.js` | 저장 안 함 | 없음 |

기간별 차트 URL은 HTTP status에 따라 구분한다.

- 200: 과거 확정 데이터로 보고 30일 캐시
- 404: 데이터 생성 대기 상태로 보고 2분 negative cache, SWR 없음
- 5xx: `no-store`, 새 cache entry로 저장하지 않음

OSS Nginx의 `proxy_cache_use_stale`에는 일반적인 hard wall-clock 상한이
없으므로 stale을 정확히 며칠이라고 보장하지 않는다. 404는 별도 2분
정책으로 운영하고, 엄격한 404 보장이 필요하면 전체 cache clear runbook을
사용한다.

루트 `/`와 `/api/charts/weekly/latest`는 항상 최신 정책인 5분을 적용한다.

### 10.3 stale 및 stampede 보호

Nginx에 다음 성격의 정책을 적용한다.

- cache lock으로 동일 key 동시 miss를 하나의 upstream 요청으로 합침
- background update
- update/error/timeout/일부 5xx에서 stale 사용
- upstream 5xx를 성공 캐시로 새로 저장하지 않음
- client 요청이 stale 사용 여부를 진단할 수 있도록 상태 헤더 제공

응답 헤더:

```http
X-Cache-Status: HIT | MISS | STALE | BYPASS | EXPIRED
```

### 10.4 upstream 헤더 처리

현재 차트 API의 `s-maxage` 정책과 Nginx의 경로/status 정책이 충돌하지 않도록 실제 응답 헤더를 검증한다.

- `Set-Cookie`가 있는 응답은 캐시하지 않는다.
- `private` 또는 `no-store` 응답을 강제로 캐시하지 않는다.
- 일반 HTML을 캐시하기 위해 upstream `Cache-Control`을 무조건 무시하는 전역 설정은 금지한다.
- Next dynamic HTML의 `private/no-store`는 allowlisted `/` 및 chart detail HTML location에서만 제한적으로 무시하고, 같은 skip predicate, Set-Cookie, 4xx/5xx 보호를 유지한다.
- `Vary` 및 content encoding을 cache key에서 안전하게 처리한다.

## 11. 캐시 무효화

### 11.1 최신 데이터

- Lambda의 `/api/revalidate` 호출은 Next 내부 cache tag를 `expire: 0`으로 즉시 무효화한다.
- Nginx 최신 응답 캐시는 자동 purge하지 않는다.
- latest raw 조회는 Next `unstable_cache`를 사용하지 않고 Nginx만 사용한다. 따라서 latest에서 stale background update가 별도 계층으로 SLO를 재연장하지 않는다.
- Nginx TTL을 5분으로 제한하여 최악의 경우에도 5분 이내 새 응답을 조회한다.

### 11.2 과거 데이터 재집계

과거 차트가 재생성되는 경우 Nginx 캐시 전체를 수동 삭제한다.

수동 절차는 다음 성질을 만족해야 한다.

1. 새 cache write와 충돌하지 않게 Nginx를 일시 정지하거나 안전한 순서로 처리
2. cache volume의 내용만 삭제
3. 설정과 인증서 및 Uptime Kuma 데이터는 삭제하지 않음
4. Nginx 재시작 또는 reload
5. 첫 요청 `MISS`, 두 번째 요청 `HIT` 확인

관리자용 HTTP purge endpoint는 추가하지 않는다.

## 12. `/api/revalidate` 보호

기존 `x-revalidate-secret` 검증을 유지하고 Nginx에서 다음 제한을 추가한다.

- POST만 허용
- request body 크기 제한
- 요청 속도 제한
- 응답은 항상 `no-store`
- secret 없는 요청은 401
- 올바르지 않은 method는 405
- endpoint의 요청 body와 secret header를 access/error log에 기록하지 않음

AWS Lambda의 출발 IP는 고정으로 가정하지 않으므로 IP allowlist는 사용하지 않는다.

Lambda 환경변수의 `REVALIDATE_ENDPOINT_URL`을 Funnel 주소로 변경한다.

## 13. 헬스체크와 모니터링

### 13.1 Health endpoint

프로세스 liveness만 확인하는 endpoint를 제공한다.

```text
GET /api/health/live
```

요구사항:

- Next 프로세스가 정상적으로 요청을 처리하면 200
- 외부 S3/Spotify 상태는 검사하지 않음
- `Cache-Control: no-store`
- 민감한 환경변수 또는 시스템 세부정보를 노출하지 않음

### 13.2 Uptime Kuma

다음을 관측한다.

- Funnel 공개 메인 URL
- Funnel을 통한 `/api/health/live`
- 필요하면 홈서버 내부에서 Next 컨테이너 liveness

Prometheus/Grafana/Loki는 이번 범위에서 제외한다.

## 14. 로그 정책

Nginx와 Next 컨테이너에 Docker JSON log rotation을 설정한다.

```text
max-size: 10m
max-file: 3
```

추가 원칙:

- access log에 secret header를 기록하지 않음
- Next 오류 로그는 유지
- 캐시 상태는 `X-Cache-Status` 및 Nginx access log에서 확인 가능하게 함
- Spotify access/refresh token을 출력하지 않음

## 15. Vercel 전용 기능 제거

다음을 제거한다.

- `@vercel/analytics`
- `@vercel/speed-insights`
- `src/app/layout.tsx`의 관련 컴포넌트

제거 후 layout, build 및 hydration 동작을 검증한다.

## 16. 구현 단계

### Phase 0: 안전한 기준점 준비

- 현재 작업 상태 보존
- 최신 `origin/main` 기반 홈서버 작업 브랜치 생성
- Spotify 커밋 `f898d07` 확인
- 기존 변경과의 통합 범위 확인

### Phase 1: 애플리케이션 self-host 준비

- Next standalone 설정
- Vercel Analytics/Speed Insights 제거
- liveness endpoint 추가
- production runtime에서 필요한 환경변수 목록 정리
- Docker secret entrypoint 추가
- Debian/Node.js 22 Dockerfile 작성
- DuckDB native module smoke test

### Phase 2: Nginx와 Compose

- Nginx cache zone 및 cache key 구성
- route/status별 TTL 설정
- RSC/POST/revalidation/health bypass
- stale, background update, cache lock 설정
- rate limit 및 body size 제한
- persistent cache volume 구성
- Uptime Kuma 추가
- container log rotation 설정

### Phase 3: Funnel 연결

- 호스트 Tailscale 상태 확인
- loopback Nginx endpoint 구성
- Funnel 공개
- `*.ts.net` URL의 HTTPS 및 proxy headers 확인
- Lambda `REVALIDATE_ENDPOINT_URL` 변경 준비

### Phase 4: 검증

- 정적 검사와 테스트
- cache HIT/MISS/BYPASS 확인
- Lambda 재검증 end-to-end 확인
- stale-if-error 확인
- Nginx cache volume 재부팅 유지 확인
- 수동 전체 cache 삭제 확인

### Phase 5: 전환

배포 자동화 자체는 이번 계획에서 다루지 않는다.

운영 전환 원칙만 다음과 같이 둔다.

- 홈서버와 Vercel을 일주일 병행
- Funnel URL에서 실제 사용 검증
- Lambda 재검증 실패 여부 확인
- 홈서버 재부팅 복구 확인
- 안정화 후 Vercel 종료

## 17. 완료 기준

### 빌드 및 정적 검증

- `bun test` 통과
- `bun run lint` 통과
- `bun run build` 통과
- Debian 기반 production image 빌드 성공
- production container에서 DuckDB 로드 성공
- 활성 코드에서 Spotify `/artists?ids=` 제거 확인

### 라우팅 및 보안

- Funnel URL로 메인 및 상세 페이지 접근 가능
- secret 없는 `/api/revalidate` 요청은 401
- GET 등 잘못된 method는 거부
- body size 및 rate limit이 동작
- RSC와 POST 요청은 Nginx cache `BYPASS`
- health와 revalidation response는 `no-store`

### 캐시

- 동일한 일반 HTML/API의 두 번째 요청이 `HIT`
- `/` 및 최신 API fresh TTL이 5분 이하
- 과거 200 응답이 30일 정책을 사용
- 404가 2분 정책을 사용
- 5xx가 새 cache entry로 저장되지 않음
- Next 중단 시 기존 성공 응답을 `STALE`로 제공
- `X-Cache-Status`가 실제 상태를 표시
- 전체 cache 삭제 후 첫 요청 `MISS`, 두 번째 요청 `HIT`

### 갱신

- Lambda의 revalidation 요청이 Funnel과 Nginx를 통과해 200 반환
- Next 내부 cache tag가 무효화됨
- Nginx 최신 응답이 최대 5분 이내 새 데이터를 제공
- 재검증 endpoint 호출 자체는 캐시되지 않음

### 복구 및 운영

- 홈서버 재부팅 후 Compose 서비스가 자동 시작
- Nginx cache volume이 유지됨
- Next cache 초기화 후 정상적으로 다시 warm-up
- Uptime Kuma가 공개 URL과 liveness를 관측하되 Uptime Kuma 자체는 loopback/tailnet 전용
- 로그 rotation이 10MB × 3개 제한을 적용

실제 Tailscale 로그인/Funnel 공개, AWS/Lambda/S3 운영 변경, 운영 secret 생성,
Uptime Kuma monitor 생성 및 Vercel 종료는 실행하지 않고 템플릿/runbook/검증
절차만 제공한다.

## 18. 2차 개선 후보

1차 이전이 안정화된 이후 별도 계획으로 검토한다.

- Lambda가 아티스트 차트와 썸네일 map을 사전 생성
- 웹 요청 경로에서 DuckDB와 Spotify 호출 제거
- content hash가 포함된 immutable JSON 생성
- 짧게 캐시하는 latest/index manifest 도입
- Next static export 또는 Astro 전환
- 커스텀 도메인이 필요한 경우 VPS/WireGuard 또는 다른 tunnel 검토
- 다중 Next 인스턴스가 필요해질 경우 Redis 기반 shared cache handler 검토

Redis는 다음 조건이 실제로 발생하기 전까지 도입하지 않는다.

- Next 인스턴스가 2개 이상 필요함
- 인스턴스별 Data Cache 불일치가 발생함
- 재시작 후 cache cold start가 운영 문제로 확인됨
- Next 내부 tag invalidation을 공유 저장소로 전파해야 함
