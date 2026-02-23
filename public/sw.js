const SHELL_CACHE = "my-music-ranking-shell-v1";

const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.svg",
  "/icon-512.svg",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
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
        .catch(async () => caches.match("/")),
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
