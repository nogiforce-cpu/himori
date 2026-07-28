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
  updateShelf,
  getWeatherCache,
  pushAnshinSnapshot,
  getCurrentSeason,
  startNewSeason,
  removeSeason,
  endCurrentSeason,
  getSeasons,
} from '../store.js';
import {
  resolveMainShelf,
  computeAnshin,
  applyBurnConsumption,
  estimateDaysLeft,
  isBelowSafetyLine,
  isOffSeason,
  seasonPhase,
  lastBurnDate,
  shouldShowDryAdvisory,
  shouldPromptSeasonEnd,
  moistureDisplayText,
  truckAnalogy,
  daysBetween,
  barColor,
  stoveYears,
  todayIso,
  BURN_CONSUMPTION_M3,
} from '../derive.js';
import { has48hAlert, factualTodayNote, upcomingDaysSummary } from '../weather.js';
import { showToast, go } from '../ui.js';
import { openSenseNoteSheet, openShelfPickerSheet } from './sheets.js';
import { state } from '../state.js';

const SNOOZE_KEY = 'himori.seasonPromptSnoozeUntil';

function shelfPhotoHtml(shelf, height) {
  const photos = getPhotos();
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  const src = photo ? photo.uri : 'assets/sample-woodshelf-1.jpg';
  return `<div class="photo-ph" style="height:${height}px;margin-bottom:10px"><img src="${src}" alt=""></div>`;
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
      // 降水確率は5%刻みに丸めて表示(日本の天気予報で馴染みのある単位に合わせる)。
      // 色は確率の高低で変えず、常に同じ青系の色にして「雨マーク=降水確率」だと一目で分かるようにする。
      const prob = d.precipitationProbability;
      const roundedProb = prob == null ? null : Math.round(prob / 5) * 5;
      const precipBadge =
        roundedProb == null
          ? ''
          : `<div class="p"><svg class="icon" viewBox="0 0 24 24" style="width:11px;height:11px;color:var(--rain)"><use href="#i-drop"/></svg>${roundedProb}%</div>`;
      return `<div class="day"><div class="d">${label}</div><div class="t">${d.tempMin}〜${d.tempMax}℃</div>${precipBadge}</div>`;
    })
    .join('');
}

function mainShelfCardHtml(shelves, profile, weather, burnLogs, offSeason) {
  const { shelf, isSuggestion } = resolveMainShelf(shelves, profile);
  if (!shelf) return `<div class="empty">薪棚がまだありません。「薪を追加」から登録してください。</div>`;

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
    <div style="font-size:15px;font-weight:700;margin:8px 0 10px">${shelf.name}</div>
    ${shelfPhotoHtml(shelf, 96)}
    <div class="row"><span class="label-sm">使える薪(残量)</span><span style="font-size:12px;font-weight:700">約${shelf.usableVolumeM3}m³${daysLeftText}</span></div>
    ${truckAnalogy(shelf.usableVolumeM3) ? `<div class="label-sm" style="text-align:right;margin-top:2px">${truckAnalogy(shelf.usableVolumeM3)}</div>` : ''}
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
  if (weather && has48hAlert(weather.daily)) parts.push('冷え込みや雨の予報があるので、多めに運んでおくと安心です。');
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
  if (weather && has48hAlert(weather.daily)) {
    banners.push(
      `<div class="banner"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-drop"/></svg><span>48時間以内に冷え込み・雨・雪の予報があります。多めに運んでおくと安心です。</span></div>`
    );
  }
  bannerEl.innerHTML = banners.join('');

  document.getElementById('home-weather-strip').innerHTML = weatherStripHtml(weather);

  document.getElementById('home-recommend').innerHTML = mainShelfCardHtml(shelves, profile, weather, burnLogs, offSeason);

  const anshinEl = document.getElementById('home-anshin');
  anshinEl.innerHTML = `
    <div class="ring-wrap">${ringSvg(score)}<div class="val">${score}%</div></div>
    <div>
      <div style="font-size:13px;font-weight:700;margin-bottom:3px">薪の充足率</div>
      <div style="font-size:11px;color:var(--khaki);line-height:1.6">使える薪(${sumUsable(shelves)}m³) ÷ 想定シーズン使用量(${profile.seasonTargetM3}m³)</div>
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
    <div style="font-size:12px;line-height:1.7">${hitokoto({
      score,
      shelf: mainShelf,
      weather,
      offSeason,
      phase: seasonPhase(),
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
  stoveEl.innerHTML = `
    <div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;border:1px solid var(--leather-line)">
      <img src="assets/sample-stove.jpg" alt="" style="width:100%;height:100%;object-fit:cover">
    </div>
    <div style="flex:1">
      <div style="font-size:10px;color:var(--leather-text);letter-spacing:.5px">薪ストーブ</div>
      <div class="slab" style="font-size:14px;font-weight:700">${profile.stove.name}</div>
    </div>
    ${years ? `<div style="font-size:9px;color:#d9c6a8;border:1px solid rgba(242,234,214,.25);padding:3px 7px;border-radius:4px">使用${years}年目</div>` : ''}
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
  const prevUsableVolumeM3 = shelf.usableVolumeM3;
  const prevRemainingPercent = shelf.remainingPercent;
  const patch = applyBurnConsumption(shelf);
  updateShelf(shelf.id, patch);
  const today = todayIso();
  const log = addBurnLog({ date: today, shelfId: shelf.id, note: '' });
  // 焚くのが久しぶりでシーズンが切れていた場合は「新しいシーズンの始まり」として
  // 少しワクワクする言い回しにする(オフシーズンの寂しさと対になる演出)
  const isSeasonStart = !getCurrentSeason();
  const createdSeason = isSeasonStart ? startNewSeason(today) : null;
  render();

  const undoBurn = () => {
    updateShelf(shelf.id, { usableVolumeM3: prevUsableVolumeM3, remainingPercent: prevRemainingPercent });
    removeBurnLog(log.id);
    if (createdSeason) removeSeason(createdSeason.id);
    render();
    showToast('取り消しました');
  };

  const toastMessage = isSeasonStart ? '🔥今シーズンの焚き始めです。今年も暖かい冬になりますように。' : '今日の記録を保存しました';
  const actions = [{ label: '元に戻す', onClick: undoBurn }];
  if (!isSeasonStart) {
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
  localStorage.setItem(SNOOZE_KEY, d.toISOString().slice(0, 10));
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
