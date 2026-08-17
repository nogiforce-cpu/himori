// 天気連動プラン: 都道府県・市区町村の選択→緯度経度(HeartRails)→Open-Meteo予報、48h通知判定
//
// 以前は郵便番号を入力する方式だったが、「番地まで特定できるはずの郵便番号を入力させて
// おきながら、実際にはピンポイントな天気は分からない」というちぐはぐな印象を与えてしまう
// との指摘を受け、都道府県→市区町村を選ぶだけの方式に変更した。実際に得られる予報の
// 精度が「市区町村程度」でしかないなら、入力してもらう情報もその粒度に合わせる方が誠実。
import { getWeatherCache, setWeatherCache, recordWeatherHistoryToday, updateProfile } from './store.js';
import { localIsoDate } from './date-utils.js';
import { resolveJmaArea, fetchJmaDaily } from './jma.js';

const NOTIFY_FLAG_KEY = 'himori.lastWeatherNotifyDate';
const CHIMNEY_FLAG_KEY = 'himori.lastChimneyNotifyDate';

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

export async function fetchCitiesForPrefecture(prefecture) {
  const url = `https://geoapi.heartrails.com/api/json?method=getCities&prefecture=${encodeURIComponent(prefecture)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('市区町村一覧の取得に失敗しました');
  const data = await res.json();
  return (data?.response?.location || []).map((l) => l.city);
}

// 市区町村を選ぶだけで緯度経度まで特定する(番地の入力は求めない)。市区町村内の
// 全町域の座標の平均を代表地点として使う(1つの町域に絞り込まないことで、
// 「住所を特定している」という印象を避けつつ、市区町村内のおおよそ中心に近い点になる)。
export async function resolveLocationFromCity(prefecture, city) {
  if (!prefecture || !city) throw new Error('都道府県と市区町村を選んでください');
  const url = `https://geoapi.heartrails.com/api/json?method=getTowns&city=${encodeURIComponent(city)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('地域情報の取得に失敗しました');
  const data = await res.json();
  const towns = data?.response?.location || [];
  if (!towns.length) throw new Error('該当する地域が見つかりませんでした');
  const lat = towns.reduce((sum, t) => sum + Number(t.y), 0) / towns.length;
  const lon = towns.reduce((sum, t) => sum + Number(t.x), 0) / towns.length;
  const jma = await resolveJmaArea({ prefecture, city, town: '' }).catch(() => null);
  return { lat, lon, prefecture, city, town: null, jma };
}

// 気温・湿度・風はJMA(気象庁)モデルで取得する。Open-Meteoの既定モデルは世界規模のブレンド
// モデルで、日本国内ではYahoo天気/tenki.jpなどが使うJMAの実況と数℃ずれることがあるため。
// ただしJMAモデルは降水確率を提供していないので、その項目だけ既定モデルから別途取得して
// 日付ごとにマージする(どちらも同じ無料エンドポイント、追加コストなし)。
// 雨量合計・風速・湿度はOpen-Meteoにしか無いためそのまま使う。
export async function fetchDailyForecast(lat, lon) {
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=Asia%2FTokyo`;
  const jmaUrl = `${base}&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,windspeed_10m_max,relative_humidity_2m_mean&models=jma_seamless`;
  const probUrl = `${base}&daily=precipitation_probability_max`;

  const [jmaRes, probRes] = await Promise.all([fetch(jmaUrl), fetch(probUrl)]);
  if (!jmaRes.ok) throw new Error('天気予報の取得に失敗しました');
  const jmaData = await jmaRes.json();
  const d = jmaData.daily;

  let probByDate = new Map();
  if (probRes.ok) {
    const probData = await probRes.json();
    const p = probData.daily;
    probByDate = new Map(p.time.map((date, i) => [date, p.precipitation_probability_max[i]]));
  }

  const daily = d.time.map((date, i) => ({
    date,
    tempMin: d.temperature_2m_min[i],
    tempMax: d.temperature_2m_max[i],
    precipitationSum: d.precipitation_sum[i],
    precipitationProbability: probByDate.has(date) ? probByDate.get(date) : null,
    windSpeedMax: d.windspeed_10m_max[i],
    humidityMean: d.relative_humidity_2m_mean[i],
  }));
  return daily;
}

// Open-Meteoの推定モデル値を、可能な範囲で気象庁が実際に発表した数値(降水確率・気温)に
// 上書きする。気象庁側が取れない項目・日付はOpen-Meteoの値のまま静かに残す。
async function overlayJmaOfficial(daily, jmaArea) {
  if (!jmaArea?.officeCode) return daily;
  try {
    const byDate = await fetchJmaDaily(jmaArea);
    daily.forEach((d) => {
      const official = byDate.get(d.date);
      if (!official) return;
      if (official.tempMin != null) d.tempMin = official.tempMin;
      if (official.tempMax != null) d.tempMax = official.tempMax;
      if (official.precipitationProbability != null) d.precipitationProbability = official.precipitationProbability;
      if (official.precipCategory) d.precipCategory = official.precipCategory;
    });
  } catch {
    // 気象庁側が取得できない時はOpen-Meteoの値のまま継続(オフライン等)
  }
  return daily;
}

// キャッシュの構造が変わった時(取得するフィールドを増やした等)に、日付だけ見て
// 「新鮮」と誤判定して古い形のデータを使い続けないようにするためのバージョン番号。
// フィールドを追加・変更したらこの数字を上げる。
const CACHE_VERSION = 8;

// 予報モデルは1日に何度も更新されるため、1日1回しか取り直さないと夜には朝の古い
// 予報のまま(実際の気温とズレて見える)になってしまう。数時間おきに取り直す。
const REFRESH_INTERVAL_HOURS = 3;

// キャッシュが無い/日付が変わった/場所が変わった/一定時間が経てば再取得。
// オフライン等は静かに諦める(古いキャッシュを返す)
export async function ensureWeatherFresh(profile) {
  if (!profile?.location) return getWeatherCache();
  const cache = getWeatherCache();
  const today = localIsoDate();
  const sameLocation =
    cache?.location && cache.location.lat === profile.location.lat && cache.location.lon === profile.location.lon;
  const hoursSinceFetch = cache?.fetchedAt ? (Date.now() - new Date(cache.fetchedAt).getTime()) / 3600000 : Infinity;
  const isFresh =
    cache &&
    cache.version === CACHE_VERSION &&
    sameLocation &&
    cache.fetchedAt?.slice(0, 10) === today &&
    hoursSinceFetch < REFRESH_INTERVAL_HOURS;
  if (isFresh) return cache;
  try {
    // 郵便番号登録済みだが気象庁の発表区分(jma)が未解決、または古い形(class20Code
    // 追加前)の既存プロフィールは、この場で補完・再解決する(緯度経度は取り直さず、
    // 既に持っている住所情報から解決できるため無料)。
    let location = profile.location;
    if (!location.jma || !('class20Code' in location.jma)) {
      const jma = await resolveJmaArea(location).catch(() => null);
      if (jma) {
        location = { ...location, jma };
        updateProfile({ location });
      }
    }
    const daily = await fetchDailyForecast(location.lat, location.lon);
    await overlayJmaOfficial(daily, location.jma);
    const next = { version: CACHE_VERSION, fetchedAt: new Date().toISOString(), location, daily };
    setWeatherCache(next);
    // 今日時点の実際の気温を積み上げて記録しておく(カレンダーで「この日は焚いていない/焚いた」を
    // 実際の気温と一緒に振り返れるようにするため。過去分は遡れないが、今日から蓄積を始める)
    if (daily[0]) recordWeatherHistoryToday(daily[0]);
    return next;
  } catch {
    return cache; // ネットワーク不通時は古いキャッシュ(あれば)のまま静かに継続
  }
}

// 48時間以内の「冷え込み」「まとまった雨」をそれぞれ独立に判定する。
// 両方まとめて「冷え込み・雨・雪」と一括で言うと、真夏に雨だけ降る予報でも
// 「雪」に言及してしまうなど季節感のない文言になるため、呼び出し側で
// 該当する条件だけを言い分けられるようにする。
export function upcoming48hRisk(dailyWeather) {
  if (!dailyWeather || dailyWeather.length < 2) return null;
  const next2 = dailyWeather.slice(0, 2);
  const cold = next2.some((d) => d.tempMin <= 3);
  const rain = next2.some((d) => d.precipitationSum >= 1);
  const snow = next2.some((d) => d.precipCategory === 'snow');
  if (!cold && !rain) return null;
  return { cold, rain, snow };
}

// 48時間以内に冷え込み・雨の予報があるか(通知の要否判定などブール値だけで足りる箇所用)
export function has48hAlert(dailyWeather) {
  return upcoming48hRisk(dailyWeather) != null;
}

// 中立的な事実表示用の一文(煽らない)。ホーム/チェック画面の小さな表示に使う。
// 「乾いた薪は割れやすくなる」の一言は氷点下に近い予報の時だけ添える(常時つけると
// 気温が高い日にも表示されて誤情報になるため、実際の値で条件分岐する)。
export function factualTodayNote(dailyWeather) {
  if (!dailyWeather || !dailyWeather.length) return null;
  const today = dailyWeather[0];
  const temp = Math.round(today.tempMin);
  if (temp <= 3) return `予想最低気温 ${temp}℃(乾いた薪は割れやすくなる目安)`;
  return `予想最低気温 ${temp}℃`;
}

// ホームの数日天気ストリップ用(最大5日分)。薪の運び出し・薪割り・使用の計画に使える事実だけを渡す
export function upcomingDaysSummary(dailyWeather, days = 5) {
  if (!dailyWeather || !dailyWeather.length) return [];
  return dailyWeather.slice(0, days).map((d) => ({
    date: d.date,
    tempMin: Math.round(d.tempMin),
    tempMax: Math.round(d.tempMax),
    precipitationSum: d.precipitationSum,
    precipitationProbability: d.precipitationProbability,
    precipCategory: d.precipCategory ?? null,
  }));
}

function todayFlagIso() {
  return localIsoDate();
}

function canShowNotification() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function showLocalNotification(title, body) {
  if (!canShowNotification()) return;
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body }));
    } else {
      new Notification(title, { body });
    }
  } catch {
    // 通知に失敗しても致命的ではないため握りつぶす
  }
}

// 天気起因の通知は「48時間以内に冷え込み/雨/雪」の1種類、1日1回だけ
export function maybeNotifyWeather(dailyWeather, enabled) {
  if (!enabled) return;
  if (!has48hAlert(dailyWeather)) return;
  const last = localStorage.getItem(NOTIFY_FLAG_KEY);
  const today = todayFlagIso();
  if (last === today) return;
  showLocalNotification('火守 / HIMORI', '48時間以内に冷え込み・雨・雪の予報があります。多めに運んでおくと安心です。');
  localStorage.setItem(NOTIFY_FLAG_KEY, today);
}

// 煙突・触媒清掃リマインダー(予定日が30日以内に近づいたら1日1回)
export function maybeNotifyChimney(nextChimneyCleaning, enabled) {
  if (!enabled || !nextChimneyCleaning) return;
  const days = Math.round((new Date(nextChimneyCleaning) - new Date()) / 86400000);
  if (days < 0 || days > 30) return;
  const last = localStorage.getItem(CHIMNEY_FLAG_KEY);
  const today = todayFlagIso();
  if (last === today) return;
  showLocalNotification('火守 / HIMORI', `煙突・触媒の清掃予定日まであと${days}日です。`);
  localStorage.setItem(CHIMNEY_FLAG_KEY, today);
}

// 薪棚チェックの未実施リマインダー(全ての薪棚が一定日数チェックされていなければ1日1回)。
// ①(実績からシーズン想定使用量を自動提案する)がそもそも薪棚チェックの記録に
// 依存しているため、記録を溜める後押しとして追加した。
const CHECK_FLAG_KEY = 'himori.lastCheckNotifyDate';
const CHECK_REMINDER_DAYS = 14;
export function maybeNotifyShelfCheck(shelves, enabled) {
  if (!enabled || !shelves?.length) return;
  const today = new Date();
  const maxDays = Math.min(
    ...shelves.map((s) => {
      if (!s.lastCheckedAt) return Infinity;
      return Math.floor((today - new Date(s.lastCheckedAt + 'T00:00:00')) / 86400000);
    })
  );
  if (maxDays < CHECK_REMINDER_DAYS) return;
  const last = localStorage.getItem(CHECK_FLAG_KEY);
  const todayIso = todayFlagIso();
  if (last === todayIso) return;
  showLocalNotification('火守 / HIMORI', `${CHECK_REMINDER_DAYS}日以上、薪棚をチェックしていないようです。状態を見ておくと安心です。`);
  localStorage.setItem(CHECK_FLAG_KEY, todayIso);
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}
