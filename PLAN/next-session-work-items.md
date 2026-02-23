# 다음 세션 전달용 작업 항목 (핵심만 압축)

## 목표
실제 구현(`src/lib/charts`, `src/lib/ui/charts`, `/app/api/charts/*`, `/app/*`) 기준으로 문서/운영/검증 상태를 정합화한다.

## 즉시 이어서 할 일 (Priority: High)
1. 기존 4개 PLAN 문서 정합화
   - `PLAN/spotify-ranking-execution-plan.md`
   - `PLAN/spotify-ranking-plan.md`
   - `PLAN/spotify-ranking-implementation-log.md`
   - `PLAN/raw-based-live-ranking.md`

   정합화 포인트:
   - 실제 코드 기준 경로는 `src/lib/charts/*`, `src/lib/ui/charts/*`로 통일
   - 미구현 API(`GET /api/charts/index`)는 “선택”이 아니라 “미구현/보류”로 분리 명시
   - 최근 UI 반영 사항(`entryStatus`, `rankDelta`, 썸네일, 총곡수, 헤더/UX, `NEW`/`RE-ENTRY` 문구 변경) 반영
   - raw 기반 실시간 분기(`raw 기반 live`)는 현재 구현과 운영 모드 구분(기본 전략 아님)

2. raw 수집 주기 기반 캐시 정책 상태 점검
   - `latest`/`latest_not_found` 정책이 구현 코드에 반영되었는지 확인
   - 수식·기본값(파싱 실패 fallback 포함)과 env 오버라이드 문서 동기화

3. UI 상태 메시지/지표 최종 문구 정리
   - `LW`/`NEW`/`PEAK`/`WEEKS` 라벨 정책 최종본(문서 + 컴포넌트 일치)
   - “신규/재진입” 항목 처리 규칙 정리(변동 미표시)

4. 이전 세션 테스트 기록 아티팩트 정리
   - 브라우저/크롬 테스트 결과, 헤더 캐시 관측값, API 시나리오를 단일 문서에 정리
   - 결과 항목: success/fail/action needed 3칸 표기

## 중간 우선순위
5. 실행 로그 문서에 브랜치 단위 작업 이력 추가
   - 브랜치: `codex/ui-entrystatus-rank-update` 기준으로 구현 완료 항목만 간단히 누적

6. 다음 구현 전 리스크 체크리스트 작성
   - 캐시 정책과 실제 동작 불일치 가능 포인트
   - 과거 데이터 조회 경로의 404 처리 일관성
   - raw/processed 경계(현재 주차 판단) 정책이 문서와 다를 경우 정합성 검증 포인트

## 완료 후 확인
7. 아래 4개 항목이 모두 맞는지 최종 점검
   - 코드-문서 경로 일치
   - 캐시 정책 값/규칙 일치
   - UI 문구/표시 규칙 일치
   - 테스트 시나리오가 실제 구현 상태를 반영

## 참고 (참조만 유지)
- `PLAN/raw-based-live-ranking.md`는 현재 운영 기본 전략이 아닌 “확장 옵션”으로 표기
- `PLAN/spotify-ranking-execution-plan.md` 8.2/8.3 정책 수식은 최신값과 동기화 후 유지
