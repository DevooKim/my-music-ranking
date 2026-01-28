# S3 구조 재설계 및 람다 수정 구현 계획

## 📋 개요
- **목표**: S3 구조를 `PLAN.md`에 따라 재설계하고 람다 함수 수정
- **기간**: Phase별로 순차 진행 (약 2-3주 예상)
- **영향 범위**: Lambda (collector, weekly-processor, monthly-processor), S3 경로, 타입 정의

---

## 🎯 Phase 1: S3 경로 구조 변경 및 타입 정의 (2-3일)

### 1.1 타입 정의 수정
**파일**: `lambda/shared/types.ts`

#### 작업 내용
- [ ] `RawPlayedData` 타입 수정
  - 기존: 개별 파일 (collectedAt, isoYear, isoWeek, items)
  - 신규: 주간 누적 파일 (isoYear, isoWeek, items, next?)
  - `next` 필드 추가 (마지막 수집 커서)
  
```typescript
export interface RawPlayedData {
  isoYear: number;
  isoWeek: number;
  items: PlayedItem[];
  next?: string; // 다음 페이지 URL
}

export interface NextMetadata {
  next: string | null;
  updatedAt: string;
}
```

### 1.2 S3 경로 유틸리티 변경
**파일**: `lambda/shared/s3.ts`

#### 작업 내용
- [ ] `s3Paths` 객체 수정
  - 기존: `played/raw/{year}/{week}/{filename}.json`
  - 신규: `raw/{YYYY}/raw-week-{nn}.json`
  
- [ ] 새로운 경로 구조
```typescript
export const s3Paths = {
  // Raw 데이터 (주간 단위 누적)
  raw: (isoYear: number, isoWeek: number) =>
    `raw/${isoYear}/raw-week-${String(isoWeek).padStart(2, "0")}.json`,
  
  // 메타데이터
  nextMetadata: () =>
    `metadata/recently-played/next.json`,
  
  trackStats: () =>
    `metadata/track-stats.json`,
  
  // 처리된 데이터
  weeklyProcessed: (isoYear: number, isoWeek: number) =>
    `processed/weekly/${isoYear}/weekly-week-${String(isoWeek).padStart(2, "0")}.json`,
  
  monthlyProcessed: (year: number, month: number) =>
    `processed/monthly/${year}/monthly-month-${String(month).padStart(2, "0")}.json`,
};
```

---

## 🎯 Phase 2: Collector 람다 수정 (3-4일)

### 2.1 수정 사항
**파일**: `lambda/collector/handler.ts`

#### 작업 내용
- [ ] **메타데이터 읽기 로직 추가**
  - `metadata/recently-played/next.json` 파일 읽기
  - 없으면 기본 URL 사용: `https://api.spotify.com/v1/me/player/recently-played?limit=50`

- [ ] **Raw 데이터 누적 로직 구현 (중요: 재생 시각 기준)**
  - **각 item의 `played_at` (재생 시각) 기준으로 주차 판단** (수집 시각 X)
  - 주차별로 items 그룹핑
  - 각 주차별 기존 `raw/{YYYY}/raw-week-{nn}.json` 파일 읽기
  - 주차별로 신규 items와 기존 items 병합
  - `played_at + track.id` 기준 중복 제거
  - 주차별로 파일 저장

- [ ] **메타데이터 업데이트 로직**
  - items와 next 상태에 따라 처리
  - `updatedAt` 타임스탬프 추가

#### 구현 예시 플로우
```
1. 메타데이터에서 next URL 읽기
2. 현재 시간(timestamp) 기록 (API 요청 전)
3. Spotify API 호출 (next URL 사용 또는 기본 URL)
4. 응답 처리:
   a. items가 있으면:
      - 주차별 그룹핑 및 저장 (아래 5-6 단계)
      - next 업데이트 (응답의 next 값)
   b. items가 없으면 (next도 null):
      - 2단계에서 기록한 timestamp로 after URL 생성하여 메타데이터 업데이트
      - 예: `?after={timestamp}&limit=50`
      - 다음 수집 시 해당 시간 이후의 재생 기록만 수집
5. items를 재생 시각(played_at) 기준으로 주차별 그룹핑 (KST 기준)
   - 예: [{week: 4, items: [...]}, {week: 5, items: [...]}]
6. 각 주차별로 처리:
   a. 기존 raw/{YYYY}/raw-week-{nn}.json 파일 읽기 (있으면)
   b. items 병합 및 중복 제거
   c. raw 파일 저장
7. next 메타데이터 업데이트
```

**중요한 엣지 케이스**:
1. **주차 경계 케이스**: 
   - 일요일 22시 수집 (Week 4) → 일요일 20-22시 데이터 수집
   - 월요일 00시 수집 (Week 5) → 일요일 22-24시 + 월요일 0-2시 데이터
   - **해결**: 각 item의 `played_at`을 ISO Week로 계산하여 올바른 주차 파일에 저장

2. **다중 주차 데이터 (극단적 케이스)**:
   - 장기간 음악을 듣지 않다가 재개한 경우
   - 예: 3주 동안 안 듣다가 → 50개가 3주치에 걸쳐 분포
   - **해결**: `groupByWeek` 함수가 자동으로 주차별 분류 → 각 주차 파일에 개별 저장
   - **최대 케이스**: limit=50, 주당 1곡씩 → 최대 50주 파일 동시 업데이트 가능 (비현실적)
   - **현실적**: 대부분 1-2주차 데이터만 포함

3. **재생 기록 없는 시간대**:
   - 일요일 22-24시에 재생 기록이 없는 경우
   - API 응답: `{"items": [], "next": null, "cursors": null, ...}`
   - **해결**: API 요청 전 현재 시간을 기록해두고, 응답이 비어있으면 해당 시간으로 after URL 생성
     - 예: `https://api.spotify.com/v1/me/player/recently-played?after={요청전timestamp}&limit=50`
     - API 요청-응답 사이에 새 재생 기록이 생겨도 놓치지 않음
   - **장점**: 다음 수집 시 현재 시간 이후의 재생 기록만 가져옴 (중복 방지, 데이터 누락 방지)

4. **next가 null인 경우 처리**:
   - 메타데이터의 next가 null → 기본 URL 사용: `https://api.spotify.com/v1/me/player/recently-played?limit=50`
   - 최근 50개부터 다시 수집 시작

### 2.2 중복 제거 로직
**파일**: `lambda/shared/mapper.ts`

#### 작업 내용
- [ ] 중복 키 생성 함수 수정
```typescript
export function getDeduplicationKey(item: PlayedItem): string {
  return `${item.playedAt}_${item.trackId}`;
}
```

- [ ] 주차별 그룹핑 함수 추가
```typescript
export function groupByWeek(items: PlayedItem[]): Map<string, PlayedItem[]> {
  const grouped = new Map<string, PlayedItem[]>();
  
  for (const item of items) {
    // KST 기준으로 변환
    const playedDate = new Date(item.playedAt);
    const kstDate = new Date(playedDate.getTime() + 9 * 60 * 60 * 1000);
    
    // ISO Week 계산
    const isoYear = getISOWeekYear(kstDate);
    const isoWeek = getISOWeek(kstDate);
    const weekKey = `${isoYear}-${String(isoWeek).padStart(2, "0")}`;
    
    if (!grouped.has(weekKey)) {
      grouped.set(weekKey, []);
    }
    grouped.get(weekKey)!.push(item);
  }
  
  return grouped;
}
```

---

## 🎯 Phase 3: Weekly Processor 수정 (2일)

### 3.1 수정 사항
**파일**: `lambda/weekly-processor/handler.ts`

#### 작업 내용
- [ ] **Raw 데이터 읽기 로직 변경**
  - 기존: 여러 파일 병합 (ListObjectsV2로 조회)
  - 신규: 단일 파일 읽기 (`raw/{YYYY}/raw-week-{nn}.json`)

- [ ] **저장 경로 변경**
  - 기존: `played/charts/weekly/{year}/week-{week}.json`
  - 신규: `processed/weekly/{YYYY}/weekly-week-{nn}.json`
  - **데이터 형식: ChartResponse (기존과 동일)**

- [ ] **차트 계산 및 저장**
  - 지난주 차트 읽기 (lastRank 계산용)
  - `buildChart()` 호출하여 ChartResponse 생성
  - track-stats 업데이트: `metadata/track-stats.json`

#### 구현 플로우
```
1. 지난 주 계산 (KST 기준)
2. raw/{YYYY}/raw-week-{nn}.json 읽기 (RawPlayedData)
3. 지난주 차트 읽기 (lastRank 계산용):
   - processed/weekly/{YYYY}/weekly-week-{nn-1}.json
4. metadata/track-stats.json 읽기
5. buildChart() 호출하여 ChartResponse 생성
6. ChartResponse 저장:
   - processed/weekly/{YYYY}/weekly-week-{nn}.json
7. metadata/track-stats.json 업데이트
```

**변경 사항 정리**:
- **기존**: Raw 병합 → 차트 계산 → ChartResponse 저장 (played/charts/weekly)
- **신규**: Raw 읽기 → 차트 계산 → ChartResponse 저장 (processed/weekly) - **경로만 변경**

---

## 🎯 Phase 4: Monthly Processor 수정 (2일)

### 4.1 수정 사항
**파일**: `lambda/monthly-processor/handler.ts`

#### 작업 내용
- [ ] **Weekly 파일 읽기 경로 변경**
  - 기존: `played/weekly/{year}/week-{week}.json`
  - 신규: `processed/weekly/{YYYY}/weekly-week-{nn}.json`

- [ ] **저장 경로 변경**
  - 기존: `played/charts/monthly/{year}/month-{month}.json`
  - 신규: `processed/monthly/{YYYY}/monthly-month-{nn}.json`
  - **데이터 형식: ChartResponse (기존과 동일)**

- [ ] **차트 계산 및 저장**
  - 지난달 차트 읽기 (lastRank 계산용)
  - `buildChart()` 호출하여 ChartResponse 생성
  - track-stats 업데이트: `metadata/track-stats.json`

#### 구현 플로우
```
1. 지난 달 계산
2. 해당 월의 모든 raw 파일에서 items 수집 (월 범위 내 played_at 필터링)
3. 지난달 차트 읽기 (lastRank 계산용):
   - processed/monthly/{YYYY}/monthly-month-{nn-1}.json
4. metadata/track-stats.json 읽기
5. buildChart() 호출하여 ChartResponse 생성
6. ChartResponse 저장:
   - processed/monthly/{YYYY}/monthly-month-{nn}.json
7. metadata/track-stats.json 업데이트
```

**참고**: Monthly는 raw 데이터에서 직접 집계 (weekly 경유 X)
- raw 데이터의 items에서 해당 월 범위의 played_at만 필터링
- 월 경계를 걸치는 주간의 경우도 정확하게 처리 가능

---

## 🎯 Phase 5: 기존 데이터 마이그레이션 (3-4일)

### 5.1 마이그레이션 스크립트 작성
**파일**: `scripts/migrate-to-new-structure.ts`

#### 작업 내용
- [ ] **Raw 데이터 마이그레이션**
  - 기존: `played/raw/{year}/{week}/{timestamp}.json` → 신규: `raw/{YYYY}/raw-week-{nn}.json`
  - 주차별로 파일 병합
  - 중복 제거 적용

- [ ] **Weekly 차트 마이그레이션**
  - 기존: `played/charts/weekly/{year}/week-{week}.json` → 신규: `processed/weekly/{YYYY}/weekly-week-{nn}.json`
  - 데이터 구조 유지 (ChartResponse)

- [ ] **Monthly 차트 마이그레이션**
  - 기존: `played/charts/monthly/{year}/month-{month}.json` → 신규: `processed/monthly/{YYYY}/monthly-month-{nn}.json`
  - 데이터 구조 유지 (ChartResponse)

- [ ] **메타데이터 마이그레이션**
  - 기존: `played/stats/track-stats.json` → 신규: `metadata/track-stats.json`

#### 마이그레이션 검증
- [ ] 마이그레이션 전후 데이터 건수 비교
- [ ] 샘플 데이터 무결성 검증
- [ ] 기존 S3 경로와 신규 경로 병행 운영 (1주일)

### 5.2 롤백 계획
- [ ] 마이그레이션 전 전체 S3 백업
- [ ] 롤백 스크립트 작성
- [ ] 테스트 환경에서 먼저 검증

---

## 🎯 Phase 6: API 및 프론트엔드 수정 (2-3일)

### 6.1 API 경로 수정
**파일**: `src/lib/utils/s3-paths.ts` (생성 필요)

#### 작업 내용
- [ ] 백엔드 s3 경로 함수 추가 (람다 공유 코드 복사)
- [ ] API 라우트에서 새로운 경로 사용
  - `src/app/api/v1/stats/route.ts`
  - `src/app/api/v1/recently-played/route.ts`

### 6.2 DuckDB 쿼리 수정
**파일**: `src/lib/duckdb/client.ts`

#### 작업 내용
- [ ] S3 경로 패턴 변경
  - Raw: `s3://bucket/raw/*/raw-week-*.json`
  - Weekly: `s3://bucket/processed/weekly/*/weekly-week-*.json`
  - Monthly: `s3://bucket/processed/monthly/*/monthly-month-*.json`

---

## 🎯 Phase 7: 테스트 및 배포 (2-3일)

### 7.1 테스트 계획
- [ ] **유닛 테스트**
  - [ ] 중복 제거 로직 테스트
  - [ ] S3 경로 생성 테스트
  - [ ] 날짜 계산 (ISO Week) 테스트

- [ ] **통합 테스트**
  - [ ] Collector 람다 실행 (테스트 환경)
  - [ ] Weekly Processor 실행
  - [ ] Monthly Processor 실행
  - [ ] API 응답 검증

- [ ] **부하 테스트**
  - [ ] Collector 2시간 주기 실행 시뮬레이션
  - [ ] Raw 파일 크기 모니터링 (주당 최대 840번 호출 가능)

### 7.2 배포 전략
- [ ] **스테이징 환경 배포**
  - [ ] 신규 구조로 1주일 운영
  - [ ] 데이터 정합성 검증

- [ ] **프로덕션 배포**
  - [ ] 블루-그린 배포 방식
  - [ ] 기존 람다와 병행 운영 (1주)
  - [ ] 모니터링 강화

### 7.3 모니터링
- [ ] CloudWatch 알람 설정
  - [ ] 람다 에러율
  - [ ] S3 파일 크기 이상 증가
  - [ ] API 응답 시간

---

## 📊 예상 일정

| Phase | 작업 내용 | 예상 기간 | 담당 |
|-------|----------|----------|------|
| Phase 1 | 타입 및 S3 경로 수정 | 2-3일 | - |
| Phase 2 | Collector 수정 | 3-4일 | - |
| Phase 3 | Weekly Processor 수정 | 2일 | - |
| Phase 4 | Monthly Processor 수정 | 2일 | - |
| Phase 5 | 데이터 마이그레이션 | 3-4일 | - |
| Phase 6 | API 및 프론트 수정 | 2-3일 | - |
| Phase 7 | 테스트 및 배포 | 2-3일 | - |
| **총계** | | **16-22일** | |

---

## 🚨 주의사항 및 리스크

### 리스크 관리
1. **데이터 손실 방지**
   - 마이그레이션 전 전체 백업 필수
   - 단계별 검증 후 다음 단계 진행

2. **서비스 중단 최소화**
   - 기존 구조와 신규 구조 병행 운영
   - 블루-그린 배포로 롤백 가능성 확보

3. **Raw 파일 크기 모니터링**
   - 주당 최대 840건 (2시간 × 7일 × 60분/2시간 = 84, 각 50건)
   - 파일 크기가 너무 커질 경우 압축 고려

4. **KST 시간대 처리**
   - 람다는 UTC로 실행되므로 KST 변환 로직 필수
   - ISO Week 계산 시 주의 (월요일 시작)

---

## 📝 체크리스트

### 시작 전
- [ ] PLAN.md 내용 팀 리뷰 완료
- [ ] 구현 계획 승인
- [ ] 테스트 환경 준비

### Phase별 완료 조건
- [ ] Phase 1: 타입 및 경로 정의 완료, PR 머지
- [ ] Phase 2: Collector 수정 완료, 로컬 테스트 통과
- [ ] Phase 3: Weekly Processor 수정 완료, 로컬 테스트 통과
- [ ] Phase 4: Monthly Processor 수정 완료, 로컬 테스트 통과
- [ ] Phase 5: 마이그레이션 스크립트 완료, 검증 완료
- [ ] Phase 6: API 수정 완료, 통합 테스트 통과
- [ ] Phase 7: 프로덕션 배포 완료, 모니터링 정상

### 배포 후
- [ ] 1주일간 모니터링
- [ ] 기존 구조 제거 (백업 유지)
- [ ] 문서화 업데이트
