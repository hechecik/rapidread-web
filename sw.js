/* hechecik — service worker (çevrimdışı kullanım)
   Sürüm değiştiğinde VERSION'ı artırın; eski önbellek silinir. */
const VERSION = 'hechecik-v12';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './stt-worker.js'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
];
// CDN'den gelen her şey (ffmpeg çekirdeği dahil) ilk kullanımda önbelleğe alınır
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.sheetjs.com', 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    // Kütüphaneler: biri başarısız olursa kurulum bozulmasın
    await Promise.allSettled(LIBS.map(async u => {
      const r = await fetch(u, { mode: 'cors' });
      if (r.ok) await c.put(u, r);
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Sayfanın kendisi ve işçi dosyası: önce ağ (güncel sürüm), ağ yoksa önbellek.
  // stt-worker.js istisnası kritik: cache-first olsaydı eski worker sonsuza kadar
  // servis edilir, düzeltmeler canlıya hiç ulaşmazdı.
  const isPage = req.mode === 'navigate' || (url.origin === location.origin && url.pathname.endsWith('.html'));
  const isWorker = url.origin === location.origin && url.pathname.endsWith('stt-worker.js');
  if (isPage || isWorker) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(VERSION);
        c.put(isWorker ? './stt-worker.js' : './index.html', r.clone());
        return r;
      } catch (_) {
        return (await caches.match(isWorker ? './stt-worker.js' : './index.html')) || Response.error();
      }
    })());
    return;
  }

  // Aynı köken statik dosyalar ve CDN: önce önbellek, yoksa ağdan al + sakla
  if (url.origin === location.origin || CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true });
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') {
        const c = await caches.open(VERSION); c.put(req, r.clone());
      }
      return r;
    })());
  }
});
