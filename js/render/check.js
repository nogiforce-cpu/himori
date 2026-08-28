import { getShelf, getChecksForShelf, addCheck, updateCheck, updateShelf, addPhoto, getWeatherCache, getPhotos, getProfile, getWoodAdditions } from '../store.js';
import { dryFriendlyDaysCount, todayIso, DRY_MOISTURE_THRESHOLD_PERCENT, CHECKLIST_ITEMS, CHECK_STATE_LABELS, nextCheckState, shelfStatusLabel, shelfStatusNote, monthDayLabel } from '../derive.js';
import { factualTodayNote, isWeatherCacheValid } from '../weather.js';
import { WEATHER_V2_ENABLED } from '../weather-v2-flag.js';
import { showToast, go, openOverlay, closeOverlay } from '../ui.js';
import { state, ensureCurrentShelf } from '../state.js';
import { openShelfPickerSheet, openShelfEditSheet, openCheckEditSheet, openPhotoZoomSheet, percentSliderHtml, wirePercentSlider } from './sheets.js';
import { pickImageFile, fileToResizedDataUrl, noPhotoPlaceholderHtml } from '../photos.js';

let checklistDraft = {};
let draftShelfId = null;

function resetDraftIfNeeded(shelfId) {
  if (draftShelfId !== shelfId) {
    draftShelfId = shelfId;
    checklistDraft = {};
    CHECKLIST_ITEMS.forEach((i) => {
      checklistDraft[i.key] = 'good';
    });
  }
}

export function render() {
  const shelfId = ensureCurrentShelf();
  const shelf = getShelf(shelfId);
  resetDraftIfNeeded(shelfId);

  const headerEl = document.getElementById('check-shelf-header');
  const bodyEl = document.getElementById('check-body');
  if (!shelf) {
    headerEl.innerHTML = `<div class="empty">薪棚がまだ登録されていません。<button class="link-btn" data-action="open-add-shelf" style="padding:0">薪棚を登録する</button></div>`;
    bodyEl.style.display = 'none';
    return;
  }
  bodyEl.style.display = '';
  const isMain = getProfile().mainShelfId === shelf.id;
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? getPhotos().find((p) => p.id === photoId) : null;
  // 「詳細」の役割(この薪棚をじっくり見る)は、数字より先に現在の写真が目に入る構成を
  // 優先する。写真は見るための要素なので、タップしても記録画面には遷移させず
  // 拡大表示のみにする(記録の操作は下の「今日の薪棚を記録」区画に分離する)。
  const bigPhotoHtml = photo
    ? `<div class="photo-ph" id="check-shelf-photo" style="width:100%;height:180px;cursor:pointer"><img src="${photo.uri}" alt=""></div>`
    : noPhotoPlaceholderHtml('写真未登録', 'width:100%;height:180px');
  headerEl.innerHTML = `
    ${bigPhotoHtml}
    <div style="display:flex;align-items:flex-start;gap:8px;margin-top:12px">
      <div style="flex:1;min-width:0;cursor:pointer" data-action="pick-shelf">
        <div style="font-size:calc(15px * var(--font-scale));font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${shelf.name}${isMain ? '<span class="main-tag">いつもの薪棚</span>' : ''}
          <svg class="icon" viewBox="0 0 24 24" style="width:13px;height:13px;color:var(--khaki);transform:rotate(90deg);flex-shrink:0"><use href="#i-chevright"/></svg>
        </div>
        <div style="font-size:calc(13px * var(--font-scale));font-weight:700;margin-top:4px">${shelfStatusLabel(shelf.status)} ${shelf.usableVolumeM3}m³</div>
        ${shelfStatusNote(shelf.status) ? `<div class="label-sm">${shelfStatusNote(shelf.status)}</div>` : ''}
        <div class="label-sm" style="margin-top:2px">棚のサイズ 約${shelf.totalVolumeM3}m³${shelf.woodTypes?.length ? `・樹種:${shelf.woodTypes.join('・')}` : ''}</div>
      </div>
      <button class="iconbtn" data-action="edit-shelf" aria-label="薪棚の設定" style="flex-shrink:0"><svg class="icon" viewBox="0 0 24 24" style="width:17px;height:17px"><use href="#i-edit"/></svg></button>
    </div>
  `;
  const shelfPhotoEl = document.getElementById('check-shelf-photo');
  if (shelfPhotoEl) shelfPhotoEl.addEventListener('click', () => openPhotoZoomSheet(photo.uri));

  const weather = getWeatherCache();
  const noteParts = [];
  // 気象V2: 古いキャッシュ(取得失敗が続いている等)は「新しい予報」のように見せない。
  if (weather && (!WEATHER_V2_ENABLED || isWeatherCacheValid(weather))) {
    const note = factualTodayNote(weather.daily);
    if (note) noteParts.push(note);
    const dryDays = dryFriendlyDaysCount(weather.daily);
    if (dryDays != null) noteParts.push(`今後1週間は乾燥が進みやすい日(気温を踏まえた目安)が${dryDays}日ある見込みです`);
  }
  document.getElementById('check-weather-note').textContent = noteParts.join(' / ');

  document.getElementById('checklist').innerHTML = CHECKLIST_ITEMS.map((item) => {
    const val = checklistDraft[item.key];
    return `
      <div class="checklist-item">
        <span class="ico"><svg class="icon" viewBox="0 0 24 24" style="width:15px;height:15px"><use href="#i-check"/></svg></span>
        <span class="name">${item.label}</span>
        <button class="toggle-pill ${val}" data-action="toggle-check-item" data-key="${item.key}">
          <svg class="icon" viewBox="0 0 24 24" style="width:12px;height:12px"><use href="#${val === 'good' ? 'i-check' : 'i-info'}"/></svg>
          ${CHECK_STATE_LABELS[val]}
        </button>
      </div>`;
  }).join('');

  const history = getChecksForShelf(shelf.id);
  const latestCheck = history[0] || null;

  const refPhoto = shelf.referencePhotoId ? getPhotos().find((p) => p.id === shelf.referencePhotoId) : null;
  document.getElementById('check-residual').innerHTML = `
    <div class="label-sm" style="margin-bottom:8px;font-weight:700">写真と残量</div>
    <div class="row" style="align-items:flex-start;gap:12px;margin-bottom:12px">
      <div class="photo-ph" id="check-ref-photo" style="width:92px;height:92px;flex-shrink:0;cursor:pointer">
        ${refPhoto ? `<img src="${refPhoto.uri}" alt="">` : `<svg class="icon" viewBox="0 0 24 24" style="width:18px;height:18px"><use href="#i-camera"/></svg>`}
      </div>
      <div style="flex:1;padding-top:2px">
        <div class="label-sm" style="margin-bottom:4px">満タン(100%)時点の写真</div>
        ${refPhoto ? `<div class="label-sm" style="margin-bottom:6px">タップで拡大して見比べられます</div>` : ''}
        <button class="link-btn" style="padding:0" id="check-set-ref-photo">${refPhoto ? '写真を残す(撮り直す)' : 'タップして写真を残す'}</button>
      </div>
    </div>
    <div class="field" style="margin-bottom:0">
      ${percentSliderHtml('check-residual-pct', shelf.remainingPercent, '今の残量(写真と見比べて合わせてください)')}
    </div>
  `;
  wirePercentSlider(document, 'check-residual-pct');
  // 満タン写真を撮り直した時は、それを薪棚の「今の写真」としても採用する(写真は
  // 見比べ用の基準であると同時に、薪棚一覧・ホームなどに表示される代表写真でもあり、
  // 撮り直すたびに薪棚の記録が自然に積み上がっていくようにするため)。
  const setRefPhoto = async () => {
    const file = await pickImageFile();
    if (!file) return;
    const dataUrl = await fileToResizedDataUrl(file);
    try {
      const photo = addPhoto({ category: '薪棚', date: todayIso(), uri: dataUrl });
      updateShelf(shelf.id, { referencePhotoId: photo.id, photoIds: [...shelf.photoIds, photo.id] });
      render();
    } catch {
      showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
    }
  };
  document.getElementById('check-set-ref-photo').addEventListener('click', setRefPhoto);
  document.getElementById('check-ref-photo').addEventListener('click', () => {
    if (refPhoto) openPhotoZoomSheet(refPhoto.uri);
    else setRefPhoto();
  });

  // 含水率は数字だけ見せても「良いのか悪いのか」判断できないため、一般的な目安
  // (20%以下で十分乾燥)と比べた良好/やや高めの評価を添える。
  const moistureNote = (v) => (v <= DRY_MOISTURE_THRESHOLD_PERCENT ? '良好' : 'やや高め');
  const prevMoistureText =
    latestCheck?.moisturePercent != null
      ? `${latestCheck.moisturePercent}%(${moistureNote(latestCheck.moisturePercent)})`
      : '実測なし';
  document.getElementById('check-moisture-field').innerHTML = `
    <label>含水率(任意・モイスチャーメーター実測値)</label>
    <div class="box num-field-row">
      <div class="prev-value">前回<b>${prevMoistureText}</b></div>
      <svg class="icon arrow-ic" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-chevright"/></svg>
      <div class="new-value"><input class="box" style="padding:0" type="number" id="check-moisture" placeholder="例: 18" min="0" max="60" step="1"><span class="label-sm">%</span></div>
    </div>
    <div class="label-sm" style="margin-top:4px">目安:${DRY_MOISTURE_THRESHOLD_PERCENT}%以下で十分乾燥した薪とされています</div>
  `;

  // 薪の追加も、薪棚の状態が変わった出来事という意味ではチェック記録と同じ時系列の
  // 一部なので、まとめて1つの「最近の変化」として表示する(以前は薪を追加しても、
  // ここには一切反映されず、カレンダーの日別詳細でしか見られなかった)。増減どちらも
  // 中立な事実として書き、「残量◯%」のような在庫的な言い回しは避ける。
  const additions = getWoodAdditions().filter((a) => a.shelfId === shelf.id);
  const timeline = [
    ...history.map((h) => ({ type: 'check', date: h.date, data: h })),
    ...additions.map((a) => ({ type: 'addition', date: a.date, data: a })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const historyEl = document.getElementById('check-history');
  historyEl.innerHTML = timeline.length
    ? timeline
        .slice(0, 8)
        .map((entry, i) => {
          if (entry.type === 'check') {
            const h = entry.data;
            const prevUsable = timeline.slice(i + 1).find((e) => e.type === 'check' || e.type === 'addition')?.data.usableVolumeM3;
            const diff = prevUsable != null ? Math.round((h.usableVolumeM3 - prevUsable) * 100) / 100 : null;
            const diffText = diff == null || diff === 0 ? '' : diff > 0 ? `・${diff}m³増加` : `・${Math.abs(diff)}m³使用`;
            return `
              <div class="event-row" style="cursor:pointer" data-check-id="${h.id}">
                <div class="thumb icon"><svg class="icon" viewBox="0 0 24 24"><use href="#i-check"/></svg></div>
                <div class="text">
                  <div>薪棚を記録しました(使える薪${h.usableVolumeM3}m³${diffText})${h.moisturePercent != null ? `・含水率${h.moisturePercent}%(${moistureNote(h.moisturePercent)})` : ''}</div>
                  <div class="label-sm">${monthDayLabel(h.date)}</div>
                </div>
              </div>`;
          }
          const a = entry.data;
          const detail = [a.source, a.price != null ? `¥${a.price.toLocaleString()}` : null].filter(Boolean).join('・');
          return `
            <div class="event-row">
              <div class="thumb icon"><svg class="icon" viewBox="0 0 24 24" style="color:var(--green)"><use href="#i-plus"/></svg></div>
              <div class="text">
                <div>薪が${a.addedVolumeM3}m³増えました${detail ? `(${detail})` : ''}</div>
                <div class="label-sm">${monthDayLabel(a.date)}</div>
              </div>
            </div>`;
        })
        .join('')
    : `<div class="empty">まだ記録がありません。</div>`;
  historyEl.querySelectorAll('.event-row[data-check-id]').forEach((row) => {
    row.addEventListener('click', () => {
      openCheckEditSheet(row.dataset.checkId, () => render());
    });
  });

  // 写真の記録: この薪棚に登録された写真を時系列で並べ、見た目の変化を
  // 振り返れるようにする(将来のBefore/Now機能の土台にもなる並び)。
  const photoRecordEl = document.getElementById('check-photo-record');
  const shelfPhotos = getPhotos()
    .filter((p) => shelf.photoIds.includes(p.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 6);
  if (photoRecordEl) {
    photoRecordEl.innerHTML = shelfPhotos.length
      ? shelfPhotos
          .map(
            (p) => `
        <div class="event-row" style="cursor:pointer" data-photo-uri="${p.id}">
          <div class="thumb"><img src="${p.uri}" alt=""></div>
          <div class="text">
            <div class="label-sm">${monthDayLabel(p.date)}</div>
          </div>
        </div>`
          )
          .join('')
      : `<div class="empty">まだ写真がありません。</div>`;
    photoRecordEl.querySelectorAll('[data-photo-uri]').forEach((row) => {
      const p = shelfPhotos.find((sp) => sp.id === row.dataset.photoUri);
      row.addEventListener('click', () => openPhotoZoomSheet(p.uri));
    });
  }
}

export function toggleChecklistItem(key) {
  checklistDraft[key] = nextCheckState(checklistDraft[key]);
  render();
}

// 同じ内容かどうかの比較。項目の並び順に依存しないようキーを揃えて比較する。
function checksEqual(a, b) {
  if (!a || !b) return false;
  const sameItems = CHECKLIST_ITEMS.every((i) => a.items?.[i.key] === b.items?.[i.key]);
  return (
    sameItems &&
    a.remainingPercent === b.remainingPercent &&
    a.usableVolumeM3 === b.usableVolumeM3 &&
    a.moisturePercent === b.moisturePercent &&
    (a.memo || '') === (b.memo || '')
  );
}

// 同じ日に記録が既にある時、黙って上書き・黙って追加のどちらもせず選んでもらう
// (上書きだと朝夜2回分のような別の観測が消えてしまい、常に追加だと内容が同じなのに
// 重複が増え続けるため、どちらのトラブルも避けられるようにユーザーに確認する)。
function openSameDayChoiceSheet({ existingDate, onOverwrite, onAddNew }) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">今日はすでに記録があります</div>
      <div style="font-size:calc(13px * var(--font-scale));line-height:1.7;color:var(--cream);margin-bottom:16px">${existingDate}の記録を書き換えますか?それとも別の記録として追加しますか?</div>
      <button class="btn-primary" id="same-day-overwrite" style="margin-bottom:8px">上書きする</button>
      <button class="btn-ghost" id="same-day-add" style="width:100%;margin-bottom:8px">別の記録として追加</button>
      <button class="btn-ghost" data-action="close-overlay" style="width:100%">キャンセル</button>
    </div>
  `);
  ov.querySelector('#same-day-overwrite').addEventListener('click', () => {
    closeOverlay();
    onOverwrite();
  });
  ov.querySelector('#same-day-add').addEventListener('click', () => {
    closeOverlay();
    onAddNew();
  });
}

export function saveCheck() {
  const shelfId = ensureCurrentShelf();
  let shelf = getShelf(shelfId);
  if (!shelf) return;
  const memo = document.getElementById('check-memo').value.trim();
  const moistureRaw = document.getElementById('check-moisture').value;
  const moisturePercent = moistureRaw === '' ? null : Math.max(0, Math.min(60, Number(moistureRaw)));

  // 自己申告の残量%(写真と見比べての目視補正)。スライダーは常に値を持つので、
  // 動かしていなければ今の残量のまま=実質的な変更なしとして扱われる。
  const pct = Math.max(0, Math.min(100, Number(document.getElementById('check-residual-pct').value)));
  const usable = Math.round(((shelf.totalVolumeM3 * pct) / 100) * 100) / 100;
  updateShelf(shelf.id, { remainingPercent: pct, usableVolumeM3: usable });
  shelf = getShelf(shelfId);

  const payload = {
    shelfId: shelf.id,
    date: todayIso(),
    remainingPercent: shelf.remainingPercent,
    usableVolumeM3: shelf.usableVolumeM3,
    items: { ...checklistDraft },
    moisturePercent,
    memo,
  };

  const finish = (message) => {
    updateShelf(shelf.id, { lastCheckedAt: todayIso() });
    document.getElementById('check-memo').value = '';
    document.getElementById('check-moisture').value = '';
    render();
    showToast(message);
  };

  const todayExisting = getChecksForShelf(shelf.id).find((c) => c.date === todayIso());

  // 何も変わっていないのに「記録する」を押しただけなら、無意味な重複を増やさず何もしない
  if (todayExisting && checksEqual(todayExisting, payload)) {
    showToast('変更がないため、記録はそのままです');
    return;
  }

  if (todayExisting) {
    openSameDayChoiceSheet({
      existingDate: todayExisting.date,
      onOverwrite: () => {
        updateCheck(todayExisting.id, payload);
        finish('薪棚の記録を更新しました');
      },
      onAddNew: () => {
        addCheck(payload);
        finish('薪棚の今を記録しました');
      },
    });
    return;
  }

  addCheck(payload);
  finish('薪棚の今を記録しました');
}

export function pickShelf() {
  openShelfPickerSheet(state.currentShelfId, (shelfId) => {
    state.currentShelfId = shelfId;
    render();
  });
}

export function backToShelves() {
  go('shelves');
}

export function editShelf() {
  const shelfId = ensureCurrentShelf();
  openShelfEditSheet(shelfId, () => render());
}
