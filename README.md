# my-music-ranking

Spotify 재생 기록으로 주간/월간/연간 랭킹을 보여주는 Next.js 앱입니다. `origin/main`의
Spotify Development Mode 대응(아티스트 개별 조회, 동시성 5, 429 재시도)을 유지합니다.
활성 코드에는 deprecated `/v1/artists?ids=` 호출이 없습니다.

## 개발 및 검증

Bun 1.4와 TypeScript 7을 사용합니다.

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run build
```

Self-host 이미지/구성 검증은 다음을 사용합니다.

```bash
docker compose config
docker build -t my-music-ranking:local .
# 이미지가 빌드된 뒤, 최종 UID(1001)로 native DuckDB/httpfs 검증:
docker run --rm --user 1001 --entrypoint node my-music-ranking:local scripts/duckdb-httpfs-smoke.cjs
```

## 홈서버 운영

- [배포 runbook](docs/home-server-deploy.md)
- [캐시/재검증 runbook](docs/cache-operations.md)
- [secret/Lambda 템플릿](docs/secrets-and-lambda.md)
- [모니터링](docs/monitoring.md)

`docker-compose.yml`은 예시 secret 파일을 기본으로 참조하며, placeholder 상태에서는
entrypoint가 fail-fast 합니다. 실제 secret은 승인된 secret manager로 생성해
`.secrets/`에 소유자 read-only로 배치하십시오. Tailscale Funnel, AWS/Lambda 변경,
실제 운영 secret 생성, Uptime Kuma monitor 생성, Vercel 종료는 이 저장소에서 실행하지
않습니다.

## Spotify collector 재승인

Spotify refresh token이 만료되면 collector 로그의
`Spotify reauthorization required (invalid_grant; HTTP 400)`를 확인합니다. Spotify
Developer Dashboard에 `http://127.0.0.1:8888/callback`을 등록한 뒤 승인된 운영 절차로
다음을 실행하십시오. 토큰은 터미널에 출력되지 않고 gitignored 파일에만 기록됩니다.

```bash
bun lambda/tools/spotify-reauthorize.ts
cd lambda && ./deploy.sh
```
