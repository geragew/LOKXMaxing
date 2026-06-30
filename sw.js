const CACHE_VERSION = "lokx-shell-v13";
const RUNTIME_CACHE = "lokx-static-v13";
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
  "./neck-analysis.js",
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
  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.replace(/^\/+/, "");

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(async () => {
          const safeFallbacks = new Map([
            ["resultado.html", "./resultado.html"],
            ["cameras.html", "./cameras.html"],
          ]);
          const fallback = safeFallbacks.get(relativePath) || "./index.html";
          return caches.match(fallback);
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const isBiometricPath = /^(?:uploads|captures|recordings|reports|exports)(?:\/|$)/i.test(relativePath);
          const isStaticAsset = /^assets\//i.test(relativePath)
            && /\.(?:js|mjs|png|svg|webp|wasm|task|tflite)$/i.test(relativePath);
          const shouldCache = !isBiometricPath && isStaticAsset;
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
