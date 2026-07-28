import { getShelf, getChecksForShelf, addCheck, updateShelf, addPhoto, getWeatherCache, getPhotos, getProfile } from '../store.js';
import { daysBetween, dryFriendlyDaysCount, todayIso } from '../derive.js';
import { factualTodayNote } from '../weather.js';
import { showToast, go } from '../ui.js';
import { state, ensureCurrentShelf } from '../state.js';
import { openShelfPickerSheet, openShelfEditSheet } from './sheets.js';
import { pickImageFile, fileToResizedDataUrl } from '../photos.js';

const CHECKLIST_ITEMS = [
  { key: 'dryness', label: '乾燥状態' },
  { key: 'pestMold', label: '虫・カビ' },
  { key: 'leakMoisture', label: '雨漏り・湿気' },
  { key: 'airflow', label: '通気・風通し' },
  { key: 'stackCondition', label: '薪の崩れ・整頓' },
];

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
  if (!shelf) {
    headerEl.innerHTML = `<div class="empty">薪棚がありません。先に「薪を追加」から登録してください。</div>`;
    document.getElementById('checklist').innerHTML = '';
    document.getElementById('check-history').innerHTML = '';
    document.getElementById('check-weather-note').textContent = '';
    return;
  }
  const lastDays = daysBetween(shelf.lastCheckedAt);
  const dryingDays = shelf.dryingStartedAt ? daysBetween(shelf.dryingStartedAt) : null;
  const isMain = getProfile().mainShelfId === shelf.id;
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? getPhotos().find((p) => p.id === photoId) : null;
  const thumbHtml = `<img src="${photo ? photo.uri : 'assets/sample-woodshelf-1.jpg'}" alt="">`;
  headerEl.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;flex:1;cursor:pointer" data-action="pick-shelf">
      <div class="photo-ph" style="width:56px;height:56px;flex-shrink:0">${thumbHtml}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:4px">
          ${shelf.name}${isMain ? '<span class="main-tag">レギュラー</span>' : ''}
          <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;color:var(--khaki);transform:rotate(90deg);flex-shrink:0"><use href="#i-chevright"/></svg>
        </div>
        <div class="label-sm">残量${shelf.remainingPercent}%(約${shelf.usableVolumeM3}m³)・最終チェック${lastDays}日前${dryingDays != null ? `・乾燥経過${dryingDays}日` : ''}</div>
      </div>
    </div>
    <button class="iconbtn" data-action="edit-shelf"><svg class="icon" viewBox="0 0 24 24" style="width:17px;height:17px"><use href="#i-edit"/></svg></button>
  `;

  const weather = getWeatherCache();
  const noteParts = [];
  if (weather) {
    const note = factualTodayNote(weather.daily);
    if (note) noteParts.push(note);
    const dryDays = dryFriendlyDaysCount(weather.daily);
    if (dryDays != null) noteParts.push(`今後1週間は乾燥が進みやすい日(降水なし・湿度65%以下)が${dryDays}日ある見込みです`);
  }
  document.getElementById('check-weather-note').textContent = noteParts.join(' / ');

  document.getElementById('checklist').innerHTML = CHECKLIST_ITEMS.map((item) => {
    const val = checklistDraft[item.key];
    return `
      <div class="checklist-item">
        <span class="ico"><svg class="icon" viewBox="0 0 24 24" style="width:15px;height:15px"><use href="#i-check"/></svg></span>
        <span class="name">${item.label}</span>
        <button class="toggle-pill ${val === 'good' ? 'good' : 'warning'}" data-action="toggle-check-item" data-key="${item.key}">
          <svg class="icon" viewBox="0 0 24 24" style="width:12px;height:12px"><use href="#${val === 'good' ? 'i-check' : 'i-info'}"/></svg>
          ${val === 'good' ? '良好' : '異常あり'}
        </button>
      </div>`;
  }).join('');

  const refPhoto = shelf.referencePhotoId ? getPhotos().find((p) => p.id === shelf.referencePhotoId) : null;
  document.getElementById('check-residual').innerHTML = `
    <div class="label-sm" style="margin-bottom:8px;font-weight:700">残量の記録</div>
    <div class="row" style="align-items:flex-start;gap:10px">
      <div class="photo-ph" id="check-ref-photo" style="width:64px;height:64px;flex-shrink:0;cursor:pointer">
        ${refPhoto ? `<img src="${refPhoto.uri}" alt="">` : `<svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-camera"/></svg>`}
      </div>
      <div style="flex:1">
        <div class="label-sm" style="margin-bottom:4px">満タン(100%)時点の写真</div>
        <button class="link-btn" style="padding:0" id="check-set-ref-photo">${refPhoto ? '撮り直す' : '登録する'}</button>
        <div class="label-sm" style="margin-top:6px">見比べながら、実際の残量を自己申告で補正できます(任意)</div>
      </div>
    </div>
    <div class="field" style="margin-top:10px;margin-bottom:0">
      <label>実際の残量(自己申告・%、空欄なら計算値の${shelf.remainingPercent}%のまま)</label>
      <div class="box num-field-row"><input class="box" style="padding:0" type="number" id="check-residual-pct" min="0" max="100" step="1" placeholder="${shelf.remainingPercent}"><span class="label-sm">%</span></div>
    </div>
  `;
  const setRefPhoto = async () => {
    const file = await pickImageFile();
    if (!file) return;
    const dataUrl = await fileToResizedDataUrl(file);
    const photo = addPhoto({ category: '薪棚', date: todayIso(), uri: dataUrl });
    updateShelf(shelf.id, { referencePhotoId: photo.id });
    render();
  };
  document.getElementById('check-set-ref-photo').addEventListener('click', setRefPhoto);
  document.getElementById('check-ref-photo').addEventListener('click', setRefPhoto);

  const history = getChecksForShelf(shelf.id);
  document.getElementById('check-history').innerHTML = history.length
    ? history
        .map(
          (h) =>
            `<div class="history-row"><span>${h.date}(${daysBetween(h.date)}日前)</span><span>残量${h.remainingPercent}%(約${h.usableVolumeM3}m³)${h.moisturePercent != null ? `・含水率${h.moisturePercent}%` : ''}</span></div>`
        )
        .join('')
    : `<div class="empty">まだチェック記録がありません。</div>`;
}

export function toggleChecklistItem(key) {
  checklistDraft[key] = checklistDraft[key] === 'good' ? 'warning' : 'good';
  render();
}

export function saveCheck() {
  const shelfId = ensureCurrentShelf();
  let shelf = getShelf(shelfId);
  if (!shelf) return;
  const memo = document.getElementById('check-memo').value.trim();
  const moistureRaw = document.getElementById('check-moisture').value;
  const moisturePercent = moistureRaw === '' ? null : Number(moistureRaw);

  // 自己申告の残量%が入力されていれば、計算値を上書きする(写真と見比べての目視補正)
  const residualRaw = document.getElementById('check-residual-pct').value;
  if (residualRaw !== '') {
    const pct = Math.max(0, Math.min(100, Number(residualRaw)));
    const usable = Math.round(((shelf.totalVolumeM3 * pct) / 100) * 100) / 100;
    updateShelf(shelf.id, { remainingPercent: Math.round(pct), usableVolumeM3: usable });
    shelf = getShelf(shelfId);
  }

  addCheck({
    shelfId: shelf.id,
    date: todayIso(),
    remainingPercent: shelf.remainingPercent,
    usableVolumeM3: shelf.usableVolumeM3,
    items: { ...checklistDraft },
    moisturePercent,
    memo,
  });
  updateShelf(shelf.id, { lastCheckedAt: todayIso() });

  document.getElementById('check-memo').value = '';
  document.getElementById('check-moisture').value = '';
  render();
  showToast('チェックを記録しました');
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
