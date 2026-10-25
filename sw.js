// SM home dekor Planner – egyszerű offline gyorsítótár az app vázához (hálózat először).
// Az adatokat a Supabase és az app saját helyi tárolója kezeli, azokat itt nem tároljuk.
const CACHE = 'smhd-shell-v2.3.1';
const SHELL = ['/', '/index.html', '/app.js', '/config.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  // minden más gyorsítótár törlése (a régi, tévedésből ide került M.E.D.V.E. példányé is)
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // a Supabase hívásai nem érintettek
  e.respondWith(
    fetch(req)
      .then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('/index.html') : undefined)))
  );
});
