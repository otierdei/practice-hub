// Practice Hub Service Worker: App Dateien offline, API nie aus dem Cache
const CACHE = 'ph-v32';
const FILES = ['./', 'index.html', 'datenschutz.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png', 'notation.js?v=32', 'guitar.js?v=32', 'fonts/young-serif.woff2', 'fonts/figtree.woff2', 'samples/bd.mp3', 'samples/sn.mp3', 'samples/t1.mp3', 'samples/t2.mp3', 'samples/ft.mp3', 'samples/cr.mp3', 'samples/hh.mp3', 'samples/ho.mp3', 'samples/rd.mp3'];
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
