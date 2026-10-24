// Egyszerű offline gyorsítótár az app vázához. Az adatokat a Firebase saját offline tárolója kezeli.
const CACHE = 'medve-v5.72.1';
const SHELL = ['./', './?src=medve', './index.html', './manifest.webmanifest', './firebase-config.js', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './icon-maskable.png', './badge-96.png', './boot-guard.js'];
const CDN = 'medve-cdn'; // v5.61: a Firebase-könyvtár (gstatic) másolata – hálózat nélküli induláshoz; frissítéskor NEM törlődik
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const FBLIBS = ['firebase-app', 'firebase-auth', 'firebase-firestore', 'firebase-functions', 'firebase-messaging'].map(n => FBV + n + '.js');
const LKG = 'medve-lkg'; // utolsó működő verziók (az app menti) – frissítéskor NEM törlődik

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}),
    caches.open(CDN).then(c => Promise.all(FBLIBS.map(u => c.add(u).catch(() => {})))).catch(() => {})
  ]));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== LKG && k !== CDN).map(k => caches.delete(k)))));
  self.clients.claim();
  e.waitUntil(trimOld());
});
// Hálózat először (mindig a friss verzió), hálózat nélkül a tárolt példány.
// Helyi verzió-visszaállítás: ha a felhasználó / admin rögzített egy korábbi működő verziót, az oldalt abból szolgáljuk ki.
async function pinnedPage(url) {
  try { const c = await caches.open(LKG);
    // v5.65.0: ha a cím tartalmazza az ?unpin=1 paramétert, a rögzítés (régi verzióhoz kötés) megszűnik
    if (url && url.search.indexOf('unpin=1') >= 0) { await c.delete('./__pin'); return null; }
    const p = await c.match('./__pin'); if (!p) return null; const v = (await p.text()).trim(); return await c.match('./__lkg/' + v) || null; } catch (x) { return null; }
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // v5.61: a Firebase-könyvtár (verziózott, változatlan fájlok) – tárolt példány először, ha nincs, hálózat és eltárolás
  if (e.request.method === 'GET' && url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(caches.open(CDN).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r && r.ok) { try { c.put(e.request, r.clone()); } catch (x) {} }
      return r;
    }));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/__lkg/') >= 0 || url.pathname.endsWith('/__pin') || url.search.includes('lkg=')) return;
  const isPage = e.request.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) && !url.search.includes('lkg=');
  if (isPage) {
    e.respondWith(pinnedPage(url).then(p => p || fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
// Azonnali értesítés (push) – akkor is, ha az app be van zárva.
// iPhone/iPad (Safari): MINDEN pushnál kötelező értesítést mutatni, különben az iOS pár után visszavonja a feliratkozást.
// Android: ha az app éppen előtérben van, ott jelez magától (rezgés + hang), nem dupláz.
const APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Android/.test(self.navigator.userAgent);
// v5.65.2: a régi / lejárt értesítések automatikusan eltűnnek az értesítési sávból (és a jelvény-számláló is helyesen mutat)
// Üzenet: 12 óra, utasítás: 3 nap; ha a push tartalmaz lejáratot (exp), az számít.
const NTF_AGE = { chat: 12 * 3600e3, cmd: 3 * 24 * 3600e3 };
async function trimOld() {
  try {
    const now = Date.now(); const list = await self.registration.getNotifications();
    list.forEach(n => {
      const cmd = (n.tag || '').indexOf('medve-cmd-') === 0;
      const exp = n.data && n.data.exp ? Number(n.data.exp) : 0;
      if ((exp && exp < now) || now - (n.timestamp || now) > (cmd ? NTF_AGE.cmd : NTF_AGE.chat)) { try { n.close(); } catch (x) {} }
    });
  } catch (x) {}
}
async function badgeSync() {
  try { await trimOld(); const n = (await self.registration.getNotifications()).length;
    if (self.navigator.setAppBadge) { n ? await self.navigator.setAppBadge(n) : await self.navigator.clearAppBadge(); } } catch (x) {}
}
self.addEventListener('push', e => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (x) { p = {}; }
  const d = p.data || p || {};
  const cmd = d.cmd === '1';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const front = list.find(c => c.visibilityState === 'visible' && c.focused);
    if (front && !APPLE) { try { front.postMessage({ medve: 'push', cmd }); } catch (x) {} return; }
    await trimOld();
    await self.registration.showNotification(d.title || 'M.E.D.V.E.', {
      body: d.body || 'Új üzenet', icon: './icon-192.png', badge: './badge-96.png',
      tag: cmd ? 'medve-cmd-' + Date.now() : (d.tag || 'medve-chat'), renotify: true, requireInteraction: cmd,
      vibrate: cmd ? [400, 150, 400, 150, 400] : [250, 100, 250], silent: false, timestamp: Date.now(),
      data: { url: d.url || './?v=uzenet', exp: d.exp ? Number(d.exp) : 0 }
    });
    await badgeSync();
  })());
});
// Értesítésre koppintva: a megnyitott app előtérbe hozása, vagy megnyitása.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    await badgeSync();
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = (e.notification.data && e.notification.data.url) || './';
    for (const c of list) { if ('focus' in c) { try { c.postMessage({ medve: 'open', url }); } catch (x) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
self.addEventListener('notificationclose', e => { e.waitUntil(badgeSync()); });
self.addEventListener('message', e => {
  if (e.data && e.data.medve === 'seen') e.waitUntil((async () => {
    (await self.registration.getNotifications()).forEach(n => n.close()); await badgeSync(); })());
});
