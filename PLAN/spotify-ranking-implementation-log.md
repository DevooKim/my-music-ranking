# Spotify 재생 랭킹 앱 구현 진행 로그

## 브랜치 구성
- `codex/charts-data-api`
  - 공통 정책: S3 processed JSON 기반 조회 아키텍처 설계
  - 실제 코드 정리는 최종 구현 브랜치에서 통합 반영
- `codex/charts-ui-pages`
  - API/서비스/라우팅/페이지(주간-월간-연간) 구현
  - 요청된 SSG/ISR 전략(빌드 사전 생성 없음, 요청 시 캐시) 반영

## 구현 완료 항목
- `src/lib/charts/*`
  - 타입, 캐시 정책, 기간 계산, S3 키/조회, repository, service, API 응답 메타 처리 구현
- `src/app/api/charts/*`
  - `weekly/latest`, `weekly/[isoYear]/[isoWeek]`, `monthly/[year]/[month]`, `yearly/[year]` API 라우트 구현
- 페이지 라우트
  - 루트(`/`)는 이번 주차 랭킹을 메인으로 표시
  - 과거 데이터 조회 페이지
    - `/weekly/[isoYear]/[isoWeek]`
    - `/monthly/[year]/[month]`
    - `/yearly/[year]`
- 공통 UI
  - 랭킹 리스트 및 상태 메시지 컴포넌트 구현
  - 페이지 간 이동 링크, 이전/다음 구간 탐색
- 런타임 캐시 정책
  - found: 기본 30일 + stale-while-revalidate
  - not_found/error fallback: 120초 + stale-while-revalidate
  - latest: 600초 + stale-while-revalidate

## 다음 단계 권장
- API 응답 스키마 고정/계약 테스트 추가
- `next/font` 캐시 정책/ISR 동작 검증(배포 환경에서 실제 캐시 동작 확인)
- artist 상세 페이지, artist 탭은 향후 `src/app/artist/[id]` 확장으로 이어붙이기
