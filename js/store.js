// himori.* localStorageの薄いCRUDラッパー + 初回シード

const KEYS = {
  profile: 'himori.profile',
  shelves: 'himori.shelves',
  checks: 'himori.checks',
  burnLogs: 'himori.burnLogs',
  woodAdditions: 'himori.woodAdditions',
  photos: 'himori.photos',
  weatherCache: 'himori.weatherCache',
  splitLogs: 'himori.splitLogs',
  anshinHistory: 'himori.anshinHistory',
  maintenanceLogs: 'himori.maintenanceLogs',
  seasons: 'himori.seasons',
  woodTypeCatalog: 'himori.woodTypeCatalog',
  weatherHistory: 'himori.weatherHistory',
};

function readJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

// ---- 初回シード(相対日付で生成し、常に「今開いた」感を保つ) ----
function seedIfEmpty() {
  if (localStorage.getItem(KEYS.profile) != null) return;

  const profile = {
    userName: 'ゲスト',
    stove: { name: 'Jøtul F 400', purchaseDate: daysAgo(365 * 4), catalystReplacedAt: null },
    unit: 'm3',
    safetyLineM3: 2.2,
    seasonTargetM3: 4.6,
    mainShelfId: 'shelf-1',
    notificationsEnabled: false,
    theme: 'dark',
    postalCode: null,
    location: null,
    nextChimneyCleaning: null,
  };

  const shelves = [
    {
      id: 'shelf-1', name: '第1薪棚(メイン)', status: '乾燥済み',
      remainingPercent: 70, usableVolumeM3: 1.8, totalVolumeM3: 2.6,
      lastCheckedAt: daysAgo(6), dryingStartedAt: daysAgo(330),
      estimatedDaysLeft: 38, woodTypes: ['広葉樹(ミックス)'], photoIds: ['photo-sample-1'],
    },
    {
      id: 'shelf-2', name: '第2薪棚(北側)', status: '乾燥中',
      remainingPercent: 40, usableVolumeM3: 0.8, totalVolumeM3: 2.0,
      lastCheckedAt: daysAgo(3), dryingStartedAt: daysAgo(120),
      estimatedDaysLeft: 18, woodTypes: ['針葉樹'], photoIds: ['photo-sample-2'],
    },
    {
      id: 'shelf-3', name: '南側薪棚(来季用)', status: '来季用',
      remainingPercent: 65, usableVolumeM3: 1.2, totalVolumeM3: 1.8,
      lastCheckedAt: daysAgo(7), dryingStartedAt: daysAgo(160),
      estimatedDaysLeft: 90, woodTypes: ['広葉樹(ミックス)'], photoIds: ['photo-sample-3'],
    },
    {
      id: 'shelf-4', name: '薪小屋(予備)', status: '乾燥中',
      remainingPercent: 30, usableVolumeM3: 0.6, totalVolumeM3: 2.0,
      lastCheckedAt: daysAgo(10), dryingStartedAt: daysAgo(240),
      estimatedDaysLeft: 14, woodTypes: ['広葉樹(ミックス)', '針葉樹'], photoIds: [],
    },
  ];

  const samplePhotos = [
    { id: 'photo-sample-1', category: '薪棚', date: daysAgo(6), uri: 'assets/sample-woodshelf-1.jpg' },
    { id: 'photo-sample-2', category: '薪棚', date: daysAgo(3), uri: 'assets/sample-woodshelf-2.jpg' },
    { id: 'photo-sample-3', category: '薪棚', date: daysAgo(7), uri: 'assets/sample-woodshelf-3.jpg' },
    { id: 'photo-sample-stove', category: 'ストーブ', date: daysAgo(30), uri: 'assets/sample-stove.jpg' },
  ];

  const checks = [
    {
      id: 'check-001', shelfId: 'shelf-1', date: daysAgo(6),
      remainingPercent: 70, usableVolumeM3: 1.8,
      items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' },
      moisturePercent: null, memo: '',
    },
    {
      id: 'check-002', shelfId: 'shelf-1', date: daysAgo(12),
      remainingPercent: 75, usableVolumeM3: 2.0,
      items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' },
      moisturePercent: 18, memo: '',
    },
    {
      id: 'check-003', shelfId: 'shelf-1', date: daysAgo(19),
      remainingPercent: 80, usableVolumeM3: 2.1,
      items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' },
      moisturePercent: 19, memo: '',
    },
  ];

  const burnLogs = [
    { id: 'burn-001', date: daysAgo(3), shelfId: 'shelf-1', note: '' },
    { id: 'burn-002', date: daysAgo(0), shelfId: 'shelf-1', note: '' },
  ];

  const woodAdditions = [
    {
      id: 'add-001', shelfId: 'shelf-1', date: daysAgo(2),
      addedVolumeM3: 0.8, woodType: '広葉樹(ミックス)',
      memo: '週末に薪を補充しました。', photoId: null,
    },
  ];

  const seasons = [{ id: 'season-1', startDate: daysAgo(150), endDate: null }];
  const maintenanceLogs = [
    { id: 'maint-001', date: daysAgo(200), type: '煙突掃除', memo: '' },
  ];
  const woodTypeCatalog = ['広葉樹(ミックス)', '針葉樹'];

  writeJSON(KEYS.profile, profile);
  writeJSON(KEYS.shelves, shelves);
  writeJSON(KEYS.checks, checks);
  writeJSON(KEYS.burnLogs, burnLogs);
  writeJSON(KEYS.woodAdditions, woodAdditions);
  writeJSON(KEYS.photos, samplePhotos);
  writeJSON(KEYS.weatherCache, null);
  writeJSON(KEYS.splitLogs, []);
  writeJSON(KEYS.anshinHistory, []);
  writeJSON(KEYS.maintenanceLogs, maintenanceLogs);
  writeJSON(KEYS.seasons, seasons);
  writeJSON(KEYS.woodTypeCatalog, woodTypeCatalog);
}

// 既存ユーザーが以前のバージョンのデータを持っている場合に、新しいフィールドを
// 壊さず補完する(データを消さずにアップデートを受け取れるようにするための移行処理)
const PROFILE_DEFAULTS = { mainShelfId: null, seasonTargetM3: 4.6 };
function migrateProfile(profile) {
  if (!profile) return profile;
  const missingKeys = Object.keys(PROFILE_DEFAULTS).filter((k) => !(k in profile));
  if (missingKeys.length === 0) return profile;
  const patched = { ...profile };
  missingKeys.forEach((k) => {
    patched[k] = PROFILE_DEFAULTS[k];
  });
  writeJSON(KEYS.profile, patched);
  return patched;
}

function migrateWoodTypeCatalog() {
  if (localStorage.getItem(KEYS.woodTypeCatalog) != null) return;
  const shelves = readJSON(KEYS.shelves, []);
  const additions = readJSON(KEYS.woodAdditions, []);
  const names = new Set();
  shelves.forEach((s) => (s.woodTypes || []).forEach((w) => names.add(w)));
  additions.forEach((a) => a.woodType && names.add(a.woodType));
  writeJSON(KEYS.woodTypeCatalog, Array.from(names));
}

// ---- Profile ----
export function getProfile() {
  migrateWoodTypeCatalog();
  return migrateProfile(readJSON(KEYS.profile, null));
}
export function setProfile(profile) {
  writeJSON(KEYS.profile, profile);
}
export function updateProfile(patch) {
  const p = getProfile();
  const next = { ...p, ...patch };
  setProfile(next);
  return next;
}

// ---- Shelves ----
export function getShelves() {
  return readJSON(KEYS.shelves, []);
}
export function setShelves(shelves) {
  writeJSON(KEYS.shelves, shelves);
}
export function getShelf(id) {
  return getShelves().find((s) => s.id === id) || null;
}
export function updateShelf(id, patch) {
  const shelves = getShelves();
  const idx = shelves.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  shelves[idx] = { ...shelves[idx], ...patch };
  setShelves(shelves);
  return shelves[idx];
}

// ---- Checks ----
export function getChecks() {
  return readJSON(KEYS.checks, []);
}
export function getChecksForShelf(shelfId) {
  return getChecks()
    .filter((c) => c.shelfId === shelfId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
export function addCheck(check) {
  const checks = getChecks();
  const record = { id: uid('check'), ...check };
  checks.unshift(record);
  writeJSON(KEYS.checks, checks);
  return record;
}

// ---- Burn logs ----
export function getBurnLogs() {
  return readJSON(KEYS.burnLogs, []);
}
export function addBurnLog(log) {
  const logs = getBurnLogs();
  const record = { id: uid('burn'), note: '', ...log };
  logs.unshift(record);
  writeJSON(KEYS.burnLogs, logs);
  return record;
}
export function updateBurnLog(id, patch) {
  const logs = getBurnLogs();
  const idx = logs.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  logs[idx] = { ...logs[idx], ...patch };
  writeJSON(KEYS.burnLogs, logs);
  return logs[idx];
}
export function removeBurnLog(id) {
  writeJSON(KEYS.burnLogs, getBurnLogs().filter((l) => l.id !== id));
}

// ---- Wood additions ----
export function getWoodAdditions() {
  return readJSON(KEYS.woodAdditions, []);
}
export function addWoodAddition(entry) {
  const list = getWoodAdditions();
  const record = { id: uid('add'), ...entry };
  list.unshift(record);
  writeJSON(KEYS.woodAdditions, list);
  return record;
}

// ---- Photos ----
export function getPhotos() {
  return readJSON(KEYS.photos, []);
}
export function addPhoto(photo) {
  const list = getPhotos();
  const record = { id: uid('photo'), ...photo };
  list.unshift(record);
  writeJSON(KEYS.photos, list);
  return record;
}
export function deletePhoto(id) {
  writeJSON(KEYS.photos, getPhotos().filter((p) => p.id !== id));
}

// ---- Weather cache ----
export function getWeatherCache() {
  return readJSON(KEYS.weatherCache, null);
}
export function setWeatherCache(cache) {
  writeJSON(KEYS.weatherCache, cache);
}

// ---- 実際の気温の記録(遡って取得はできないため、取得できた日から積み上げる) ----
export function getWeatherHistory() {
  return readJSON(KEYS.weatherHistory, []);
}
export function recordWeatherHistoryToday(todayWeather) {
  const list = getWeatherHistory();
  const idx = list.findIndex((e) => e.date === todayWeather.date);
  const entry = {
    date: todayWeather.date,
    tempMin: Math.round(todayWeather.tempMin),
    tempMax: Math.round(todayWeather.tempMax),
  };
  if (idx === -1) list.push(entry);
  else list[idx] = entry;
  writeJSON(KEYS.weatherHistory, list);
}

// ---- Split logs(薪割り記録) ----
export function getSplitLogs() {
  return readJSON(KEYS.splitLogs, []);
}
export function addSplitLog(entry) {
  const list = getSplitLogs();
  const record = { id: uid('split'), ...entry };
  list.unshift(record);
  writeJSON(KEYS.splitLogs, list);
  return record;
}

// ---- Anshin history(安心度スナップショットのキャッシュ) ----
export function getAnshinHistory() {
  return readJSON(KEYS.anshinHistory, []);
}
export function pushAnshinSnapshot(score) {
  const list = getAnshinHistory();
  const today = isoDate(new Date());
  const idx = list.findIndex((e) => e.date === today);
  if (idx === -1) {
    list.push({ date: today, score });
  } else {
    list[idx] = { date: today, score };
  }
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  writeJSON(KEYS.anshinHistory, list);
}

// ---- メンテナンス記録(煙突掃除・ガスケット交換・触媒交換・サビ取り等) ----
export function getMaintenanceLogs() {
  return readJSON(KEYS.maintenanceLogs, []);
}
export function addMaintenanceLog(entry) {
  const list = getMaintenanceLogs();
  const record = { id: uid('maint'), memo: '', ...entry };
  list.unshift(record);
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  writeJSON(KEYS.maintenanceLogs, list);
  return record;
}

// ---- シーズン(火入れ期間) ----
export function getSeasons() {
  return readJSON(KEYS.seasons, []);
}
export function getCurrentSeason() {
  const seasons = getSeasons();
  return seasons.find((s) => !s.endDate) || null;
}
export function startNewSeason(startDate) {
  const seasons = getSeasons();
  const record = { id: uid('season'), startDate, endDate: null };
  seasons.push(record);
  writeJSON(KEYS.seasons, seasons);
  return record;
}
export function removeSeason(id) {
  writeJSON(KEYS.seasons, getSeasons().filter((s) => s.id !== id));
}
export function endCurrentSeason(endDate) {
  const seasons = getSeasons();
  const idx = seasons.findIndex((s) => !s.endDate);
  if (idx === -1) return null;
  seasons[idx] = { ...seasons[idx], endDate };
  writeJSON(KEYS.seasons, seasons);
  return seasons[idx];
}

// ---- 樹種図鑑(手動で追加・削除できるシンプルなカタログ) ----
export function getWoodTypeCatalog() {
  return readJSON(KEYS.woodTypeCatalog, []);
}
export function addWoodTypeToCatalog(name) {
  const list = getWoodTypeCatalog();
  if (!name || list.includes(name)) return list;
  list.push(name);
  writeJSON(KEYS.woodTypeCatalog, list);
  return list;
}
export function deleteWoodTypeFromCatalog(name) {
  const list = getWoodTypeCatalog().filter((w) => w !== name);
  writeJSON(KEYS.woodTypeCatalog, list);
  return list;
}

// ---- 全データのエクスポート/インポート(設定のデータバックアップ用) ----
export function exportAllData() {
  const out = {};
  Object.values(KEYS).forEach((k) => {
    out[k] = readJSON(k, null);
  });
  return out;
}
export function importAllData(data) {
  Object.entries(data).forEach(([k, v]) => {
    if (Object.values(KEYS).includes(k)) writeJSON(k, v);
  });
}

export { KEYS, uid, isoDate, daysAgo, seedIfEmpty };
