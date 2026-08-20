import { localIsoDate } from './date-utils.js';

// 気象庁(JMA)の公式発表データを直接取得するモジュール。
// Open-Meteoのjma_seamlessモデルは「JMAの数値予報モデルを再現した推定値」であり、
// 気象庁が実際に発表する降水確率・気温そのものではない(降水確率は日本向けモデルでは
// 提供されないため、これまでは無関係な世界共通モデルの値で代用していた)。
// 実機テストでYahoo天気等と数値が食い違う報告を受け、気象庁が一般公開しているJSON
// (https://www.jma.go.jp/bosai/) を直接読み、可能な範囲で「気象庁が発表した数値そのもの」
// に置き換える。ただし気象庁の週間予報は府県単位、気温代表地点は1地点のみのため、
// 山間部など気候が異なる地域では市区町村ごとの完全な一致は原理的に望めない
// (Yahoo天気等の商用サービスは独自の補正を加えているとみられる)。

const AREA_INDEX_KEY = 'himori.jmaAreaIndex';
const AREA_INDEX_TTL_MS = 90 * 24 * 3600 * 1000; // 地域階層はほぼ変化しないため90日キャッシュ

async function loadAreaIndex() {
  try {
    const cached = JSON.parse(localStorage.getItem(AREA_INDEX_KEY) || 'null');
    if (cached && Date.now() - cached.fetchedAt < AREA_INDEX_TTL_MS) return cached.data;
  } catch {
    // 壊れたキャッシュは無視して取り直す
  }
  const res = await fetch('https://www.jma.go.jp/bosai/common/const/area.json');
  if (!res.ok) throw new Error('気象庁の地域情報取得に失敗しました');
  const data = await res.json();
  try {
    localStorage.setItem(AREA_INDEX_KEY, JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch {
    // 容量オーバー等は致命的ではないので無視
  }
  return data;
}

// ある府県予報区(office)の下にある地方細分(class10)の一覧を返す。気象庁の行政区分は
// 必ずしも実際の気候と一致しない(例: 山間部の町が平野部と同じ区分にまとめられている等)
// ため、自動判定された区分をユーザーが自分の体感に合わせて選び直せるようにするために使う。
export async function listRegionsForOffice(officeCode) {
  const area = await loadAreaIndex();
  const office = area.offices?.[officeCode];
  if (!office) return [];
  return (office.children || []).map((code) => ({ code, name: area.class10s?.[code]?.name || code }));
}

// 郵便番号から得た住所(都道府県・市区町村・町域)を、気象庁の発表区分
// (府県予報区office・地方細分class10・二次細分class15)に対応付ける。
// 市区町村名が一致しない場合は都道府県単位までのフォールバックに留める
// (誤った市区町村の予報を出すより、粒度は粗くても確実な方を優先する)。
export async function resolveJmaArea({ prefecture, city, town }) {
  if (!prefecture) return null;
  let area;
  try {
    area = await loadAreaIndex();
  } catch {
    return null;
  }
  const officeEntry = Object.entries(area.offices).find(([, v]) => v.name === prefecture);
  if (!officeEntry) return null; // 北海道の各地方等、県名と発表区分名が一致しない例は現状フォールバック
  const [officeCode, officeInfo] = officeEntry;

  const class10Codes = officeInfo.children || [];
  const class15Codes = class10Codes.flatMap((c10) => area.class10s[c10]?.children || []);
  const class20Codes = class15Codes.flatMap((c15) => area.class15s[c15]?.children || []);

  const haystack = `${city || ''}${town || ''}`;
  const matched = class20Codes
    .map((code) => ({ code, ...area.class20s[code] }))
    .filter((c) => c.name && haystack.includes(c.name))
    .sort((a, b) => b.name.length - a.name.length)[0]; // より長く一致した市区町村名を優先

  if (!matched) {
    return {
      officeCode,
      class10Code: class10Codes[0] || null,
      class15Code: null,
      class20Code: null,
      regionName: officeInfo.name,
    };
  }
  const class15Code = matched.parent;
  const class10Code = area.class15s[class15Code]?.parent;
  return {
    officeCode,
    class10Code: class10Code || null,
    class15Code: class15Code || null,
    class20Code: matched.code,
    regionName: (class10Code && area.class10s[class10Code]?.name) || officeInfo.name,
  };
}

// 気象庁の発表(短期+週間)を日付ごとにまとめ直す。
// 短期(今日・明日、6時間刻み): 地方細分(南部/北部等)ごとの降水確率→日ごとの最大値を採用。
// 週間(明日以降7日分): 府県単位の降水確率・代表地点の最高/最低気温を、公式発表のまま採用。
export async function fetchJmaDaily({ officeCode, class10Code, class15Code }) {
  const res = await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${officeCode}.json`);
  if (!res.ok) throw new Error('気象庁の予報取得に失敗しました');
  const [shortTerm, extended] = await res.json();
  const byDate = new Map();

  // 気象庁の発表では値が未確定の日を空文字列("")で埋めるため、Number("")が0になる
  // JSの罠に注意する(空文字列を先に弾いてからNumber変換する)。
  const toNumberOrNull = (raw) => {
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  };

  const popSeries = shortTerm?.timeSeries?.[1];
  const popArea =
    popSeries?.areas?.find((a) => a.area?.code === class15Code) ||
    popSeries?.areas?.find((a) => a.area?.code === class10Code);
  popSeries?.timeDefines?.forEach((t, i) => {
    const pop = toNumberOrNull(popArea?.pops?.[i]);
    if (pop == null) return;
    const date = t.slice(0, 10);
    const entry = byDate.get(date) || {};
    entry.precipitationProbability = Math.max(entry.precipitationProbability ?? 0, pop);
    byDate.set(date, entry);
  });

  // 週間予報は「明日以降」の発表という前提で使っている(このファイル冒頭のコメント通り)。
  // ただし気象庁の週間予報データは、発表タイミングによっては先頭の日付が「今日」と
  // 重なることがあり、その場合の値は今日の実況とズレていることがある(実機で「今日の
  // 最高気温」が明らかに違う値になる不具合が実際に発生した)。今日の予報は短期予報や
  // 数値モデルの方が適切なので、週間予報は今日の日付には決して適用しない。
  const todayIso = localIsoDate();

  const weeklyPopArea = extended?.timeSeries?.[0]?.areas?.[0];
  extended?.timeSeries?.[0]?.timeDefines?.forEach((t, i) => {
    const pop = toNumberOrNull(weeklyPopArea?.pops?.[i]);
    if (pop == null) return;
    const date = t.slice(0, 10);
    if (date === todayIso) return;
    const entry = byDate.get(date) || {};
    entry.precipitationProbability = pop;
    byDate.set(date, entry);
  });

  // 週間の最高・最低気温は両方とも気象庁の発表値をそのまま採用する。以前は最低気温だけ
  // Open-Meteoの数値モデル値を残していたが、同じ日の最高気温は気象庁・最低気温は
  // 別モデルという組み合わせは出典として一貫性がなく分かりにくい、という指摘を受けて統一した。
  // 気象庁の週間気温は県内1地点の代表観測点のみのため、標高差のある地域では最低気温が
  // 実態より高めに出ることがある(実測比較で確認済み)が、これは無料の公式データである以上
  // 避けられない粒度の限界として許容し、出典の一貫性・分かりやすさを優先する。
  // なお当日分はこのブロックでは扱わない(todayIsoは常にスキップ)。当日の最高気温は
  // 下の短期予報ブロックで別途、気象庁の実況ベースの値に置き換える。
  const weeklyTempArea = extended?.timeSeries?.[1]?.areas?.[0];
  extended?.timeSeries?.[1]?.timeDefines?.forEach((t, i) => {
    const date = t.slice(0, 10);
    if (date === todayIso) return;
    const tMax = toNumberOrNull(weeklyTempArea?.tempsMax?.[i]);
    const tMin = toNumberOrNull(weeklyTempArea?.tempsMin?.[i]);
    if (tMax == null && tMin == null) return;
    const entry = byDate.get(date) || {};
    if (tMax != null) entry.tempMax = tMax;
    if (tMin != null) entry.tempMin = tMin;
    byDate.set(date, entry);
  });

  // 短期予報(shortTerm.timeSeries[2])には、週間予報と同じ代表観測地点の当日気温が
  // 含まれている。これまで当日の気温は数値予報モデル(Open-Meteo)の推定値のままで、
  // 実測より低く出る癖のせいで実態とズレることがあった(実機で確認済み)。同じ観測
  // 地点を使うことで、出典の一貫性も保てる。なお午前に発表された回では「当日の
  // 最低気温」の枠が省略されて最高気温の値が重複して入る仕様があり、その場合は
  // 当日の最低気温が最高気温と同じ値になってしまうことがあるが、出典を気象庁のみに
  // 揃えることを優先し、この限界は許容する。
  const tempStationSeries = shortTerm?.timeSeries?.[2];
  const weeklyStationCode = weeklyTempArea?.area?.code;
  const tempStationArea =
    tempStationSeries?.areas?.find((a) => a.area?.code === weeklyStationCode) || tempStationSeries?.areas?.[0];
  if (tempStationArea) {
    const todayTemps = [];
    tempStationSeries.timeDefines.forEach((t, i) => {
      if (t.slice(0, 10) !== todayIso) return;
      const v = toNumberOrNull(tempStationArea.temps?.[i]);
      if (v != null) todayTemps.push(v);
    });
    if (todayTemps.length) {
      const entry = byDate.get(todayIso) || {};
      entry.tempMax = Math.max(...todayTemps);
      entry.tempMin = Math.min(...todayTemps);
      byDate.set(todayIso, entry);
    }
  }

  // 今日・明日は気象庁の天気文(「くもり　所により　雨」等)に実際に「雪」「雨」の
  // 文字が含まれるかで直接判定できる。週間予報(明後日以降)は文章が無く数値の
  // 天気コードしか無いため、気温が氷点下に近いかどうかで雪/雨を推定する
  // (降水があり最高気温が3℃以下なら雪、というのは一般的な目安として妥当)。
  const weatherTextSeries = shortTerm?.timeSeries?.[0];
  const weatherTextArea =
    weatherTextSeries?.areas?.find((a) => a.area?.code === class15Code) ||
    weatherTextSeries?.areas?.find((a) => a.area?.code === class10Code);
  weatherTextSeries?.timeDefines?.forEach((t, i) => {
    const text = weatherTextArea?.weathers?.[i];
    if (!text) return;
    const date = t.slice(0, 10);
    const entry = byDate.get(date) || {};
    entry.weatherText = [entry.weatherText, text].filter(Boolean).join('　');
    byDate.set(date, entry);
  });

  byDate.forEach((entry) => {
    if (entry.weatherText) {
      if (entry.weatherText.includes('雪')) entry.precipCategory = 'snow';
      else if (entry.weatherText.includes('雨')) entry.precipCategory = 'rain';
    } else if (entry.precipitationProbability >= 30) {
      entry.precipCategory = entry.tempMax != null && entry.tempMax <= 3 ? 'snow' : 'rain';
    }
  });

  return byDate;
}
