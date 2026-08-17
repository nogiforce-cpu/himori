// himori.* localStorageの薄いCRUDラッパー + 初回シード
import { localIsoDate } from './date-utils.js';

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

const isoDate = localIsoDate;

// ---- 初回シード ----
// 以前はここで薪棚4つ・チェック履歴・焚いた記録などを最初から作り込んでいたが、
// 初めて開いた瞬間から「自分のものではない薪棚」が既に登録されている状態は、
// 実際に薪ストーブを使っているユーザーから見て違和感が強い(自分の在庫を
// 正しく反映していないデータが最初から並んでいる)。そのため新規インストールは
// 完全な空の状態から始め、サンプルの使用感を試したい場合は設定画面から
// 「デモデータ」を任意で読み込めるようにしている(loadDemoSeason参照)。
function seedIfEmpty() {
  if (localStorage.getItem(KEYS.profile) != null) return;

  const profile = {
    userName: 'ゲスト',
    stove: { name: 'マイストーブ', purchaseDate: null, catalystReplacedAt: null, photoId: null },
    unit: 'm3',
    safetyLineM3: 2.2,
    seasonTargetM3: 4.6,
    mainShelfId: null,
    notificationsEnabled: false,
    theme: 'dark',
    textSize: 'normal',
    postalCode: null,
    location: null,
    nextChimneyCleaning: null,
    onboardingCompleted: false,
  };

  writeJSON(KEYS.profile, profile);
  writeJSON(KEYS.shelves, []);
  writeJSON(KEYS.checks, []);
  writeJSON(KEYS.burnLogs, []);
  writeJSON(KEYS.woodAdditions, []);
  writeJSON(KEYS.photos, []);
  writeJSON(KEYS.weatherCache, null);
  writeJSON(KEYS.splitLogs, []);
  writeJSON(KEYS.anshinHistory, []);
  writeJSON(KEYS.maintenanceLogs, []);
  writeJSON(KEYS.seasons, []);
  writeJSON(KEYS.woodTypeCatalog, []);
}

// 既存ユーザーが以前のバージョンのデータを持っている場合に、新しいフィールドを
// 壊さず補完する(データを消さずにアップデートを受け取れるようにするための移行処理)
// onboardingCompleted:true をデフォルトにしているのは、既存ユーザー(既にプロフィールが
// あった=既に使い始めている)には初回セットアップの案内を出さないため。真の初回起動は
// seedIfEmpty()側でonboardingCompleted:falseを明示的に書き込んでいるので、この関数は通らない。
const PROFILE_DEFAULTS = { mainShelfId: null, seasonTargetM3: 4.6, onboardingCompleted: true, textSize: 'normal' };
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
export function addShelf(entry) {
  const shelves = getShelves();
  const record = {
    id: uid('shelf'),
    name: '新しい薪棚',
    status: '乾燥中',
    remainingPercent: 100,
    usableVolumeM3: 0,
    totalVolumeM3: 1,
    lastCheckedAt: localIsoDate(),
    dryingStartedAt: null,
    estimatedDaysLeft: null,
    woodTypes: [],
    photoIds: [],
    referencePhotoId: null,
    ...entry,
  };
  shelves.push(record);
  setShelves(shelves);
  return record;
}
export function deleteShelf(id) {
  setShelves(getShelves().filter((s) => s.id !== id));
  const profile = getProfile();
  if (profile.mainShelfId === id) updateProfile({ mainShelfId: null });
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
export function updateCheck(id, patch) {
  const checks = getChecks();
  const idx = checks.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  checks[idx] = { ...checks[idx], ...patch };
  writeJSON(KEYS.checks, checks);
  return checks[idx];
}
export function deleteCheck(id) {
  writeJSON(KEYS.checks, getChecks().filter((c) => c.id !== id));
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
// 写真の削除時、薪棚・ストーブ・メンテ記録側に残ったIDへの参照も一緒に外す
// (参照だけ残ると、存在しない写真を表示しようとして空白になるため)
export function deletePhoto(id) {
  writeJSON(KEYS.photos, getPhotos().filter((p) => p.id !== id));

  const shelves = getShelves();
  let shelvesChanged = false;
  shelves.forEach((s) => {
    if (s.photoIds?.includes(id)) {
      s.photoIds = s.photoIds.filter((pid) => pid !== id);
      shelvesChanged = true;
    }
  });
  if (shelvesChanged) setShelves(shelves);

  const profile = getProfile();
  if (profile?.stove?.photoId === id) {
    updateProfile({ stove: { ...profile.stove, photoId: null } });
  }

  const maintenanceLogs = getMaintenanceLogs();
  if (maintenanceLogs.some((m) => m.photoId === id)) {
    writeJSON(
      KEYS.maintenanceLogs,
      maintenanceLogs.map((m) => (m.photoId === id ? { ...m, photoId: null } : m))
    );
  }
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
  const record = { id: uid('maint'), memo: '', photoId: null, ...entry };
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

// ---- デモシーズンデータ(製品を試してもらうための1シーズン分のサンプル。
// 有効化時は現在のデータを退避し、リセットで元に戻せる) ----
const DEMO_BACKUP_KEY = 'himori.demoBackup';
const DEMO_FLAG_KEY = 'himori.demoActive';

export function isDemoActive() {
  return localStorage.getItem(DEMO_FLAG_KEY) === '1';
}

// 直近で終わっている「11/30始まり〜翌3/20終わり」の1シーズンぶんの期間を返す
// (今日が1〜3/20の間でまだ今季が終わっていない場合は、さらに1年前のシーズンにする)
function mostRecentCompletedSeasonRange(today = new Date()) {
  const y = today.getFullYear();
  let start = new Date(y - 1, 10, 30);
  let end = new Date(y, 2, 20);
  if (end > today) {
    start = new Date(y - 2, 10, 30);
    end = new Date(y - 1, 2, 20);
  }
  return { start, end };
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// 焚く頻度は一定ではなく、シーズン初め/終わりの端境期は控えめ、真冬(概ね12月半ば〜
// 2月半ば)は焚く回数が増えるイメージにする(たまに焚かない日があるのも含めて実態に近づける)。
// dense=trueだと「ほぼ毎日」、falseだと「週2〜3回程度」の控えめなペースになる。
function buildSeasonBurns(atFn, spanDays, dense, notes = {}) {
  const logs = [];
  const peakStart = 18;
  const peakEnd = spanDays - 30;
  for (let d = 0; d <= spanDays; d++) {
    const inPeak = d >= peakStart && d <= peakEnd;
    if (dense) {
      if (inPeak) {
        if (d % 7 === 4) continue; // 真冬でも週1回くらいは焚かない日がある
      } else if (d % 3 !== 0) {
        continue; // 端境期は2〜3日に1回程度
      }
    } else {
      if (inPeak) {
        if (d % 3 === 0) continue; // 控えめな年: 真冬でも3日に1回は休む
      } else if (d % 4 !== 0) {
        continue; // 端境期は4日に1回程度
      }
    }
    logs.push({
      id: uid('burn'),
      date: atFn(d),
      shelfId: d % 23 === 11 ? 'shelf-2' : 'shelf-1',
      note: notes[d] || '',
    });
  }
  return logs;
}

// このアプリを「去年から使い続けている」という体験をイメージしてもらうため、直近だけで
// なくその前年ぶんの1シーズンも合わせて2シーズン(約1年半〜2年)ぶんのデータを作る。
// 過去の記録をさかのぼって振り返れることこそがこのアプリの核なので、カレンダーを
// 数ヶ月〜1年以上戻っても記録が続いている状態を再現する。
function buildDemoDataset() {
  const today = new Date();
  const { start: recentStart, end: recentEnd } = mostRecentCompletedSeasonRange(today);
  const recentSpan = Math.round((recentEnd - recentStart) / 86400000);
  const olderStart = addDays(recentStart, -365);
  const olderEnd = addDays(recentEnd, -365);
  const olderSpan = Math.round((olderEnd - olderStart) / 86400000);
  const atNew = (offset) => isoDate(addDays(recentStart, offset));
  const atOld = (offset) => isoDate(addDays(olderStart, offset));

  const burnLogs = [
    ...buildSeasonBurns(atOld, olderSpan, false),
    ...buildSeasonBurns(atNew, recentSpan, true, {
      0: '今シーズン初焚き。よく乾いていて着火もスムーズ。',
      50: '今年一番の冷え込み。夜まで暖かかった。',
      85: '来客があったので長めに焚いた。',
    }),
  ];

  const checks = [
    // 去年(1年目)は記録の頻度が控えめ
    { id: uid('check'), shelfId: 'shelf-1', date: atOld(10), remainingPercent: 88, usableVolumeM3: 2.29, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: null, memo: 'アプリを使い始めました。' },
    { id: uid('check'), shelfId: 'shelf-1', date: atOld(55), remainingPercent: 62, usableVolumeM3: 1.61, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: null, memo: '' },
    { id: uid('check'), shelfId: 'shelf-1', date: atOld(olderSpan - 8), remainingPercent: 33, usableVolumeM3: 0.86, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: null, memo: '' },
    // 今シーズン(2年目)は含水計も導入し、こまめに記録
    { id: uid('check'), shelfId: 'shelf-1', date: atNew(5), remainingPercent: 90, usableVolumeM3: 2.34, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: 22, memo: 'シーズン開始。良く乾燥している。' },
    { id: uid('check'), shelfId: 'shelf-1', date: atNew(24), remainingPercent: 80, usableVolumeM3: 2.08, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: 19, memo: '' },
    { id: uid('check'), shelfId: 'shelf-1', date: atNew(43), remainingPercent: 70, usableVolumeM3: 1.82, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: 20, memo: '' },
    { id: uid('check'), shelfId: 'shelf-1', date: atNew(62), remainingPercent: 60, usableVolumeM3: 1.56, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: 18, memo: '' },
    { id: uid('check'), shelfId: 'shelf-1', date: atNew(81), remainingPercent: 50, usableVolumeM3: 1.3, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'warning', airflow: 'good', stackCondition: 'good' }, moisturePercent: 17, memo: '棚の隅が少し湿っていた。' },
    { id: uid('check'), shelfId: 'shelf-1', date: atNew(recentSpan - 10), remainingPercent: 42, usableVolumeM3: 1.09, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: 16, memo: '' },
    { id: uid('check'), shelfId: 'shelf-2', date: atOld(60), remainingPercent: 58, usableVolumeM3: 1.16, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: null, memo: '' },
    { id: uid('check'), shelfId: 'shelf-2', date: atNew(30), remainingPercent: 55, usableVolumeM3: 1.1, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: null, memo: '' },
    { id: uid('check'), shelfId: 'shelf-2', date: atNew(85), remainingPercent: 35, usableVolumeM3: 0.7, items: { dryness: 'good', pestMold: 'good', leakMoisture: 'good', airflow: 'good', stackCondition: 'good' }, moisturePercent: null, memo: '' },
  ];

  const woodAdditions = [
    { id: uid('add'), shelfId: 'shelf-1', date: atOld(3), addedVolumeM3: 0.7, woodType: 'ナラ', source: 'ホームセンター', memo: '初めての薪購入。', photoId: null },
    { id: uid('add'), shelfId: 'shelf-1', date: atNew(2), addedVolumeM3: 0.6, woodType: 'クヌギ', source: '近所の薪屋', memo: '今シーズン分を購入しました。', photoId: null },
    { id: uid('add'), shelfId: 'shelf-2', date: atNew(70), addedVolumeM3: 0.4, woodType: '広葉樹(ミックス)', source: '', memo: '', photoId: null },
  ];

  const splitLogs = [
    { id: uid('split'), date: atOld(-30), volumeM3: 0.4 },
    { id: uid('split'), date: atNew(-60), volumeM3: 0.5 },
    { id: uid('split'), date: atNew(-40), volumeM3: null },
    { id: uid('split'), date: atNew(-15), volumeM3: 0.3 },
  ];

  // シーズン前後だけでなく、シーズン中の定期的なお手入れ、さらに春〜夏のオフシーズンにも
  // メンテ記録を散らして「1年を通して使っている」感じが出るようにする
  // (実際に使う場面をイメージしやすくするため)。1年目・2年目それぞれの前後に加え、
  // 1年目の夏(2つのシーズンの間)にも1件入れて、間が空きすぎないようにする。
  const maintenanceLogs = [
    { id: uid('maint'), date: atOld(-10), type: 'シーズン前の試し焚き点検', memo: '初めての薪ストーブ、問題なし。' },
    { id: uid('maint'), date: atOld(olderSpan + 15), type: '煙突掃除', memo: '初シーズン終わりに実施。' },
    { id: uid('maint'), date: atOld(olderSpan + 120), type: '本体のサビ取り・塗装補修', memo: '' },
    { id: uid('maint'), date: atNew(-15), type: 'シーズン前の試し焚き点検', memo: '問題なし。' },
    { id: uid('maint'), date: atNew(10), type: '耐火レンガ点検', memo: '' },
    { id: uid('maint'), date: atNew(40), type: '灰処理・灰受け清掃', memo: '' },
    { id: uid('maint'), date: atNew(65), type: '空気取入れ口・ダンパー確認', memo: 'すすが少し溜まっていたので清掃した。' },
    { id: uid('maint'), date: atNew(90), type: '灰処理・灰受け清掃', memo: '' },
    { id: uid('maint'), date: atNew(recentSpan + 15), type: '煙突掃除', memo: 'シーズン終わりに実施。' },
    { id: uid('maint'), date: atNew(recentSpan + 25), type: 'ガスケット(ドアパッキン)交換', memo: '' },
    { id: uid('maint'), date: atNew(recentSpan + 40), type: '蝶番・留め具の点検注油', memo: '' },
    { id: uid('maint'), date: atNew(recentSpan + 125), type: '本体のサビ取り・塗装補修', memo: '梅雨明け後に点検。小さなサビを補修した。' },
  ].filter((m) => new Date(m.date + 'T00:00:00') <= today); // 未来日にならないものだけ残す

  const seasons = [
    { id: uid('season'), startDate: atOld(0), endDate: atOld(olderSpan) },
    { id: uid('season'), startDate: atNew(0), endDate: atNew(recentSpan) },
  ];

  const anshinHistory = [
    ...[10, 55, olderSpan - 8, olderSpan + 20].map((d, i) => ({ date: atOld(d), score: [85, 62, 33, 40][i] })),
    ...[2, 24, 43, 70, 81, recentSpan - 10, recentSpan].map((d, i) => ({
      date: atNew(d),
      score: [90, 82, 75, 80, 65, 55, 48][i],
    })),
  ];

  const weatherHistory = [
    ...[10, 55, olderSpan - 8].map((d, i) => ({ date: atOld(d), tempMin: [2, 0, -2][i], tempMax: [9, 7, 5][i] })),
    ...[5, 24, 43, 62, 81, recentSpan - 10].map((d, i) => ({
      date: atNew(d),
      tempMin: [3, 1, -1, 2, 0, 4][i],
      tempMax: [10, 8, 6, 9, 7, 11][i],
    })),
  ];

  const woodTypeCatalog = ['クヌギ', 'ナラ', '広葉樹(ミックス)', '針葉樹'];

  // デモ用の写真(実機の実写を薪棚・ストーブのプレースホルダーとして使う)。
  const photos = [
    { id: 'photo-sample-1', category: '薪棚', date: atNew(recentSpan - 10), uri: 'assets/sample-woodshelf-1.jpg' },
    { id: 'photo-sample-2', category: '薪棚', date: atNew(85), uri: 'assets/sample-woodshelf-2.jpg' },
    { id: 'photo-sample-3', category: '薪棚', date: atNew(recentSpan - 20), uri: 'assets/sample-woodshelf-3.jpg' },
    { id: 'photo-sample-stove', category: 'ストーブ', date: atOld(-30), uri: 'assets/sample-stove.jpg' },
  ];

  // 以前はseedIfEmpty()が作る薪棚をそのまま使い回していたが、新規インストールが
  // 完全な空の状態から始まるようになったため、デモデータ自体がこの4棚を自己完結
  // して持つ必要がある(getShelves()に依存すると、空の状態からは何も生成できない)。
  const shelves = [
    {
      id: 'shelf-1', name: '第1薪棚(メイン)', status: '乾燥済み',
      remainingPercent: 42, usableVolumeM3: 1.09, totalVolumeM3: 2.6,
      lastCheckedAt: atNew(recentSpan - 10), dryingStartedAt: atOld(-330),
      estimatedDaysLeft: 38, woodTypes: ['広葉樹(ミックス)', 'ナラ', 'クヌギ'], photoIds: ['photo-sample-1'],
    },
    {
      id: 'shelf-2', name: '第2薪棚(北側)', status: '乾燥済み',
      remainingPercent: 35, usableVolumeM3: 0.7, totalVolumeM3: 2.0,
      lastCheckedAt: atNew(85), dryingStartedAt: atOld(-120),
      estimatedDaysLeft: 18, woodTypes: ['針葉樹', '広葉樹(ミックス)'], photoIds: ['photo-sample-2'],
    },
    {
      id: 'shelf-3', name: '南側薪棚(来季用)', status: '来季用',
      remainingPercent: 65, usableVolumeM3: 1.2, totalVolumeM3: 1.8,
      lastCheckedAt: atNew(recentSpan - 20), dryingStartedAt: atOld(-160),
      estimatedDaysLeft: 90, woodTypes: ['広葉樹(ミックス)'], photoIds: ['photo-sample-3'],
    },
    {
      id: 'shelf-4', name: '薪小屋(予備)', status: '乾燥中',
      remainingPercent: 30, usableVolumeM3: 0.6, totalVolumeM3: 2.0,
      lastCheckedAt: atNew(recentSpan - 5), dryingStartedAt: atOld(-240),
      estimatedDaysLeft: 14, woodTypes: ['広葉樹(ミックス)', '針葉樹'], photoIds: [],
    },
  ];

  return { shelves, photos, checks, burnLogs, woodAdditions, splitLogs, maintenanceLogs, seasons, anshinHistory, weatherHistory, woodTypeCatalog };
}

// デモデータを読み込む。既に実際のデータが入っている場合は上書きする前に退避しておく
export function loadDemoSeason() {
  if (!isDemoActive()) {
    const backup = {};
    Object.values(KEYS).forEach((k) => {
      backup[k] = localStorage.getItem(k);
    });
    localStorage.setItem(DEMO_BACKUP_KEY, JSON.stringify(backup));
  }
  const demo = buildDemoDataset();
  writeJSON(KEYS.shelves, demo.shelves);
  writeJSON(KEYS.photos, demo.photos);
  writeJSON(KEYS.checks, demo.checks);
  writeJSON(KEYS.burnLogs, demo.burnLogs);
  writeJSON(KEYS.woodAdditions, demo.woodAdditions);
  writeJSON(KEYS.splitLogs, demo.splitLogs);
  writeJSON(KEYS.maintenanceLogs, demo.maintenanceLogs);
  writeJSON(KEYS.seasons, demo.seasons);
  writeJSON(KEYS.anshinHistory, demo.anshinHistory);
  writeJSON(KEYS.weatherHistory, demo.weatherHistory);
  writeJSON(KEYS.woodTypeCatalog, demo.woodTypeCatalog);
  const profile = getProfile();
  setProfile({
    ...profile,
    mainShelfId: profile.mainShelfId || 'shelf-1',
    stove: { ...profile.stove, name: profile.stove.name || 'Jøtul F 400', photoId: profile.stove.photoId || 'photo-sample-stove' },
  });
  localStorage.setItem(DEMO_FLAG_KEY, '1');
}

// デモ開始前の状態に戻す(退避しておいたデータを復元)
export function resetDemoSeason() {
  const raw = localStorage.getItem(DEMO_BACKUP_KEY);
  if (raw) {
    try {
      const backup = JSON.parse(raw);
      Object.entries(backup).forEach(([k, v]) => {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      });
    } catch {
      // 復元に失敗しても致命的ではないため握りつぶす(デモフラグは下で必ず消す)
    }
  }
  localStorage.removeItem(DEMO_BACKUP_KEY);
  localStorage.removeItem(DEMO_FLAG_KEY);
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

export { KEYS, uid, isoDate, seedIfEmpty };
