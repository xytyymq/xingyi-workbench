/* 星羿赛事App Service Worker — 离线缓存，可装 PWA */
const CACHE = 'xingyi-match-v1';
const ASSETS = [
  'index.html', 'shared.css', 'award.js',
  'brawl.html', 'brawl/engine.js', 'brawl/app.js',
  'doubleswiss.html', 'doubleswiss/engine.js', 'doubleswiss/app.js',
  'octa.html', 'octa/engine.js', 'octa/app.js',
  'team.html', 'team/engine.js', 'team/app.js', 'team/award.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    const copy = resp.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return resp;
  }).catch(() => caches.match('index.html'))));
});
