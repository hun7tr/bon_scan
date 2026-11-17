/* Offline: App-Dateien werden beim Installieren gespeichert. Mit Verbindung kommt die neueste Fassung, sonst die gespeicherte.
   Die Texterkennung (vendor/ bzw. CDN) ändert sich nicht und wird immer aus dem Speicher geladen, sobald sie einmal da ist. */
const CACHE = 'bon-scan-v1';
const OCR_CACHE = 'bon-scan-ocr-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'data.js', 'parser.js', 'ocr.js', 'changelog.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    // Texterkennung vorab laden, wenn sie im Repository liegt
    try {
      const r = await fetch('vendor/files.json', { cache: 'no-store' });
      if (r.ok) {
        const files = await r.json();
        const oc = await caches.open(OCR_CACHE);
        for (const f of files) { if (!(await oc.match(f))) { try { await oc.add(f); } catch (err) {} } }
      }
    } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ocr = url.pathname.includes('/vendor/') || url.hostname === 'cdn.jsdelivr.net';
  if (ocr) {
    e.respondWith((async () => {
      const oc = await caches.open(OCR_CACHE);
      const hit = await oc.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) oc.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : undefined);
    const fresh = (req.mode === 'navigate' ? fetch(req) : fetch(req.url, { cache: 'no-cache' })).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    if (!cached) return fresh;
    const quick = await Promise.race([fresh.catch(() => null), new Promise(r => setTimeout(() => r(null), 2500))]);
    return quick && quick.ok ? quick : cached;
  })());
});
