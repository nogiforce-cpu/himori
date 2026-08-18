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
import { lastBurnDate, todayIso, BURN_CONSUMPTION_M3, overallCheckState } from '../derive.js';
import { openOverlay } from '../ui.js';
import { state } from '../state.js';
import { localIsoDate } from '../date-utils.js';

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
  const burnDates = new Set(burnLogs.map((b) => b.date));
  const maintDates = new Set(maintenanceLogs.map((m) => m.date));
  const photoDates = new Set(photos.map((p) => p.date));
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
    if (maintDates.has(dateIso)) {
      icons.push('<svg class="icon ic-maint" viewBox="0 0 24 24"><use href="#i-wrench"/></svg>');
    }
    if (photoDates.has(dateIso)) {
      icons.push('<svg class="icon ic-photo" viewBox="0 0 24 24"><use href="#i-image"/></svg>');
    }
    // シーズン開始は🔥(ブランドの炎モチーフ)、終了は天気アイコンと紛らわしい絵文字を避けて
    // 「終」の文字バッジで表す
    // 予定(まだ起きていない未来のこと)は実績と混同しないよう、点線の縁取りバッジで
    // 「これから」感を出す(実績のアイコンは塗りつぶし、予定は輪郭のみ)
    const seasonMark = seasonStartDates.has(dateIso)
      ? '<span class="cal-season-mark">🔥</span>'
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

  // 今月のまとめ(タップしなくても分かる簡易サマリー)
  const monthBurns = burnLogs.filter((b) => inMonth(b.date, year, month));
  const monthChecks = getChecks().filter((c) => inMonth(c.date, year, month));
  const monthMaint = maintenanceLogs.filter((m) => inMonth(m.date, year, month));
  const monthSplits = getSplitLogs().filter((s) => inMonth(s.date, year, month));
  const usedVolume = Math.round(monthBurns.length * BURN_CONSUMPTION_M3 * 100) / 100;
  const summaryEl = document.getElementById('cal-month-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="label-sm" style="margin-bottom:6px">今月のまとめ</div>
      <div style="font-size:calc(12px * var(--font-scale));line-height:1.9">
        🔥焚いた回数 ${monthBurns.length}回(約${usedVolume}m³)<br>
        ${monthChecks.length > 0 ? `📋薪棚チェック ${monthChecks.length}回<br>` : ''}
        ${monthMaint.length > 0 ? `🔧メンテナンス ${monthMaint.length}回<br>` : ''}
        ${monthSplits.length > 0 ? `🪓薪割り ${monthSplits.length}回` : ''}
      </div>
    `;
  }

  const currentSeason = seasons.find((s) => !s.endDate);
  const seasonNoteEl = document.getElementById('cal-season-note');
  if (currentSeason) {
    seasonNoteEl.textContent = `🔥今シーズン開始: ${currentSeason.startDate}${lastBurn ? `・最後に焚いた日: ${lastBurn}(「終」マークは終了日)` : ''}`;
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
    if (s.startDate === lastYearIso) highlights.push('🔥昨年の焚き始めの日でした');
    if (s.endDate === lastYearIso) highlights.push('昨年のシーズン締めの日でした');
  });
  getMaintenanceLogs()
    .filter((m) => m.date === lastYearIso)
    .forEach((m) => highlights.push(`🔧昨年、${m.type}をしました`));
  return highlights;
}

export function openCalDay(dateIso) {
  const shelves = getShelves();
  const shelfName = (id) => shelves.find((s) => s.id === id)?.name ?? '';
  const burns = getBurnLogs().filter((b) => b.date === dateIso);
  const maint = getMaintenanceLogs().filter((m) => m.date === dateIso);
  const checks = getChecks().filter((c) => c.date === dateIso);
  const additions = getWoodAdditions().filter((a) => a.date === dateIso);
  const photos = getPhotos().filter((p) => p.date === dateIso);
  const splits = getSplitLogs().filter((s) => s.date === dateIso);
  const isChimneyPlan = getProfile()?.nextChimneyCleaning === dateIso;

  const sections = [];
  if (isChimneyPlan) {
    sections.push(
      `<div class="banner" style="margin:0 0 10px"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-wrench"/></svg><span>この日は煙突・触媒清掃の予定日です</span></div>`
    );
  }
  if (burns.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">今日、焚いた</div>` +
        burns.map((b) => `<div class="history-row"><span>${shelfName(b.shelfId)}</span><span>${b.note || ''}</span></div>`).join('')
    );
  }
  if (checks.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">薪棚チェック</div>` +
        checks
          .map((c) => {
            const state = overallCheckState(c.items);
            const stateLabel = state === 'good' ? '良好' : state === 'attention' ? '要注意' : '異常あり';
            return `<div class="history-row"><span>${shelfName(c.shelfId)}</span><span>残量${c.remainingPercent}%・${stateLabel}</span></div>`;
          })
          .join('')
    );
  }
  if (additions.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">薪を追加</div>` +
        additions
          .map(
            (a) =>
              `<div class="history-row"><span>${shelfName(a.shelfId)}${a.source ? `(${a.source})` : ''}</span><span>+${a.addedVolumeM3}m³${a.price != null ? `・¥${a.price.toLocaleString()}` : ''}</span></div>`
          )
          .join('')
    );
  }
  if (splits.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">薪割り</div>` +
        splits.map((s) => `<div class="history-row"><span>薪割り</span><span>${s.volumeM3 != null ? `${s.volumeM3}m³` : '量は未記録'}</span></div>`).join('')
    );
  }
  if (maint.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">メンテナンス</div>` +
        maint.map((m) => `<div class="history-row"><span>${m.type}</span><span>${m.memo || ''}</span></div>`).join('')
    );
  }
  if (photos.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">写真</div>` +
        `<div class="album-grid">${photos.map((p) => `<div class="photo-ph"><img src="${p.uri}" alt=""></div>`).join('')}</div>`
    );
  }
  const lastYear = lastYearHighlights(dateIso);
  if (lastYear.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:10px 0 4px">去年の今日(${lastYearSameDay(dateIso)})</div>` +
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
