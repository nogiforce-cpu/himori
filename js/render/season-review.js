// シーズン振り返り(「この冬と、火の記録」)。単なる気象統計画面ではなく、既存の
// 出来事アダプター(buildLivingWithWoodEvents)・樹種の初記録(firstWoodTypeDates)・
// 気温の実測記録(weatherHistory)といった、既にHIMORIが持っているデータだけを
// 組み合わせて「その季節を振り返れる場所」にする。新しい永続データ構造は作らない。
import {
  getSeasons,
  getShelves,
  getBurnLogs,
  getWoodAdditions,
  getSplitLogs,
  getChecks,
  getMaintenanceLogs,
  getPhotos,
  getWeatherHistory,
} from '../store.js';
import { buildLivingWithWoodEvents, firstWoodTypeDates, monthDayLabel, BURN_CONSUMPTION_M3 } from '../derive.js';
import { openOverlay, closeOverlay } from '../ui.js';
import { eventRowHtml } from './event-row.js';

function inRange(dateIso, start, end) {
  return dateIso >= start && (!end || dateIso < end);
}

function seasonLabel(season) {
  const startYear = Number(season.startDate.slice(0, 4));
  const endYear = season.endDate ? Number(season.endDate.slice(0, 4)) : startYear + 1;
  return startYear === endYear ? `${startYear}` : `${startYear}–${String(endYear).slice(2)}`;
}

// 月平均最低気温が最も低かった月について、「気温が低い月だった」という事実と
// 「その月の薪使用量」という事実を、因果や相関を示唆せずに並べるだけの一文にする。
// 以前は「その月の焚いた日数が季節内で最多かどうか」も条件にして、両方が一致した
// 時だけ「薪を使うペースも大きかったようです」という一文で結んでいたが、これは
// 「寒かったから薪を多く使った」という因果関係をHIMORI側が示唆しているように読めて
// しまうため、単純に2つの事実を別々の文として並べる形に変更した。
function seasonalNote(burnLogs, weatherHistory, start, end) {
  const monthKey = (d) => d.slice(0, 7);
  const tempsByMonth = new Map();
  weatherHistory
    .filter((w) => inRange(w.date, start, end) && w.tempMin != null)
    .forEach((w) => {
      const k = monthKey(w.date);
      const list = tempsByMonth.get(k) || [];
      list.push(w.tempMin);
      tempsByMonth.set(k, list);
    });
  if (!tempsByMonth.size) return null;

  const coldestMonth = [...tempsByMonth.entries()].sort(
    (a, b) => a[1].reduce((s, v) => s + v, 0) / a[1].length - (b[1].reduce((s, v) => s + v, 0) / b[1].length)
  )[0]?.[0];
  if (!coldestMonth) return null;
  const monthNum = Number(coldestMonth.slice(5, 7));
  const burnsInMonth = burnLogs.filter((b) => monthKey(b.date) === coldestMonth).length;
  const monthVolumeM3 = Math.round(burnsInMonth * BURN_CONSUMPTION_M3 * 100) / 100;
  const lines = [`${monthNum}月は低い気温の日が多い月でした。`];
  if (burnsInMonth > 0) lines.push(`${monthNum}月の薪使用量は${monthVolumeM3}m³でした。`);
  return lines;
}

function statRow(label, value) {
  if (value == null) return '';
  return `<div class="stat-card"><div class="label-sm">${label}</div><div class="n">${value}</div></div>`;
}

export function openSeasonReviewSheet(seasonId) {
  const season = getSeasons().find((s) => s.id === seasonId);
  if (!season) return;
  const start = season.startDate;
  const end = season.endDate;

  const burnLogs = getBurnLogs().filter((b) => inRange(b.date, start, end));
  const burnDays = new Set(burnLogs.map((b) => b.date)).size;
  const usedVolumeM3 = Math.round(burnLogs.length * BURN_CONSUMPTION_M3 * 100) / 100;

  // シーズン振り返りには確定済み(confirmed !== false)の日データだけを使う。
  // 当日分の実測はまだ最低/最高が変わりうる未確定値のため、季節の統計には含めない。
  const weatherHistory = getWeatherHistory().filter(
    (w) => inRange(w.date, start, end) && w.tempMin != null && w.confirmed !== false
  );
  const lowestTemp = weatherHistory.length ? Math.min(...weatherHistory.map((w) => w.tempMin)) : null;
  const belowZeroDays = weatherHistory.filter((w) => w.tempMin < 0).length;
  // 「◯◯観測所」と単独の観測点名を名乗るのは、この季節の記録が全てその観測点由来
  // だと確認できた時だけにする(一部だけ古い記録・出典不明な記録が混ざっている場合に
  // 「世羅観測所」と言い切ってしまうと、実際とは違う出典を示すことになるため)。
  const allFromSameStation = weatherHistory.length > 0 && weatherHistory.every((w) => w.stationName === weatherHistory[0].stationName && w.stationName);
  const tempSourceLabel = allFromSameStation
    ? `気温:${weatherHistory[0].stationName}観測所(気象庁)`
    : weatherHistory.length
      ? '気温:気象庁の発表に基づく記録'
      : '';

  const woodTypeFirstDates = firstWoodTypeDates(getWoodAdditions(), getPhotos());
  const woodTypesMet = [...woodTypeFirstDates.values()].filter((d) => inRange(d, start, end)).length;

  const note = seasonalNote(burnLogs, weatherHistory, start, end);

  const allEvents = buildLivingWithWoodEvents({
    shelves: getShelves(),
    woodAdditions: getWoodAdditions(),
    splitLogs: getSplitLogs(),
    checks: getChecks(),
    burnLogs: getBurnLogs(),
    maintenanceLogs: getMaintenanceLogs(),
    photos: getPhotos(),
  }).filter((e) => inRange(e.date, start, end));
  const shownEvents = allEvents.slice(0, 10);
  const eventsHtml = shownEvents.length
    ? shownEvents.map((e) => eventRowHtml(e, monthDayLabel(e.date))).join('')
    : `<div class="empty" style="padding:10px 4px">この季節の記録はまだありません。</div>`;

  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:4px">
        <span class="sheet-title" style="margin-bottom:0">${seasonLabel(season)}</span>
        <button class="iconbtn" id="season-review-close"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div style="font-size:calc(15px * var(--font-scale));font-weight:700;color:var(--khaki);margin-bottom:14px">この冬と、火の記録</div>

      <div class="stat-grid" style="margin-bottom:6px">
        ${statRow('火を焚いた日', `${burnDays}日`)}
        ${statRow('使った薪', `${usedVolumeM3}m³`)}
        ${lowestTemp != null ? statRow('いちばん低かった最低気温', `${lowestTemp}℃`) : ''}
        ${weatherHistory.length ? statRow('氷点下だった日', `${belowZeroDays}日`) : ''}
        ${woodTypesMet > 0 ? statRow('出会った樹種', `${woodTypesMet}種`) : ''}
      </div>
      ${tempSourceLabel ? `<div class="label-sm" style="margin-bottom:14px">${tempSourceLabel}</div>` : ''}
      ${note ? `<div class="card" style="font-size:calc(12px * var(--font-scale));line-height:1.7;margin-bottom:14px">${note.join('<br>')}</div>` : ''}

      <div class="label-sm" style="font-weight:700;margin-bottom:6px">この季節の出来事</div>
      <div>${eventsHtml}</div>
    </div>
  `);
  ov.querySelector('#season-review-close').addEventListener('click', () => closeOverlay());
}
