// SM home dekor Planner – offline működés.
// - Az app váza (saját fájlok): hálózat először, net nélkül a tárolt példány.
// - Külső könyvtárak (Supabase, betűtípusok, QR, HEIC-átalakító, termékfelismerő): tárolt példány azonnal,
//   háttérben frissítve. Így net nélkül is elindul az app.
// - A termékfotók bélyegképeit és a felismerő modellt az app maga tárolja (smhd-thumbs, transformers-cache),
//   ezeket frissítéskor sem töröljük.
const CACHE = 'smhd-shell-v2.9.0';
const CDN = 'smhd-cdn-v1';
const KEEP = [CACHE, CDN, 'smhd-thumbs'];
const SHELL = ['/', '/index.html', '/app.js', '/config.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const CDN_PRELOAD = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))),
    caches.open(CDN).then(c => Promise.all(CDN_PRELOAD.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {}))))
  ]));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  // régi app-verziók (és a tévedésből ide került M.E.D.V.E. példány) törlése; a fotó- és modell-tár marad
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP.includes(k) && !k.startsWith('transformers')).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(CDN).then(async c => {
      const hit = await c.match(req, { ignoreVary: true });
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => {}); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return; // Supabase hívásai nem érintettek
  e.respondWith(
    fetch(req)
      .then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('/index.html') : undefined)))
  );
});
