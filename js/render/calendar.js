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
  // 薪割り・薪追加は「薪づくり」、薪棚チェックは「薪棚」として、それぞれ意味の伝わる
  // 専用アイコンで示す(以前は1つの緑ドットにまとめていたが、凡例と対応する言葉を
  // 用意できたので、混ぜずに分けた方が「何があった日か」が一目で伝わる)。
  const woodworkDates = new Set([...woodAdditions.map((a) => a.date), ...splitLogs.map((s) => s.date)]);
  const shelfCheckDates = new Set(allChecks.map((c) => c.date));
  // 気温バッジ(毎日の数字)は出来事より目立ってしまうため廃止し、代わりに「季節の気配」
  // だけを控えめな雪の結晶アイコンで示す: 実際に雪が観測された日、または最低気温が
  // 氷点下(0℃未満)だった日だけを対象にする(気象庁の実況が解決できた日のみ記録されるため、
  // 全ての日を遡って判定できるわけではない)。以前は独自の「強い冷え込み(-5℃以下)」という
  // HIMORI発のしきい値を使っていたが、気象庁発表値をそのまま扱う方針と矛盾するため、
  // 誰にとっても同じ意味を持つ客観的な基準(氷点下=0℃未満)に変更した。
  const snowDates = new Set(
    weatherHistory.filter((w) => w.precipCategory === 'snow' || w.tempMin < 0).map((w) => w.date)
  );
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
    if (burnDates.has(dateIso)) classes.push('has-burn');
    if (warningCheckDates.has(dateIso)) classes.push('warn');
    // 色分けされたバッジだけだと意味が伝わりにくいため、それぞれの出来事を表す小さな
    // HIMORI専用アイコンに置き換える(絵文字は使わない)。異常チェックはマス全体の
    // 赤いリングで表す(today/last-burnと同じ「特別な日はマスの縁で示す」パターンに統一)。
    // 出来事アイコンを常に天気(雪)より先に並べ、「出来事 > 天気」の優先順位を保つ。
    // 色に意味を持たせる(HIMORIの視覚言語): 火=炎色、薪づくり=薪色、薪棚=深緑、
    // 愛機=鉄・灰の暖色、写真=オリーブ、雪=控えめな青。
    const dayEvents = [];
    if (burnDates.has(dateIso)) dayEvents.push({ badge: 'b-burn', symbol: '#i-flame', label: '火を焚いた' });
    if (woodworkDates.has(dateIso)) dayEvents.push({ badge: 'b-woodwork', symbol: '#i-woodwork', label: '薪づくり' });
    if (shelfCheckDates.has(dateIso)) dayEvents.push({ badge: 'b-shelf', symbol: '#i-warehouse', label: '薪棚の記録' });
    if (maintDates.has(dateIso)) dayEvents.push({ badge: 'b-stove', symbol: '#i-wrench', label: '愛機のメンテナンス' });
    if (photoDates.has(dateIso)) dayEvents.push({ badge: 'b-photo', symbol: '#i-image', label: '写真' });
    if (snowDates.has(dateIso)) dayEvents.push({ badge: 'b-snow', symbol: '#i-snow', label: '雪・冷え込み' });
    // 極小アイコンを大量に並べると情報過多になるため、2〜3個程度の美しい配置に留める。
    // 4件目以降がある日は、3個目を「+N」の数字チップに差し替える(Nは残り件数)。
    const MAX_DAY_ICONS = 3;
    const shownEvents = dayEvents.length > MAX_DAY_ICONS ? dayEvents.slice(0, MAX_DAY_ICONS - 1) : dayEvents;
    const overflowCount = dayEvents.length > MAX_DAY_ICONS ? dayEvents.length - shownEvents.length : 0;
    const iconsHtml =
      shownEvents
        .map((e) => `<span class="cal-event-badge ${e.badge}" role="img" aria-label="${e.label}"><svg class="icon" viewBox="0 0 24 24"><use href="${e.symbol}"/></svg></span>`)
        .join('') + (overflowCount > 0 ? `<span class="cal-more">+${overflowCount}</span>` : '');
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
    cells.push(`
      <div class="${classes.join(' ')}" data-action="open-cal-day" data-date="${dateIso}">
        <div class="cal-day-top"><span>${d}</span>${seasonMark}</div>
        <span class="cal-icons">${iconsHtml}</span>
      </div>
    `);
  }
  document.getElementById('cal-grid').innerHTML = cells.join('');

  // 凡例: 常設5種(火/薪づくり/薪棚/愛機/写真)は季節を問わず起こりうる出来事なので
  // 常時表示する。雪・冷え込みとチェックで異常は、その月に実際に該当が無ければ
  // 出さない(8月に雪の凡例が並んでいる、といった季節外れな情報量を避けるため)。
  const legendEl = document.getElementById('cal-legend');
  if (legendEl) {
    const monthHasSnow = Array.from(snowDates).some((d) => inMonth(d, year, month));
    const monthHasWarning = Array.from(warningCheckDates).some((d) => inMonth(d, year, month));
    const chips = [
      { badge: 'b-burn', icon: '#i-flame', text: '火' },
      { badge: 'b-woodwork', icon: '#i-woodwork', text: '薪づくり' },
      { badge: 'b-shelf', icon: '#i-warehouse', text: '薪棚' },
      { badge: 'b-stove', icon: '#i-wrench', text: '愛機' },
      { badge: 'b-photo', icon: '#i-image', text: '写真' },
    ];
    let legendHtml = chips
      .map((c) => `<span><span class="cal-event-badge ${c.badge}"><svg class="icon" viewBox="0 0 24 24"><use href="${c.icon}"/></svg></span>${c.text}</span>`)
      .join('');
    if (monthHasSnow) {
      legendHtml += `<span><span class="cal-event-badge b-snow"><svg class="icon" viewBox="0 0 24 24"><use href="#i-snow"/></svg></span>雪・冷え込み</span>`;
    }
    if (monthHasWarning) {
      legendHtml += `<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;box-shadow:0 0 0 1.5px var(--red) inset;background:rgba(181,80,46,.12)"></span>チェックで異常</span>`;
    }
    legendEl.innerHTML = legendHtml;
  }

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
    // 文字の羅列だった「今月のまとめ」を、アイコン+数値の小さなカードの並びにする。
    // 分析ダッシュボードにはせず、「今月こんなことをしたな」と眺められる密度に留める
    // (項目数はこれまで通り絞ったまま、カード化するだけで新しい情報は増やさない)。
    const items = [];
    if (burnDays > 0) items.push({ badge: 'b-burn', icon: '#i-flame', n: `${burnDays}日`, l: '火を焚いた日' });
    if (workDays > 0) items.push({ badge: 'b-woodwork', icon: '#i-woodwork', n: `${workDays}日`, l: '薪づくり' });
    if (checkDays > 0) items.push({ badge: 'b-shelf', icon: '#i-check', n: `${checkDays}日`, l: '薪棚の記録' });
    if (monthMaint.length > 0) items.push({ badge: 'b-stove', icon: '#i-wrench', n: `${monthMaint.length}回`, l: 'メンテナンス' });
    summaryEl.innerHTML = items.length
      ? `<div class="label-sm" style="margin-bottom:8px">今月のまとめ</div><div class="cal-summary-grid">${items
          .map(
            (it) =>
              `<div class="cal-summary-item"><span class="cal-event-badge ${it.badge}"><svg class="icon" viewBox="0 0 24 24"><use href="${it.icon}"/></svg></span><span class="txt"><div class="n">${it.n}</div><div class="l">${it.l}</div></span></div>`
          )
          .join('')}</div>`
      : `<div class="empty" style="padding:6px 4px">まだ記録のない月です。火を焚いたり、薪仕事を記録するとここに残ります。</div>`;
  }

  const currentSeason = seasons.find((s) => !s.endDate);
  const seasonNoteEl = document.getElementById('cal-season-note');
  if (currentSeason) {
    seasonNoteEl.textContent = `今シーズン開始: ${currentSeason.startDate}${lastBurn ? `・最後に焚いた日: ${lastBurn}(「終」マークは終了日)` : ''}`;
  } else if (seasons.length) {
    const last = seasons[seasons.length - 1];
    seasonNoteEl.innerHTML = `<span>前シーズン: ${last.startDate} 〜 ${last.endDate}</span> <button class="link-btn" style="padding:0" data-action="open-season-review" data-season-id="${last.id}">この冬の記録を見る</button>`;
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

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
// 「2026-08-18」より「8月18日(火)」の方が、その日を思い出しやすい。内部的な年月日は
// dateIso自体をそのまま各所で持ち回っているので失われない。
function dateHeadingLabel(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[d.getDay()]})`;
}

// その日が「季節の気配」として記憶に残りそうな気象だったかを、既存のweatherHistory
// (実際に記録された最低気温・分かる範囲の降水種別)だけから判定する。新しい天気APIや
// この日の最低気温を、公式の数値そのまま・出典付きで一行だけ示す。以前は
// 「冷え込みの強い一日でした」「今季初めて、氷点下になりました」等の文章で節目として
// 演出していたが、これはHIMORI側が気温に「強い/初めて」という意味づけ・評価を加える
// ことになり、気象庁発表値をそのまま扱う今回の方針と矛盾するため、即物的な数値表示に
// 統一した(出来事(節目)ではなく、あくまで参考情報としての位置付け)。
// stationNameが無い記録(気象V2以前に保存された、予報値ベースの古い記録)は、
// 特定の観測点を名乗らず「気象庁の発表に基づく記録」という控えめな表記にとどめる。
function weatherFactLine(dateIso, weatherHistory) {
  const entry = weatherHistory.find((w) => w.date === dateIso);
  if (!entry || entry.tempMin == null) return null;
  if (entry.stationId) {
    const url = `https://www.jma.go.jp/bosai/amedas/#area_type=offices&amdno=${entry.stationId}&format=table1h`;
    return `この日の最低気温 ${entry.tempMin}℃(<a href="${url}" target="_blank" rel="noopener">${entry.stationName}観測所・気象庁 ↗</a>)`;
  }
  return `この日の最低気温 ${entry.tempMin}℃(気象庁の発表に基づく記録)`;
}

// 同じ日に同じ種類の記録(特に「今日、焚いた」や同じ種類のメンテ)が複数あると、実データ
// としては正しくても見た目には重複に見えやすい。データそのものは変えず、表示だけ
// 「(◯回記録)」としてまとめる。薪追加・薪棚チェック・薪割りは記録ごとに量や状態という
// 意味のある違いを持つため、まとめずそれぞれ残す。
function dedupeEvents(events) {
  const indexByKey = new Map();
  const result = [];
  events.forEach((e) => {
    const key = e.type === 'burn' ? 'burn' : e.type === 'maintenance' ? `maintenance:${e.text}` : null;
    if (!key) {
      result.push({ ...e });
      return;
    }
    if (indexByKey.has(key)) {
      const target = result[indexByKey.get(key)];
      target.count = (target.count || 1) + 1;
      if (e.photo && !target.photo) target.photo = e.photo;
    } else {
      indexByKey.set(key, result.length);
      result.push({ ...e });
    }
  });
  return result.map((e) => (e.count > 1 ? { ...e, text: `${e.text}(${e.count}回記録)` } : e));
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
  const events = dedupeEvents(allEvents().filter((e) => e.date === dateIso));
  const isChimneyPlan = getProfile()?.nextChimneyCleaning === dateIso;
  const seasons = getSeasons();
  const seasonStart = seasons.find((s) => s.startDate === dateIso);
  const seasonEnd = seasons.find((s) => s.endDate === dateIso);
  const firstWoodType = firstWoodTypeDates(getWoodAdditions(), getPhotos());
  const newWoodTypeNames = Array.from(firstWoodType.entries())
    .filter(([, d]) => d === dateIso)
    .map(([name]) => name);
  const weatherNote = weatherFactLine(dateIso, getWeatherHistory());

  // その日の「節目」をまとめて1箇所に集約する(以前は初焚き・シーズン締め・初めての樹種が
  // それぞれ別のバナー枠で浮いて見えていた)。実績と紐づく節目は控えめな行として、
  // まだ起きていない「予定」(煙突清掃日)だけは引き続き別枠のバナーで区別する。
  const milestones = [];
  if (seasonStart) {
    milestones.push({ icon: '#i-flame', color: 'var(--ember)', text: '今季の初焚きです' });
  }
  if (seasonEnd) {
    milestones.push({ icon: '#i-flame', text: '今シーズンを締めた日です' });
  }
  newWoodTypeNames.forEach((name) => {
    milestones.push({
      img: 'assets/icon-woodtype.png',
      text: `${name}という樹種を初めて記録しました`,
      action: `data-action="open-woodtype-detail" data-name="${name}" data-return-type="calendar-day" data-return-date="${dateIso}"`,
    });
  });
  if (weatherNote) {
    milestones.push({ icon: '#i-snow', color: 'var(--rain)', text: weatherNote });
  }

  const sections = [];
  if (isChimneyPlan) {
    sections.push(
      `<div class="banner" style="margin:0 0 10px"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-wrench"/></svg><span>この日は煙突・触媒清掃の予定日です</span></div>`
    );
  }
  if (milestones.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin-bottom:2px">この日の節目</div>` +
        milestones
          .map((m) => {
            const iconHtml = m.img
              ? `<img src="${m.img}" alt="" style="width:16px;height:16px;object-fit:contain;flex-shrink:0">`
              : `<svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0${m.color ? `;color:${m.color}` : ''}"><use href="${m.icon}"/></svg>`;
            return `<div class="cal-milestone"${m.action ? ` ${m.action} style="cursor:pointer"` : ''}>${iconHtml}<span>${m.text}</span></div>`;
          })
          .join('') +
        `<div style="height:6px"></div>`
    );
  }
  if (events.length) {
    // returnType:'calendar-day' を添えて、樹種詳細を閉じた時にこの日の詳細シートへ
    // そのまま戻れるようにする(カレンダー本体の月表示・スクロールには触れない)。
    sections.push(
      events
        .map((e) => eventRowHtml({ ...e, returnType: 'calendar-day', returnDate: dateIso }, subLineFor(e, { checks, additions, burns, maint })))
        .join('')
    );
  }
  const lastYear = lastYearHighlights(dateIso);
  if (lastYear.length) {
    sections.push(
      `<div class="label-sm" style="font-weight:700;margin:14px 0 4px">去年の今日(${dateHeadingLabel(lastYearSameDay(dateIso))})</div>` +
        lastYear.map((h) => `<div class="history-row"><span>${h}</span><span></span></div>`).join('')
    );
  }

  openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">${dateHeadingLabel(dateIso)}</span>
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
