// SM home dekor – offline működés
// Az app saját fájljai: hálózat először, offline a mentett másolat.
// CDN könyvtárak és betűtípusok: mentett másolat először.
// Supabase (adatok, belépés, dokumentumok): mindig hálózat, sosem kerül gyorsítótárba.
const CACHE = "smhd-v2.2.0";
const SHELL = [
  "/", "/index.html", "/app.js", "/config.js", "/manifest.webmanifest",
  "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/favicon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("/index.html") : Response.error())))
    );
    return;
  }

  const cdn = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
  if (cdn.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }))
    );
  }
});
