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
  BURN_CONSUMPTION_M3,
} from '../derive.js';
import { upcoming48hRisk, upcomingDaysSummary } from '../weather.js';
import { showToast, go, openOverlay, closeOverlay } from '../ui.js';
import { openSenseNoteSheet, openShelfPickerSheet, openPhotoViewSheet, openSplitLogSheet } from './sheets.js';
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

// 「レギュラー薪棚」への導線だけを担うコンパクトな参照カード。乾燥状態・含水率などの
// 詳細は薪棚チェック画面が既に担っているため、ここでは重複させず、写真・名前・残量と
// 導線(タップでチェックへ/レギュラーの変更)だけに絞る。
function mainShelfRefHtml(shelves, profile, offSeason) {
  const { shelf, isSuggestion } = resolveMainShelf(shelves, profile);
  if (!shelf) return '';

  // オフシーズン中に「レギュラーにしませんか」と急かすと違和感があるため、候補提示は
  // シーズン中だけ目立たせる(オフシーズンはニュートラルな表示に留める)。
  const badgeHtml = isSuggestion
    ? offSeason
      ? `<span class="badge khaki">薪棚(レギュラー未設定)</span>`
      : `<span class="badge amber">レギュラーの候補</span>`
    : `<span class="badge khaki">レギュラー薪棚</span>`;
  const actionHtml = isSuggestion
    ? `<button class="link-btn" data-action="set-main-shelf" data-shelf-id="${shelf.id}" style="padding:6px 0 0">これをレギュラーにする</button>`
    : `<button class="link-btn" data-action="pick-main-shelf" style="padding:6px 0 0">薪棚を変更</button><button class="link-btn" data-action="release-main-shelf" style="padding:6px 0 0;margin-left:12px">レギュラーを未設定に戻す</button>`;

  const photos = getPhotos();
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  const thumbHtml = photo
    ? `<div class="photo-ph" style="width:52px;height:52px;flex-shrink:0"><img src="${photo.uri}" alt=""></div>`
    : noPhotoPlaceholderHtml('', 'width:52px;height:52px;flex-shrink:0');

  return `
    <div style="display:flex;gap:12px;align-items:center;cursor:pointer" data-action="open-main-shelf-check">
      ${thumbHtml}
      <div style="flex:1;min-width:0">
        ${badgeHtml}
        <div style="font-size:calc(13px * var(--font-scale));font-weight:700;margin-top:3px">${shelf.name}</div>
        <div class="label-sm">使える薪 約${shelf.usableVolumeM3}m³(残量${shelf.remainingPercent}%)</div>
      </div>
      <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;color:var(--khaki);flex-shrink:0"><use href="#i-chevright"/></svg>
    </div>
    ${actionHtml}
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

// 「薪のある日々」カード: 薪棚の最新写真と、直近の薪づくり(薪割り・薪の追加)の
// 積み重ねを見せる。集計期間は「前シーズンが終わった日」を起点にする。これは
// 焚いている最中かどうかに関わらず、次の冬に向けた薪づくりが常に同じ1つの区切りの
// 中で積み上がっていくようにするため(シーズンが始まった瞬間に夏の作業実績が
// 0にリセットされて消えてしまうのを避ける)。記録が何もなければ表示しない。
function livingWithWoodHtml(previousSeason) {
  const cycleStart = previousSeason?.endDate ?? null;
  const inCycle = (iso) => !cycleStart || iso > cycleStart;

  const photos = getPhotos()
    .filter((p) => p.category === '薪棚')
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const recentPhotos = photos.slice(0, 3);

  const splitCount = getSplitLogs().filter((s) => inCycle(s.date)).length;
  const addedVolume =
    Math.round(
      getWoodAdditions()
        .filter((a) => inCycle(a.date))
        .reduce((sum, a) => sum + a.addedVolumeM3, 0) * 100
    ) / 100;

  if (recentPhotos.length === 0 && splitCount === 0 && addedVolume <= 0) return '';

  const photoStrip = recentPhotos.length
    ? `<div style="display:flex;gap:6px;margin-bottom:${splitCount || addedVolume > 0 ? '10px' : '0'}">
        ${recentPhotos.map((p) => `<div class="photo-ph" style="width:64px;height:64px;flex-shrink:0"><img src="${p.uri}" alt=""></div>`).join('')}
      </div>`
    : '';

  const stats = [];
  if (splitCount > 0)
    stats.push(
      `<div style="display:flex;align-items:center;gap:6px"><img src="assets/icon-axe.png" alt="" style="width:15px;height:15px;object-fit:contain">薪割り ${splitCount}回</div>`
    );
  if (addedVolume > 0)
    stats.push(
      `<div style="display:flex;align-items:center;gap:6px"><svg class="icon" viewBox="0 0 24 24" style="width:15px;height:15px;color:var(--green)"><use href="#i-plus"/></svg>増えた薪 ${addedVolume}m³</div>`
    );
  const statsHtml = stats.length
    ? `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:calc(12.5px * var(--font-scale))">${stats.join('')}</div>`
    : '';

  return `
    <div class="label-sm" style="margin-bottom:8px">薪のある日々</div>
    ${photoStrip}
    ${statsHtml}
  `;
}

function dayOfYear(iso) {
  const d = new Date(iso + 'T00:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

// オフシーズン用のひとことは「焚ける/焚けない」の二択ではなく、その時々で意味のある
// アドバイスをいくつか候補に挙げ、日替わりでローテーションする(薪ストーブ好きの人が
// 興味を持ちそうな切り口: 乾燥・メンテ・樹種記録・写真記録など)。
function offSeasonTip({ weather, shelves, allChecks, maintenanceLogs, woodTypeCatalog, photos }) {
  const candidates = [];
  const todayWeather = weather?.daily?.[0];
  if (todayWeather && todayWeather.tempMax >= 30) {
    candidates.push('暑い時期です。薪割りなど力仕事は無理をせず、水分補給も忘れずに。');
  }
  const dryShelf = shelves.find((s) =>
    shouldShowDryAdvisory(s, allChecks.filter((c) => c.shelfId === s.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null)
  );
  if (dryShelf) candidates.push(`${dryShelf.name}はそろそろ乾燥薪かもしれません。乾燥状態を確認しておくと安心です。`);

  if (shelves.length) {
    const maxDaysSinceCheck = Math.max(...shelves.map((s) => daysBetween(s.lastCheckedAt)));
    if (maxDaysSinceCheck >= 60) {
      candidates.push('しばらく薪棚をチェックしていないようです。虫・カビや雨漏りがないか見ておくと安心です。');
    }
  }
  if (woodTypeCatalog.length < 2) {
    candidates.push('焚いた樹種を記録しておくと、樹種コレクションが賑わってきますよ。');
  }
  const hasRecentPhoto = photos.some((p) => daysBetween(p.date) <= 30);
  if (!hasRecentPhoto) {
    candidates.push('薪棚の様子を写真に残しておくと、後で見返した時に面白いですよ。');
  }
  const lastMaint = maintenanceLogs[0];
  if (!lastMaint || daysBetween(lastMaint.date) >= 300) {
    candidates.push('ストーブのメンテナンス(煙突掃除やガスケットの状態)を確認するのに良い時期です。');
  }
  // 締めの一言は複数の言い回しを用意し、日替わりで表情を変える(元の実装は1本だけだった
  // 枠を、複数の視点で書いた文の中から日替わりで1本選ぶ形にする。他の具体的な候補を
  // 薄めすぎないよう、この枠自体は依然として1つ分のままにする)。
  const closingLines = [
    'オフシーズンです。薪棚チェックやストーブのメンテナンスをしておくと、シーズン入りがスムーズです。',
    '火を入れていない時期こそ、薪と道具の状態がよく見えるものです。',
    '良い薪は、シーズンが始まってから慌てて作るものではなく、オフシーズンの今つくられています。',
    '静かな季節ですが、暖炉のある暮らしはこの時期の下ごしらえで決まります。',
  ];
  candidates.push(closingLines[dayOfYear(todayIso()) % closingLines.length]);

  return candidates[dayOfYear(todayIso()) % candidates.length];
}

function hitokoto(ctx) {
  const { score, shelf, weather, offSeason, phase, lastCheckDate } = ctx;
  if (phase === 'off') return offSeasonTip(ctx);
  if (phase === 'shoulder') {
    const month = Number(todayIso().slice(5, 7));
    return [10, 11].includes(month)
      ? 'シーズンが近づいてきました。薪棚のチェックと乾燥具合の確認をしておくと安心です。'
      : 'シーズンも落ち着いてきました。来季に向けて薪棚を整理しておくとスムーズです。';
  }
  if (offSeason) {
    return 'しばらく焚いていないようです。無理のない範囲で薪棚の様子を見ておくと安心です。';
  }
  if (!shelf) return '薪棚がまだ登録されていません。「薪を追加」から始めましょう。';
  // 状態ごとの一言も、日替わりで複数の言い回しから選ぶ(同じ状態が続く間ずっと
  // 同じ一文が表示され続けると単調なため。いずれも他者の発言の引用ではなくオリジナル)。
  const rotate = (lines) => lines[dayOfYear(todayIso()) % lines.length];
  const parts = [];
  if (score >= 70) {
    parts.push(
      rotate([
        'しっかり焚けるだけの蓄えがあります。',
        'この量なら、多少の寒波が来ても慌てずに済みます。',
        'よく準備できています。あとは乾燥が進むのを待つだけです。',
      ])
    );
  } else if (score >= 40) {
    const daysSinceCheck = lastCheckDate ? daysBetween(lastCheckDate) : null;
    if (daysSinceCheck == null || daysSinceCheck >= 14) {
      parts.push(
        rotate([
          '今のところは焚けますが、薪棚チェック(乾燥状態・虫カビ・雨漏りなど)をしておくとより安心です。',
          '焚く分には困らない量ですが、しばらく棚を見ていないなら一度様子を確認しておきたいところです。',
          '量は足りていますが、質(乾燥具合)は見た目では分かりません。チェックしておくと安心です。',
        ])
      );
    } else {
      parts.push(rotate(['今のところは焚けます。', '今のところは順調です。', '今日も問題なく焚けそうです。']));
    }
  } else {
    parts.push(
      rotate(['薪棚の残りが少なくなってきました。', 'そろそろ棚の底が見えてきた頃合いです。', '薪を足すと、また安心して焚けます。'])
    );
  }
  const peakRisk = weather ? upcoming48hRisk(weather.daily) : null;
  if (peakRisk) parts.push('冷え込みや雨の予報があるので、多めに運んでおくと安心です。');
  return parts.join('');
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
  document.getElementById('home-note').innerHTML = `
    <div style="font-size:calc(12.5px * var(--font-scale));line-height:1.7">${hitokoto({
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
    })}</div>
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
  const livingHtml = livingWithWoodHtml(previousSeason);
  livingEl.innerHTML = livingHtml;
  livingEl.style.display = livingHtml ? '' : 'none';

  // 暮らし: レギュラー薪棚への導線。天気は詳細情報として下の方に控えめに置く
  const shelfRefEl = document.getElementById('home-shelf-ref');
  const shelfRefHtml = mainShelfRefHtml(shelves, profile, offSeason);
  shelfRefEl.innerHTML = shelfRefHtml;
  shelfRefEl.style.display = shelfRefHtml ? '' : 'none';

  document.getElementById('home-weather-strip').innerHTML = weatherStripHtml(weather);
  document.getElementById('home-weather-source').innerHTML = weatherSourceHtml(weather);

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
      <div style="font-size:calc(10px * var(--font-scale));color:var(--leather-text);letter-spacing:.5px">薪ストーブ</div>
      <div class="slab" style="font-size:calc(14px * var(--font-scale));font-weight:700">${profile.stove.name}</div>
    </div>
    ${years ? `<div style="font-size:calc(9px * var(--font-scale));color:#d9c6a8;border:1px solid rgba(242,234,214,.25);padding:3px 7px;border-radius:4px;flex-shrink:0">使用${years}年目</div>` : ''}
    <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;color:var(--leather-text)">
      <span style="font-size:calc(10px * var(--font-scale));white-space:nowrap">メンテ記録</span>
      <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg>
    </div>
  `;
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
