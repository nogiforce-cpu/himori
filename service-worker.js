const CACHE = 'himori-v60';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/state.js',
  './js/store.js',
  './js/backup.js',
  './js/derive.js',
  './js/weather.js',
  './js/weather-v2-flag.js',
  './js/amedas.js',
  './js/fireSite.js',
  './js/date-utils.js',
  './js/onboarding.js',
  './js/jma.js',
  './js/photos.js',
  './js/render/home.js',
  './js/render/shelves.js',
  './js/render/check.js',
  './js/render/review.js',
  './js/render/album.js',
  './js/render/settings.js',
  './js/render/sheets.js',
  './js/render/event-row.js',
  './js/render/calendar.js',
  './js/render/season-review.js',
  './assets/logo-badge.svg',
  './assets/logo-icon-square.svg',
  './assets/icon-axe.png',
  './assets/icon-woodtype.png',
  './assets/sample-woodshelf-1.jpg',
  './assets/sample-woodshelf-2.jpg',
  './assets/sample-woodshelf-3.jpg',
  './assets/sample-stove.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

// Precache the complete release; a failed fetch keeps the old worker active.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
  }));
});
self.addEventListener('message', (e) => {
  if (e.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('himori-') && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
// Serve the installed release as a set, including while the network is flaky.
// A new release is fetched only by the next worker's install, never file by file.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  const relative = './' + url.pathname.slice(new URL('./', self.location.href).pathname.length);
  const asset = e.request.mode === 'navigate' ? './index.html' : ASSETS.includes(relative) ? relative : null;
  if (!asset) return;
  e.respondWith(caches.open(CACHE).then(async (cache) =>
    (await cache.match(asset)) || Response.error()
  ));
});
