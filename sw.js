const CACHE_VERSION = "lokx-shell-v8";
const RUNTIME_CACHE = "lokx-runtime-v8";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./resultado.html",
  "./cameras.html",
  "./styles.css",
  "./resultado.css",
  "./resultado-mode.css",
  "./cameras.css",
  "./app.js",
  "./scanner.js",
  "./analysis-engine.js",
  "./resultado.js",
  "./cameras.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./assets/favicon.svg",
  "./assets/home-collage.webp",
  "./assets/loading-collage.webp",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => ![CACHE_VERSION, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          return (await caches.match(request)) || (await caches.match("./index.html"));
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const shouldCache = /\.(?:js|mjs|css|png|svg|webp|wasm|task|json|webmanifest)$/i.test(url.pathname);
          if (shouldCache) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
        }
        return response;
      });
    }),
  );
});
