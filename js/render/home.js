import {
  getShelves,
  getProfile,
  updateProfile,
  getPhotos,
  getBurnLogs,
  getChecks,
  getChecksForShelf,
  getMaintenanceLogs,
  getWoodTypeCatalog,
  getWoodAdditions,
  getSplitLogs,
  addBurnLog,
  removeBurnLog,
  getWeatherCache,
  pushAnshinSnapshot,
  getCurrentSeason,
  startNewSeason,
  removeSeason,
  endCurrentSeason,
  getSeasons,
  isDemoActive,
  addPhoto,
} from '../store.js';
import {
  resolveMainShelf,
  computeAnshin,
  isBelowSafetyLine,
  isOffSeason,
  seasonPhase,
  lastBurnDate,
  shouldShowDryAdvisory,
  shouldPromptSeasonEnd,
  daysBetween,
  stoveYears,
  todayIso,
  monthDayLabel,
  shelfStatusLabel,
  buildLivingWithWoodEvents,
  BURN_CONSUMPTION_M3,
} from '../derive.js';
import { upcoming48hRisk, upcomingDaysSummary } from '../weather.js';
import { showToast, go, openOverlay, closeOverlay } from '../ui.js';
import { openSenseNoteSheet, openShelfPickerSheet, openPhotoViewSheet, openSplitLogSheet } from './sheets.js';
import { eventRowHtml } from './event-row.js';
import { state } from '../state.js';
import { localIsoDate } from '../date-utils.js';
import { noPhotoPlaceholderHtml, pickImageFile, fileToResizedDataUrl } from '../photos.js';

const SNOOZE_KEY = 'himori.seasonPromptSnoozeUntil';

function weekdayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

function weatherStripHtml(weather) {
  if (!weather) return '';
  const days = upcomingDaysSummary(weather.daily, 5);
  if (!days.length) return '';
  return days
    .map((d, i) => {
      const label = i === 0 ? '今日' : `${d.date.slice(5).replace('-', '/')}(${weekdayLabel(d.date)})`;
      // 降水確率は「70%か80%か」の細かい違いに実用上の意味が薄い上、気象庁の発表も
      // 4つの時間帯に分かれていてどれか1つの数字だけ抜き出すのは誠実でない。数字は
      // やめて、雨か雪かのカテゴリだけを表示する(薪ストーブを焚く人には、確率の
      // 細かさよりも「雪になるかどうか」の方が実用的にも気分的にも意味がある)。
      const precipBadge =
        d.precipCategory === 'snow'
          ? `<div class="p"><svg class="icon" viewBox="0 0 24 24" style="width:11px;height:11px;color:var(--rain)"><use href="#i-snow"/></svg>雪</div>`
          : d.precipCategory === 'rain'
            ? `<div class="p"><svg class="icon" viewBox="0 0 24 24" style="width:11px;height:11px;color:var(--rain)"><use href="#i-drop"/></svg>雨</div>`
            : '';
      return `<div class="day"><div class="d">${label}</div><div class="t"><span class="t-max">${d.tempMax}</span><span class="t-min">${d.tempMin}</span>℃</div>${precipBadge}</div>`;
    })
    .join('');
}

// 天気の出典を明示する。Yahoo天気など商用アプリの町別の数値とはズレることがあるが、
// それは不具合ではなく「参照元が違う」ためだと分かるようにするための表示。
// 気象庁の発表区分が特定できている場合は、その地域の公式予報ページへのリンクも添える
// (迷った時に一次情報へすぐ確認しに行けるように)。
function weatherSourceHtml(weather) {
  if (!weather) return '';
  const jma = weather.location?.jma;
  const officeCode = jma?.officeCode;
  // 市区町村(class20)まで特定できていれば、その市区町村のページに直接リンクする
  // (気象庁の発表区分そのものは県全体のことが多いが、サイト側は市区町村単位で
  // ページが分かれており、該当ページを開くと自動でその地域の情報が選択された状態になる)。
  const jmaUrl = jma?.class20Code
    ? `https://www.jma.go.jp/bosai/forecast/#area_type=class20s&area_code=${jma.class20Code}`
    : officeCode
      ? `https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${officeCode}`
      : null;
  // 「南部」だけだとどこの南部か分からないため、必ず都道府県名を前に付ける。
  const regionLabel = weather.location?.prefecture ? `${weather.location.prefecture}${jma?.regionName}` : jma?.regionName;
  const label = officeCode
    ? `気象庁「${regionLabel}」の発表値(降水確率・最高/最低気温)。当日の最低気温のみ数値予報モデルの推定値。数時間ごとに更新。地域が体感と違う場合は設定から変更できます`
    : '数値予報モデル(Open-Meteo)による推定値を表示。数時間ごとに更新';
  return `
    <div class="label-sm" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>${label}</span>
      ${jmaUrl ? `<a href="${jmaUrl}" target="_blank" rel="noopener" class="link-btn" style="padding:0;white-space:nowrap">気象庁の予報を見る</a>` : ''}
    </div>`;
}

// ホーム下部の天気は「気象情報を表示する」のではなく「薪ストーブ生活の文脈で
// 一言だけ伝える」ことを目的にする。数日分の詳細・出典表記は情報として正しくても
// ホームには重いため、詳しい内容は「詳しい天気を見る」の折りたたみに格納し、
// ここでは明日の予報から意味のある時だけ短い一文を出す(平常運転の日は何も言わない
// 方が、過剰な擬人化・毎日同じ定型文の繰り返しを避けられる)。
function weatherContextLine(weather, phase) {
  if (!weather?.daily?.length) return '';
  const tomorrow = weather.daily[1] || weather.daily[0];
  if (!tomorrow) return '';
  if (tomorrow.precipCategory === 'snow') return `明日は雪の予報です。最高${tomorrow.tempMax}℃。`;
  if (phase !== 'off' && tomorrow.tempMin <= 5) return `明日は冷え込みそうです。最低${tomorrow.tempMin}℃。火が恋しい一日になりそうです。`;
  if (tomorrow.tempMax >= 30) return '明日も暑くなりそうです。薪仕事は涼しい時間に。';
  if (tomorrow.precipCategory === 'rain') return '明日は雨の予報です。';
  return '';
}

// ホーム最上部の「今季の薪」カード。以前は充足率(%)・あと何日分・いつまで持つかという
// 「不足するかもしれない不安」を軸にした構成だったが、薪の消費ペースは気温・焚き方・
// 樹種などで大きく変わり、精度の低い予測を正確そうに見せることになっていた。
// 今は「今、実際に何m³の薪があるか」という事実だけを、乾燥済み/乾燥中/来季用に
// 分けてそのまま見せる形に変更している(m³は薪ストーブユーザーが自分の蓄えを
// 実感しやすい単位)。充足率そのものは削除せず、週次まとめ(review.js)では
// 引き続きcomputeAnshinを使って詳しく見られるようにしてある。
function seasonWoodHtml(shelves) {
  if (shelves.length === 0) {
    return `
      <div class="label-sm" style="margin-bottom:4px">今季の薪</div>
      <div style="font-size:calc(13px * var(--font-scale));line-height:1.7">薪棚を登録すると、今、自分がどれだけ薪を準備できているかが見えてきます。</div>
      <button class="link-btn" data-action="open-add-shelf" style="padding:8px 0 0">薪棚を登録する</button>
    `;
  }

  const sum = (status) =>
    Math.round(shelves.filter((s) => s.status === status).reduce((v, s) => v + s.usableVolumeM3, 0) * 100) / 100;
  const dried = sum('乾燥済み');
  const drying = sum('乾燥中');
  const nextSeason = sum('来季用');

  if (dried <= 0 && drying <= 0 && nextSeason <= 0) {
    return `
      <div class="label-sm" style="margin-bottom:4px">今季の薪</div>
      <div style="font-size:calc(13px * var(--font-scale));line-height:1.7">今はまだ薪がありません。薪を追加すると、ここに積み上がっていきます。</div>
    `;
  }

  const row = (label, value, note) =>
    value > 0
      ? `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(242,234,214,.1)">
          <span style="font-size:calc(13px * var(--font-scale))">${label}${note ? `<span class="label-sm" style="margin-left:6px">${note}</span>` : ''}</span>
          <span style="font-size:calc(16px * var(--font-scale));font-weight:700">${value}<span style="font-size:calc(11px * var(--font-scale));font-weight:400">m³</span></span>
        </div>`
      : '';

  return `
    <div class="label-sm" style="margin-bottom:2px">今季の薪</div>
    <div style="margin-top:6px">
      ${row('乾燥薪', dried)}
      ${row('乾燥中', drying, '次の冬へ準備中')}
      ${row('来季用', nextSeason, '再来季へ準備中')}
    </div>
  `;
}

// 「いつもの薪棚」への導線だけを担う、ごく簡素な参照カード。乾燥状態・含水率・
// レギュラーの変更などはすべて薪棚一覧・薪棚チェック画面がすでに担っているため、
// ホームでは写真・名前・量ひとつだけを見せてタップでチェックへ渡す(以前あった
// 「薪棚を変更」「レギュラーを未設定に戻す」等の設定操作はホームから外した)。
function mainShelfRefHtml(shelves, profile) {
  const { shelf } = resolveMainShelf(shelves, profile);
  if (!shelf) return '';

  const photos = getPhotos();
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  const thumbHtml = photo
    ? `<div class="photo-ph" style="width:52px;height:52px;flex-shrink:0"><img src="${photo.uri}" alt=""></div>`
    : noPhotoPlaceholderHtml('', 'width:52px;height:52px;flex-shrink:0');

  // 上の「今季の薪」カードと同じ言葉遣い(乾燥薪/乾燥中/来季用)で揃え、
  // 「残量◯%」のような別の言い回しを重ねて出さないようにする。
  const amountLabel = shelfStatusLabel(shelf.status);

  return `
    <div class="label-sm" style="margin-bottom:8px">いつもの薪棚</div>
    <div style="display:flex;gap:12px;align-items:center;cursor:pointer" data-action="open-main-shelf-check">
      ${thumbHtml}
      <div style="flex:1;min-width:0">
        <div style="font-size:calc(14px * var(--font-scale));font-weight:700">${shelf.name}</div>
        <div class="label-sm">${amountLabel} ${shelf.usableVolumeM3}m³</div>
      </div>
      <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;color:var(--khaki);flex-shrink:0"><use href="#i-chevright"/></svg>
    </div>
  `;
}

// 「今日、焚いた」ボタンの下に添える、今シーズン(進行中ならその時点まで、オフシーズンなら
// 直近に終えたシーズンの実績を振り返り)何日、火を焚いたかの記録。「◯m³消費した」ではなく
// 「◯日、火のある暮らしをした」という記録として見せる(同じ日に複数回記録しても
// 日数は重複して増えないよう、日付の重複を除いて数える)。
function burnDaysLine(currentSeason, previousSeason, burnLogs) {
  const countDays = (fromIso, toIso) =>
    new Set(burnLogs.filter((b) => b.date >= fromIso && (!toIso || b.date <= toIso)).map((b) => b.date)).size;
  if (currentSeason) {
    const days = countDays(currentSeason.startDate, null);
    if (days > 0) return `今季${days}日、火を焚きました`;
    return '';
  }
  if (previousSeason) {
    const days = countDays(previousSeason.startDate, previousSeason.endDate);
    if (days > 0) return `前シーズンは${days}日、火を焚きました`;
  }
  return '';
}

// 「薪のある日々」カード: 薪割り・薪の追加・薪棚チェックといった、種類の違う出来事を
// 直近3件、日付とともに並べる(以前は薪棚写真3枚だけを並べていたため、同じ薪棚を
// 何度も撮っていると代わり映えのない見た目になっていた)。集計期間は「前シーズンが
// 終わった日」を起点にする。これは焚いている最中かどうかに関わらず、次の冬に向けた
// 薪づくりが常に同じ1つの区切りの中で積み上がっていくようにするため(シーズンが
// 始まった瞬間に夏の作業実績が0にリセットされて消えてしまうのを避ける)。
// カレンダー・アルバムと共通のbuildLivingWithWoodEvents(derive.js)から作り、
// ここでは「薪をつくる」記録(追加・薪割り・チェック)だけに絞って取り出す
// (今日焚いた・メンテはこのカードのスコープ外。カレンダーの日別詳細では両方とも見える)。
function livingWithWoodEvents(shelves, previousSeason) {
  const cycleStart = previousSeason?.endDate ?? null;
  const inCycle = (iso) => !cycleStart || iso > cycleStart;
  const photos = getPhotos();

  const all = buildLivingWithWoodEvents({
    shelves,
    woodAdditions: getWoodAdditions(),
    splitLogs: getSplitLogs(),
    checks: getChecks(),
    burnLogs: getBurnLogs(),
    maintenanceLogs: getMaintenanceLogs(),
    photos,
  });
  const top = all.filter((e) => ['addition', 'split', 'check'].includes(e.type) && inCycle(e.date)).slice(0, 3);

  // 出来事だけでは3件に満たない時は、直近の薪棚写真で埋めて寂しくならないようにする
  // (すでにイベントの写真として使われた1枚は重複させない)。
  if (top.length < 3) {
    const usedPhotoIds = new Set(top.map((e) => e.photo?.id).filter(Boolean));
    const fillerPhotos = photos
      .filter((p) => p.category === '薪棚' && !usedPhotoIds.has(p.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const p of fillerPhotos) {
      if (top.length >= 3) break;
      top.push({ date: p.date, photo: p, text: '薪棚の様子を記録しました' });
    }
    top.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  return top;
}

function livingWithWoodHtml(shelves, previousSeason) {
  const events = livingWithWoodEvents(shelves, previousSeason);
  if (events.length === 0) return '';

  // returnType:'home' を添えて、樹種詳細を閉じた時にホームへそのまま戻れるようにする
  // (ホーム画面自体は開いたままなので、閉じるだけで元の状態・スクロール位置に戻る)。
  const rows = events.map((e) => eventRowHtml({ ...e, returnType: 'home' }, monthDayLabel(e.date))).join('');

  return `
    <div class="label-sm" style="margin-bottom:2px">薪のある日々</div>
    ${rows}
  `;
}

// 樹種コレクションへの入口を「見る」という操作の案内ではなく、すでに自分が
// 集めてきた成果として見せる(0種の時だけ、素直に案内文にする)。
function woodtypeCollectionHtml(catalog) {
  if (catalog.length === 0) {
    return `
      <div style="flex:1">
        <div style="font-size:calc(10px * var(--font-scale));color:var(--leather-text);letter-spacing:.5px">図鑑</div>
        <div class="slab" style="font-size:calc(14px * var(--font-scale));font-weight:700">樹種コレクションを見る</div>
      </div>
    `;
  }
  const names = catalog.slice(0, 4).join('・') + (catalog.length > 4 ? '…' : '');
  return `
    <div style="flex:1;min-width:0">
      <div style="font-size:calc(10px * var(--font-scale));color:var(--leather-text);letter-spacing:.5px">薪の図鑑</div>
      <div class="slab" style="font-size:calc(14px * var(--font-scale));font-weight:700">集めた樹種 ${catalog.length}種</div>
      <div class="label-sm" style="margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${names}</div>
    </div>
  `;
}

function dayOfYear(iso) {
  const d = new Date(iso + 'T00:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

// オフシーズンの語り口は、まず季節そのものを前向きに感じられる一言(main)を必ず出し、
// 注意喚起(暑さ対策など)や実務的な提案(チェック・メンテ・記録)は控えめな補足(note)に
// 格下げする。以前はこれらが同じ抽選プールに入っていたため、日によっては「暑いので
// 無理せず」のような注意喚起だけがホームを開いた瞬間の第一声になってしまっていた。
function offSeasonTip({ weather, shelves, allChecks, maintenanceLogs, woodTypeCatalog, photos }) {
  const mainLines = [
    '次の冬へ、薪が育つ季節です。',
    '冬を待ちながら、薪を育てる季節です。',
    '良い薪は、シーズンが始まってから慌てて作るものではなく、今つくられています。',
    '静かな季節ですが、暖炉のある暮らしはこの時期の下ごしらえで決まります。',
  ];
  const main = mainLines[dayOfYear(todayIso()) % mainLines.length];

  const notes = [];
  const todayWeather = weather?.daily?.[0];
  if (todayWeather && todayWeather.tempMax >= 30) {
    notes.push('暑い日の薪仕事は無理せずに。');
  }
  const dryShelf = shelves.find((s) =>
    shouldShowDryAdvisory(s, allChecks.filter((c) => c.shelfId === s.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null)
  );
  if (dryShelf) notes.push(`${dryShelf.name}はそろそろ乾燥薪かもしれません。`);
  if (shelves.length) {
    const maxDaysSinceCheck = Math.max(...shelves.map((s) => daysBetween(s.lastCheckedAt)));
    if (maxDaysSinceCheck >= 60) notes.push('しばらく薪棚をチェックしていないようです。');
  }
  if (woodTypeCatalog.length < 2) notes.push('焚いた樹種を記録しておくと、樹種コレクションが賑わってきますよ。');
  const hasRecentPhoto = photos.some((p) => daysBetween(p.date) <= 30);
  if (!hasRecentPhoto) notes.push('薪棚の様子を写真に残しておくと、後で見返した時に面白いですよ。');
  const lastMaint = maintenanceLogs[0];
  if (!lastMaint || daysBetween(lastMaint.date) >= 300) notes.push('ストーブのメンテナンスを確認するのに良い時期です。');

  return { main, note: notes[0] || '' };
}

function hitokoto(ctx) {
  const { score, shelf, weather, offSeason, phase, lastCheckDate } = ctx;
  if (phase === 'off') return offSeasonTip(ctx);
  if (phase === 'shoulder') {
    const month = Number(todayIso().slice(5, 7));
    return {
      main: [10, 11].includes(month) ? 'シーズンが近づいてきました。' : 'シーズンも落ち着いてきました。',
      note: [10, 11].includes(month) ? '薪棚のチェックと乾燥具合の確認をしておくと安心です。' : '来季に向けて薪棚を整理しておくとスムーズです。',
    };
  }
  if (offSeason) {
    return { main: 'しばらく焚いていないようです。', note: '無理のない範囲で薪棚の様子を見ておくと安心です。' };
  }
  if (!shelf) return { main: '薪棚がまだ登録されていません。', note: '「薪を追加」から始めましょう。' };
  // 状態ごとの一言も、日替わりで複数の言い回しから選ぶ(同じ状態が続く間ずっと
  // 同じ一文が表示され続けると単調なため。いずれも他者の発言の引用ではなくオリジナル)。
  const rotate = (lines) => lines[dayOfYear(todayIso()) % lines.length];
  let main;
  let note = '';
  if (score >= 70) {
    main = rotate([
      'しっかり焚けるだけの蓄えがあります。',
      'この量なら、多少の寒波が来ても慌てずに済みます。',
      'よく準備できています。あとは乾燥が進むのを待つだけです。',
    ]);
  } else if (score >= 40) {
    const daysSinceCheck = lastCheckDate ? daysBetween(lastCheckDate) : null;
    if (daysSinceCheck == null || daysSinceCheck >= 14) {
      main = rotate(['今のところは焚けています。', '焚く分には困らない量です。', '量は足りています。']);
      note = '薪棚チェックで乾燥状態や虫・カビの様子も見ておくと、より安心です。';
    } else {
      main = rotate(['今のところは焚けます。', '今のところは順調です。', '今日も問題なく焚けそうです。']);
    }
  } else {
    main = rotate(['薪棚の残りが少なくなってきました。', 'そろそろ棚の底が見えてきた頃合いです。', '薪を足すと、また安心して焚けます。']);
  }
  const peakRisk = weather ? upcoming48hRisk(weather.daily) : null;
  if (peakRisk) note = note ? note : '冷え込みや雨の予報があるので、多めに運んでおくと安心です。';
  return { main, note };
}

export function render() {
  const shelves = getShelves();
  const profile = getProfile();
  const weather = getWeatherCache();
  const burnLogs = getBurnLogs();
  const { shelf: mainShelf } = resolveMainShelf(shelves, profile);
  const offSeason = isOffSeason(burnLogs);
  const score = computeAnshin(shelves, profile.seasonTargetM3);
  pushAnshinSnapshot(score);

  // バナー: 安心ライン割れ(異常系=赤)/シーズン終了確認/48時間以内の天気予報。優先度順に重ねて表示
  const bannerEl = document.getElementById('home-banner');
  const banners = [];
  if (isDemoActive()) {
    banners.push(
      `<div class="banner" style="background:rgba(169,151,107,.18);border-color:rgba(169,151,107,.5)"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-info"/></svg><span>デモデータを表示中です。設定画面からいつでも元に戻せます。</span></div>`
    );
  }
  const currentSeason = getCurrentSeason();
  const snoozeUntil = localStorage.getItem(SNOOZE_KEY);
  const canAskSeasonEnd = !snoozeUntil || todayIso() >= snoozeUntil;
  if (currentSeason && canAskSeasonEnd && shouldPromptSeasonEnd(currentSeason, burnLogs)) {
    const last = lastBurnDate(burnLogs) || currentSeason.startDate;
    const days = Math.max(0, Math.round((new Date() - new Date(last + 'T00:00:00')) / 86400000));
    banners.push(`
      <div class="banner">
        <svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-info"/></svg>
        <div style="flex:1">
          <div>${days}日焚いていないようです。今シーズンはここで終了しますか?</div>
          <div class="row" style="margin-top:8px;justify-content:flex-start;gap:14px">
            <button class="link-btn" style="padding:0" data-action="confirm-season-end">はい、終了しました</button>
            <button class="link-btn" style="padding:0" data-action="dismiss-season-end-prompt">まだ続けます</button>
          </div>
        </div>
      </div>
    `);
  }
  if (shelves.length > 0 && isBelowSafetyLine(shelves, profile.safetyLineM3)) {
    banners.push(
      `<div class="banner" style="background:rgba(181,80,46,.14);border-color:rgba(181,80,46,.4)"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px;color:var(--red)"><use href="#i-info"/></svg><span>使える薪の合計が安心ライン(${profile.safetyLineM3}m³)を下回っています。</span></div>`
    );
  }
  // 「薪を多めに運んでおくと安心」は焚いているシーズンでこそ意味があるアドバイスなので、
  // 真夏のオフシーズンには出さない。また冷え込み/雨で言い回しを分け、夏の雨予報に
  // 「雪」と言ってしまうような季節外れな文言にならないようにする。
  const phase = seasonPhase();
  if (weather && phase !== 'off') {
    const risk = upcoming48hRisk(weather.daily);
    if (risk) {
      // 気象庁の天気文から実際に「雪」と分かる場合は、あいまいな「雨・雪」ではなく
      // はっきり雪と伝える(薪ストーブと雪は相性が良いので、ワクワクできる情報でもある)。
      const text = risk.snow
        ? '48時間以内に雪の予報があります。多めに運んでおくと安心です。'
        : risk.cold && risk.rain
          ? '48時間以内に冷え込みと雨の予報があります。多めに運んでおくと安心です。'
          : risk.cold
            ? '48時間以内に冷え込みの予報があります。多めに運んでおくと安心です。'
            : '48時間以内にまとまった雨の予報があります。濡れる前に多めに運んでおくと安心です。';
      const icon = risk.snow ? 'i-snow' : 'i-drop';
      banners.push(
        `<div class="banner"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#${icon}"/></svg><span>${text}</span></div>`
      );
    }
  }
  bannerEl.innerHTML = banners.join('');

  const seasons = getSeasons();
  const previousSeason = seasons.filter((s) => s.endDate).slice(-1)[0];

  // 今日のひとこと(季節や状態に応じて表情を変える、ホームの語り口)。
  // データ・数字より先に、まず気持ちを添えたいので今季の薪カードより上に置く。
  const mainLastCheck = mainShelf ? getChecksForShelf(mainShelf.id)[0] : null;
  const note = hitokoto({
    score,
    shelf: mainShelf,
    weather,
    offSeason,
    phase,
    lastCheckDate: mainLastCheck?.date ?? null,
    shelves,
    allChecks: getChecks(),
    maintenanceLogs: getMaintenanceLogs(),
    woodTypeCatalog: getWoodTypeCatalog(),
    photos: getPhotos(),
  });
  document.getElementById('home-note').innerHTML = `
    <div style="font-size:calc(14px * var(--font-scale));font-weight:600">${note.main}</div>
    ${note.note ? `<div class="label-sm" style="margin-top:4px">${note.note}</div>` : ''}
  `;

  // 第1階層: 「今、自分がどれだけ薪を準備できているか」を事実ベースで見せるカード
  document.getElementById('home-season-summary').innerHTML = seasonWoodHtml(shelves);

  // 第2階層直下: 「今日、焚いた」の下に、今シーズン何日火を焚いたかの振り返り
  const burnDaysEl = document.getElementById('home-burn-days');
  const burnDaysText = burnDaysLine(currentSeason, previousSeason, burnLogs);
  burnDaysEl.textContent = burnDaysText;
  burnDaysEl.style.display = burnDaysText ? '' : 'none';

  // 薪のある日々: 薪棚写真と、薪づくり(薪割り・薪の追加)の積み重ね
  const livingEl = document.getElementById('home-living');
  const livingHtml = livingWithWoodHtml(shelves, previousSeason);
  livingEl.innerHTML = livingHtml;
  livingEl.style.display = livingHtml ? '' : 'none';

  // 暮らし: レギュラー薪棚への導線
  const shelfRefEl = document.getElementById('home-shelf-ref');
  const shelfRefHtml = mainShelfRefHtml(shelves, profile);
  shelfRefEl.innerHTML = shelfRefHtml;
  shelfRefEl.style.display = shelfRefHtml ? '' : 'none';

  const stoveEl = document.getElementById('home-stove');
  const years = stoveYears(profile.stove.purchaseDate);
  const stovePhoto = profile.stove.photoId ? getPhotos().find((p) => p.id === profile.stove.photoId) : null;
  const stovePhotoHtml = stovePhoto
    ? `<img src="${stovePhoto.uri}" alt="" style="width:100%;height:100%;object-fit:cover">`
    : noPhotoPlaceholderHtml('', 'width:100%;height:100%');
  stoveEl.innerHTML = `
    <div data-action="edit-stove-photo" style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;border:1px solid var(--leather-line);cursor:pointer">
      ${stovePhotoHtml}
    </div>
    <div style="flex:1">
      <div style="font-size:calc(10px * var(--font-scale));color:var(--leather-text);letter-spacing:.5px">愛機</div>
      <div class="slab" style="font-size:calc(14px * var(--font-scale));font-weight:700">${profile.stove.name}</div>
    </div>
    ${years ? `<div style="font-size:calc(9px * var(--font-scale));color:#d9c6a8;border:1px solid rgba(242,234,214,.25);padding:3px 7px;border-radius:4px;flex-shrink:0">火のある暮らし、${years}年目</div>` : ''}
    <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;color:var(--leather-text);flex-shrink:0"><use href="#i-chevright"/></svg>
  `;

  document.getElementById('home-woodtypes').innerHTML = woodtypeCollectionHtml(getWoodTypeCatalog());

  // 詳細情報(第5階層): 薪ストーブ生活の文脈での短い一言だけを常時表示し、
  // 数日分の予報・出典は「詳しい天気を見る」の折りたたみに格納する
  const weatherContextEl = document.getElementById('home-weather-context');
  const contextText = weatherContextLine(weather, phase);
  weatherContextEl.textContent = contextText;
  weatherContextEl.style.display = contextText ? '' : 'none';
  const weatherToggleEl = document.getElementById('btn-weather-detail-toggle');
  weatherToggleEl.style.display = weather ? '' : 'none';
  document.getElementById('home-weather-strip').innerHTML = weatherStripHtml(weather);
  document.getElementById('home-weather-source').innerHTML = weatherSourceHtml(weather);
}


export function handleBurnToday() {
  const shelves = getShelves();
  const profile = getProfile();
  const { shelf } = resolveMainShelf(shelves, profile);
  if (!shelf) {
    showToast('先に薪棚を登録してください');
    return;
  }
  if (shelf.usableVolumeM3 <= 0) {
    showToast('この薪棚はまだ空のようです。薪を追加してから記録してみてください。');
    return;
  }
  // トースト表示だけだと見逃しやすく「押したのに反応したか分からない」となるため、
  // ボタン自体にも一瞬の反応(パルス)を付ける。render()はこのボタンを再生成しないので
  // クラスは消えず、アニメーション終了後に自然に元の見た目へ戻る。
  const burnBtn = document.getElementById('btn-burn-today');
  if (burnBtn) {
    burnBtn.classList.remove('flash');
    void burnBtn.offsetWidth;
    burnBtn.classList.add('flash');
  }

  const today = todayIso();
  const log = addBurnLog({ date: today, shelfId: shelf.id, note: '' });
  // 焚くのが久しぶりでシーズンが切れていた場合は「新しいシーズンの始まり」として
  // 少しワクワクする言い回しにする(オフシーズンの寂しさと対になる演出)
  const isSeasonStart = !getCurrentSeason();
  const createdSeason = isSeasonStart ? startNewSeason(today) : null;
  render();

  const undoBurn = () => {
    removeBurnLog(log.id);
    if (createdSeason) removeSeason(createdSeason.id);
    render();
    showToast('取り消しました');
  };

  // 真夏(オフシーズン)にたまたま焚いた場合まで「今年も暖かい冬になりますように」と
  // 言うと季節感が矛盾するため、シーズン開始の演出は焚き頃の時期(peak/shoulder)だけにする
  const celebrateSeasonStart = isSeasonStart && seasonPhase() !== 'off';
  const actions = [{ label: '元に戻す', onClick: undoBurn }];
  if (!celebrateSeasonStart) {
    actions.push({ label: 'ひとことを追加', onClick: () => openSenseNoteSheet(log.id, () => render()) });
  }
  showToast('今日の記録を保存しました', actions);
  // トーストだけだと見逃しやすく、シーズン最初の一枚は特別な瞬間なので、
  // 短く自動で消える専用の演出をひとつ重ねる(タップでも早く閉じられる)
  if (celebrateSeasonStart) showSeasonStartCelebration();
}

function showSeasonStartCelebration() {
  const ov = openOverlay(`
    <div class="sheet" style="text-align:center;padding:36px 24px">
      <svg class="icon" viewBox="0 0 24 24" style="width:44px;height:44px;color:var(--ember);margin:0 auto 14px;display:block"><use href="#i-flame"/></svg>
      <div class="slab" style="font-size:calc(18px * var(--font-scale));font-weight:700;margin-bottom:8px">今シーズンの焚き始めです</div>
      <div class="label-sm" style="line-height:1.7">今年も暖かい冬になりますように。</div>
    </div>
  `);
  setTimeout(() => {
    if (document.querySelector('[data-dynamic-overlay="true"]') === ov) closeOverlay();
  }, 2600);
}

// ホームのストーブ写真は「タップ=写真の操作」という直感に合わせ、カード全体のタップ
// (メンテ記録を開く)とは別のアクションにしている。未登録ならその場で選んですぐ登録、
// 登録済みならいつもの写真ビュー(見る/削除)を開く。
export async function editStovePhoto() {
  const profile = getProfile();
  const existing = profile.stove.photoId ? getPhotos().find((p) => p.id === profile.stove.photoId) : null;
  if (existing) {
    openPhotoViewSheet(existing, () => {
      updateProfile({ stove: { ...profile.stove, photoId: null } });
      render();
    });
    return;
  }
  const file = await pickImageFile();
  if (!file) return;
  const uri = await fileToResizedDataUrl(file);
  try {
    const photo = addPhoto({ category: 'ストーブ', date: todayIso(), uri });
    updateProfile({ stove: { ...profile.stove, photoId: photo.id } });
    render();
  } catch {
    showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
  }
}

export function setMainShelf(shelfId) {
  updateProfile({ mainShelfId: shelfId });
  render();
  showToast('レギュラー薪棚にしました');
}

export function releaseMainShelf() {
  updateProfile({ mainShelfId: null });
  render();
}

export function pickMainShelf() {
  const profile = getProfile();
  openShelfPickerSheet(profile.mainShelfId, (shelfId) => {
    updateProfile({ mainShelfId: shelfId });
    render();
  });
}

export function confirmSeasonEnd() {
  const burnLogs = getBurnLogs();
  const currentSeason = getCurrentSeason();
  const end = lastBurnDate(burnLogs) || todayIso();
  endCurrentSeason(end);
  localStorage.removeItem(SNOOZE_KEY);
  // シーズンを締める時は、ただ「終わった」だけでなく今シーズンの実績を一言添えて
  // ねぎらう(焚き始めのワクワク感と対になる、寂しさを和らげる演出)
  let message = '今シーズンの記録を締めました。お疲れさまでした。';
  if (currentSeason) {
    const seasonBurns = burnLogs.filter((b) => b.date >= currentSeason.startDate && b.date <= end);
    if (seasonBurns.length > 0) {
      const usedVolume = Math.round(seasonBurns.length * BURN_CONSUMPTION_M3 * 100) / 100;
      message = `今シーズンもお疲れさまでした。${seasonBurns.length}回焚いて、約${usedVolume}m³使いました。また来シーズンもよろしくお願いします。`;
    }
  }
  showToast(message, [], { duration: 5000 });
  render();
}

export function dismissSeasonEndPrompt() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  localStorage.setItem(SNOOZE_KEY, localIsoDate(d));
  render();
}

// レギュラー薪棚カードをタップした時、その棚のチェック記録画面に直接移動する
// (シーズン中は使用量の変化が速いレギュラー薪棚こそ、素早くチェックできると嬉しいはず)
export function openMainShelfCheck() {
  const shelves = getShelves();
  const profile = getProfile();
  const { shelf } = resolveMainShelf(shelves, profile);
  if (!shelf) return;
  state.currentShelfId = shelf.id;
  go('check');
}

export function openSplitLogFromHome() {
  openSplitLogSheet(() => render());
}

// 「詳しい天気を見る」の開閉。render()のたびに畳んだ状態へ戻る(常時展開しておく
// ほどの情報ではないため、開いたままにする状態は持たせていない)。
export function toggleWeatherDetail() {
  const el = document.getElementById('home-weather-detail');
  const btn = document.getElementById('btn-weather-detail-toggle');
  if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  if (btn) btn.textContent = show ? '天気を閉じる' : '詳しい天気を見る';
}
