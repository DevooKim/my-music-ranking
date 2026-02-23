const SHELL_CACHE = "my-music-ranking-shell-v1";

const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/pwa-192.svg",
  "/pwa-512.svg",
  "/favicon.ico",
];

const cacheAsset = async (cache, asset) => {
  try {
    const response = await fetch(asset);
    if (!response.ok) {
      throw new Error(`${asset} ${response.status}`);
    }
    await cache.put(asset, response);
  } catch {
    return;
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(SHELL_ASSETS.map((asset) => cacheAsset(cache, asset)));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const fallback = await caches.match("/");
          return (
            fallback ||
            new Response("오프라인 상태입니다. 연결 상태를 확인해 주세요.", {
              status: 503,
              statusText: "Service Unavailable",
              headers: {
                "Content-Type": "text/plain; charset=UTF-8",
              },
            })
          );
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          if (!response || !response.ok) {
            return response;
          }

          const copy = response.clone();
          caches
            .open(SHELL_CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined);
          return response;
        })
        .catch(
          () =>
            new Response("오프라인 상태입니다. 연결 상태를 확인해 주세요.", {
              status: 503,
              statusText: "Service Unavailable",
              headers: {
                "Content-Type": "text/plain; charset=UTF-8",
              },
            }),
        );
    }),
  );
});
