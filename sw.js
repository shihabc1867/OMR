// Service worker: works offline, but always tries the network first so updates show up at once
const V = 'omr-v17';
const FILES = ['./', 'index.html', 'app.js', 'omr-core.js', 'live.js', 'paper.js', 'report.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's HTTP cache (GitHub Pages keeps files for 10 minutes)
  e.waitUntil(caches.open(V).then(c => Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'reload' })).then(r => { if (r.ok) return c.put(f, r); }).catch(() => { })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return; // Apps Script calls are never cached
  e.respondWith(caches.open(V).then(c =>
    fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok) c.put(r, res.clone()); return res; })
      .catch(() => c.match(r, { ignoreSearch: true }).then(hit => hit || Response.error()))
  ));
});
