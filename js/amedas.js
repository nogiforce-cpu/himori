// 気象庁アメダス(地域気象観測所)の観測点マスタ・実測値を取得するモジュール。
// 「季節の記録に使う観測点」の候補提示・おすすめ判定・過去気温の取得に使う。
// 予報(未来)は扱わない。ここで扱うのは常に「実際に観測された値」のみ。
import { localIsoDate } from './date-utils.js';

const TABLE_KEY = 'himori.amedasTable';
const TABLE_TTL_MS = 90 * 24 * 3600 * 1000; // 観測点の配置はほぼ変化しないため90日キャッシュ

async function loadAmedasTable() {
  try {
    const cached = JSON.parse(localStorage.getItem(TABLE_KEY) || 'null');
    if (cached && Date.now() - cached.fetchedAt < TABLE_TTL_MS) return cached.data;
  } catch {
    // 壊れたキャッシュは無視して取り直す
  }
  const res = await fetch('https://www.jma.go.jp/bosai/amedas/const/amedastable.json');
  if (!res.ok) throw new Error('観測点情報の取得に失敗しました');
  const data = await res.json();
  try {
    localStorage.setItem(TABLE_KEY, JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch {
    // 容量オーバー等は致命的ではないので無視
  }
  return data;
}

function dmsToDeg([deg, min]) {
  return deg + min / 60;
}

// 2点間の距離(km)。標高差は含まない水平距離のみ(標高は別途参考情報として表示する)。
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function yyyymmdd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// その観測所が気温を観測しているかどうかを、実際に直近データを取りに行って
// tempフィールドの有無で判定する。amedastable.jsonの`elems`ビット列の意味は
// 気象庁の公式ドキュメントで確証を得られなかったため、推測でビットを解釈しない
// (雨量専用地点など、気温を観測していない地点が実在するため)。
async function verifyTempCapable(stationId) {
  const now = new Date();
  const hourBlock = String(Math.floor(now.getHours() / 3) * 3).padStart(2, '0');
  const url = `https://www.jma.go.jp/bosai/amedas/data/point/${stationId}/${yyyymmdd(now)}_${hourBlock}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    const times = Object.keys(data).sort();
    if (!times.length) return false;
    const latest = data[times[times.length - 1]];
    return Array.isArray(latest?.temp) && latest.temp[0] != null;
  } catch {
    return false; // オフライン等は「観測不可」側に倒す(誤って候補に出さないため)
  }
}

// 「火のある場所」の緯度経度から近い順にアメダス候補を返す。距離だけで機械的に
// 並べる。標高(alt)は各観測点の絶対標高であり、火のある場所との標高差は計算しない
// (火のある場所自体の標高を信頼できる方法で取得できていないため)。標高は単なる
// 参考情報としてUI側に表示するのみで、並び順やおすすめの判定には一切使わない。
// 気温を観測していない地点(雨量専用等)は候補から除外する。
export async function findNearbyTempStations(lat, lon, { limit = 5, searchRadiusKm = 60, checkCount = 8 } = {}) {
  const table = await loadAmedasTable();
  const withDistance = Object.entries(table)
    .map(([id, s]) => ({
      id,
      name: s.kjName,
      lat: dmsToDeg(s.lat),
      lon: dmsToDeg(s.lon),
      alt: s.alt,
      distanceKm: haversineKm(lat, lon, dmsToDeg(s.lat), dmsToDeg(s.lon)),
    }))
    .filter((s) => s.distanceKm <= searchRadiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, checkCount);

  const results = [];
  for (const candidate of withDistance) {
    // eslint-disable-next-line no-await-in-loop -- 直列にして同時リクエスト数を抑える(候補数は最大8件程度)
    const hasTemp = await verifyTempCapable(candidate.id);
    if (hasTemp) results.push(candidate);
    if (results.length >= limit) break;
  }
  return results;
}

// 気温観測が確認できた候補のうち、最も近い1件を「HIMORIおすすめ」とする。
// 「この地点が一番正確」という断定はせず、単に距離が近いことの提示に留める。
// fireSiteElevationM(火のある場所自体の標高)は将来の拡張用の引数で、現時点では
// 信頼できる取得方法が無いため未使用・無視している。将来これを信頼できる方法で
// 取得できるようになった場合は、ここで各候補のaltとの差を計算し、距離に加えて
// 標高差もおすすめ判定に加味できる(その際もUI上「最も正確」等の断定はしない)。
export function recommendStation(candidates, { fireSiteElevationM = null } = {}) {
  if (!candidates?.length) return null;
  void fireSiteElevationM; // 将来の拡張ポイント(現在は未使用)
  return candidates[0]; // findNearbyTempStationsは既に距離順
}

// 実際に確認したところ、アメダスの実況データ(data/point/.../{日付}_{時刻}.json)は
// 概ね直近9日分しか公式サーバー上に残っていない(10日以上前の日付を指定すると404)。
// 推測ではなく、複数の日数で実際にリクエストして確認した値。この範囲を超える日は
// 「未確定のまま追いつけない日」として諦め、無限に遡ろうとしない。
const AMEDAS_RETENTION_DAYS = 9;

// 指定観測所・指定日について、その日の3時間ブロック(00,03,...,upToHourまで)の
// 実測気温から最低/最高を計算する共通処理。upToHourを省略すると21時(=1日分すべて)
// を対象にする(確定値の計算用)。分単位の生データは保存せず、代表値(最低・最高)
// だけを返す(データ量を無駄に増やさないため)。
async function fetchAmedasBlockSummary(stationId, dateObj, upToHour = 21) {
  const dateStr = yyyymmdd(dateObj);
  const blocks = [];
  for (let h = 0; h <= upToHour; h += 3) blocks.push(String(h).padStart(2, '0'));

  const results = await Promise.allSettled(
    blocks.map((hh) => fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${stationId}/${dateStr}_${hh}.json`).then((r) => (r.ok ? r.json() : null)))
  );

  let tempMin = null;
  let tempMax = null;
  results.forEach((r) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    Object.values(r.value).forEach((entry) => {
      const t = entry?.temp?.[0];
      if (t == null) return;
      tempMin = tempMin == null ? t : Math.min(tempMin, t);
      tempMax = tempMax == null ? t : Math.max(tempMax, t);
    });
  });

  if (tempMin == null) return null;
  return { date: localIsoDate(dateObj), tempMin, tempMax };
}

// 「当日ここまで」の実測値から、その時点までの最低/最高を計算する。まだ一日が
// 終わっていないため、この値は確定値ではない(この後さらに気温が下がる/上がる
// 可能性がある)。呼び出し側はconfirmed:falseとして保存すること。
export async function fetchAmedasTodaySummary(stationId) {
  const now = new Date();
  const currentBlock = Math.floor(now.getHours() / 3) * 3;
  return fetchAmedasBlockSummary(stationId, now, currentBlock);
}

// 過去の1日分(00時〜21時の全8ブロック)の実測値から、その日の確定した最低/最高を
// 計算する。日が完全に終わっている過去日にのみ使う。
export async function fetchAmedasConfirmedDaySummary(stationId, dateObj) {
  return fetchAmedasBlockSummary(stationId, dateObj, 21);
}

// 「確定させるべきなのに、まだ確定していない過去日」の一覧を返す(古い順)。
// weatherHistoryに全く記録が無い日(=HIMORIを開かなかった日)も対象に含めることで、
// 数日ぶりに開いた場合でも取得可能な範囲(AMEDAS_RETENTION_DAYS)を補完できるようにする。
// ただし1回の呼び出しで一気に大量リクエストしないよう、呼び出し側でmaxDaysを渡して
// 1回あたりの件数を制限すること(残りは次回起動時に続きから処理される)。
export function listUnconfirmedDates(weatherHistory, sinceDateIso, { maxDays = 5 } = {}) {
  const now = new Date();
  const today = localIsoDate(now);
  const floorDate = new Date(now.getTime() - AMEDAS_RETENTION_DAYS * 86400000);
  const floorIso = localIsoDate(floorDate);
  const startIso = sinceDateIso && sinceDateIso > floorIso ? sinceDateIso : floorIso;

  const byDate = new Map(weatherHistory.map((w) => [w.date, w]));
  const dates = [];
  const cursor = new Date(startIso + 'T00:00:00');
  while (true) {
    const iso = localIsoDate(cursor);
    if (iso >= today) break; // 当日は「確定」の対象外(まだ一日が終わっていない)
    const existing = byDate.get(iso);
    if (!existing || existing.confirmed === false) dates.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates.slice(0, maxDays);
}
