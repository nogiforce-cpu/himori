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
} from '../store.js';
import {
  resolveMainShelf,
  computeAnshin,
  estimateDaysLeft,
  isBelowSafetyLine,
  isOffSeason,
  seasonPhase,
  lastBurnDate,
  shouldShowDryAdvisory,
  shouldPromptSeasonEnd,
  moistureDisplayText,
  daysBetween,
  barColor,
  stoveYears,
  todayIso,
  BURN_CONSUMPTION_M3,
} from '../derive.js';
import { upcoming48hRisk, factualTodayNote, upcomingDaysSummary } from '../weather.js';
import { showToast, go } from '../ui.js';
import { openSenseNoteSheet, openShelfPickerSheet } from './sheets.js';
import { state } from '../state.js';
import { localIsoDate } from '../date-utils.js';
import { noPhotoPlaceholderHtml } from '../photos.js';

const SNOOZE_KEY = 'himori.seasonPromptSnoozeUntil';

function shelfPhotoHtml(shelf, height) {
  const photos = getPhotos();
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  const style = `height:${height}px;margin-bottom:10px`;
  if (!photo) return noPhotoPlaceholderHtml('写真未登録', style);
  return `<div class="photo-ph" style="${style}"><img src="${photo.uri}" alt=""></div>`;
}

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
    ? `気象庁「${regionLabel}」の発表値(降水確率・最高/最低気温)。当日分のみ数値予報モデルの推定値。数時間ごとに更新。地域が体感と違う場合は設定から変更できます`
    : '数値予報モデル(Open-Meteo)による推定値を表示。数時間ごとに更新';
  return `
    <div class="label-sm" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>${label}</span>
      ${jmaUrl ? `<a href="${jmaUrl}" target="_blank" rel="noopener" class="link-btn" style="padding:0;white-space:nowrap">気象庁の予報を見る</a>` : ''}
    </div>`;
}

function mainShelfCardHtml(shelves, profile, weather, burnLogs, offSeason) {
  const { shelf, isSuggestion } = resolveMainShelf(shelves, profile);
  if (!shelf)
    return `<div class="empty">薪棚がまだ登録されていません。<button class="link-btn" data-action="open-add-shelf" style="padding:0">薪棚を登録する</button></div>`;

  const note = weather ? factualTodayNote(weather.daily) : null;
  const daysLeft = estimateDaysLeft(shelf, burnLogs);
  const daysLeftText = daysLeft == null ? '' : daysLeft >= 365 ? '・あと365日以上分' : `・あと${daysLeft}日分`;
  const latestCheck = getChecksForShelf(shelf.id)[0] || null;
  const advisory = shouldShowDryAdvisory(shelf, latestCheck)
    ? `<div class="dry-advisory">乾燥日数・含水率の目安からすると、そろそろ乾燥薪かもしれません。</div>`
    : '';
  const moistureText = moistureDisplayText(latestCheck);

  // オフシーズン中に「レギュラーにしませんか」と急かすと違和感があるため、候補提示は
  // シーズン中だけ目立たせる(オフシーズンはニュートラルな表示に留める)。
  const badgeHtml = isSuggestion
    ? offSeason
      ? `<span class="badge khaki">薪棚(レギュラー未設定)</span>`
      : `<span class="badge amber">レギュラーの候補</span>`
    : `<span class="badge khaki">レギュラー薪棚</span>`;
  const actionHtml = isSuggestion
    ? `<button class="link-btn" data-action="set-main-shelf" data-shelf-id="${shelf.id}">これをレギュラーにする</button>`
    : `<button class="link-btn" data-action="pick-main-shelf">薪棚を変更</button><button class="link-btn" data-action="release-main-shelf" style="margin-left:12px">レギュラーを未設定に戻す</button>`;

  return `
    ${badgeHtml}
    <div style="font-size:calc(15px * var(--font-scale));font-weight:700;margin:8px 0 10px">${shelf.name}</div>
    ${shelfPhotoHtml(shelf, 96)}
    <div class="row"><span class="label-sm">使える薪(残量)</span><span style="font-size:calc(12px * var(--font-scale));font-weight:700">約${shelf.usableVolumeM3}m³${daysLeftText}</span></div>
    <div class="progress"><div style="width:${shelf.remainingPercent}%;background:${barColor(shelf.remainingPercent)}"></div></div>
    ${moistureText ? `<div class="factual-note">${moistureText}</div>` : ''}
    ${note ? `<div class="factual-note">${note}</div>` : ''}
    ${advisory}
    <div class="row" style="margin-top:10px">${actionHtml}</div>
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
  candidates.push('オフシーズンです。薪棚チェックやストーブのメンテナンスをしておくと、シーズン入りがスムーズです。');

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
  const parts = [];
  if (score >= 70) {
    parts.push('しっかり焚けるだけの蓄えがあります。');
  } else if (score >= 40) {
    const daysSinceCheck = lastCheckDate ? daysBetween(lastCheckDate) : null;
    if (daysSinceCheck == null || daysSinceCheck >= 14) {
      parts.push('今のところは焚けますが、薪棚チェック(乾燥状態・虫カビ・雨漏りなど)をしておくとより安心です。');
    } else {
      parts.push('今のところは焚けます。');
    }
  } else {
    parts.push('残量が少なめです。薪の補充を検討しましょう。');
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
  if (isBelowSafetyLine(shelves, profile.safetyLineM3)) {
    banners.push(
      `<div class="banner" style="background:rgba(181,80,46,.14);border-color:rgba(181,80,46,.4)"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px;color:var(--red)"><use href="#i-info"/></svg><span>使える薪の合計が安心ライン(${profile.safetyLineM3}m³)を下回っています。薪を追加しましょう。</span></div>`
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

  document.getElementById('home-weather-strip').innerHTML = weatherStripHtml(weather);
  document.getElementById('home-weather-source').innerHTML = weatherSourceHtml(weather);

  document.getElementById('home-recommend').innerHTML = mainShelfCardHtml(shelves, profile, weather, burnLogs, offSeason);

  const anshinEl = document.getElementById('home-anshin');
  anshinEl.innerHTML = `
    <div class="ring-wrap">${ringSvg(score)}<div class="val">${score}%</div></div>
    <div>
      <div style="font-size:calc(13px * var(--font-scale));font-weight:700;margin-bottom:3px">薪の充足率</div>
      <div style="font-size:calc(11px * var(--font-scale));color:var(--khaki);line-height:1.6">使える薪(${sumUsable(shelves)}m³) ÷ 想定シーズン使用量(${profile.seasonTargetM3}m³)</div>
    </div>
  `;

  const seasons = getSeasons();
  const previousSeason = seasons.filter((s) => s.endDate).slice(-1)[0];
  const seasonDateParts = [];
  if (currentSeason) seasonDateParts.push(`🔥今シーズン開始 ${currentSeason.startDate}`);
  if (previousSeason) seasonDateParts.push(`前シーズン終了 ${previousSeason.endDate}`);
  document.getElementById('home-season-dates').textContent = seasonDateParts.join('・');

  const mainLastCheck = mainShelf ? getChecksForShelf(mainShelf.id)[0] : null;
  document.getElementById('home-note').innerHTML = `
    <div class="label-sm" style="margin-bottom:5px">今日のひとこと</div>
    <div style="font-size:calc(12px * var(--font-scale));line-height:1.7">${hitokoto({
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

  const stoveEl = document.getElementById('home-stove');
  const years = stoveYears(profile.stove.purchaseDate);
  const stovePhoto = profile.stove.photoId ? getPhotos().find((p) => p.id === profile.stove.photoId) : null;
  const stovePhotoHtml = stovePhoto
    ? `<img src="${stovePhoto.uri}" alt="" style="width:100%;height:100%;object-fit:cover">`
    : noPhotoPlaceholderHtml('', 'width:100%;height:100%');
  stoveEl.innerHTML = `
    <div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;border:1px solid var(--leather-line)">
      ${stovePhotoHtml}
    </div>
    <div style="flex:1">
      <div style="font-size:calc(10px * var(--font-scale));color:var(--leather-text);letter-spacing:.5px">薪ストーブ</div>
      <div class="slab" style="font-size:calc(14px * var(--font-scale));font-weight:700">${profile.stove.name}</div>
    </div>
    ${years ? `<div style="font-size:calc(9px * var(--font-scale));color:#d9c6a8;border:1px solid rgba(242,234,214,.25);padding:3px 7px;border-radius:4px">使用${years}年目</div>` : ''}
  `;
}

function sumUsable(shelves) {
  const v = shelves.filter((s) => s.status !== '来季用').reduce((sum, s) => sum + s.usableVolumeM3, 0);
  return Math.round(v * 100) / 100;
}

function ringSvg(score) {
  const c = 213.6;
  const offset = c * (1 - score / 100);
  return `
    <svg viewBox="0 0 80 80">
      <circle cx="40" cy="40" r="34" stroke="#171912" stroke-width="8" fill="none"/>
      <circle cx="40" cy="40" r="34" stroke="#D97732" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
    </svg>`;
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
    showToast('薪棚に使える薪がありません。「薪を追加」から補充してください。');
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
  const toastMessage = celebrateSeasonStart ? '🔥今シーズンの焚き始めです。今年も暖かい冬になりますように。' : '今日の記録を保存しました';
  const actions = [{ label: '元に戻す', onClick: undoBurn }];
  if (!celebrateSeasonStart) {
    actions.push({ label: 'ひとことを追加', onClick: () => openSenseNoteSheet(log.id, () => render()) });
  }
  showToast(toastMessage, actions);
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
  let message = '🔥今シーズンの記録を締めました。お疲れさまでした。';
  if (currentSeason) {
    const seasonBurns = burnLogs.filter((b) => b.date >= currentSeason.startDate && b.date <= end);
    if (seasonBurns.length > 0) {
      const usedVolume = Math.round(seasonBurns.length * BURN_CONSUMPTION_M3 * 100) / 100;
      message = `🔥今シーズンもお疲れさまでした。${seasonBurns.length}回焚いて、約${usedVolume}m³使いました。また来シーズンもよろしくお願いします。`;
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
