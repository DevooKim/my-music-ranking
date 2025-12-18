## 원본 데이터
```json
"items": [
    {
      "track": {
        "album": {
          "album_type": "album",
          "artists": [
            {
              "external_urls": {
                "spotify": "https://open.spotify.com/artist/5wVJpXzuKV6Xj7Yhsf2uYx"
              },
              "href": "https://api.spotify.com/v1/artists/5wVJpXzuKV6Xj7Yhsf2uYx",
              "id": "5wVJpXzuKV6Xj7Yhsf2uYx",
              "name": "HANRORO",
              "type": "artist",
              "uri": "spotify:artist:5wVJpXzuKV6Xj7Yhsf2uYx"
            }
          ],
          "external_urls": {
            "spotify": "https://open.spotify.com/album/2DV7iVJ7L5DRQijgjyqLyQ"
          },
          "href": "https://api.spotify.com/v1/albums/2DV7iVJ7L5DRQijgjyqLyQ",
          "id": "2DV7iVJ7L5DRQijgjyqLyQ",
          "images": [
            {
              "height": 640,
              "url": "https://i.scdn.co/image/ab67616d0000b273afda752d5db59e06d3f86e3b",
              "width": 640
            },
            {
              "height": 300,
              "url": "https://i.scdn.co/image/ab67616d00001e02afda752d5db59e06d3f86e3b",
              "width": 300
            },
            {
              "height": 64,
              "url": "https://i.scdn.co/image/ab67616d00004851afda752d5db59e06d3f86e3b",
              "width": 64
            }
          ],
          "name": "JAMONG SALGU CLUB",
          "release_date": "2025-08-04",
          "release_date_precision": "day",
          "total_tracks": 7,
          "type": "album",
          "uri": "spotify:album:2DV7iVJ7L5DRQijgjyqLyQ"
        },
        "artists": [
          {
            "external_urls": {
              "spotify": "https://open.spotify.com/artist/5wVJpXzuKV6Xj7Yhsf2uYx"
            },
            "href": "https://api.spotify.com/v1/artists/5wVJpXzuKV6Xj7Yhsf2uYx",
            "id": "5wVJpXzuKV6Xj7Yhsf2uYx",
            "name": "HANRORO",
            "type": "artist",
            "uri": "spotify:artist:5wVJpXzuKV6Xj7Yhsf2uYx"
          }
        ],
        "disc_number": 1,
        "duration_ms": 192000,
        "explicit": false,
        "external_ids": {
          "isrc": "KRMIM2540757"
        },
        "external_urls": {
          "spotify": "https://open.spotify.com/track/3sOAwRg5esaxDcWnUigWPv"
        },
        "href": "https://api.spotify.com/v1/tracks/3sOAwRg5esaxDcWnUigWPv",
        "id": "3sOAwRg5esaxDcWnUigWPv",
        "is_local": false,
        "name": "0+0",
        "popularity": 49,
        "preview_url": null,
        "track_number": 4,
        "type": "track",
        "uri": "spotify:track:3sOAwRg5esaxDcWnUigWPv"
      },
      "played_at": "2025-09-17T12:26:02.395Z",
      "context": null
    }
]
```



```sh
curl --location 'https://api.spotify.com/v1/search?q=isrc%3AKRMIM2540757&type=track&limit=1&market=KR' \
--header 'accept-language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' \
--header 'Authorization: Bearer BQAJP31jeyPE0DBrO4KMo9mnvAnkMaC9GBxcmMC9mkgEzmyx_5wuWvDoIWL8UKzhJ4wO1px8Inzc2_MxQCNgGliwxI_BUPSmV1HX9CTBossc2OBkOZemDbzmJpXjIAAspFmmqbJOO3lW-U1UREdtGotoPAoReNVwLflZHd0ng5_MHJAwTc8nbMj2imkD-yjg0TSUTak-rzwWdh1GR-NONRh3UGFSgf5-ZxWolRI9qiS3hDRhdgvKG75r04g'
```

- `isrc` 코드로 트랙을 검색

## 신규 데이터
```json
{
    "tracks": {
        "href": "https://api.spotify.com/v1/search?offset=0&limit=1&query=isrc%3AKRMIM2540757&type=track&market=KR&locale=ko-KR,ko;q%3D0.9,en-US;q%3D0.8,en;q%3D0.7",
        "limit": 1,
        "next": null,
        "offset": 0,
        "previous": null,
        "total": 1,
        "items": [
            {
                "album": {
                    "album_type": "album",
                    "artists": [
                        {
                            "external_urls": {
                                "spotify": "https://open.spotify.com/artist/5wVJpXzuKV6Xj7Yhsf2uYx"
                            },
                            "href": "https://api.spotify.com/v1/artists/5wVJpXzuKV6Xj7Yhsf2uYx",
                            "id": "5wVJpXzuKV6Xj7Yhsf2uYx",
                            "name": "HANRORO",
                            "type": "artist",
                            "uri": "spotify:artist:5wVJpXzuKV6Xj7Yhsf2uYx"
                        }
                    ],
                    "external_urls": {
                        "spotify": "https://open.spotify.com/album/2DV7iVJ7L5DRQijgjyqLyQ"
                    },
                    "href": "https://api.spotify.com/v1/albums/2DV7iVJ7L5DRQijgjyqLyQ",
                    "id": "2DV7iVJ7L5DRQijgjyqLyQ",
                    "images": [
                        {
                            "height": 640,
                            "width": 640,
                            "url": "https://i.scdn.co/image/ab67616d0000b273afda752d5db59e06d3f86e3b"
                        },
                        {
                            "height": 300,
                            "width": 300,
                            "url": "https://i.scdn.co/image/ab67616d00001e02afda752d5db59e06d3f86e3b"
                        },
                        {
                            "height": 64,
                            "width": 64,
                            "url": "https://i.scdn.co/image/ab67616d00004851afda752d5db59e06d3f86e3b"
                        }
                    ],
                    "is_playable": true,
                    "name": "자몽살구클럽",
                    "release_date": "2025-08-04",
                    "release_date_precision": "day",
                    "total_tracks": 7,
                    "type": "album",
                    "uri": "spotify:album:2DV7iVJ7L5DRQijgjyqLyQ"
                },
                "artists": [
                    {
                        "external_urls": {
                            "spotify": "https://open.spotify.com/artist/5wVJpXzuKV6Xj7Yhsf2uYx"
                        },
                        "href": "https://api.spotify.com/v1/artists/5wVJpXzuKV6Xj7Yhsf2uYx",
                        "id": "5wVJpXzuKV6Xj7Yhsf2uYx",
                        "name": "HANRORO",
                        "type": "artist",
                        "uri": "spotify:artist:5wVJpXzuKV6Xj7Yhsf2uYx"
                    }
                ],
                "disc_number": 1,
                "duration_ms": 192000,
                "explicit": false,
                "external_ids": {
                    "isrc": "KRMIM2540757"
                },
                "external_urls": {
                    "spotify": "https://open.spotify.com/track/3sOAwRg5esaxDcWnUigWPv"
                },
                "href": "https://api.spotify.com/v1/tracks/3sOAwRg5esaxDcWnUigWPv",
                "id": "3sOAwRg5esaxDcWnUigWPv",
                "is_local": false,
                "is_playable": true,
                "name": "0+0",
                "popularity": 64,
                "preview_url": null,
                "track_number": 4,
                "type": "track",
                "uri": "spotify:track:3sOAwRg5esaxDcWnUigWPv"
            }
        ]
    }
}
```

- 원본에서 album.artists, album.name, artists, name을 신규 데이터로 교체
- isrc를 기준으로 메모리에 캐싱하여 중복 호출 방지