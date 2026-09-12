const CACHE_PREFIX = "centauri-journey-calculator";
const CACHE_VERSION = "dev";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const PRECACHE_ASSETS = [];
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/service-worker.js",
  ...PRECACHE_ASSETS,
];

async function cacheResponse(cache, request, response) {
  if (!response.ok) {
    throw new Error(`The local asset ${request} returned HTTP ${response.status}.`);
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  await cache.put(
    request,
    new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

async function precache(cache, request) {
  await cacheResponse(cache, request, await fetch(request, { cache: "no-store" }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.all([...new Set(SHELL)].map((request) => precache(cache, request))))
      .then(() => self.skipWaiting())
      .catch(async (error) => {
        await caches.delete(CACHE_NAME);
        throw error;
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  ) {
    return;
  }
  event.respondWith(
    caches.match(event.request.url).then((cached) => {
      if (cached !== undefined) {
        return cached;
      }
      return fetch(event.request)
        .then(async (response) => {
          if (response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cacheResponse(cache, event.request, response.clone());
            } catch {
              // A non-cacheable development response must not break the local calculator.
            }
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request.url).then((cached) => {
            if (cached !== undefined) {
              return cached;
            }
            if (event.request.mode === "navigate") {
              return caches.match("/");
            }
            throw new Error("The requested local asset is not cached.");
          });
        });
    }),
  );
});
