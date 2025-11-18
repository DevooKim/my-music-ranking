# 음악 차트 웹 애플리케이션 구현 기획서

## 1. 프로젝트 개요

### 1.1 프로젝트 목적
- Spotify API를 활용하여 사용자의 음악 재생 기록을 수집하고 분석
- 수집된 데이터를 기반으로 개인화된 음악 차트 제공
- 한국어 번역 기능을 통해 한국 사용자에게 최적화된 UX 제공

### 1.2 핵심 가치
- **자동화된 데이터 수집**: Spotify 재생 기록 자동 수집
- **다국어 지원**: 영문 트랙명의 한국어 번역 제공
- **실시간 업데이트**: 최신 재생 기록 반영

## 2. 시스템 아키텍처

### 2.1 기술 스택

**Frontend & Backend**
- Next.js 16 (App Router)
- TypeScript
- React 19

**Database**
- Neon PostgreSQL (Serverless)
- Drizzle ORM

**External APIs**
- Spotify Web API (재생 기록)
- 번역 API (한국어 변환)

### 2.2 시스템 구성도

```
[Client Browser]
       ↓
[Next.js App Router]
       ↓
[API Routes] ← [Spotify API]
       ↓           ↓
[Drizzle ORM] ← [Translation API]
       ↓
[Neon PostgreSQL]
       ↓
[current.json on Local]
```

## 3. 데이터베이스 설계

### 3.1 스키마 구조

**artist 테이블**
```sql
CREATE TABLE artist (
  id VARCHAR(255) PRIMARY KEY,  -- Spotify artist ID
  name VARCHAR(500) NOT NULL,
  external_url TEXT,
  spotify_uri VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**album 테이블**
```sql
CREATE TABLE album (
  id VARCHAR(255) PRIMARY KEY,  -- Spotify album ID
  name VARCHAR(500) NOT NULL,
  album_type VARCHAR(50),       -- single, album, compilation
  release_date DATE,
  release_date_precision VARCHAR(20),  -- year, month, day
  total_tracks INTEGER,
  external_url TEXT,
  spotify_uri VARCHAR(255),
  image_url_large TEXT,         -- 640x640
  image_url_medium TEXT,        -- 300x300
  image_url_small TEXT,         -- 64x64
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**track 테이블**
```sql
CREATE TABLE track (
  id VARCHAR(255) PRIMARY KEY,  -- Spotify track ID
  album_id VARCHAR(255) REFERENCES album(id),
  name VARCHAR(500) NOT NULL,
  disc_number INTEGER,
  track_number INTEGER,
  duration_ms INTEGER,
  explicit BOOLEAN,
  isrc VARCHAR(50),
  popularity INTEGER,
  preview_url TEXT,
  external_url TEXT,
  spotify_uri VARCHAR(255),
  is_local BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**track_artist 관계 테이블**
```sql
CREATE TABLE track_artist (
  track_id VARCHAR(255) REFERENCES track(id),
  artist_id VARCHAR(255) REFERENCES artist(id),
  position INTEGER DEFAULT 0,  -- 아티스트 순서
  PRIMARY KEY (track_id, artist_id)
);
```

**album_artist 관계 테이블**
```sql
CREATE TABLE album_artist (
  album_id VARCHAR(255) REFERENCES album(id),
  artist_id VARCHAR(255) REFERENCES artist(id),
  position INTEGER DEFAULT 0,
  PRIMARY KEY (album_id, artist_id)
);
```

**track_name 테이블**
```sql
CREATE TABLE track_name (
  id SERIAL PRIMARY KEY,
  track_id VARCHAR(255) REFERENCES track(id),
  name TEXT NOT NULL,           -- 원본 이름
  kor_name TEXT,                -- 한국어 번역
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id)
);
```

**played 테이블**
```sql
CREATE TABLE played (
  id SERIAL PRIMARY KEY,
  track_id VARCHAR(255) REFERENCES track(id),
  played_at TIMESTAMP NOT NULL,
  context_uri VARCHAR(255),
  context_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(track_id, played_at)   -- 중복 방지
);

CREATE INDEX idx_played_at ON played(played_at DESC);
CREATE INDEX idx_track_id ON played(track_id);
```

## 4. API 명세서

### 4.1 POST /api/v1/recently-played

**목적**: Spotify 최근 재생 기록 수집 및 저장

**Request**
```typescript
interface RecentlyPlayedRequest {
  items: PlayedItem[];
}

interface PlayedItem {
  track: Track;
  played_at: string;  // ISO 8601 format
  context?: Context;
}

interface Track {
  id: string;
  name: string;
  album: Album;
  artists: Artist[];
  disc_number: number;
  track_number: number;
  duration_ms: number;
  explicit: boolean;
  external_ids: { isrc: string };
  external_urls: { spotify: string };
  popularity: number;
  preview_url: string | null;
  uri: string;
  is_local: boolean;
}

interface Album {
  id: string;
  name: string;
  album_type: string;
  artists: Artist[];
  images: Image[];
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  external_urls: { spotify: string };
  uri: string;
}

interface Artist {
  id: string;
  name: string;
  external_urls: { spotify: string };
  uri: string;
}

interface Image {
  url: string;
  height: number;
  width: number;
}

interface Context {
  type: string;
  uri: string;
  external_urls: { spotify: string };
}
```

**Response**
```typescript
interface ApiResponse {
  success: boolean;
  message: string;
  processedCount?: number;
}
```

**상태 코드**
- 200: 성공
- 400: 잘못된 요청
- 500: 서버 오류

## 5. 데이터 처리 플로우

### 5.1 데이터 수집 프로세스

```
1. API 요청 수신
   ↓
2. 즉시 200 응답 반환
   ↓
3. 백그라운드 처리 시작
   ├─ 4. Artist 데이터 저장 (없으면 INSERT)
   ├─ 5. Album 데이터 저장 (없으면 INSERT)
   ├─ 6. Track 데이터 저장 (없으면 INSERT)
   ├─ 7. 관계 테이블 업데이트 (track_artist, album_artist)
   ├─ 8. track_name 조회
   │   ├─ 존재하고 kor_name이 있으면 → 9번으로
   │   └─ 없거나 kor_name이 없으면
   │       ├─ 번역 API 호출
   │       └─ track_name INSERT/UPDATE
   ├─ 9. played 데이터 저장 (중복 체크)
   └─ 10. current.json 생성/업데이트
```

### 5.2 중복 데이터 처리 전략

**UPSERT 전략**
```sql
INSERT INTO artist (id, name, ...)
VALUES ($1, $2, ...)
ON CONFLICT (id)
DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = CURRENT_TIMESTAMP;
```

**played 테이블 중복 방지**
- UNIQUE constraint (track_id, played_at)
- INSERT IGNORE 또는 ON CONFLICT DO NOTHING 사용

## 6. current.json 파일 구조

### 6.1 파일 형식
```json
{
  "lastUpdated": "2025-11-18T12:20:42.950Z",
  "totalPlays": 1500,
  "tracks": [
    {
      "rank": 1,
      "trackId": "10ghh7XuPOiqW24K8HTu9r",
      "trackName": "Isn't That Good?",
      "trackNameKor": "그거 좋지 않아?",
      "artists": [
        {
          "id": "2UjX6FLGyUQb4sbookjR3y",
          "name": "YdBB"
        }
      ],
      "album": {
        "id": "7c37aX2hvJWplnEQ4zsCM6",
        "name": "GREAT SEOUL INVASION Semi Final",
        "imageUrl": "https://i.scdn.co/image/ab67616d0000b273fdf1cb70ec42c0d6b50bcec5"
      },
      "playCount": 45,
      "lastPlayed": "2025-11-18T12:20:42.950Z"
    }
  ]
}
```

### 6.2 생성 로직
- 매 데이터 수집 후 재생성
- 전체 재생 기록 집계 후 정렬
- 로컬 파일시스템 또는 S3에 저장

## 7. 구현 단계

### Phase 1: 기반 설정 (1-2일) ✅
- [x] Next.js 프로젝트 설정
- [x] Drizzle ORM 설정
- [x] Neon DB 연결
- [x] 환경 변수 설정

### Phase 2: 데이터베이스 구축 (1일) ✅
- [x] Drizzle 스키마 정의
- [x] 마이그레이션 실행
- [ ] 시드 데이터 (선택)

### Phase 3: API 개발 (2-3일)
- [ ] POST /api/v1/recently-played 엔드포인트
- [ ] 데이터 파싱 및 검증
- [ ] 비동기 처리 구현
- [ ] 중복 체크 로직

### Phase 4: 번역 기능 (1-2일)
- [ ] 번역 API 연동
- [ ] track_name 테이블 관리
- [ ] 캐싱 전략

### Phase 5: 파일 생성 (1일)
- [ ] current.json 생성 로직
- [ ] S3 업로드 (선택)

### Phase 6: 테스트 및 최적화 (2일)
- [ ] 단위 테스트
- [ ] 통합 테스트
- [ ] 성능 최적화

## 8. 보안 고려사항

### 8.1 API 보안
- API Key 또는 JWT 토큰 인증
- Rate limiting 구현
- CORS 설정

### 8.2 데이터 보안
- 환경 변수로 민감 정보 관리
- SQL Injection 방지 (Drizzle ORM 사용)
- XSS 방지

### 8.3 접근 제어
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const authToken = request.headers.get('authorization');

  if (!authToken || !validateToken(authToken)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
}
```

## 9. 성능 최적화

### 9.1 데이터베이스 최적화
- 인덱스 설정 (played_at, track_id)
- 배치 처리 (bulk insert)
- 연결 풀링

### 9.2 API 최적화
- 비동기 처리로 빠른 응답
- 트랜잭션 사용
- 쿼리 최적화

### 9.3 캐싱 전략
- track_name 한국어 번역 캐싱
- current.json CDN 캐싱
