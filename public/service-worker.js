const CACHE_NAME = "bert-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/bert-icon.svg", "/bert-maskable-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Avoid caching opaque/error bodies; never treat a failed chunk as a cache hit later.
        if (response && response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }
          // Never serve the HTML shell for script/style/font/etc. — that MIME mismatch breaks the app (blank screen).
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
          return Response.error();
        }),
      ),
  );
});
