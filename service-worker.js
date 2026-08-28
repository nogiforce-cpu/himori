const CACHE = 'himori-v59';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/state.js',
  './js/store.js',
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

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先: オンラインなら常に最新のファイル一式を取りに行き、取得できたらキャッシュを更新する。
// 取得できた時だけキャッシュを差し替えるので、HTML・JSが新旧混ざったまま配信されることがない。
// オフライン時のみキャッシュにフォールバックする(以前はキャッシュ優先だったため、更新後に
// 新旧ファイルが混ざって画面が真っ白になる不具合があった)。
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) {
    return; // 天気・位置情報APIは常にネットワークへ(キャッシュ対象外)
  }
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
