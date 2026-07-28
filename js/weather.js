// 天気連動プラン: 郵便番号→緯度経度(HeartRails)→Open-Meteo予報、48h通知判定
import { getWeatherCache, setWeatherCache, recordWeatherHistoryToday } from './store.js';

const NOTIFY_FLAG_KEY = 'himori.lastWeatherNotifyDate';
const CHIMNEY_FLAG_KEY = 'himori.lastChimneyNotifyDate';

export const GEO_SOURCE_NOTICE = '出典:「位置参照情報ダウンロードサービス」(国土交通省)を加工して作成';

export async function resolveLocationFromPostal(postalCode) {
  const digits = String(postalCode).replace(/[^0-9]/g, '');
  if (digits.length !== 7) throw new Error('郵便番号は7桁で入力してください');
  const url = `https://geoapi.heartrails.com/api/json?method=searchByPostal&postal=${digits}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('位置情報の取得に失敗しました');
  const data = await res.json();
  const loc = data?.response?.location?.[0];
  if (!loc) throw new Error('該当する住所が見つかりませんでした');
  return {
    lat: Number(loc.y),
    lon: Number(loc.x),
    prefecture: loc.prefecture,
    city: loc.city,
    town: loc.town,
  };
}

// 気温・湿度・風はJMA(気象庁)モデルで取得する。Open-Meteoの既定モデルは世界規模のブレンド
// モデルで、日本国内ではYahoo天気/tenki.jpなどが使うJMAの実況と数℃ずれることがあるため。
// ただしJMAモデルは降水確率を提供していないので、その項目だけ既定モデルから別途取得して
// 日付ごとにマージする(どちらも同じ無料エンドポイント、追加コストなし)。
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

// キャッシュの構造が変わった時(取得するフィールドを増やした等)に、日付だけ見て
// 「新鮮」と誤判定して古い形のデータを使い続けないようにするためのバージョン番号。
// フィールドを追加・変更したらこの数字を上げる。
const CACHE_VERSION = 3;

// キャッシュが無い/日付が変わっていれば再取得。オフライン等は静かに諦める(nullを返す)
export async function ensureWeatherFresh(profile) {
  if (!profile?.location) return getWeatherCache();
  const cache = getWeatherCache();
  const today = new Date().toISOString().slice(0, 10);
  const isFresh = cache && cache.fetchedAt?.slice(0, 10) === today && cache.version === CACHE_VERSION;
  if (isFresh) return cache;
  try {
    const daily = await fetchDailyForecast(profile.location.lat, profile.location.lon);
    const next = { version: CACHE_VERSION, fetchedAt: new Date().toISOString(), location: profile.location, daily };
    setWeatherCache(next);
    // 今日時点の実際の気温を積み上げて記録しておく(カレンダーで「この日は焚いていない/焚いた」を
    // 実際の気温と一緒に振り返れるようにするため。過去分は遡れないが、今日から蓄積を始める)
    if (daily[0]) recordWeatherHistoryToday(daily[0]);
    return next;
  } catch {
    return cache; // ネットワーク不通時は古いキャッシュ(あれば)のまま静かに継続
  }
}

// 48時間以内に冷え込み・雨・雪の予報があるか
export function has48hAlert(dailyWeather) {
  if (!dailyWeather || dailyWeather.length < 2) return false;
  const next2 = dailyWeather.slice(0, 2);
  return next2.some((d) => d.tempMin <= 3 || d.precipitationSum >= 1);
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
  }));
}

function todayFlagIso() {
  return new Date().toISOString().slice(0, 10);
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

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}
