// Practice Hub Service Worker: App Dateien offline, API nie aus dem Cache
const CACHE = 'ph-v123';
const FILES = ['./', 'index.html', 'datenschutz.html', 'notenspiel.html', 'notenwerte.html', 'hoerspiel.html', 'taktspiel.html', 'songform.html', 'game-audio.js?v=2', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png', 'notation.js?v=123', 'guitar.js?v=123', 'roadmap.js?v=123', 'progress.js?v=123', 'transpose.js?v=123', 'fonts/young-serif.woff2', 'fonts/figtree.woff2', 'samples/bd.mp3?v=123', 'samples/sn.mp3?v=123', 'samples/t1.mp3?v=123', 'samples/t2.mp3?v=123', 'samples/ft.mp3?v=123', 'samples/cr.mp3?v=123', 'samples/hh.mp3?v=123', 'samples/ho.mp3?v=123', 'samples/rd.mp3?v=123'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Seite: erst Netz (damit Updates sofort ankommen), sonst Cache
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('index.html', c)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
// Push an Oti (18.11.2026): Meldung zeigen, Antippen öffnet die Akte des Schülers
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Practice Hub', { body: d.body || '', tag: d.tag || undefined, icon: 'icon-512.png', badge: 'icon-180.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { c.postMessage({ type: 'open', url }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
