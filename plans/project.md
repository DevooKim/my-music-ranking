# 목적

- 음악 차트를 보여주는 웹 애플리케이션

# 기술 스택
- Next.js
- Drizzle
- Neon
- S3

# 기능 요구사항

1. 데이터 수집 API 개발

## 데이터베이스
- played 테이블
- track 테이블
- artist 테이블
- album 테이블
- track_name 테이블
  - track_id (FK)
  - name
  - kor_name

## 1. 데이터 수집 API
- POST /api/v1/recently-played
  - 설명: 사용자가 최근에 재생한 음악 데이터를 수집합니다.
  - 요청 본문:
    ```json
    {
      "items": [
        {
          "track": {
            "album": {
              "album_type": "single",
              "artists": [
                {
                  "external_urls": {
                    "spotify": "https://open.spotify.com/artist/0LyfQWJT6nXafLPZqxe9Of"
                  },
                  "href": "https://api.spotify.com/v1/artists/0LyfQWJT6nXafLPZqxe9Of",
                  "id": "0LyfQWJT6nXafLPZqxe9Of",
                  "name": "Various Artists",
                  "type": "artist",
                  "uri": "spotify:artist:0LyfQWJT6nXafLPZqxe9Of"
                }
              ],
              "external_urls": {
                "spotify": "https://open.spotify.com/album/7c37aX2hvJWplnEQ4zsCM6"
              },
              "href": "https://api.spotify.com/v1/albums/7c37aX2hvJWplnEQ4zsCM6",
              "id": "7c37aX2hvJWplnEQ4zsCM6",
              "images": [
                {
                  "height": 640,
                  "url": "https://i.scdn.co/image/ab67616d0000b273fdf1cb70ec42c0d6b50bcec5",
                  "width": 640
                },
                {
                  "height": 300,
                  "url": "https://i.scdn.co/image/ab67616d00001e02fdf1cb70ec42c0d6b50bcec5",
                  "width": 300
                },
                {
                  "height": 64,
                  "url": "https://i.scdn.co/image/ab67616d00004851fdf1cb70ec42c0d6b50bcec5",
                  "width": 64
                }
              ],
              "name": "GREAT SEOUL INVASION Semi Final",
              "release_date": "2022-09-29",
              "release_date_precision": "day",
              "total_tracks": 5,
              "type": "album",
              "uri": "spotify:album:7c37aX2hvJWplnEQ4zsCM6"
            },
            "artists": [
              {
                "external_urls": {
                  "spotify": "https://open.spotify.com/artist/2UjX6FLGyUQb4sbookjR3y"
                },
                "href": "https://api.spotify.com/v1/artists/2UjX6FLGyUQb4sbookjR3y",
                "id": "2UjX6FLGyUQb4sbookjR3y",
                "name": "YdBB",
                "type": "artist",
                "uri": "spotify:artist:2UjX6FLGyUQb4sbookjR3y"
              }
            ],
            "disc_number": 1,
            "duration_ms": 212746,
            "explicit": false,
            "external_ids": {
              "isrc": "KRE892200094"
            },
            "external_urls": {
              "spotify": "https://open.spotify.com/track/10ghh7XuPOiqW24K8HTu9r"
            },
            "href": "https://api.spotify.com/v1/tracks/10ghh7XuPOiqW24K8HTu9r",
            "id": "10ghh7XuPOiqW24K8HTu9r",
            "is_local": false,
            "name": "Isn’t That Good?",
            "popularity": 45,
            "preview_url": null,
            "track_number": 4,
            "type": "track",
            "uri": "spotify:track:10ghh7XuPOiqW24K8HTu9r"
          },
          "played_at": "2025-11-18T12:20:42.950Z",
          "context": {
            "external_urls": {
              "spotify": "https://open.spotify.com/playlist/37i9dQZF1E4zyeOXcK1OJO"
            },
            "href": "https://api.spotify.com/v1/playlists/37i9dQZF1E4zyeOXcK1OJO",
            "type": "playlist",
            "uri": "spotify:playlist:37i9dQZF1E4zyeOXcK1OJO"
          }
        }
      ]
    }
    ```
  - 동작
    1. 응답을 보내고 비동기로 데이터를 처리합니다.
    2. track_name 테이블에서 track_id로 name과 kor_name을 조회합니다.
    3. kor_name이 없으면 외부 API를 호출하여 한국어 이름을 가져오고, track_name 테이블에 저장합니다.
    4. track, artist, album, played 테이블에 데이터를 저장합니다.
    5. 중복된 데이터는 저장하지 않습니다.
    6. current.json 파일로 가공된 데이터를 로컬에 저장합니다. (overwrite)