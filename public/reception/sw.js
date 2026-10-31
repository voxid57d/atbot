// Cache only the public reception shell and hashed assets; never cache API responses or QR data.
const CACHE = "ielts-zone-reception-v6";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const response = await fetch("/reception/", { cache: "reload" });
      if (!response.ok) throw new Error("Reception shell unavailable");
      const html = await response.clone().text(),
        cache = await caches.open(CACHE);
      await cache.put("/reception/", response);
      const paths = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g),
      ].map((v) => v[1]);
      await cache.addAll([
        ...new Set(paths),
        "/reception/icon.svg",
        "/reception/icon-192.png",
        "/reception/icon-512.png",
        "/brand/ielts-zone-logo.svg",
      ]);
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (
          (name.startsWith("atbot-reception-") ||
            name.startsWith("ielts-zone-reception-")) &&
          name !== CACHE
        )
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (
    event.request.mode === "navigate" &&
    url.pathname.startsWith("/reception/")
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/reception/")),
    );
    return;
  }
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/reception/icon.svg" ||
    url.pathname === "/reception/icon-192.png" ||
    url.pathname === "/reception/icon-512.png" ||
    url.pathname === "/brand/ielts-zone-logo.svg"
  )
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
});
