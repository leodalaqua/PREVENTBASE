/* PreventBase service worker. API e páginas nunca são servidas do cache (dados legais sempre online);
   só assets estáticos versionados e a página offline. Trocar VERSION ao mudar a lista PRECACHE. */
const VERSION = "v3";
const PRECACHE = `preventbase-precache-${VERSION}`;
const STATIC = `preventbase-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/favicon-32.png", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/brand/mark.png", "/brand/wordmark.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PRECACHE).then((c) => c.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, STATIC]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(STATIC).then((c) => c.put(request, copy));
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return (await event.preloadResponse) || (await fetch(request));
        } catch {
          return (await caches.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (/\.(?:png|svg|ico|webp|jpg|jpeg|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(staleWhileRevalidate(request));
  }
});
