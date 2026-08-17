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

export function barColor(pct) {
  if (pct <= 35) return 'var(--red)';
  if (pct <= 55) return 'var(--ember)';
  return 'var(--green)';
}

export function daysBetween(fromIso, toIso = todayIso()) {
  const from = new Date(fromIso + 'T00:00:00');
  const to = new Date(toIso + 'T00:00:00');
  return Math.round((to - from) / 86400000);
}

export function todayIso() {
  return localIsoDate();
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

// 薪追加を反映した薪棚の更新パッチを返す(総量を超える場合は総量も引き上げる)
export function applyWoodAddition(shelf, addedVolumeM3) {
  let usable = shelf.usableVolumeM3 + addedVolumeM3;
  let total = shelf.totalVolumeM3;
  if (usable > total) total = Math.round(usable * 100) / 100;
  const remainingPercent = total ? Math.round((usable / total) * 100) : 0;
  return {
    usableVolumeM3: Math.round(usable * 100) / 100,
    totalVolumeM3: total,
    remainingPercent,
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


// 乾燥に適した日(低湿度・降水なし)のカウント。予測日数には使わず参考表示のみ(取得したdailyは今日から先の予報)
export function dryFriendlyDaysCount(dailyWeather) {
  if (!dailyWeather || !dailyWeather.length) return null;
  return dailyWeather.filter((d) => d.precipitationSum <= 0.2 && d.humidityMean <= 65).length;
}

export function stoveYears(purchaseDateIso) {
  if (!purchaseDateIso) return null;
  const days = daysBetween(purchaseDateIso);
  return Math.max(1, Math.floor(days / 365) + 1);
}

export { BURN_CONSUMPTION_M3 };
