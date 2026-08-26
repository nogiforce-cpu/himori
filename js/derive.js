// 保存せず都度計算する派生値のロジック
import { localIsoDate } from './date-utils.js';

const BURN_CONSUMPTION_M3 = 0.03; // 「今日、焚いた」1回あたりの消費目安

// 薪棚チェックの項目一覧。check.js(記録画面)とsheets.js(履歴の編集シート)の
// 両方から参照するため、循環importを避けてここに置く。
export const CHECKLIST_ITEMS = [
  { key: 'dryness', label: '乾燥状態' },
  { key: 'pestMold', label: '虫・カビ' },
  { key: 'leakMoisture', label: '雨漏り・湿気' },
  { key: 'airflow', label: '通気・風通し' },
  { key: 'stackCondition', label: '薪の崩れ・整頓' },
];

// チェック項目の評価。「良好/異常あり」の二択だと、はっきり異常とまでは言えないが
// 気になる、というありがちな状態を記録しづらいため、間に「要注意」を挟んだ3段階にする。
export const CHECK_STATE_ORDER = ['good', 'attention', 'warning'];
export const CHECK_STATE_LABELS = { good: '良好', attention: '要注意', warning: '異常あり' };
export function nextCheckState(current) {
  const idx = CHECK_STATE_ORDER.indexOf(current);
  return CHECK_STATE_ORDER[(idx + 1) % CHECK_STATE_ORDER.length];
}
// 複数項目のうち最も深刻な状態を、その回のチェック全体の代表状態とする
// (カレンダーの表示・週次まとめの一覧など、1つの記録を1つの状態で要約したい場面で使う)。
export function overallCheckState(items) {
  const values = Object.values(items || {});
  if (values.includes('warning')) return 'warning';
  if (values.includes('attention')) return 'attention';
  return 'good';
}

export function barColor(pct) {
  if (pct <= 35) return 'var(--red)';
  if (pct <= 55) return 'var(--ember)';
  return 'var(--green)';
}

// 薪棚の乾燥状態(status)にまつわる語彙・色を1箇所にまとめる。以前はホーム・薪棚一覧・
// 薪棚チェックのそれぞれで似た分岐が個別に書かれていたため、言葉がバラバラになる
// リスクがあった(例: 「使用可能」「残量」など画面ごとに違う言い方になる)。
export function shelfStatusLabel(status) {
  if (status === '乾燥済み') return '乾燥薪';
  if (status === '来季用') return '来季用';
  return '乾燥中';
}
export function shelfStatusNote(status) {
  if (status === '乾燥中') return '次の冬へ準備中';
  if (status === '来季用') return '再来季へ準備中';
  return '';
}
export function shelfStatusBadgeColor(status) {
  if (status === '乾燥済み') return 'green';
  if (status === '来季用') return 'khaki';
  return 'amber';
}

export function daysBetween(fromIso, toIso = todayIso()) {
  const from = new Date(fromIso + 'T00:00:00');
  const to = new Date(toIso + 'T00:00:00');
  return Math.round((to - from) / 86400000);
}

export function todayIso() {
  return localIsoDate();
}

// 「163日前」より「8月24日」の方が、いつの記録か直感的に分かる場面で使う共通の
// 日付表示(ホーム「薪のある日々」・薪棚一覧・薪棚チェックなど複数画面で使う)。
export function monthDayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 乾燥済み薪棚を優先し、乾いた順(dryingStartedAtが古い順)に使う。
// 乾燥済みが無ければ乾燥中の中で残量%が最も高いものにフォールバック。
export function recommendShelf(shelves) {
  const dried = shelves.filter((s) => s.status === '乾燥済み');
  if (dried.length > 0) {
    return dried.slice().sort((a, b) => (a.dryingStartedAt < b.dryingStartedAt ? -1 : 1))[0];
  }
  const drying = shelves.filter((s) => s.status === '乾燥中');
  if (drying.length > 0) {
    return drying.slice().sort((a, b) => b.remainingPercent - a.remainingPercent)[0];
  }
  return shelves[0] || null;
}

// レギュラー(メイン)薪棚を解決する。ユーザーが明示的に選んでいればそれを、
// 未設定ならおすすめアルゴリズムの候補を返し、どちらの経緯かをisSuggestionで示す。
export function resolveMainShelf(shelves, profile) {
  const chosen = profile?.mainShelfId ? shelves.find((s) => s.id === profile.mainShelfId) : null;
  if (chosen) return { shelf: chosen, isSuggestion: false };
  return { shelf: recommendShelf(shelves), isSuggestion: true };
}

// 今季の安心度(0-100): 「使える薪の合計 ÷ 今シーズン想定使用量」の割合で表す。
// 以前はチェック状況や経過日数も混ぜた重み付けにしていたが、内訳がブラックボックスで
// 根拠が説明しにくかったため、実際に見える2つの数字(在庫・想定使用量)の比率だけに絞った。
export function computeAnshin(shelves, seasonTargetM3) {
  const usable = shelves
    .filter((s) => s.status !== '来季用')
    .reduce((sum, s) => sum + s.usableVolumeM3, 0);
  const target = seasonTargetM3 > 0 ? seasonTargetM3 : usable || 1;
  return Math.round(Math.min(100, (usable / target) * 100));
}

// オフシーズン判定: 直近windowDays日burnLogsが無ければオフシーズンとみなす(文言の出し分けに使う)
export function isOffSeason(burnLogs, windowDays = 30) {
  if (!burnLogs.length) return true;
  const latest = burnLogs.reduce((max, b) => (b.date > max ? b.date : max), burnLogs[0].date);
  return daysBetween(latest) > windowDays;
}

// 月ベースの季節感(peak=真冬/shoulder=シーズンの前後/off=夏場)。焚いた実績だけでなく
// カレンダー上の季節も加味してひとことコメントを出し分けるために使う。
export function seasonPhase(dateIso = todayIso()) {
  const month = Number(dateIso.slice(5, 7));
  if ([12, 1, 2].includes(month)) return 'peak';
  if ([10, 11, 3, 4].includes(month)) return 'shoulder';
  return 'off';
}

// 焚いた最後の日(無ければnull)
export function lastBurnDate(burnLogs) {
  if (!burnLogs.length) return null;
  return burnLogs.reduce((max, b) => (b.date > max ? b.date : max), burnLogs[0].date);
}

// シーズン終了確認をそろそろ聞いてよいか(進行中シーズンがあり、直近askAfterDays焚いていない)
export function shouldPromptSeasonEnd(currentSeason, burnLogs, askAfterDays = 21) {
  if (!currentSeason) return false;
  const last = lastBurnDate(burnLogs) || currentSeason.startDate;
  return daysBetween(last) >= askAfterDays;
}

// 含水率の表示テキストを3段階で決める: ①実測値があればそれを最優先 ②無くても直近チェックの
// 「乾燥状態」項目(良好/要確認)は誰でも入力できるのでその結果を代わりに出す ③どちらも無ければ
// null(表示しない)。含水計を持っていない人でも何かしらの乾燥情報が見えるようにするための配慮。
export function moistureDisplayText(latestCheck) {
  if (!latestCheck) return null;
  if (latestCheck.moisturePercent != null) return `含水率${latestCheck.moisturePercent}%`;
  const dryness = latestCheck.items?.dryness;
  if (dryness === 'good') return '乾燥状態:良好(実測なし)';
  if (dryness === 'warning') return '乾燥状態:要確認(実測なし)';
  return null;
}

// 「十分乾燥した薪」とみなす含水率の目安(一般的に20%以下が目安とされる)。
// この数値自体はこれまで内部の判定にしか使っておらず、ユーザーには見えていなかった。
// 実測値を入力しても「その数字が良いのか悪いのか」分からないのは不親切なので、
// 含水率の入力欄・履歴の両方でこの閾値を使って明示する。
export const DRY_MOISTURE_THRESHOLD_PERCENT = 20;

// 「そろそろ乾燥薪」の目安ヒント: 乾燥開始から一定日数、または直近チェックの含水率が閾値以下
export function shouldShowDryAdvisory(shelf, latestCheck) {
  if (!shelf || shelf.status !== '乾燥中') return false;
  const daysDrying = shelf.dryingStartedAt ? daysBetween(shelf.dryingStartedAt) : 0;
  const moistureOk = latestCheck?.moisturePercent != null && latestCheck.moisturePercent <= DRY_MOISTURE_THRESHOLD_PERCENT;
  return daysDrying >= 180 || moistureOk;
}

// 焚くペースからの「あと何日分」目安。その薪棚の直近30日の burnLogs から日次消費ペースを推定する
// (データモデルの estimatedDaysLeft は保存値だが、消費や補充のたびに動的に再計算しないと実態と
// ずれるため、表示時は毎回この関数で算出し直す)。
// 直近の記録が少なすぎるとペースが不安定で「あと900日分」のような誤解を招く数字になるため、
// 一定回数に満たない場合はnull(目安なし)を返し、上限も設けて非現実的な桁数を表示しない。
export function estimateDaysLeft(shelf, burnLogs) {
  if (!shelf || shelf.usableVolumeM3 <= 0) return 0;
  const windowDays = 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = localIsoDate(cutoff);
  const recentCount = burnLogs.filter((b) => b.shelfId === shelf.id && b.date >= cutoffIso).length;
  if (recentCount < 3) return null;
  const avgDaily = (recentCount * BURN_CONSUMPTION_M3) / windowDays;
  return Math.min(365, Math.round(shelf.usableVolumeM3 / avgDaily));
}

// 今シーズン使える薪の合計(来季用を除く)が安心ラインを下回っているか
export function isBelowSafetyLine(shelves, safetyLineM3) {
  if (!safetyLineM3) return false;
  const total = shelves
    .filter((s) => s.status !== '来季用')
    .reduce((sum, s) => sum + s.usableVolumeM3, 0);
  return total < safetyLineM3;
}

// 薪追加を反映した薪棚の更新パッチを返す。薪棚の総容量は物理的な棚のサイズで
// 決まっており、薪を追加したからといって棚自体が大きくなるわけではないため、
// 以前は総容量も一緒に引き上げていたが、総容量で頭打ちにするよう変更した。
// 超過分はoverflowM3として返し、呼び出し側でユーザーに知らせる。
export function applyWoodAddition(shelf, addedVolumeM3) {
  const total = shelf.totalVolumeM3;
  const usableRaw = shelf.usableVolumeM3 + addedVolumeM3;
  const usable = Math.min(usableRaw, total);
  const overflowM3 = Math.round((usableRaw - usable) * 100) / 100;
  const remainingPercent = total ? Math.round((usable / total) * 100) : 0;
  return {
    patch: { usableVolumeM3: Math.round(usable * 100) / 100, remainingPercent },
    overflowM3,
  };
}

// 日曜始まり週の {start, end}(ISO日付)を offsetWeeks 週分ずらして返す
export function weekRange(offsetWeeks = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetWeeks * 7);
  const dow = now.getDay(); // 0=日
  const start = new Date(now);
  start.setDate(now.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: localIsoDate(start), end: localIsoDate(end) };
}

export function formatWeekLabel(range) {
  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
  };
  return `${fmt(range.start)}〜${fmt(range.end)}`;
}

function inRange(dateIso, range) {
  return dateIso >= range.start && dateIso <= range.end;
}

export function weeklyStats(range, { burnLogs, woodAdditions, anshinHistory, splitLogs, checks }) {
  const burnsInWeek = burnLogs.filter((b) => inRange(b.date, range));
  const additionsInWeek = woodAdditions.filter((a) => inRange(a.date, range));
  const checksInWeek = checks.filter((c) => inRange(c.date, range));
  const splitsInWeek = (splitLogs || []).filter((s) => inRange(s.date, range));

  const usedVolume = burnsInWeek.length * BURN_CONSUMPTION_M3;

  const inWeekScores = anshinHistory.filter((e) => inRange(e.date, range));
  const beforeWeekScores = anshinHistory.filter((e) => e.date < range.start);
  const startScore = beforeWeekScores.length
    ? beforeWeekScores[beforeWeekScores.length - 1].score
    : inWeekScores[0]?.score ?? null;
  const endScore = inWeekScores.length
    ? inWeekScores[inWeekScores.length - 1].score
    : startScore;
  const anshinDelta = startScore != null && endScore != null ? endScore - startScore : null;

  return {
    burnCount: burnsInWeek.length,
    usedVolumeM3: Math.round(usedVolume * 100) / 100,
    anshinDelta,
    currentScore: endScore,
    checksInWeek,
    splitCount: splitsInWeek.length,
    splitVolumeM3: Math.round(splitsInWeek.reduce((s, e) => s + (e.volumeM3 || 0), 0) * 100) / 100,
    splitVolumeUnknown: splitsInWeek.some((e) => e.volumeM3 == null),
    trendPoints: inWeekScores,
    additionsCount: additionsInWeek.length,
  };
}

export function summaryText(stats, offSeason) {
  // オフシーズン中は「0回焚きました」が当然の結果になり違和感があるため、焚いていない週は
  // シーズン中かどうかで文言を出し分ける(チェックだけ実施していれば冬支度の進捗として触れる)。
  if (offSeason && stats.burnCount === 0) {
    return stats.checksInWeek.length > 0
      ? 'オフシーズンですが、薪棚チェックをして冬支度を進められました。'
      : '今はオフシーズンのようです。次のシーズンに向けて薪棚を整えておくと安心です。';
  }
  if (stats.burnCount === 0 && stats.checksInWeek.length === 0) {
    return 'この週の記録はまだありません。焚いたら「今日、焚いた」をタップして残しておきましょう。';
  }
  const parts = [];
  parts.push(`今週は${stats.burnCount}回焚きました。`);
  if (stats.anshinDelta != null) {
    if (stats.anshinDelta > 0) parts.push(`薪の充足率は先週より${stats.anshinDelta}%上がっています。`);
    else if (stats.anshinDelta < 0) parts.push(`薪の充足率は先週より${Math.abs(stats.anshinDelta)}%下がっています。`);
    else parts.push('薪の充足率は先週から変わっていません。');
  }
  if (stats.checksInWeek.length > 0) parts.push('薪棚チェックも実施できました。');
  return parts.join('');
}


// 平衡含水率(EMC): ある気温・湿度の空気の中に木材を置き続けたら、最終的に何%の
// 含水率で釣り合うかを表す値。米国森林製品研究所(Forest Products Laboratory)の
// Wood Handbookが採用するSimpson(1973)の近似式。「湿度が高くても気温が高ければ
// 乾きやすい」という体感を、固定の湿度しきい値ではなく物理的な根拠のある1つの
// 数値に落とし込むために使う。既知の参考値(70°F/50%RHで約9%等)で検算済み。
function equilibriumMoistureContent(tempC, rhPercent) {
  const T = (tempC * 9) / 5 + 32; // 式が華氏(°F)前提のため変換
  const h = Math.min(Math.max(rhPercent, 0), 100) / 100;
  const W = 330 + 0.452 * T + 0.00415 * T * T;
  const K = 0.791 + 0.000463 * T - 0.000000844 * T * T;
  const K1 = 6.34 + 0.000775 * T - 0.0000935 * T * T;
  const K2 = 1.09 + 0.0284 * T - 0.0000904 * T * T;
  const Kh = K * h;
  const term1 = Kh / (1 - Kh);
  const term2 = (K1 * Kh + 2 * K1 * K2 * Kh * Kh) / (1 + K1 * Kh + K1 * K2 * Kh * Kh);
  return (1800 / W) * (term1 + term2);
}

// 「十分乾燥した薪」の目安(DRY_MOISTURE_THRESHOLD_PERCENT=20%)まで薪が乾き続けるには、
// 空気の平衡含水率がそれより十分低い必要がある。木材乾燥でよく使われる「よく乾く日」の
// 目安(EMC 15%以下)を採用。降水量は、夕立程度の一時的な雨なら乾燥の妨げにならないと
// 考え、しきい値を緩めている(以前は0.2mmとほぼ無降水限定だった)。
const DRY_FRIENDLY_EMC_THRESHOLD = 15;
const DRY_FRIENDLY_PRECIP_MM = 2;
export function dryFriendlyDaysCount(dailyWeather) {
  if (!dailyWeather || !dailyWeather.length) return null;
  return dailyWeather.filter(
    (d) =>
      d.precipitationSum <= DRY_FRIENDLY_PRECIP_MM &&
      equilibriumMoistureContent(d.tempMax, d.humidityMean) <= DRY_FRIENDLY_EMC_THRESHOLD
  ).length;
}

// 写真1枚が「どの薪棚の記録か」を、新しい永続フィールドを増やさずに逆引きする。
// 薪棚の記録用写真はshelf.photoIdsに積まれ、薪追加時の写真はwoodAddition.photoIdに
// 個別に紐づくため、この2箇所だけ確認すれば十分(メンテ・ストーブ写真は薪棚に紐付かない)。
export function resolvePhotoShelfId(photoId, shelves, woodAdditions) {
  const shelf = shelves.find((s) => s.photoIds?.includes(photoId));
  if (shelf) return shelf.id;
  const addition = woodAdditions.find((a) => a.photoId === photoId);
  return addition ? addition.shelfId : null;
}

// 樹種ごとの「最初に記録された日」を、既存データ(薪追加・樹種写真)から逆算する。
// 樹種名を手入力しただけでまだ薪追加も写真も無い場合は日付が無いので、その樹種は含めない
// (無い日付を新たに作り出さない)。
export function firstWoodTypeDates(woodAdditions, photos) {
  const map = new Map();
  const consider = (name, date) => {
    if (!name || !date) return;
    const cur = map.get(name);
    if (!cur || date < cur) map.set(name, date);
  };
  woodAdditions.forEach((a) => consider(a.woodType, a.date));
  photos.filter((p) => p.category === '樹種').forEach((p) => consider(p.woodType, p.date));
  return map;
}

function photoEventText(photo) {
  if (photo.category === '薪棚') return '薪棚の様子を記録しました';
  if (photo.category === 'ストーブ') return '愛機の写真を残しました';
  if (photo.category === '樹種') return `${photo.woodType ?? '樹種'}を記録しました`;
  if (photo.category === 'メンテ') return 'メンテナンスの写真を残しました';
  return '写真を残しました';
}

// カレンダー・アルバム・ホームを横断する「共通の出来事」アダプター。今日焚いた・薪割り・
// 薪追加・薪棚チェック・メンテナンスという保存形式の異なるデータを、表示のたびに同じ形へ
// 正規化するだけで、新しいイベントDBへ書き出したり永続化したりはしない(薄い変換)。
// 写真は、対応するイベント(その薪棚のその日のチェックなど)のthumbとして優先的に使い、
// どのイベントとも紐付かなかった写真だけを単独の'photo'イベントとして追加する
// (同じ写真が二重に出てくることを避けるため)。
export function buildLivingWithWoodEvents({ shelves, woodAdditions, splitLogs, checks, burnLogs, maintenanceLogs, photos }) {
  const shelfName = (id) => shelves.find((s) => s.id === id)?.name ?? '薪棚';
  const events = [];
  const usedPhotoIds = new Set();
  const takePhoto = (photoId) => {
    if (!photoId) return null;
    const photo = photos.find((p) => p.id === photoId);
    if (photo) usedPhotoIds.add(photo.id);
    return photo || null;
  };

  burnLogs.forEach((b) => {
    events.push({ date: b.date, type: 'burn', icon: '#i-flame', iconColor: 'var(--ember)', photo: null, shelfId: b.shelfId, text: '今日、火を焚きました' });
  });
  woodAdditions.forEach((a) => {
    events.push({
      date: a.date,
      type: 'addition',
      icon: '#i-plus',
      iconColor: 'var(--green)',
      photo: takePhoto(a.photoId),
      shelfId: a.shelfId,
      woodType: a.woodType || null,
      text: `${shelfName(a.shelfId)}に${a.addedVolumeM3}m³追加`,
    });
  });
  splitLogs.forEach((s) => {
    events.push({ date: s.date, type: 'split', img: 'assets/icon-axe.png', photo: null, shelfId: null, text: s.volumeM3 ? `薪割りをしました(${s.volumeM3}m³)` : '薪割りをしました' });
  });
  checks.forEach((c) => {
    events.push({ date: c.date, type: 'check', icon: '#i-check', photo: null, shelfId: c.shelfId, text: `${shelfName(c.shelfId)}を記録しました` });
  });
  maintenanceLogs.forEach((m) => {
    events.push({ date: m.date, type: 'maintenance', icon: '#i-wrench', photo: takePhoto(m.photoId), shelfId: null, text: `${m.type}をしました` });
  });
  // 「薪棚の記録」写真(shelf.photoIds)は、同じ薪棚・同じ日のチェックイベントがあれば
  // そちらのthumbに添える(その日の記録の一部として見える方が自然なため)。
  shelves.forEach((s) => {
    (s.photoIds || []).forEach((pid) => {
      if (usedPhotoIds.has(pid)) return;
      const photo = photos.find((p) => p.id === pid);
      if (!photo) return;
      const sameDayCheck = events.find((e) => e.type === 'check' && e.shelfId === s.id && e.date === photo.date && !e.photo);
      if (sameDayCheck) {
        sameDayCheck.photo = photo;
        usedPhotoIds.add(pid);
      }
    });
  });
  // 残った写真(どのイベントとも紐付かなかったもの)は、単独の記録として追加する
  photos.forEach((p) => {
    if (usedPhotoIds.has(p.id)) return;
    events.push({ date: p.date, type: 'photo', icon: '#i-image', photo: p, shelfId: null, text: photoEventText(p) });
  });

  const typeOrder = { burn: 0, check: 1, addition: 2, split: 3, maintenance: 4, photo: 5 };
  events.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : typeOrder[a.type] - typeOrder[b.type]));
  return events;
}

export function stoveYears(purchaseDateIso) {
  if (!purchaseDateIso) return null;
  const days = daysBetween(purchaseDateIso);
  return Math.max(1, Math.floor(days / 365) + 1);
}

export { BURN_CONSUMPTION_M3 };
