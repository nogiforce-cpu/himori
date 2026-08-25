import {
  getBurnLogs,
  getMaintenanceLogs,
  getPhotos,
  getChecks,
  getWoodAdditions,
  getSplitLogs,
  getSeasons,
  getShelves,
  getWeatherHistory,
  getProfile,
} from '../store.js';
import {
  lastBurnDate,
  todayIso,
  overallCheckState,
  buildLivingWithWoodEvents,
  firstWoodTypeDates,
} from '../derive.js';
import { openOverlay } from '../ui.js';
import { state } from '../state.js';
import { localIsoDate } from '../date-utils.js';
import { eventRowHtml } from './event-row.js';

// カレンダー・日別詳細の両方で使う「今の全記録」。呼ぶたびに毎回組み立てる薄い変換で、
// 新しいイベントDBへ書き出したりはしない(ホームの「薪のある日々」と同じアダプター)。
function allEvents() {
  return buildLivingWithWoodEvents({
    shelves: getShelves(),
    woodAdditions: getWoodAdditions(),
    splitLogs: getSplitLogs(),
    checks: getChecks(),
    burnLogs: getBurnLogs(),
    maintenanceLogs: getMaintenanceLogs(),
    photos: getPhotos(),
  });
}

function inMonth(dateIso, year, month) {
  return dateIso.slice(0, 4) === String(year) && Number(dateIso.slice(5, 7)) === month + 1;
}

function monthRange(offset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  return { year: first.getFullYear(), month: first.getMonth(), daysInMonth, startWeekday: first.getDay() };
}

function iso(year, month, day) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function render() {
  const { year, month, daysInMonth, startWeekday } = monthRange(state.calendarMonthOffset);
  document.getElementById('cal-month-label').textContent = `${year}年${month + 1}月`;
  // ＜＞での1ヶ月ずつの移動に加え、ラベルをタップするとネイティブの年月ピッカー
  // (iOSではドラムロール状のホイール)で一気に遠い月へ移動できるようにする。
  // 「カレンダー」なので過去だけでなく未来へも制限なく移動できる。
  const monthPickerEl = document.getElementById('cal-month-picker');
  monthPickerEl.value = `${year}-${String(month + 1).padStart(2, '0')}`;

  const burnLogs = getBurnLogs();
  const maintenanceLogs = getMaintenanceLogs();
  const photos = getPhotos();
  const today = todayIso();
  const lastBurn = lastBurnDate(burnLogs);
  const seasons = getSeasons();

  const weatherHistory = getWeatherHistory();
  const weatherByDate = new Map(weatherHistory.map((w) => [w.date, w]));

  const allChecks = getChecks();
  const woodAdditions = getWoodAdditions();
  const splitLogs = getSplitLogs();
  const burnDates = new Set(burnLogs.map((b) => b.date));
  const maintDates = new Set(maintenanceLogs.map((m) => m.date));
  const photoDates = new Set(photos.map((p) => p.date));
  // 薪割り・薪追加・薪棚チェックも「同じ暮らしの一部」として見えるよう、まとめて
  // 1つの小さな緑ドットで示す(焚いた/メンテ/写真と並べて4種もアイコンを増やすと
  // マスの中が煩雑になるため、種類ごとに分けず「薪仕事をした日」として1つにまとめる)。
  const workDates = new Set([
    ...woodAdditions.map((a) => a.date),
    ...splitLogs.map((s) => s.date),
    ...allChecks.map((c) => c.date),
  ]);
  // 「良好」ではなかったチェックの日だけを特別扱いする(良好なチェックは日常の記録なので、
  // マスの中で毎回目立たせる必要はない → タップした日別詳細で見れば十分)。
  // 「要注意」「異常あり」はどちらも良好ではない状態としてまとめてマスの縁で示す。
  const warningCheckDates = new Set(
    allChecks.filter((c) => overallCheckState(c.items) !== 'good').map((c) => c.date)
  );
  const seasonStartDates = new Set(seasons.map((s) => s.startDate));
  const seasonEndDates = new Set(seasons.filter((s) => s.endDate).map((s) => s.endDate));
  const nextChimney = getProfile()?.nextChimneyCleaning;

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push('<div class="cal-day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const dateIso = iso(year, month, d);
    const classes = ['cal-day'];
    if (dateIso === today) classes.push('today');
    if (dateIso === lastBurn) classes.push('last-burn');
    if (warningCheckDates.has(dateIso)) classes.push('warn');
    // 色分けされたドットだけだと意味が伝わりにくいため、それぞれの出来事を表す小さな
    // アイコンに置き換える(炎=焚いた、レンチ=メンテ、写真=撮影)。異常チェックはマス全体の
    // 赤いリングで表す(today/last-burnと同じ「特別な日はマスの縁で示す」パターンに統一)。
    const icons = [];
    if (burnDates.has(dateIso)) {
      icons.push('<svg class="icon ic-burn" viewBox="0 0 24 24"><use href="#i-flame"/></svg>');
    }
    if (workDates.has(dateIso)) {
      icons.push('<svg class="icon ic-work" viewBox="0 0 24 24"><use href="#i-plus"/></svg>');
    }
    if (maintDates.has(dateIso)) {
      icons.push('<svg class="icon ic-maint" viewBox="0 0 24 24"><use href="#i-wrench"/></svg>');
    }
    if (photoDates.has(dateIso)) {
      icons.push('<svg class="icon ic-photo" viewBox="0 0 24 24"><use href="#i-image"/></svg>');
    }
    // シーズン開始は炎アイコン(ブランドの炎モチーフ)、終了は天気アイコンと紛らわしい絵文字を避けて
    // 「終」の文字バッジで表す
    // 予定(まだ起きていない未来のこと)は実績と混同しないよう、点線の縁取りバッジで
    // 「これから」感を出す(実績のアイコンは塗りつぶし、予定は輪郭のみ)
    const seasonMark = seasonStartDates.has(dateIso)
      ? '<span class="cal-season-mark"><svg class="icon" viewBox="0 0 24 24" style="width:10px;height:10px;color:var(--ember)"><use href="#i-flame"/></svg></span>'
      : seasonEndDates.has(dateIso)
        ? '<span class="cal-season-mark cal-season-end">終</span>'
        : dateIso === nextChimney
          ? '<span class="cal-season-mark cal-plan-mark">予定</span>'
          : '';
    const w = weatherByDate.get(dateIso);
    // セルの横幅が狭いため「最低:」を付けると崩れやすい。数字だけでも青バッジの
    // 見た目で「気温(寒さの目安)」だと伝わるので、コンパクトさを優先する。
    const tempHtml = w ? `<span class="cal-temp">${w.tempMin}℃</span>` : '';
    cells.push(`
      <div class="${classes.join(' ')}" data-action="open-cal-day" data-date="${dateIso}">
        <div class="cal-day-top"><span>${d}</span>${seasonMark}</div>
        <span class="cal-icons">${icons.join('')}</span>
        ${tempHtml}
      </div>
    `);
  }
  document.getElementById('cal-grid').innerHTML = cells.join('');

  // 今月のまとめ: 「回数」ではなく「日数」で数える(同じ日に何度記録しても暮らしの
  // 実感としては1日分。焚いた日数はホームの「今季◯日、火を焚きました」と考え方を揃える)。
  // 薪割りと薪追加は「薪づくり」として1つにまとめ、項目を絞って情報過多にしない。
  // 何も記録が無い月は数字の0を並べず、素直な空状態の一言にする。
  const monthBurns = burnLogs.filter((b) => inMonth(b.date, year, month));
  const monthChecks = getChecks().filter((c) => inMonth(c.date, year, month));
  const monthMaint = maintenanceLogs.filter((m) => inMonth(m.date, year, month));
  const monthAdditions = getWoodAdditions().filter((a) => inMonth(a.date, year, month));
  const monthSplits = getSplitLogs().filter((s) => inMonth(s.date, year, month));
  const burnDays = new Set(monthBurns.map((b) => b.date)).size;
  const workDays = new Set([...monthAdditions.map((a) => a.date), ...monthSplits.map((s) => s.date)]).size;
  const checkDays = new Set(monthChecks.map((c) => c.date)).size;
  const summaryEl = document.getElementById('cal-month-summary');
  if (summaryEl) {
    const summaryIcon = (symbol, extra = '') =>
      `<svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px${extra}"><use href="${symbol}"/></svg>`;
    const rows = [];
    if (burnDays > 0) rows.push(`${summaryIcon('#i-flame', ';color:var(--ember)')}火を焚いた日 ${burnDays}日`);
    if (workDays > 0) rows.push(`<img src="assets/icon-axe.png" alt="" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;object-fit:contain">薪づくり ${workDays}日`);
    if (checkDays > 0) rows.push(`${summaryIcon('#i-check')}薪棚の記録 ${checkDays}日`);
    if (monthMaint.length > 0) rows.push(`${summaryIcon('#i-wrench')}メンテナンス ${monthMaint.length}回`);
    summaryEl.innerHTML = rows.length
      ? `<div class="label-sm" style="margin-bottom:6px">今月のまとめ</div><div style="font-size:calc(12px * var(--font-scale));line-height:1.9">${rows.join('<br>')}</div>`
      : `<div class="empty" style="padding:6px 4px">まだ記録のない月です。火を焚いたり、薪仕事を記録するとここに残ります。</div>`;
  }

  const currentSeason = seasons.find((s) => !s.endDate);
  const seasonNoteEl = document.getElementById('cal-season-note');
  if (currentSeason) {
    seasonNoteEl.textContent = `今シーズン開始: ${currentSeason.startDate}${lastBurn ? `・最後に焚いた日: ${lastBurn}(「終」マークは終了日)` : ''}`;
  } else if (seasons.length) {
    const last = seasons[seasons.length - 1];
    seasonNoteEl.textContent = `前シーズン: ${last.startDate} 〜 ${last.endDate}`;
  } else {
    seasonNoteEl.textContent = '';
  }
}

export function calPrev() {
  state.calendarMonthOffset -= 1;
  render();
}
export function calNext() {
  state.calendarMonthOffset += 1;
  render();
}

// 年月ピッカー(input type="month")で選ばれた年月へ一気に移動する
export function pickMonth(value) {
  if (!value) return;
  const [y, m] = value.split('-').map(Number);
  const now = new Date();
  state.calendarMonthOffset = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  render();
}

function lastYearSameDay(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  d.setFullYear(d.getFullYear() - 1);
  return localIsoDate(d);
}

// 「去年の今日」何をしていたかを一言で表す。シーズン開始/終了・メンテ記録があれば拾う
// (焚いた/チェックなどの日常記録まで遡ると情報過多になるので、節目になる出来事だけに絞る)
function lastYearHighlights(dateIso) {
  const lastYearIso = lastYearSameDay(dateIso);
  const highlights = [];
  getSeasons().forEach((s) => {
    if (s.startDate === lastYearIso) highlights.push('<svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px;color:var(--ember)"><use href="#i-flame"/></svg>昨年の焚き始めの日でした');
    if (s.endDate === lastYearIso) highlights.push('昨年のシーズン締めの日でした');
  });
  getMaintenanceLogs()
    .filter((m) => m.date === lastYearIso)
    .forEach((m) => highlights.push(`<svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px"><use href="#i-wrench"/></svg>昨年、${m.type}をしました`));
  return highlights;
}

// その日のイベントに、種類ごとに意味のある補足を1つだけ添える(残量目安・購入先や
// 価格・メモなど)。「check ID:xxx」のような内部データそのものではなく、既存の履歴表示
// (旧history-row)が見せていた情報を、event-rowの補足行として引き継ぐだけにとどめる。
function subLineFor(e, { checks, additions, burns, maint }) {
  if (e.type === 'check') {
    const c = checks.find((x) => x.shelfId === e.shelfId);
    if (!c) return '';
    const state = overallCheckState(c.items);
    const label = state === 'good' ? '良好' : state === 'attention' ? '要注意' : '異常あり';
    return `残り目安${c.remainingPercent}%・${label}`;
  }
  if (e.type === 'addition') {
    const a = additions.find((x) => x.shelfId === e.shelfId);
    const parts = [];
    if (a?.source) parts.push(a.source);
    if (a?.price != null) parts.push(`¥${a.price.toLocaleString()}`);
    return parts.join('・');
  }
  if (e.type === 'burn') {
    const b = burns.find((x) => x.shelfId === e.shelfId && x.note);
    return b?.note || '';
  }
  if (e.type === 'maintenance') {
    const m = maint.find((x) => `${x.type}をしました` === e.text);
    return m?.memo || '';
  }
  return '';
}

export function openCalDay(dateIso) {
  const checks = getChecks().filter((c) => c.date === dateIso);
  const additions = getWoodAdditions().filter((a) => a.date === dateIso);
  const burns = getBurnLogs().filter((b) => b.date === dateIso);
  const maint = getMaintenanceLogs().filter((m) => m.date === dateIso);
  const events = allEvents().filter((e) => e.date === dateIso);
  const isChimneyPlan = getProfile()?.nextChimneyCleaning === dateIso;
  const seasonStart = getSeasons().find((s) => s.startDate === dateIso);
  const seasonEnd = getSeasons().find((s) => s.endDate === dateIso);
  const firstWoodType = firstWoodTypeDates(getWoodAdditions(), getPhotos());
  const newWoodTypeNames = Array.from(firstWoodType.entries())
    .filter(([, d]) => d === dateIso)
    .map(([name]) => name);

  const sections = [];
  if (isChimneyPlan) {
    sections.push(
      `<div class="banner" style="margin:0 0 10px"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-wrench"/></svg><span>この日は煙突・触媒清掃の予定日です</span></div>`
    );
  }
  if (seasonStart) {
    sections.push(
      `<div class="banner" style="margin:0 0 10px"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px;color:var(--ember)"><use href="#i-flame"/></svg><span>今季の初焚きです</span></div>`
    );
  }
  if (seasonEnd) {
    sections.push(
      `<div class="banner" style="margin:0 0 10px"><span>今シーズンを締めた日です</span></div>`
    );
  }
  newWoodTypeNames.forEach((name) => {
    sections.push(
      `<div class="banner" style="margin:0 0 10px"><img src="assets/icon-woodtype.png" alt="" style="width:16px;height:16px;object-fit:contain"><span>${name}という樹種を初めて記録しました</span></div>`
    );
  });
  if (events.length) {
    sections.push(events.map((e) => eventRowHtml(e, subLineFor(e, { checks, additions, burns, maint }))).join(''));
  }
  const lastYear = lastYearHighlights(dateIso);
  if (lastYear.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:14px 0 4px">去年の今日(${lastYearSameDay(dateIso)})</div>` +
        lastYear.map((h) => `<div class="history-row"><span>${h}</span><span></span></div>`).join('')
    );
  }

  openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">${dateIso}</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      ${sections.length ? sections.join('') : '<div class="empty">この日の記録はありません。</div>'}
    </div>
  `);
}

// アルバムの写真から「その日の記録」へ戻れるようにする導線。対象日の月へカレンダーを
// 合わせ、週次まとめを見ていた場合もカレンダー表示に切り替えてから日別詳細を開く
// (app.jsのsetReviewViewと同じ表示切り替えだが、循環importを避けるためここで完結させる)。
export function focusOnDate(dateIso) {
  const now = new Date();
  const target = new Date(dateIso + 'T00:00:00');
  state.calendarMonthOffset = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  state.reviewView = 'calendar';
  const calEl = document.getElementById('review-view-calendar');
  const weekEl = document.getElementById('review-view-weekly');
  const titleEl = document.getElementById('review-title');
  if (calEl) calEl.style.display = '';
  if (weekEl) weekEl.style.display = 'none';
  if (titleEl) titleEl.textContent = 'カレンダー';
  document.querySelectorAll('#review-view-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === 'calendar');
  });
  render();
  openCalDay(dateIso);
}
