// Caché básica para que la app abra sin cobertura (túneles, zonas sin red).
const CACHE = 'ais-cabina-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine.js', 'sim.js', 'scheme.js', 'demo.js', 'manifest.json', 'icon-192.png',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname.includes('renfe.com') || u.hostname.includes('overpass')) return; // datos en vivo, nunca de caché
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (u.origin === location.origin || u.hostname === 'unpkg.com')) { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
